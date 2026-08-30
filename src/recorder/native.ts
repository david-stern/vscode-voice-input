import * as vscode from 'vscode';
import { startPcmCapture, PcmCaptureHandle, PcmSource } from './capture';
import {
  audioDevicesFromNames,
  AudioDevice,
  isLoopbackMonitorName,
  resolveAudioDeviceIndex,
} from './devices';
import { pcm16FramesToWav } from './wav';

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

interface PvRecorderInstance extends PcmSource {
  readonly frameLength: number;
  getSelectedDevice(): string;
}

interface PvRecorderConstructor {
  new(frameLength: number, deviceIndex?: number, bufferedFramesCount?: number): PvRecorderInstance;
  getAvailableDevices(): string[];
}

const FRAME_LENGTH = 512;
const BUFFERED_FRAMES = 100;
const MAX_CAPTURE_MS = 5 * 60 * 1000;

let recorderConstructor: PvRecorderConstructor | null = null;

/** Delay native module loading until enumeration or capture is actually requested. */
function loadPvRecorder(): PvRecorderConstructor {
  if (recorderConstructor) return recorderConstructor;
  try {
    // The native addon must remain lazy: it is optional on unsupported systems
    // and is bundled as an external platform-specific package.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const module = require('@picovoice/pvrecorder-node') as { PvRecorder: PvRecorderConstructor };
    recorderConstructor = module.PvRecorder;
    return recorderConstructor;
  } catch (error) {
    throw new Error("Voice Input's bundled audio recorder could not be loaded on this system.", { cause: error });
  }
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
  const names = loadPvRecorder().getAvailableDevices();
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
  const maxDurationMs = Math.min(requestedDuration, MAX_CAPTURE_MS);

  const PvRecorder = loadPvRecorder();
  const deviceId = options.deviceId?.trim() ?? '';
  const deviceIndex = deviceId
    ? resolveAudioDeviceIndex(deviceId, PvRecorder.getAvailableDevices())
    : -1;

  const recorder = new PvRecorder(FRAME_LENGTH, deviceIndex, BUFFERED_FRAMES);
  let selectedDevice: string;
  let capture: PcmCaptureHandle;
  try {
    selectedDevice = recorder.getSelectedDevice();
    capture = startPcmCapture(recorder, {
      maxSamples: Math.max(1, Math.floor(recorder.sampleRate * maxDurationMs / 1000)),
      maxDurationMs,
      onFrame: options.onFrame,
    });
  } catch (error) {
    try { recorder.release(); } catch { /* preserve the start error */ }
    throw error;
  }

  return {
    sampleRate: capture.sampleRate,
    selectedDevice,
    outcome: capture.outcome,
    stop: () => capture.stop(),
    cancel: () => capture.cancel(),
  };
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
