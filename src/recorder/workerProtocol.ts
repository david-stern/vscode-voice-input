import type { PcmCaptureOutcome } from './capture';
import { NO_USABLE_AUDIO_INPUT_CODE, NoUsableAudioInputError } from './devices';

/**
 * Message contract between the extension host client and the recorder worker
 * thread. Every native PvRecorder call happens on the worker side, so a stalled
 * device never blocks the VS Code extension host event loop.
 */

/** Structured-clone safe projection of an error raised inside the worker. */
export interface SerializedRecorderError {
  name: string;
  message: string;
  code?: string;
}

export interface EnumerateRequest {
  op: 'enumerate';
  id: number;
}

export interface StartRequest {
  op: 'start';
  id: number;
  sessionId: string;
  /** Empty selects the operating system default input device. */
  deviceId: string;
  frameLength: number;
  bufferedFrames: number;
  maxDurationMs: number;
}

export interface StopRequest {
  op: 'stop';
  id: number;
  sessionId: string;
}

export interface CancelRequest {
  op: 'cancel';
  id: number;
  sessionId: string;
}

export type RecorderWorkerRequest = EnumerateRequest | StartRequest | StopRequest | CancelRequest;
export type RecorderWorkerOperation = RecorderWorkerRequest['op'];

export interface EnumerateReply {
  id: number;
  ok: true;
  op: 'enumerate';
  names: string[];
}

export interface StartReply {
  id: number;
  ok: true;
  op: 'start';
  sessionId: string;
  sampleRate: number;
  selectedDevice: string;
}

/** Reply to stop and cancel; both resolve only after the capture drained. */
export interface DrainReply {
  id: number;
  ok: true;
  op: 'stop' | 'cancel';
  sessionId: string;
  samplesCaptured: number;
}

export interface RecorderWorkerErrorReply {
  id: number;
  ok: false;
  op: RecorderWorkerOperation;
  error: SerializedRecorderError;
}

export type RecorderWorkerOkReply = EnumerateReply | StartReply | DrainReply;
export type RecorderWorkerReply = RecorderWorkerOkReply | RecorderWorkerErrorReply;

export interface RecorderFrameEvent {
  ev: 'frame';
  sessionId: string;
  /** Owned PCM16 payload transferred to the host without a copy. */
  buffer: ArrayBuffer;
}

export interface RecorderOutcomeEvent {
  ev: 'outcome';
  sessionId: string;
  reason: PcmCaptureOutcome['reason'];
  error?: SerializedRecorderError;
  sampleRate: number;
  samplesCaptured: number;
  selectedDevice: string;
}

export type RecorderWorkerEvent = RecorderFrameEvent | RecorderOutcomeEvent;
export type RecorderWorkerMessage = RecorderWorkerReply | RecorderWorkerEvent;

export function isRecorderWorkerEvent(message: RecorderWorkerMessage): message is RecorderWorkerEvent {
  return 'ev' in message;
}

/** Project any thrown value into the cloneable shape the protocol allows. */
export function serializeRecorderError(error: unknown): SerializedRecorderError {
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code;
    return {
      name: error.name,
      message: error.message,
      ...(typeof code === 'string' ? { code } : {}),
    };
  }
  return { name: 'Error', message: `Audio capture failed: ${String(error)}` };
}

/** Rebuild the host-side error class so existing call-site guards keep working. */
export function reviveRecorderError(error: SerializedRecorderError): Error {
  if (error.code === NO_USABLE_AUDIO_INPUT_CODE) return new NoUsableAudioInputError();
  const revived: Error & { code?: string } = new Error(error.message);
  revived.name = error.name;
  if (error.code !== undefined) revived.code = error.code;
  return revived;
}
