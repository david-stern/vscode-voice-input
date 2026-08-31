export interface PcmSource {
  readonly sampleRate: number;
  start(): void;
  read(): Promise<Int16Array>;
  stop(): void;
  release(): void;
}

export interface PcmCaptureHandle {
  readonly sampleRate: number;
  /** Number of PCM16 samples accepted from the source so far. */
  readonly samplesCaptured: number;
  /** Resolves once when capture begins ending; it never rejects. */
  readonly outcome: Promise<PcmCaptureOutcome>;
  stop(): Promise<void>;
  cancel(): void;
}

export type PcmCaptureOutcome =
  | { reason: 'stopped' | 'cancelled' | 'limit' }
  | { reason: 'error'; error: unknown };

export interface PcmCaptureOptions {
  maxSamples: number;
  maxDurationMs: number;
  onFrame(frame: Int16Array): void;
}

export const ZERO_SAMPLE_CAPTURE_CODE = 'VOICE_INPUT_ZERO_SAMPLES';

/** Normal stop completed, but the native input produced no PCM samples. */
export class ZeroSampleCaptureError extends Error {
  readonly code = ZERO_SAMPLE_CAPTURE_CODE;

  constructor(readonly selectedDevice: string) {
    super(`Audio input produced no samples: ${selectedDevice || 'system default'}`);
    this.name = 'ZeroSampleCaptureError';
  }
}

export function isZeroSampleCaptureError(error: unknown): error is ZeroSampleCaptureError {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === ZERO_SAMPLE_CAPTURE_CODE;
}

/** Drive a PCM source with single-shot stop/release semantics. */
export function startPcmCapture(source: PcmSource, options: PcmCaptureOptions): PcmCaptureHandle {
  if (!Number.isSafeInteger(options.maxSamples) || options.maxSamples <= 0) {
    throw new Error(`Invalid maximum sample count: ${options.maxSamples}`);
  }
  if (!Number.isFinite(options.maxDurationMs) || options.maxDurationMs <= 0) {
    throw new Error(`Invalid maximum capture duration: ${options.maxDurationMs}`);
  }

  source.start();

  let acceptingFrames = true;
  let cancelled = false;
  let stopIssued = false;
  let releaseIssued = false;
  let acceptedSamples = 0;
  let failure: unknown;
  let shutdownPromise: Promise<void> | null = null;
  let settleOutcome: (outcome: PcmCaptureOutcome) => void = () => {};
  const outcome = new Promise<PcmCaptureOutcome>((resolve) => {
    settleOutcome = resolve;
  });
  let outcomeSettled = false;

  const settleOutcomeOnce = (result: PcmCaptureOutcome) => {
    if (outcomeSettled) return;
    outcomeSettled = true;
    settleOutcome(result);
  };

  const stopSourceOnce = () => {
    if (stopIssued) return;
    stopIssued = true;
    try {
      source.stop();
    } catch (error) {
      if (failure === undefined && !cancelled) failure = error;
    }
  };

  const releaseSourceOnce = () => {
    if (releaseIssued) return;
    releaseIssued = true;
    try {
      source.release();
    } catch (error) {
      if (failure === undefined && !cancelled) failure = error;
    }
  };

  const beginShutdown = (reason: PcmCaptureOutcome['reason']): Promise<void> => {
    if (reason === 'cancelled') cancelled = true;
    settleOutcomeOnce(reason === 'error' ? { reason, error: failure } : { reason });
    acceptingFrames = false;
    clearTimeout(durationTimer);
    stopSourceOnce();
    if (!shutdownPromise) {
      shutdownPromise = readLoop.then(releaseSourceOnce, releaseSourceOnce);
    }
    return shutdownPromise;
  };

  const readLoop = (async () => {
    while (acceptingFrames) {
      const frame = await source.read();
      if (!acceptingFrames) break;

      const remaining = options.maxSamples - acceptedSamples;
      const accepted = frame.length > remaining ? frame.slice(0, remaining) : frame.slice();
      if (accepted.length > 0) {
        options.onFrame(accepted);
        acceptedSamples += accepted.length;
      }

      if (acceptedSamples >= options.maxSamples) {
        void beginShutdown('limit');
        break;
      }
    }
  })().catch((error: unknown) => {
    if (acceptingFrames) {
      if (failure === undefined) failure = error;
      void beginShutdown('error');
    }
  });

  const durationTimer = setTimeout(() => {
    void beginShutdown('limit');
  }, options.maxDurationMs);

  let publicStopPromise: Promise<void> | null = null;
  const stop = (): Promise<void> => {
    if (!publicStopPromise) {
      publicStopPromise = beginShutdown('stopped').then(() => {
        if (failure !== undefined && !cancelled) throw failure;
      });
    }
    return publicStopPromise;
  };

  return {
    sampleRate: source.sampleRate,
    get samplesCaptured() { return acceptedSamples; },
    outcome,
    stop,
    cancel() {
      void beginShutdown('cancelled').catch(() => {});
    },
  };
}
