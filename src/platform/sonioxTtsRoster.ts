import { MAX_SONIOX_TTS_VOICES, sonioxVoiceUri } from '../webview/controlCenter/hostVoices';

/** The real-time model whose roster this feature speaks with. */
export const SONIOX_TTS_MODEL = 'tts-rt-v2';

/**
 * Used only when the roster request fails. Every listed voice speaks every supported
 * language, so a packaged subset stays usable for Hebrew and English alike.
 */
export const SONIOX_TTS_FALLBACK_VOICE_IDS: readonly string[] = Object.freeze([
  'Adrian', 'Maya', 'Daniel', 'Grace', 'Oliver',
]);

export interface SonioxTtsVoice {
  readonly id: string;
  readonly name: string;
}

export function fallbackVoices(): readonly SonioxTtsVoice[] {
  return Object.freeze(SONIOX_TTS_FALLBACK_VOICE_IDS.map(
    (id) => Object.freeze({ id, name: id }),
  ));
}

/** Accepts only well-formed ids from the provider roster, bounded and de-duplicated. */
export function parseVoiceRoster(body: unknown): readonly SonioxTtsVoice[] {
  const models = readArray(readRecord(body)?.models);
  const model = models.find((entry) => readRecord(entry)?.id === SONIOX_TTS_MODEL) ?? models[0];
  const voices: SonioxTtsVoice[] = [];
  const seen = new Set<string>();
  for (const entry of readArray(readRecord(model)?.voices)) {
    const id = readRecord(entry)?.id;
    if (typeof id !== 'string' || !sonioxVoiceUri(id) || seen.has(id)) continue;
    seen.add(id);
    voices.push(Object.freeze({ id, name: id }));
    if (voices.length >= MAX_SONIOX_TTS_VOICES) break;
  }
  return Object.freeze(voices);
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
