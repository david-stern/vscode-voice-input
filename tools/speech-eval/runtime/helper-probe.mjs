import { createHmac } from 'node:crypto';
import { readSync } from 'node:fs';

const MAX_FRAME_BYTES = 64 * 1024;
const MAX_BUFFERED_BYTES = MAX_FRAME_BYTES + 4;
const AUTH_TIMEOUT_MS = 500;
const MODES = new Set([
  'normal',
  'crash',
  'hang',
  'ignore-term',
  'malformed-output',
  'oversized-output',
  'stderr-flood',
  'message-flood',
  'total-output',
  'auth-timeout',
]);

const secret = Buffer.alloc(32);
const mode = process.argv[2];
if (!MODES.has(mode)) rejectSession(64);
if (mode === 'ignore-term') process.on('SIGTERM', () => {});

try {
  let offset = 0;
  while (offset < secret.length) {
    const count = readSync(3, secret, offset, secret.length - offset, null);
    if (count === 0) rejectSession(65);
    offset += count;
  }
} catch {
  secret.fill(0);
  rejectSession(65);
}

let input = Buffer.alloc(0);
let authenticated = false;
const authTimer = setTimeout(() => {
  secret.fill(0);
  rejectSession(71);
}, AUTH_TIMEOUT_MS);
authTimer.unref();

process.stdin.on('data', (chunk) => {
  if (!Buffer.isBuffer(chunk) || input.length + chunk.length > MAX_BUFFERED_BYTES) {
    rejectSession(72);
    return;
  }
  input = Buffer.concat([input, chunk]);
  parseFrames();
});
process.stdin.on('error', () => rejectSession(73));
process.stdout.on('error', () => rejectSession(74));

function parseFrames() {
  while (input.length >= 4) {
    const length = input.readUInt32BE(0);
    if (length === 0 || length > MAX_FRAME_BYTES) {
      rejectSession(66);
      return;
    }
    if (input.length < length + 4) return;
    const payload = input.subarray(4, length + 4);
    input = input.subarray(length + 4);
    let message;
    try {
      message = JSON.parse(payload.toString('utf8'));
    } catch {
      rejectSession(67);
      return;
    }
    handleMessage(message);
  }
}

function handleMessage(message) {
  if (!authenticated) {
    if (mode === 'auth-timeout') return;
    const challenge = decodeCanonicalChallenge(message);
    if (!challenge) {
      secret.fill(0);
      rejectSession(68);
      return;
    }
    const mac = createHmac('sha256', secret).update(challenge).digest();
    clearTimeout(authTimer);
    secret.fill(0);
    challenge.fill(0);
    authenticated = true;
    writeFrame({ type: 'ready', version: 1, mac: mac.toString('base64') });
    mac.fill(0);
    return;
  }

  if (
    !isPlainRecord(message)
    || message.type !== 'request'
    || message.version !== 1
    || typeof message.operation !== 'string'
  ) {
    rejectSession(69);
    return;
  }

  if (mode === 'crash' && message.operation === 'crash') rejectSession(86);
  if (mode === 'hang' && message.operation === 'hang') return;
  if (mode === 'ignore-term' && message.operation === 'shutdown') return;
  if (mode === 'malformed-output' && message.operation === 'emit') {
    writeRawPayload(Buffer.from('{not-json', 'utf8'));
    return;
  }
  if (mode === 'oversized-output' && message.operation === 'emit') {
    const header = Buffer.alloc(4);
    header.writeUInt32BE(MAX_FRAME_BYTES + 1);
    process.stdout.write(header);
    return;
  }
  if (mode === 'stderr-flood' && message.operation === 'emit') {
    const flood = Buffer.alloc(512 * 1024, 120);
    process.stderr.write(flood, () => {
      flood.fill(0);
      writeFrame({ type: 'result', version: 1, requestId: message.requestId, value: 'stderr-drained' });
    });
    return;
  }
  if (mode === 'message-flood' && message.operation === 'emit') {
    for (let index = 0; index < 12; index += 1) {
      writeFrame({ type: 'result', version: 1, requestId: `flood-${index}`, value: 'queued' });
    }
    return;
  }
  if (mode === 'total-output' && message.operation === 'emit') {
    writeFrame({
      type: 'result',
      version: 1,
      requestId: message.requestId,
      value: 'x'.repeat(60 * 1024),
    });
    return;
  }
  if (mode === 'normal' && message.operation === 'ping') {
    writeFrame({ type: 'result', version: 1, requestId: message.requestId, value: 'pong' });
    return;
  }
  if (message.operation === 'shutdown') rejectSession(0);
  rejectSession(70);
}

function decodeCanonicalChallenge(message) {
  if (
    !isPlainRecord(message)
    || message.type !== 'challenge'
    || message.version !== 1
    || typeof message.challenge !== 'string'
    || !/^[A-Za-z0-9+/]{43}=$/u.test(message.challenge)
  ) return undefined;
  const challenge = Buffer.from(message.challenge, 'base64');
  if (challenge.length !== 32 || challenge.toString('base64') !== message.challenge) {
    challenge.fill(0);
    return undefined;
  }
  return challenge;
}

function isPlainRecord(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function writeFrame(message) {
  writeRawPayload(Buffer.from(JSON.stringify(message), 'utf8'));
}

function writeRawPayload(payload) {
  if (payload.length === 0 || payload.length > MAX_FRAME_BYTES) rejectSession(75);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length);
  process.stdout.write(Buffer.concat([header, payload]));
}

function rejectSession(code) {
  secret?.fill?.(0);
  process.exit(code);
}
