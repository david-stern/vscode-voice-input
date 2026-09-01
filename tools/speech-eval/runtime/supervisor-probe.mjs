import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIMITS = Object.freeze({
  frameBytes: 64 * 1024,
  bufferedBytes: 64 * 1024 + 4,
  totalOutputBytes: 256 * 1024,
  messageCount: 32,
  queuedMessages: 8,
  stderrCaptureBytes: 16 * 1024,
  authTimeoutMs: 200,
  gracefulShutdownMs: 100,
  termShutdownMs: 100,
  killShutdownMs: 500,
});
const EXPECTED_HELPER_SHA256 = '0fd0ae2174ab244e954d1061888c592ca0b5169224c155c54ccd40814dc1ab6b';
const allSessions = [];
const results = [];

async function main() {
  try {
    const identity = verifyPackagedHelperIdentity();
    results.push({
      scenario: 'helper-identity',
      absolute: true,
      regularFile: true,
      symlinkRejected: true,
      sha256: identity.sha256,
      meaning: 'package path and bytes verified before spawn',
    });
    await runNormal(identity.path);
    await runCrash(identity.path);
    await runHang(identity.path);
    await runMalformedOutput(identity.path);
    await runOversizedOutput(identity.path);
    await runStderrFlood(identity.path);
    await runMessageFlood(identity.path);
    await runMessageCount(identity.path);
    await runTotalOutput(identity.path);
    await runInvalidChallenge(identity.path);
    await runAuthTimeout(identity.path);
    await runIgnoredSigterm(identity.path);
    await runSpawnFailure();
  } finally {
    await Promise.all(allSessions.map((session) => session.shutdownBounded()));
  }

  const lingering = allSessions.filter((session) => session.pid !== undefined && isProcessAlive(session.pid));
  assert(lingering.length === 0, `no lingering children; found ${lingering.map((session) => session.pid).join(',')}`);
  console.log(JSON.stringify({ ok: true, sessionCount: allSessions.length, lingeringChildren: 0, results }, null, 2));
}

async function runNormal(helperPath) {
  const session = await startAuthenticated(helperPath, 'normal');
  session.send({ type: 'request', version: 1, requestId: 'probe-1', operation: 'ping' });
  const message = await session.next(500);
  assert(message?.type === 'result' && message.requestId === 'probe-1' && message.value === 'pong', 'normal response');
  const shutdown = await session.shutdownBounded();
  assert(shutdown.stage === 'graceful' && shutdown.terminal.code === 0, 'normal graceful shutdown');
  results.push({ scenario: 'normal', authenticated: true, result: 'pong', shutdown: shutdown.stage });
}

async function runCrash(helperPath) {
  const session = await startAuthenticated(helperPath, 'crash');
  session.send({ type: 'request', version: 1, requestId: 'crash-1', operation: 'crash' });
  const terminal = await session.closed;
  assert(terminal.code === 86, 'crash exit');
  results.push({ scenario: 'crash', supervisorSurvived: true, exitCode: terminal.code });
}

async function runHang(helperPath) {
  const session = await startAuthenticated(helperPath, 'hang');
  session.send({ type: 'request', version: 1, requestId: 'hang-1', operation: 'hang' });
  let timedOut = false;
  try {
    await session.next(100);
  } catch (error) {
    timedOut = error instanceof Error && error.message === 'response-timeout';
  }
  assert(timedOut, 'request deadline');
  const shutdown = await session.shutdownBounded();
  assert(shutdown.stage === 'graceful', 'hung operation graceful process shutdown');
  results.push({ scenario: 'request-timeout', deadlineMs: 100, shutdown: shutdown.stage });
}

async function runMalformedOutput(helperPath) {
  const session = await startAuthenticated(helperPath, 'malformed-output');
  session.send({ type: 'request', version: 1, requestId: 'malformed-1', operation: 'emit' });
  const rejection = await waitFor(session.rejected, 500, 'malformed output rejection');
  assert(rejection.reason === 'invalid-json', 'malformed JSON rejection');
  await session.shutdownBounded();
  results.push({ scenario: 'malformed-json', sessionRejected: true, callbackThrow: false });
}

