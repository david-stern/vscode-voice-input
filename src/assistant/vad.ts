export const ASSISTANT_SAMPLE_RATE = 16_000 as const;

export type UtteranceEndReason = 'silence' | 'max-duration';

export interface VadSegmenterOptions {
  /** Input sample rate. Assistant audio is intentionally fixed at 16 kHz. */
  sampleRate?: typeof ASSISTANT_SAMPLE_RATE;
  preRollMs?: number;
  minimumSpeechMs?: number;
  endSilenceMs?: number;
  maxUtteranceMs?: number;
  /** Absolute normalized RMS floor used before the ambient floor is learned. */
  minimumSpeechEnergy?: number;
  /** Speech must be this multiple of the learned ambient RMS floor. */
  noiseFloorMultiplier?: number;
  /** Smoothing factor for non-speech frames, in the range (0, 1]. */
  noiseFloorAdaptation?: number;
  initialNoiseFloor?: number;
}

export interface SegmentedUtterance {
  audio: Int16Array;
  endReason: UtteranceEndReason;
  durationMs: number;
  speechMs: number;
}

export type VadSignal =
  | { type: 'speech-started' }
  | { type: 'utterance-queued'; endReason: UtteranceEndReason }
  | { type: 'speech-discarded'; reason: 'too-short'; speechMs: number }
  | { type: 'backpressure'; reason: 'utterance-pending' };

export interface VadPushResult {
  /** False means this frame was not consumed and may be retried after takeUtterance(). */
  accepted: boolean;
  /** A pending utterance is the explicit signal for an integration to pause its producer. */
  backpressured: boolean;
  signals: readonly VadSignal[];
}

interface ResolvedOptions {
  sampleRate: typeof ASSISTANT_SAMPLE_RATE;
  preRollSamples: number;
  minimumSpeechSamples: number;
  endSilenceSamples: number;
  maxUtteranceSamples: number;
  minimumSpeechEnergy: number;
  noiseFloorMultiplier: number;
  noiseFloorAdaptation: number;
  initialNoiseFloor: number;
}

const DEFAULTS: Required<VadSegmenterOptions> = {
  sampleRate: ASSISTANT_SAMPLE_RATE,
  preRollMs: 500,
  minimumSpeechMs: 250,
  endSilenceMs: 900,
  maxUtteranceMs: 30_000,
  minimumSpeechEnergy: 0.015,
  noiseFloorMultiplier: 3,
  noiseFloorAdaptation: 0.05,
  initialNoiseFloor: 0.003,
};

/**
 * Energy-based VAD for mono 16 kHz signed PCM frames.
 *
 * It intentionally owns a single-slot output queue. Once an utterance is
 * queued, pushFrame() rejects (rather than silently dropping) subsequent
 * frames until the consumer calls takeUtterance().
 */
export class VadSegmenter {
  private readonly options: ResolvedOptions;
  private noiseFloor: number;
  private preRoll: Int16Array[] = [];
  private preRollSampleCount = 0;
  private utteranceFrames: Int16Array[] = [];
  private utteranceSampleCount = 0;
  private speechSampleCount = 0;
  private trailingSilenceSamples = 0;
  private speaking = false;
  private pending: SegmentedUtterance | undefined;

  constructor(options: VadSegmenterOptions = {}) {
    const resolved = { ...DEFAULTS, ...options };
    if (resolved.sampleRate !== ASSISTANT_SAMPLE_RATE) {
      throw new RangeError(`VadSegmenter requires ${ASSISTANT_SAMPLE_RATE} Hz audio`);
    }
    validatePositive('preRollMs', resolved.preRollMs, true);
    validatePositive('minimumSpeechMs', resolved.minimumSpeechMs);
    validatePositive('endSilenceMs', resolved.endSilenceMs);
    validatePositive('maxUtteranceMs', resolved.maxUtteranceMs);
    validatePositive('minimumSpeechEnergy', resolved.minimumSpeechEnergy);
    validatePositive('noiseFloorMultiplier', resolved.noiseFloorMultiplier);
    validateUnitInterval('noiseFloorAdaptation', resolved.noiseFloorAdaptation);
    validatePositive('initialNoiseFloor', resolved.initialNoiseFloor, true);

    const samples = (ms: number) => Math.round((ms * resolved.sampleRate) / 1_000);
    this.options = {
      sampleRate: resolved.sampleRate,
      preRollSamples: samples(resolved.preRollMs),
      minimumSpeechSamples: samples(resolved.minimumSpeechMs),
      endSilenceSamples: samples(resolved.endSilenceMs),
      maxUtteranceSamples: samples(resolved.maxUtteranceMs),
      minimumSpeechEnergy: resolved.minimumSpeechEnergy,
      noiseFloorMultiplier: resolved.noiseFloorMultiplier,
      noiseFloorAdaptation: resolved.noiseFloorAdaptation,
      initialNoiseFloor: resolved.initialNoiseFloor,
    };
    if (this.options.maxUtteranceSamples < 1) {
      throw new RangeError('maxUtteranceMs must include at least one sample');
    }
    this.noiseFloor = this.options.initialNoiseFloor;
  }

  get hasPendingUtterance(): boolean {
    return this.pending !== undefined;
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }

  get currentNoiseFloor(): number {
    return this.noiseFloor;
  }

