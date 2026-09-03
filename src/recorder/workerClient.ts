import type { PcmCaptureHandle, PcmCaptureOutcome } from './capture';
import {
  DrainReply,
  EnumerateReply,
  isRecorderWorkerEvent,
  RecorderWorkerMessage,
  RecorderWorkerOkReply,
  RecorderWorkerRequest,
  reviveRecorderError,
  StartReply,
} from './workerProtocol';

/** Structural view of a `node:worker_threads` Worker used by the client. */
export interface RecorderWorkerPort {
  postMessage(message: RecorderWorkerRequest): void;
  on(event: 'message', listener: (message: RecorderWorkerMessage) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'exit', listener: (exitCode: number) => void): unknown;
  terminate(): void | Promise<unknown>;
  ref?(): void;
  unref?(): void;
}

export interface RecorderWorkerTimeouts {
  enumerateMs: number;
  startMs: number;
  /** Applies to stop and cancel round-trips alike. */
  drainMs: number;
}

export const DEFAULT_RECORDER_WORKER_TIMEOUTS: RecorderWorkerTimeouts = {
  enumerateMs: 5_000,
  startMs: 10_000,
  drainMs: 5_000,
};

export interface RecorderWorkerClientOptions {
  createWorker(): RecorderWorkerPort;
  timeouts?: Partial<RecorderWorkerTimeouts>;
}

export interface WorkerPcmStream extends PcmCaptureHandle {
  readonly selectedDevice: string;
}

export interface StartStreamRequest {
  deviceId: string;
  frameLength: number;
  bufferedFrames: number;
  maxDurationMs: number;
  onFrame(frame: Int16Array): void;
}

interface SessionTransport {
  drain(sessionId: string, op: 'stop' | 'cancel'): Promise<DrainReply>;
  release(sessionId: string): void;
}

interface PendingCall {
  resolve(reply: RecorderWorkerOkReply): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

interface WorkerConnection {
  readonly port: RecorderWorkerPort;
  readonly pending: Map<number, PendingCall>;
  readonly sessions: Map<string, CaptureSession>;
  readonly watchdogs: Map<string, ReturnType<typeof setTimeout>>;
  alive: boolean;
}

function expectEnumerate(reply: RecorderWorkerOkReply): EnumerateReply {
  if (reply.op !== 'enumerate') throw unexpectedReply(reply, 'enumerate');
  return reply;
}

function expectStart(reply: RecorderWorkerOkReply): StartReply {
  if (reply.op !== 'start') throw unexpectedReply(reply, 'start');
  return reply;
}

function expectDrain(reply: RecorderWorkerOkReply, op: 'stop' | 'cancel'): DrainReply {
  if (reply.op !== 'stop' && reply.op !== 'cancel') throw unexpectedReply(reply, op);
  return reply;
}

function unexpectedReply(reply: RecorderWorkerOkReply, expected: string): Error {
  return new Error(`The Voice Input audio worker answered ${reply.op} instead of ${expected}.`);
}

/** Host-side mirror of one worker capture, matching the in-process contract. */
class CaptureSession implements WorkerPcmStream {
  sampleRate = 0;
  samplesCaptured = 0;
  selectedDevice = '';
  readonly outcome: Promise<PcmCaptureOutcome>;

  private settleOutcome: (outcome: PcmCaptureOutcome) => void = () => {};
  private settled = false;
  private failure: Error | undefined;
  private cancelled = false;
  private dead = false;
  private stopPromise: Promise<void> | null = null;

  constructor(
    readonly id: string,
    private readonly onFrame: (frame: Int16Array) => void,
    private readonly transport: SessionTransport,
  ) {
    this.outcome = new Promise<PcmCaptureOutcome>((resolve) => { this.settleOutcome = resolve; });
  }

  accept(frame: Int16Array): void {
    this.samplesCaptured += frame.length;
    try {
      this.onFrame(frame);
    } catch (error) {
      this.failLocally(error instanceof Error ? error : new Error(String(error)));
    }
  }

  complete(reason: PcmCaptureOutcome['reason'], samplesCaptured: number, error?: Error): void {
    this.samplesCaptured = Math.max(this.samplesCaptured, samplesCaptured);
    if (reason === 'error') {
      this.failure ??= error ?? new Error('Voice Input audio capture failed.');
      this.settle({ reason, error: this.failure });
    } else {
      this.settle({ reason });
    }
    this.transport.release(this.id);
  }

