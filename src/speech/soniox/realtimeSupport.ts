import {
  SpeechProviderError,
  type SpeechFailureCategory,
  type StreamingTranscriptionOptions,
} from '../contracts';
import type { SonioxWebSocketTransportFactory } from './transport';

export const OPEN = 1;
export const MAX_FRAME_BYTES = 64 * 1_024;
export const MAX_BUFFERED_AUDIO_BYTES = 512 * 1_024;
export const MAX_TOTAL_AUDIO_BYTES = 32 * 1_024 * 1_024;
export const MAX_MESSAGES = 4_096;
export const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
export const DEFAULT_FINALIZE_TIMEOUT_MS = 10_000;
export const DEFAULT_FINISH_TIMEOUT_MS = 10_000;
export const DEFAULT_SESSION_TIMEOUT_MS = 5 * 60 * 1_000;
export const DEFAULT_TRAILING_SILENCE_MS = 200;

const MAX_MESSAGE_BYTES = 64 * 1_024;
const MAX_TOKENS_PER_MESSAGE = 512;
const MAX_TOKEN_BYTES = 4 * 1_024;
const MAX_TRANSCRIPT_CODE_POINTS = 4_000;
const MAX_TRANSCRIPT_BYTES = 16 * 1_024;
const MAX_TRAILING_SILENCE_MS = 2_000;

export type TimerHandle = ReturnType<typeof setTimeout>;

export interface SonioxRealtimeClientOptions extends StreamingTranscriptionOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly transportFactory: SonioxWebSocketTransportFactory;
  readonly connectTimeoutMs?: number;
  readonly finalizeTimeoutMs?: number;
  readonly finishTimeoutMs?: number;
  readonly sessionTimeoutMs?: number;
  readonly setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  readonly clearTimer?: (timer: TimerHandle) => void;
}

export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

export interface SonioxToken {
  readonly text: string;
  readonly isFinal: boolean;
}

export interface ParsedResponse {
  readonly tokens: readonly SonioxToken[];
  readonly finished: boolean;
  readonly rejected: boolean;
}

export function validateConfiguration(options: SonioxRealtimeClientOptions, channels: number): void {
  if (
    typeof options.apiKey !== 'string'
    || !options.apiKey.trim()
    || options.apiKey.length > 4_096
    || /[\r\n\u0000]/u.test(options.apiKey)
  ) throw new SpeechProviderError('missing-credential');
  if (!/^stt-rt-v5$/u.test(options.model)) throw new SpeechProviderError('invalid-model');
  if (!Number.isInteger(options.sampleRateHz) || options.sampleRateHz < 8_000 || options.sampleRateHz > 48_000) {
    throw new SpeechProviderError('invalid-audio');
  }
  if (channels !== 1 && channels !== 2) throw new SpeechProviderError('invalid-audio');
  normalizedLanguageHint(options.languageHint);
}

export function configurationMessage(
  options: SonioxRealtimeClientOptions,
  channels: number,
): Record<string, unknown> {
  const languageHint = normalizedLanguageHint(options.languageHint);
  return {
    api_key: options.apiKey,
    model: options.model,
    audio_format: 'pcm_s16le',
    sample_rate: options.sampleRateHz,
    num_channels: channels,
    enable_endpoint_detection: false,
    ...(languageHint ? { language_hints: [languageHint] } : {}),
  };
}

export function trailingSilenceByteLengths(
  milliseconds: number,
  sampleRateHz: number,
  channels: number,
): number[] {
  if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > MAX_TRAILING_SILENCE_MS) {
    throw new SpeechProviderError('invalid-audio');
  }
  const sampleCount = Math.ceil((sampleRateHz * channels * Math.floor(milliseconds)) / 1_000);
  const byteLengths: number[] = [];
  for (let remaining = sampleCount * 2; remaining > 0; remaining -= MAX_FRAME_BYTES) {
    byteLengths.push(Math.min(remaining, MAX_FRAME_BYTES));
  }
  return byteLengths;
}

function normalizedLanguageHint(value: string | undefined): string | undefined {
  if (value === undefined || value === 'auto') return undefined;
  const normalized = value.trim();
  if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/u.test(normalized)) {
    throw new SpeechProviderError('invalid-audio');
  }
  return normalized;
}

export function pcm16LittleEndian(frame: Int16Array | Uint8Array): Uint8Array {
  if (frame instanceof Int16Array) {
    if (frame.byteLength > MAX_FRAME_BYTES) throw new SpeechProviderError('invalid-audio');
    const bytes = new Uint8Array(frame.length * 2);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < frame.length; index += 1) {
      view.setInt16(index * 2, frame[index], true);
    }
    return bytes;
  }
  if (frame.byteLength % 2 !== 0) throw new SpeechProviderError('invalid-audio');
  return frame.slice();
}

export function parseResponse(data: unknown): ParsedResponse {
  if (typeof data !== 'string' || utf8Length(data) > MAX_MESSAGE_BYTES) {
    throw new SpeechProviderError('malformed-response');
  }
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    throw new SpeechProviderError('malformed-response');
  }
  if (!isRecord(value)) throw new SpeechProviderError('malformed-response');
  const rejected = Object.hasOwn(value, 'error_code') || Object.hasOwn(value, 'error_type');
  const finishedValue = value.finished;
  if (finishedValue !== undefined && typeof finishedValue !== 'boolean') {
    throw new SpeechProviderError('malformed-response');
  }
  const tokensValue = value.tokens ?? [];
  if (!Array.isArray(tokensValue) || tokensValue.length > MAX_TOKENS_PER_MESSAGE) {
    throw new SpeechProviderError('malformed-response');
  }
  const tokens = tokensValue.map((token): SonioxToken => {
    if (!isRecord(token) || typeof token.text !== 'string' || typeof token.is_final !== 'boolean') {
      throw new SpeechProviderError('malformed-response');
    }
    if (utf8Length(token.text) > MAX_TOKEN_BYTES) {
      throw new SpeechProviderError('bounds-exceeded');
    }
    return { text: token.text, isFinal: token.is_final };
  });
  return { tokens, finished: finishedValue === true, rejected };
}

export function appendTranscript(current: string, addition: string): string {
  const next = `${current}${addition}`;
  assertTranscriptBound(next);
  return next;
}

export function assertTranscriptBound(value: string): void {
  if (
    codePointLength(value) > MAX_TRANSCRIPT_CODE_POINTS
    || utf8Length(value) > MAX_TRANSCRIPT_BYTES
  ) throw new SpeechProviderError('bounds-exceeded');
}

export function codePointLength(value: string): number {
  return [...value].length;
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function boundedTimeout(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(DEFAULT_SESSION_TIMEOUT_MS, Math.floor(value)));
}

export function categoryFrom(error: unknown): SpeechFailureCategory {
  return error instanceof SpeechProviderError ? error.category : 'connection-failed';
}

export function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}