async function runOversizedOutput(helperPath) {
  const session = await startAuthenticated(helperPath, 'oversized-output');
  session.send({ type: 'request', version: 1, requestId: 'oversized-1', operation: 'emit' });
  const rejection = await waitFor(session.rejected, 500, 'oversized output rejection');
  assert(rejection.reason === 'frame-size', 'oversized output rejection');
  await session.shutdownBounded();
  results.push({ scenario: 'oversized-output', sessionRejected: true, callbackThrow: false });
}

async function runStderrFlood(helperPath) {
  const session = await startAuthenticated(helperPath, 'stderr-flood');
  session.send({ type: 'request', version: 1, requestId: 'stderr-1', operation: 'emit' });
  const message = await session.next(1_000);
  assert(message?.value === 'stderr-drained', 'stderr flood response');
  await session.shutdownBounded();
  assert(session.stderrTotalBytes >= 512 * 1024, 'stderr fully drained');
  assert(session.stderrCapturedBytes === LIMITS.stderrCaptureBytes, 'stderr capture capped');
  assert(session.stderrTruncated, 'stderr truncation marked');
  results.push({
    scenario: 'stderr-flood',
    drainedBytes: session.stderrTotalBytes,
    capturedBytes: session.stderrCapturedBytes,
    truncated: session.stderrTruncated,
  });
}

async function runMessageFlood(helperPath) {
  const session = await startAuthenticated(helperPath, 'message-flood');
  session.send({ type: 'request', version: 1, requestId: 'flood-1', operation: 'emit' });
  const rejection = await waitFor(session.rejected, 500, 'message queue rejection');
  assert(rejection.reason === 'queue-limit', 'message queue cap');
  await session.shutdownBounded();
  results.push({ scenario: 'message-flood', queuedMessageCap: LIMITS.queuedMessages, sessionRejected: true });
}

async function runMessageCount(helperPath) {
  const session = await startAuthenticated(helperPath, 'normal');
  for (let index = 0; index < LIMITS.messageCount - 1; index += 1) {
    session.send({ type: 'request', version: 1, requestId: `count-${index}`, operation: 'ping' });
    await session.next(500);
  }
  session.send({ type: 'request', version: 1, requestId: 'count-overflow', operation: 'ping' });
  const rejection = await waitFor(session.rejected, 500, 'message count rejection');
  assert(rejection.reason === 'message-count-limit', 'message count cap');
  await session.shutdownBounded();
  results.push({ scenario: 'message-count', messageCap: LIMITS.messageCount, sessionRejected: true });
}

async function runTotalOutput(helperPath) {
  const session = await startAuthenticated(helperPath, 'total-output');
  for (let index = 0; index < 4; index += 1) {
    session.send({ type: 'request', version: 1, requestId: `bytes-${index}`, operation: 'emit' });
    await session.next(500);
  }
  session.send({ type: 'request', version: 1, requestId: 'bytes-overflow', operation: 'emit' });
  const rejection = await waitFor(session.rejected, 500, 'total output rejection');
  assert(rejection.reason === 'total-output-limit', 'total output cap');
  await session.shutdownBounded();
  results.push({ scenario: 'total-output', byteCap: LIMITS.totalOutputBytes, sessionRejected: true });
}

async function runInvalidChallenge(helperPath) {
  const session = spawnHelper(helperPath, 'normal');
  const secret = randomBytes(32);
  const shortChallenge = randomBytes(31);
  try {
    await session.writeSecret(secret);
    session.send({ type: 'challenge', version: 1, challenge: shortChallenge.toString('base64') });
    const terminal = await waitFor(session.closed, 500, 'invalid challenge close');
    assert(terminal.code === 68, 'exact 32-byte challenge');
  } finally {
    secret.fill(0);
    shortChallenge.fill(0);
    await session.shutdownBounded();
  }
  results.push({ scenario: 'invalid-challenge', exactCanonicalBytes: 32, rejected: true });
}