  /** The worker died, so no further reply can arrive for this capture. */
  fail(error: Error): void {
    this.dead = true;
    this.failure ??= error;
    this.settle({ reason: 'error', error: this.failure });
  }

  stop(): Promise<void> {
    this.stopPromise ??= this.runStop();
    return this.stopPromise;
  }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    if (this.dead) return;
    void this.transport.drain(this.id, 'cancel').catch(() => {
      // Cancellation stays authoritative even when the worker reports a failure.
    });
  }

  private async runStop(): Promise<void> {
    try {
      if (!this.dead) {
        try {
          const reply = await this.transport.drain(this.id, 'stop');
          this.samplesCaptured = Math.max(this.samplesCaptured, reply.samplesCaptured);
        } catch (error) {
          // A capture that already ended cleanly keeps the frames it delivered, so
          // only an unfinished or failed capture reports a late worker failure.
          if (!this.settled || this.failure !== undefined) throw error;
        }
      }
      if (this.failure !== undefined && !this.cancelled) throw this.failure;
    } finally {
      this.transport.release(this.id);
    }
  }

  private failLocally(error: Error): void {
    this.failure ??= error;
    this.settle({ reason: 'error', error: this.failure });
    if (this.dead) return;
    void this.transport.drain(this.id, 'cancel').catch(() => {
      // The local frame failure is already the authoritative outcome.
    });
  }

  private settle(outcome: PcmCaptureOutcome): void {
    if (this.settled) return;
    this.settled = true;
    this.settleOutcome(outcome);
  }
}

/**
 * Client for the recorder worker thread. Every native call is an awaited RPC with
 * a hard timeout, so a stalled audio device can never block the extension host.
 */
export class RecorderWorkerClient {
  private readonly timeouts: RecorderWorkerTimeouts;
  private connection: WorkerConnection | null = null;
  private nextCallId = 0;
  private nextSessionId = 0;

  constructor(private readonly options: RecorderWorkerClientOptions) {
    this.timeouts = { ...DEFAULT_RECORDER_WORKER_TIMEOUTS, ...options.timeouts };
  }

  /** Raw device names in native order; loopback filtering stays with the caller. */
  async enumerate(): Promise<string[]> {
    const connection = this.ensureConnection();
    const reply = await this.call(
      connection,
      (id) => ({ op: 'enumerate', id }),
      this.timeouts.enumerateMs,
      'enumerate audio devices',
    );
    return expectEnumerate(reply).names;
  }

  async start(request: StartStreamRequest): Promise<WorkerPcmStream> {
    const connection = this.ensureConnection();
    this.nextSessionId += 1;
    const sessionId = `capture-${this.nextSessionId}`;
    const session = new CaptureSession(sessionId, request.onFrame, {
      drain: (id, op) => this.drain(connection, id, op),
      release: (id) => this.releaseSession(connection, id),
    });
    connection.sessions.set(sessionId, session);
    this.updateRef(connection);

    try {
      const reply = expectStart(await this.call(
        connection,
        (id) => ({
          op: 'start',
          id,
          sessionId,
          deviceId: request.deviceId,
          frameLength: request.frameLength,
          bufferedFrames: request.bufferedFrames,
          maxDurationMs: request.maxDurationMs,
        }),
        this.timeouts.startMs,
        'start microphone capture',
      ));
      session.sampleRate = reply.sampleRate;
      session.selectedDevice = reply.selectedDevice;
      this.armWatchdog(connection, sessionId, request.maxDurationMs);
      return session;
    } catch (error) {
      this.releaseSession(connection, sessionId);
      throw error;
    }
  }

  /** Terminate the current worker; the next call spawns a fresh one. */
  dispose(): void {
    const connection = this.connection;
    if (connection) {
      this.dropConnection(connection, new Error('The Voice Input audio worker was disposed.'));
    }
  }

  private async drain(
    connection: WorkerConnection,
    sessionId: string,
    op: 'stop' | 'cancel',
  ): Promise<DrainReply> {
    const reply = await this.call(
      connection,
      (id) => ({ op, id, sessionId }),
      this.timeouts.drainMs,
      op === 'stop' ? 'stop microphone capture' : 'cancel microphone capture',
    );
    return expectDrain(reply, op);
  }