  pushFrame(frame: Int16Array): VadPushResult {
    if (this.pending) {
      return {
        accepted: false,
        backpressured: true,
        signals: [{ type: 'backpressure', reason: 'utterance-pending' }],
      };
    }
    if (frame.length === 0) {
      return { accepted: true, backpressured: false, signals: [] };
    }

    const ownedFrame = frame.slice();
    const energy = normalizedRms(ownedFrame);
    const speechThreshold = Math.max(
      this.options.minimumSpeechEnergy,
      this.noiseFloor * this.options.noiseFloorMultiplier,
    );
    const isSpeech = energy >= speechThreshold;
    const signals: VadSignal[] = [];

    if (!this.speaking) {
      if (!isSpeech) {
        this.updateNoiseFloor(energy);
        this.appendPreRoll(ownedFrame);
        return { accepted: true, backpressured: false, signals };
      }

      this.speaking = true;
      this.utteranceFrames = this.preRoll;
      this.utteranceSampleCount = this.preRollSampleCount;
      this.preRoll = [];
      this.preRollSampleCount = 0;
      this.speechSampleCount = 0;
      this.trailingSilenceSamples = 0;
      signals.push({ type: 'speech-started' });
    }

    const remaining = this.options.maxUtteranceSamples - this.utteranceSampleCount;
    if (remaining > 0) {
      const included = ownedFrame.length <= remaining ? ownedFrame : ownedFrame.slice(0, remaining);
      this.utteranceFrames.push(included);
      this.utteranceSampleCount += included.length;
      if (isSpeech) {
        this.speechSampleCount += included.length;
        this.trailingSilenceSamples = 0;
      } else {
        this.trailingSilenceSamples += included.length;
      }
    }

    if (this.utteranceSampleCount >= this.options.maxUtteranceSamples) {
      this.finishUtterance('max-duration', signals);
    } else if (this.trailingSilenceSamples >= this.options.endSilenceSamples) {
      this.finishUtterance('silence', signals);
    }

    return {
      accepted: true,
      backpressured: this.pending !== undefined,
      signals,
    };
  }

  /** Removes the only queued utterance and lets the producer resume. */
  takeUtterance(): SegmentedUtterance | undefined {
    const utterance = this.pending;
    this.pending = undefined;
    return utterance;
  }

  /** Clears calibration, buffered audio, active speech, and queued output. */
  reset(): void {
    this.noiseFloor = this.options.initialNoiseFloor;
    this.preRoll = [];
    this.preRollSampleCount = 0;
    this.clearActiveUtterance();
    this.pending = undefined;
  }

  private updateNoiseFloor(energy: number): void {
    const alpha = this.options.noiseFloorAdaptation;
    this.noiseFloor += alpha * (energy - this.noiseFloor);
  }

  private appendPreRoll(frame: Int16Array): void {
    if (this.options.preRollSamples === 0) return;
    this.preRoll.push(frame);
    this.preRollSampleCount += frame.length;

    while (this.preRollSampleCount > this.options.preRollSamples && this.preRoll.length > 0) {
      const overflow = this.preRollSampleCount - this.options.preRollSamples;
      const oldest = this.preRoll[0];
      if (oldest.length <= overflow) {
        this.preRoll.shift();
        this.preRollSampleCount -= oldest.length;
      } else {
        this.preRoll[0] = oldest.slice(overflow);
        this.preRollSampleCount -= overflow;
      }
    }
  }

  private finishUtterance(reason: UtteranceEndReason, signals: VadSignal[]): void {
    if (this.speechSampleCount >= this.options.minimumSpeechSamples) {
      const audio = concatenateFrames(this.utteranceFrames, this.utteranceSampleCount);
      this.pending = {
        audio,
        endReason: reason,
        durationMs: samplesToMs(audio.length, this.options.sampleRate),
        speechMs: samplesToMs(this.speechSampleCount, this.options.sampleRate),
      };
      signals.push({ type: 'utterance-queued', endReason: reason });
    } else {
      signals.push({
        type: 'speech-discarded',
        reason: 'too-short',
        speechMs: samplesToMs(this.speechSampleCount, this.options.sampleRate),
      });
    }
    this.clearActiveUtterance();
  }

  private clearActiveUtterance(): void {
    this.utteranceFrames = [];
    this.utteranceSampleCount = 0;
    this.speechSampleCount = 0;
    this.trailingSilenceSamples = 0;
    this.speaking = false;
  }
}

function normalizedRms(frame: Int16Array): number {
  let sumSquares = 0;
  for (const sample of frame) {
    const normalized = sample / 32_768;
    sumSquares += normalized * normalized;
  }
  return Math.sqrt(sumSquares / frame.length);
}

function concatenateFrames(frames: readonly Int16Array[], length: number): Int16Array {
  const output = new Int16Array(length);
  let offset = 0;
  for (const frame of frames) {
    output.set(frame, offset);
    offset += frame.length;
  }
  return output;
}

function samplesToMs(samples: number, sampleRate: number): number {
  return (samples * 1_000) / sampleRate;
}

function validatePositive(name: string, value: number, allowZero = false): void {
  const valid = Number.isFinite(value) && (allowZero ? value >= 0 : value > 0);
  if (!valid) throw new RangeError(`${name} must be ${allowZero ? 'non-negative' : 'positive'}`);
}

function validateUnitInterval(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new RangeError(`${name} must be in the range (0, 1]`);
  }
}
