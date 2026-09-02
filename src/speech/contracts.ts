export const SPEECH_PROVIDER_IDS = Object.freeze(['none', 'soniox'] as const);
export type SpeechProviderId = (typeof SPEECH_PROVIDER_IDS)[number];

export const TRANSCRIPTION_PROVIDER_SELECTIONS = Object.freeze([
  'none',
  'soniox',
  'legacy-soniox-pending',
] as const);
export type TranscriptionProviderSelection = (typeof TRANSCRIPTION_PROVIDER_SELECTIONS)[number];

export interface SpeechProviderCapabilities {
  readonly provider: SpeechProviderId;
  readonly finalOnly: boolean;
  readonly streamingPartials: boolean;
  readonly remoteProcessing: boolean;
}

export const NO_SPEECH_CAPABILITIES: SpeechProviderCapabilities = Object.freeze({
  provider: 'none',
  finalOnly: true,
  streamingPartials: false,
  remoteProcessing: false,
});

export const SONIOX_SPEECH_CAPABILITIES: SpeechProviderCapabilities = Object.freeze({
  provider: 'soniox',
  finalOnly: false,
  streamingPartials: true,
  remoteProcessing: true,
});

export interface SpeechTranscriptionInput {
  readonly audio: Uint8Array;
  readonly mime: string;
  readonly languageHint?: string;
}

export interface StreamingTranscriptionOptions {
  readonly sampleRateHz: number;
  readonly channels?: number;
  readonly languageHint?: string;
  onTranscript(event: StreamingTranscriptEvent): void;
  onFailure?(failure: SpeechProviderFailure): void;
}

export type StreamingTranscriptionState =
  | 'idle'
  | 'connecting'
  | 'streaming'
  | 'finalizing'
  | 'closed'
  | 'failed';

export type StreamingTranscriptEvent = Readonly<{
  kind: 'partial' | 'final';
  text: string;
}>;

export interface StreamingFinalizeOptions {
  /** Raw PCM silence sent before the control frame. Soniox recommends about 200 ms. */
  readonly trailingSilenceMs?: number;
}

export interface StreamingTranscriptionSession {
  readonly state: StreamingTranscriptionState;
  readonly signal: AbortSignal;
  /** A new transport may only be considered before audio, finalization, or dispatch. */
  readonly reconnectAllowed: boolean;
  start(): Promise<void>;
  sendPcm16(frame: Int16Array | Uint8Array): void;
  finalize(options?: StreamingFinalizeOptions): Promise<string>;
  finish(): Promise<void>;
  markDispatched(): void;
  cancel(): void;
}

export interface SpeechToTextProvider {
  readonly id: SpeechProviderId;
  readonly capabilities: SpeechProviderCapabilities;
  transcribeFinal(input: SpeechTranscriptionInput, signal?: AbortSignal): Promise<string>;
  openStreaming?(options: StreamingTranscriptionOptions): StreamingTranscriptionSession;
  dispose?(): void;
}

export const SPEECH_FAILURE_CATEGORIES = Object.freeze([
  'not-configured',
  'legacy-pending',
  'consent-required',
  'missing-credential',
  'authority-changed',
  'invalid-audio',
  'invalid-model',
  'connection-failed',
  'connection-closed',
  'malformed-response',
  'provider-rejected',
  'bounds-exceeded',
  'timed-out',
  'cancelled',
  'unavailable',
] as const);
export type SpeechFailureCategory = (typeof SPEECH_FAILURE_CATEGORIES)[number];

export type SpeechProviderFailure = Readonly<{
  category: SpeechFailureCategory;
}>;

/** Fixed, content-free failure crossing the provider boundary. */
export class SpeechProviderError extends Error {
  constructor(public readonly category: SpeechFailureCategory) {
    super('Speech transcription failed safely.');
    this.name = 'SpeechProviderError';
  }
}
