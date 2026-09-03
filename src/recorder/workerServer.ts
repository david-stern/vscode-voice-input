import {
  PcmCaptureHandle,
  PcmSource,
  startPcmCapture,
} from './capture';
import {
  fallbackIndexForLoopbackDefault,
  isLoopbackMonitorName,
  NoUsableAudioInputError,
  resolveAudioDeviceIndex,
} from './devices';
import {
  RecorderWorkerMessage,
  RecorderWorkerRequest,
  serializeRecorderError,
  StartRequest,
} from './workerProtocol';

export interface PvRecorderInstance extends PcmSource {
  readonly frameLength: number;
  getSelectedDevice(): string;
}

export interface PvRecorderConstructor {
  new(frameLength: number, deviceIndex?: number, bufferedFramesCount?: number): PvRecorderInstance;
  getAvailableDevices(): string[];
}

export interface RecorderWorkerServerDeps {
  /** Loaded lazily so an unsupported system only fails the requested operation. */
  loadRecorder(): PvRecorderConstructor;
  post(message: RecorderWorkerMessage, transfer?: readonly ArrayBuffer[]): void;
  platform?: NodeJS.Platform;
}

export interface RecorderWorkerServer {
  handle(request: RecorderWorkerRequest): void;
}

interface ServerSession {
  readonly capture: PcmCaptureHandle;
  finished: boolean;
  pending: number;
}

/** Completed sessions stay addressable for late stop and cancel round-trips. */
const MAX_RETAINED_SESSIONS = 16;

/** Copy only when the frame does not already own its whole backing buffer. */
function toTransferableBuffer(frame: Int16Array): ArrayBuffer {
  if (
    frame.byteOffset === 0
    && frame.byteLength === frame.buffer.byteLength
    && frame.buffer instanceof ArrayBuffer
  ) {
    return frame.buffer;
  }
  const buffer = new ArrayBuffer(frame.byteLength);
  new Int16Array(buffer).set(frame);
  return buffer;
}

/**
 * Own every synchronous PvRecorder call. The server is transport agnostic so the
 * worker entry stays a thin shell and the protocol stays testable in-process.
 */
export function createRecorderWorkerServer(deps: RecorderWorkerServerDeps): RecorderWorkerServer {
  const platform = deps.platform ?? process.platform;
  const sessions = new Map<string, ServerSession>();

  const replyError = (request: RecorderWorkerRequest, error: unknown): void => {
    deps.post({ id: request.id, ok: false, op: request.op, error: serializeRecorderError(error) });
  };

  const prune = (): void => {
    if (sessions.size <= MAX_RETAINED_SESSIONS) return;
    for (const [id, session] of sessions) {
      if (sessions.size <= MAX_RETAINED_SESSIONS) return;
      if (session.finished && session.pending === 0) sessions.delete(id);
    }
  };

  const openRecorder = (request: StartRequest): {
    recorder: PvRecorderInstance;
    selectedDevice: string;
  } => {
    const PvRecorder = deps.loadRecorder();
    const availableDevices = PvRecorder.getAvailableDevices();
    const deviceId = request.deviceId.trim();
    const deviceIndex = deviceId ? resolveAudioDeviceIndex(deviceId, availableDevices) : -1;

    let recorder: PvRecorderInstance | undefined = new PvRecorder(
      request.frameLength,
      deviceIndex,
      request.bufferedFrames,
    );
    try {
      let selectedDevice = recorder.getSelectedDevice();
      if (!deviceId) {
        const fallbackIndex = fallbackIndexForLoopbackDefault(
          availableDevices,
          selectedDevice,
          platform,
        );
        if (fallbackIndex !== undefined) {
          recorder.release();
          recorder = undefined;
          recorder = new PvRecorder(request.frameLength, fallbackIndex, request.bufferedFrames);
          selectedDevice = recorder.getSelectedDevice();
          if (platform === 'linux' && isLoopbackMonitorName(selectedDevice)) {
            throw new NoUsableAudioInputError();
          }
        }
      }
      return { recorder, selectedDevice };
    } catch (error) {
      try { recorder?.release(); } catch { /* preserve the start error */ }
      throw error;
    }
  };

  const start = (request: StartRequest): void => {
    if (sessions.has(request.sessionId)) {
      replyError(request, new Error(`Duplicate capture session: ${request.sessionId}`));
      return;
    }

    let recorder: PvRecorderInstance;
    let selectedDevice: string;
    try {
      ({ recorder, selectedDevice } = openRecorder(request));
    } catch (error) {
      replyError(request, error);
      return;
    }

    const sampleRate = recorder.sampleRate;
    let capture: PcmCaptureHandle;
    try {
      capture = startPcmCapture(recorder, {
        maxSamples: Math.max(1, Math.floor(sampleRate * request.maxDurationMs / 1000)),
        maxDurationMs: request.maxDurationMs,
        onFrame: (frame) => {
          const buffer = toTransferableBuffer(frame);
          deps.post({ ev: 'frame', sessionId: request.sessionId, buffer }, [buffer]);
        },
      });
    } catch (error) {
      try { recorder.release(); } catch { /* preserve the start error */ }
      replyError(request, error);
      return;
    }

    const session: ServerSession = { capture, finished: false, pending: 0 };
    sessions.set(request.sessionId, session);
    void capture.outcome.then((outcome) => {
      session.finished = true;
      deps.post({
        ev: 'outcome',
        sessionId: request.sessionId,
        reason: outcome.reason,
        ...(outcome.reason === 'error' ? { error: serializeRecorderError(outcome.error) } : {}),
        sampleRate,
        samplesCaptured: capture.samplesCaptured,
        selectedDevice,
      });
    });

    deps.post({
      id: request.id,
      ok: true,
      op: 'start',
      sessionId: request.sessionId,
      sampleRate,
      selectedDevice,
    });
    prune();
  };

  const drain = async (request: { op: 'stop' | 'cancel'; id: number; sessionId: string }): Promise<void> => {
    const session = sessions.get(request.sessionId);
    if (!session) {
      deps.post({
        id: request.id,
        ok: true,
        op: request.op,
        sessionId: request.sessionId,
        samplesCaptured: 0,
      });
      return;
    }

    session.pending += 1;
    try {
      if (request.op === 'cancel') session.capture.cancel();
      try {
        await session.capture.stop();
      } catch (error) {
        // Cancellation stays authoritative; only an explicit stop reports the failure.
        if (request.op === 'stop') {
          replyError(request, error);
          return;
        }
      }
      deps.post({
        id: request.id,
        ok: true,
        op: request.op,
        sessionId: request.sessionId,
        samplesCaptured: session.capture.samplesCaptured,
      });
    } finally {
      session.pending -= 1;
      prune();
    }
  };

  return {
    handle(request: RecorderWorkerRequest): void {
      switch (request.op) {
        case 'enumerate':
          try {
            deps.post({
              id: request.id,
              ok: true,
              op: 'enumerate',
              names: deps.loadRecorder().getAvailableDevices(),
            });
          } catch (error) {
            replyError(request, error);
          }
          return;
        case 'start':
          start(request);
          return;
        default:
          void drain(request).catch((error: unknown) => replyError(request, error));
      }
    },
  };
}