async function runAuthTimeout(helperPath) {
  const session = spawnHelper(helperPath, 'auth-timeout');
  let timedOut = false;
  try {
    await authenticate(session, LIMITS.authTimeoutMs);
  } catch (error) {
    timedOut = error instanceof Error && error.message === 'authentication-timeout';
  } finally {
    await session.shutdownBounded();
  }
  assert(timedOut, 'authentication deadline');
  results.push({ scenario: 'auth-timeout', deadlineMs: LIMITS.authTimeoutMs, terminated: true });
}

async function runIgnoredSigterm(helperPath) {
  const session = await startAuthenticated(helperPath, 'ignore-term');
  const shutdown = await session.shutdownBounded();
  assert(shutdown.stage === 'SIGKILL' && shutdown.terminal.signal === 'SIGKILL', 'SIGKILL escalation');
  results.push({
    scenario: 'ignored-sigterm',
    gracefulDeadlineMs: LIMITS.gracefulShutdownMs,
    termDeadlineMs: LIMITS.termShutdownMs,
    finalSignal: shutdown.terminal.signal,
  });
}

async function runSpawnFailure() {
  const missing = `/tmp/voice-input-missing-helper-${process.pid}`;
  const session = spawnManaged(missing, []);
  const rejection = await waitFor(session.rejected, 500, 'spawn failure');
  const terminal = await waitFor(session.closed, 500, 'spawn failure close');
  assert(rejection.reason === 'spawn-error' && terminal.spawnError, 'spawn failure handled');
  results.push({ scenario: 'spawn-failure', handled: true, callbackThrow: false });
}

