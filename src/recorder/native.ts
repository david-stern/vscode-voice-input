import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import * as vscode from 'vscode';

import {
  PcmCaptureHandle,
  ZeroSampleCaptureError,
} from './capture';
import {
  audioDevicesFromNames,
  AudioDevice,
  isLoopbackMonitorName,
} from './devices';
import { pcm16FramesToWav } from './wav';
import { RecorderWorkerClient, type RecorderWorkerPort } from './workerClient';

export type { AudioDevice } from './devices';

export interface RecorderHandle {
  readonly outcome: PcmCaptureHandle['outcome'];
  stop(): Promise<{ wav: Uint8Array; mime: 'audio/wav' } | null>;
  cancel(): void;
}

export interface PcmStreamOptions {
  /** Empty or omitted selects the operating system default input device. */
  deviceId?: string;
  /** Called in capture order with owned PCM16 frames. */
  onFrame(frame: Int16Array): void;
  /** Lower values are allowed; capture is always capped at five minutes. */
  maxDurationMs?: number;
}

export interface PcmStreamHandle extends PcmCaptureHandle {
  readonly selectedDevice: string;
}

const FRAME_LENGTH = 512;
const BUFFERED_FRAMES = 100;
const MAX_CAPTURE_MS = 5 * 60 * 1000;
/** Bundled next to out/extension.js by esbuild.js. */
const WORKER_FILE = 'recorderWorker.js';

let client: RecorderWorkerClient | null = null;

/**
 * Every PvRecorder call is synchronous native code, so it runs on a worker thread.
 * A device that stalls for seconds then fails one RPC instead of freezing the
 * whole extension host.
 */
function recorderClient(): RecorderWorkerClient {
  client ??= new RecorderWorkerClient({
    createWorker: (): RecorderWorkerPort => new Worker(path.join(__dirname, WORKER_FILE)),
  });
  return client;
}

function configuredDeviceId(): string {
  try {
    return vscode.workspace.getConfiguration('voiceInput').get<string>('audioDevice', '').trim();
  } catch {
    return '';
  }
}

/** Enumerate native input devices without activating recording. */
export async function listAudioDevices(): Promise<AudioDevice[]> {
  const names = await recorderClient().enumerate();
  const visibleNames = process.platform === 'linux'
    ? names.filter((name) => !isLoopbackMonitorName(name))
    : names;
  return audioDevicesFromNames(visibleNames);
}

/** Start a bounded native PCM16 stream for recorder and assistant consumers. */
export async function startPcmStream(options: PcmStreamOptions): Promise<PcmStreamHandle> {
  const requestedDuration = options.maxDurationMs ?? MAX_CAPTURE_MS;
  if (!Number.isFinite(requestedDuration) || requestedDuration <= 0) {
    throw new Error(`Invalid capture duration: ${requestedDuration}`);
  }

  return recorderClient().start({
    deviceId: options.deviceId?.trim() ?? '',
    frameLength: FRAME_LENGTH,
    bufferedFrames: BUFFERED_FRAMES,
    maxDurationMs: Math.min(requestedDuration, MAX_CAPTURE_MS),
    onFrame: options.onFrame,
  });
}

/** Capture into memory and return a correct mono PCM16 WAV. */
export async function startRecorder(): Promise<RecorderHandle> {
  const frames: Int16Array[] = [];
  const stream = await startPcmStream({
    deviceId: configuredDeviceId(),
    onFrame: (frame) => frames.push(frame),
  });

  let cancelled = false;
  let stopPromise: Promise<{ wav: Uint8Array; mime: 'audio/wav' } | null> | null = null;

  const stop = () => {
    if (!stopPromise) {
      stopPromise = stream.stop().then(() => {
        if (cancelled) return null;
        if (stream.samplesCaptured === 0) {
          throw new ZeroSampleCaptureError(stream.selectedDevice);
        }
        return {
          wav: pcm16FramesToWav(frames, stream.sampleRate),
          mime: 'audio/wav' as const,
        };
      });
    }
    return stopPromise;
  };

  return {
    outcome: stream.outcome,
    stop,
    cancel() {
      if (cancelled) return;
      cancelled = true;
      stream.cancel();
      if (!stopPromise) stopPromise = stream.stop().then(() => null, () => null);
    },
  };
}
