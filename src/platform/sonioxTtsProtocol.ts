/**
 * The Soniox speech-output wire contract: endpoints, provider limits, the structural
 * request/playback ports the service is built against, and the pure text transforms
 * shared with the tests. The voice roster lives in `sonioxTtsRoster`. Nothing in this
 * module performs IO.
 */
export const SONIOX_TTS_ENDPOINT = 'https://tts-rt.soniox.com/tts';
export const SONIOX_TTS_MODELS_ENDPOINT = 'https://api.soniox.com/v1/tts-models';
export const SONIOX_TTS_SAMPLE_RATE = 24_000;
export const SONIOX_TTS_AUDIO_FORMAT = 'wav';

/** The provider rejects longer requests, so the host truncates before it asks. */
export const MAX_SONIOX_TTS_TEXT_LENGTH = 5_000;

/** Our 0.5..2 rate maps onto the provider's supported 0.7..1.3 speed window. */
export const MIN_SONIOX_TTS_SPEED = 0.7;
export const MAX_SONIOX_TTS_SPEED = 1.3;

/**
 * Playback is stdin-only so no spoken text can ever appear in argv or in a temp file.
 * `paplay` reads stdin when it is given no file operand; `aplay -q -` is the fallback
 * for hosts without PulseAudio/PipeWire tooling.
 */
export const SONIOX_PLAYBACK_COMMANDS: readonly Readonly<{
  command: string;
  args: readonly string[];
}>[] = Object.freeze([
  Object.freeze({ command: 'paplay', args: Object.freeze([] as string[]) }),
  Object.freeze({ command: 'aplay', args: Object.freeze(['-q', '-']) }),
]);

export type SonioxTtsOutcome = 'completed' | 'error' | 'cancelled';

export interface SonioxTtsPlayback {
  readonly done: Promise<SonioxTtsOutcome>;
  cancel(): void;
}

export interface SonioxTtsSpeakOptions {
  language: 'he' | 'en';
  rate: number;
  voice: string;
}

/** Minimal structural response so tests never open a socket. */
export interface SonioxTtsResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  body?: AsyncIterable<Uint8Array> | null;
}

export type SonioxTtsFetch = (
  input: string,
  init: {
    method: 'GET' | 'POST';
    headers: Readonly<Record<string, string>>;
    signal: AbortSignal;
    body?: string;
  },
) => Promise<SonioxTtsResponse>;

export interface SonioxPlaybackStdin {
  write(chunk: Uint8Array): boolean;
  end(): void;
  on(event: 'error', listener: (error: unknown) => void): unknown;
  once?(event: 'drain', listener: () => void): unknown;
}

/** Minimal structural view of a spawned player, so tests never start a real process. */
export interface SonioxPlaybackProcess {
  readonly stdin: SonioxPlaybackStdin | null;
  on(event: 'error', listener: (error: unknown) => void): unknown;
  on(event: 'exit', listener: (code: number | null) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

export type SonioxPlaybackSpawn = (
  command: string,
  args: readonly string[],
) => SonioxPlaybackProcess;

/** The Soniox remote-processing consent port; identical to the transcription gate. */
export interface SonioxTtsAuthority {
  capture(): PromiseLike<Readonly<object> | undefined> | Readonly<object> | undefined;
}

export interface SonioxTtsCredentials {
  use<T>(provider: 'soniox', operation: (credential: string) => Promise<T>): Promise<T | undefined>;
}

export interface SonioxTtsServiceOptions {
  fetch: SonioxTtsFetch;
  spawn: SonioxPlaybackSpawn;
  credentials: SonioxTtsCredentials;
  authority: SonioxTtsAuthority;
  /** Content-free: spoken text, audio bytes, and credentials are never logged. */
  log(message: string): void;
  synthesisTimeoutMs?: number;
  voiceListTimeoutMs?: number;
}

/** Truncates on a word boundary so a long reply is never cut mid-word. */
export function boundedUtterance(text: unknown): string {
  const normalized = typeof text === 'string' ? text.trim() : '';
  if (normalized.length <= MAX_SONIOX_TTS_TEXT_LENGTH) return normalized;
  const capped = normalized.slice(0, MAX_SONIOX_TTS_TEXT_LENGTH);
  const boundary = capped.search(/\s\S*$/u);
  return (boundary > 0 ? capped.slice(0, boundary) : capped).trim();
}

/** Maps the extension's 0.5..2 speech rate onto the provider's 0.7..1.3 speed window. */
export function sonioxSpeechSpeed(rate: unknown): number {
  const value = typeof rate === 'number' && Number.isFinite(rate) ? rate : 1;
  const clamped = Math.min(MAX_SONIOX_TTS_SPEED, Math.max(MIN_SONIOX_TTS_SPEED, value));
  return Math.round(clamped * 100) / 100;
}

/** Fixed categories only: provider error bodies never reach the log. */
export function synthesisFailure(status: unknown): string {
  if (status === 401 || status === 403) return 'unauthenticated';
  if (status === 402) return 'budget-exhausted';
  if (status === 413) return 'utterance-too-long';
  if (status === 429) return 'rate-limited';
  return 'unavailable';
}

/** Consumes a rejected body so the connection closes; the body never reaches the log. */
export async function discardBody(response: SonioxTtsResponse): Promise<void> {
  try { await response.json(); } catch { /* The body is unreadable and stays unread. */ }
}