function verifyPackagedHelperIdentity() {
  const declaredPath = fileURLToPath(new URL('./helper-probe.mjs', import.meta.url));
  assert(isAbsolute(declaredPath), 'helper path absolute');
  const stat = lstatSync(declaredPath);
  assert(stat.isFile() && !stat.isSymbolicLink(), 'helper is a non-symlink regular file');
  const realPath = realpathSync(declaredPath);
  const packageDirectory = realpathSync(dirname(fileURLToPath(import.meta.url)));
  assert(dirname(realPath) === packageDirectory && realPath === declaredPath, 'helper remains in package-controlled directory');
  const bytes = readFileSync(realPath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  bytes.fill(0);
  assert(sha256 === EXPECTED_HELPER_SHA256, 'helper SHA-256 identity');
  return { path: realPath, sha256 };
}

async function startAuthenticated(helperPath, mode) {
  const session = spawnHelper(helperPath, mode);
  try {
    await authenticate(session, LIMITS.authTimeoutMs);
    return session;
  } catch (error) {
    await session.shutdownBounded();
    throw error;
  }
}

function spawnHelper(helperPath, mode) {
  assert(isAbsolute(process.execPath), 'Node executable path absolute');
  return spawnManaged(realpathSync(process.execPath), [helperPath, mode]);
}

function spawnManaged(executablePath, args) {
  const session = new ManagedSession(executablePath, args);
  allSessions.push(session);
  return session;
}

async function authenticate(session, timeoutMs) {
  const secret = randomBytes(32);
  const challenge = randomBytes(32);
  let expected;
  let actual;
  try {
    expected = createHmac('sha256', secret).update(challenge).digest();
    await session.writeSecret(secret);
    session.send({ type: 'challenge', version: 1, challenge: challenge.toString('base64') });
    let ready;
    try {
      ready = await session.next(timeoutMs);
    } catch (error) {
      if (error instanceof Error && error.message === 'response-timeout') {
        throw new Error('authentication-timeout');
      }
      throw error;
    }
    actual = decodeCanonicalMac(ready);
    assert(actual && actual.length === expected.length && timingSafeEqual(actual, expected), 'HMAC pipe possession');
  } finally {
    secret.fill(0);
    challenge.fill(0);
    expected?.fill(0);
    actual?.fill(0);
  }
}

function decodeCanonicalMac(message) {
  if (
    !isPlainRecord(message)
    || message.type !== 'ready'
    || message.version !== 1
    || typeof message.mac !== 'string'
    || !/^[A-Za-z0-9+/]{43}=$/u.test(message.mac)
  ) return undefined;
  const mac = Buffer.from(message.mac, 'base64');
  if (mac.length !== 32 || mac.toString('base64') !== message.mac) {
    mac.fill(0);
    return undefined;
  }
  return mac;
}

class ManagedSession {
  constructor(executablePath, args) {
    this._closed = false;
    this._rejection = undefined;
    this._stderrCapture = Buffer.alloc(0);
    this.stderrTotalBytes = 0;
    this.stderrTruncated = false;
    this._exit = undefined;
    this._resolveClosed = undefined;
    this._resolveRejected = undefined;
    this.closed = new Promise((resolve) => { this._resolveClosed = resolve; });
    this.rejected = new Promise((resolve) => { this._resolveRejected = resolve; });

    try {
      this.child = spawn(executablePath, args, {
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
        env: {},
      });
    } catch {
      this._closed = true;
      this._reject('spawn-error');
      this._resolveClosed({ code: null, signal: null, spawnError: true });
      return;
    }

    this.reader = new FrameReader(this.child.stdout, (reason) => this._reject(reason));
    this.child.stderr.on('data', (chunk) => this._drainStderr(chunk));
    this.child.stderr.on('error', () => this._reject('stderr-error'));
    this.child.stdin.on('error', () => this._reject('stdin-error'));
    this.child.stdio[3].on('error', () => this._reject('secret-pipe-error'));
    this.child.once('error', () => this._reject('spawn-error'));
    this.child.once('exit', (code, signal) => {
      this._exit = { code, signal };
      this.reader.close('child-exit');
    });
    this.child.once('close', (code, signal) => {
      if (this._closed) return;
      this._closed = true;
      this.reader.close('child-close');
      this._resolveClosed({
        code: this._exit?.code ?? code,
        signal: this._exit?.signal ?? signal,
        spawnError: this._rejection?.reason === 'spawn-error',
      });
    });
  }

  get pid() { return this.child?.pid; }
  get stderrCapturedBytes() { return this._stderrCapture.length; }

  next(timeoutMs) {
    if (!this.reader) return Promise.reject(new Error('session-not-started'));
    return this.reader.next(timeoutMs);
  }

  async writeSecret(secret) {
    if (!this.child?.stdio[3] || this._closed) throw new Error('secret-pipe-unavailable');
    await new Promise((resolve, reject) => {
      this.child.stdio[3].end(secret, (error) => error ? reject(new Error('secret-write-failed')) : resolve());
    });
  }

  send(message) {
    const payload = Buffer.from(JSON.stringify(message), 'utf8');
    if (payload.length === 0 || payload.length > LIMITS.frameBytes) {
      payload.fill(0);
      throw new Error('outbound-frame-size');
    }
    const header = Buffer.alloc(4);
    header.writeUInt32BE(payload.length);
    const frame = Buffer.concat([header, payload]);
    payload.fill(0);
    if (this._closed || !this.child?.stdin.writable) return false;
    this.child.stdin.write(frame);
    frame.fill(0);
    return true;
  }

  shutdownBounded() {
    if (!this._shutdownPromise) this._shutdownPromise = this._shutdown();
    return this._shutdownPromise;
  }

  async _shutdown() {
    if (this._closed) return { stage: 'already-closed', terminal: await this.closed };
    this.send({ type: 'request', version: 1, requestId: 'shutdown', operation: 'shutdown' });
    let terminal = await settledWithin(this.closed, LIMITS.gracefulShutdownMs);
    if (terminal) return { stage: 'graceful', terminal };
    this.child?.kill('SIGTERM');
    terminal = await settledWithin(this.closed, LIMITS.termShutdownMs);
    if (terminal) return { stage: 'SIGTERM', terminal };
    this.child?.kill('SIGKILL');
    terminal = await settledWithin(this.closed, LIMITS.killShutdownMs);
    if (!terminal) throw new Error(`child-${this.pid ?? 'unknown'}-survived-SIGKILL`);
    return { stage: 'SIGKILL', terminal };
  }

  _reject(reason) {
    if (this._rejection) return;
    this._rejection = { reason };
    this._resolveRejected(this._rejection);
    queueMicrotask(() => { void this.shutdownBounded().catch(() => {}); });
  }

  _drainStderr(chunk) {
    if (!Buffer.isBuffer(chunk)) return;
    this.stderrTotalBytes += chunk.length;
    const remaining = Math.max(0, LIMITS.stderrCaptureBytes - this._stderrCapture.length);
    if (remaining > 0) this._stderrCapture = Buffer.concat([this._stderrCapture, chunk.subarray(0, remaining)]);
    if (this.stderrTotalBytes > LIMITS.stderrCaptureBytes) this.stderrTruncated = true;
  }
}

class FrameReader {
  constructor(stream, rejectSession) {
    this.stream = stream;
    this.rejectSession = rejectSession;
    this.input = Buffer.alloc(0);
    this.totalBytes = 0;
    this.messageCount = 0;
    this.messages = [];
    this.waiters = [];
    this.failure = undefined;
    stream.on('data', (chunk) => this._consumeWithoutThrowing(chunk));
    stream.on('error', () => this._fail('stdout-error'));
  }

  next(timeoutMs) {
    if (this.failure) return Promise.reject(new Error(this.failure));
    if (this.messages.length > 0) return Promise.resolve(this.messages.shift());
    if (this.waiters.length >= LIMITS.queuedMessages) return Promise.reject(new Error('waiter-limit'));
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: undefined };
      waiter.timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error('response-timeout'));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  close(reason) {
    if (!this.failure) this.failure = reason;
    this.input = Buffer.alloc(0);
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(this.failure));
    }
  }

  _consumeWithoutThrowing(chunk) {
    if (this.failure) return;
    try {
      if (!Buffer.isBuffer(chunk)) return this._fail('non-buffer-output');
      this.totalBytes += chunk.length;
      if (this.totalBytes > LIMITS.totalOutputBytes) return this._fail('total-output-limit');
      if (this.input.length + chunk.length > LIMITS.bufferedBytes) return this._fail('buffer-limit');
      this.input = Buffer.concat([this.input, chunk]);
      while (this.input.length >= 4) {
        const length = this.input.readUInt32BE(0);
        if (length === 0 || length > LIMITS.frameBytes) return this._fail('frame-size');
        if (this.input.length < length + 4) return;
        const payload = this.input.subarray(4, length + 4);
        this.input = this.input.subarray(length + 4);
        let message;
        try {
          message = JSON.parse(payload.toString('utf8'));
        } catch {
          return this._fail('invalid-json');
        }
        this.messageCount += 1;
        if (this.messageCount > LIMITS.messageCount) return this._fail('message-count-limit');
        const waiter = this.waiters.shift();
        if (waiter) {
          clearTimeout(waiter.timer);
          waiter.resolve(message);
        } else if (this.messages.length >= LIMITS.queuedMessages) {
          return this._fail('queue-limit');
        } else {
          this.messages.push(message);
        }
      }
    } catch {
      this._fail('parser-exception');
    }
  }

  _fail(reason) {
    if (this.failure) return;
    this.failure = reason;
    this.input = Buffer.alloc(0);
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(reason));
    }
    try { this.rejectSession(reason); } catch { /* event callbacks must not throw */ }
  }
}

function isPlainRecord(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function settledWithin(promise, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) resolve(undefined);
    }, timeoutMs);
    promise.then((value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    });
  });
}

async function waitFor(promise, timeoutMs, label) {
  const result = await settledWithin(promise, timeoutMs);
  if (!result) throw new Error(`${label} timed out`);
  return result;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error && typeof error === 'object' && error.code === 'ESRCH');
  }
}

function assert(condition, label) {
  if (!condition) throw new Error(`probe assertion failed: ${label}`);
}

await main();