  /**
   * Bounds the whole capture, not just its RPC round-trips: a worker wedged inside
   * a native read after a successful start never posts an outcome event, and until
   * the next stop or cancel RPC times out nothing would notice. The worker ends a
   * healthy capture at maxDurationMs on its own, so the drain timeout is a margin.
   */
  private armWatchdog(connection: WorkerConnection, sessionId: string, maxDurationMs: number): void {
    const budgetMs = maxDurationMs + this.timeouts.drainMs;
    connection.watchdogs.set(sessionId, setTimeout(() => {
      this.dropConnection(connection, new Error(
        `The Voice Input audio worker did not finish a capture within ${budgetMs} ms.`,
      ));
    }, budgetMs));
  }

  private releaseSession(connection: WorkerConnection, sessionId: string): void {
    const watchdog = connection.watchdogs.get(sessionId);
    if (watchdog !== undefined) {
      clearTimeout(watchdog);
      connection.watchdogs.delete(sessionId);
    }
    if (connection.sessions.delete(sessionId)) this.updateRef(connection);
  }

  private ensureConnection(): WorkerConnection {
    const current = this.connection;
    if (current?.alive) return current;

    const port = this.options.createWorker();
    const connection: WorkerConnection = {
      port,
      pending: new Map(),
      sessions: new Map(),
      watchdogs: new Map(),
      alive: true,
    };
    this.connection = connection;
    port.on('message', (message: RecorderWorkerMessage) => this.receive(connection, message));
    port.on('error', (error: Error) => this.dropConnection(
      connection,
      error instanceof Error ? error : new Error(String(error)),
    ));
    port.on('exit', (exitCode: number) => this.dropConnection(
      connection,
      new Error(`The Voice Input audio worker stopped unexpectedly (exit code ${exitCode}).`),
    ));
    this.updateRef(connection);
    return connection;
  }

  private call(
    connection: WorkerConnection,
    build: (id: number) => RecorderWorkerRequest,
    timeoutMs: number,
    label: string,
  ): Promise<RecorderWorkerOkReply> {
    this.nextCallId += 1;
    const request = build(this.nextCallId);
    return new Promise<RecorderWorkerOkReply>((resolve, reject) => {
      if (!connection.alive) {
        reject(new Error(`The Voice Input audio worker is no longer available to ${label}.`));
        return;
      }
      const timer = setTimeout(() => {
        connection.pending.delete(request.id);
        this.dropConnection(
          connection,
          new Error(`The Voice Input audio worker stopped responding while asked to ${label}.`),
        );
        reject(new Error(`Voice Input timed out after ${timeoutMs} ms trying to ${label}.`));
      }, timeoutMs);
      connection.pending.set(request.id, { resolve, reject, timer });
      this.updateRef(connection);
      try {
        connection.port.postMessage(request);
      } catch (error) {
        connection.pending.delete(request.id);
        clearTimeout(timer);
        this.updateRef(connection);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private receive(connection: WorkerConnection, message: RecorderWorkerMessage): void {
    if (!connection.alive) return;
    if (isRecorderWorkerEvent(message)) {
      const session = connection.sessions.get(message.sessionId);
      if (!session) return;
      if (message.ev === 'frame') {
        session.accept(new Int16Array(message.buffer));
        return;
      }
      session.complete(
        message.reason,
        message.samplesCaptured,
        message.error ? reviveRecorderError(message.error) : undefined,
      );
      return;
    }

    const call = connection.pending.get(message.id);
    if (!call) return;
    connection.pending.delete(message.id);
    clearTimeout(call.timer);
    this.updateRef(connection);
    if (message.ok) call.resolve(message);
    else call.reject(reviveRecorderError(message.error));
  }

  private dropConnection(connection: WorkerConnection, error: Error): void {
    if (!connection.alive) return;
    connection.alive = false;
    if (this.connection === connection) this.connection = null;

    const pending = [...connection.pending.values()];
    connection.pending.clear();
    for (const call of pending) {
      clearTimeout(call.timer);
      call.reject(error);
    }

    for (const watchdog of connection.watchdogs.values()) clearTimeout(watchdog);
    connection.watchdogs.clear();

    const sessions = [...connection.sessions.values()];
    connection.sessions.clear();
    for (const session of sessions) session.fail(error);

    try {
      void Promise.resolve(connection.port.terminate()).catch(() => {
        // Termination is best effort; the connection is already abandoned.
      });
    } catch {
      // A worker that cannot be terminated is still never reused.
    }
  }

  /** Keep the host process free to exit whenever no capture or call is active. */
  private updateRef(connection: WorkerConnection): void {
    if (!connection.alive) return;
    if (connection.pending.size > 0 || connection.sessions.size > 0) connection.port.ref?.();
    else connection.port.unref?.();
  }
}
