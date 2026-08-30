export const DEFAULT_SPEECH_RATE = 1;
export const MIN_SPEECH_RATE = 0.5;
export const MAX_SPEECH_RATE = 2;
export const MAX_SPEECH_QUEUE_LENGTH = 8;
export const MAX_SPEECH_TEXT_LENGTH = 4_000;

export interface SpeechVoiceLike {
  voiceURI: string;
  name: string;
  lang: string;
  default?: boolean;
}

export interface SpeechQueueItem {
  id: string;
  text: string;
  lang?: string;
}

export function normalizeSpeechRate(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SPEECH_RATE;
  return Math.min(MAX_SPEECH_RATE, Math.max(MIN_SPEECH_RATE, parsed));
}

/** Spoken assistant feedback follows the UI/reply locale, never the STT hint. */
export function feedbackSpeechLanguage(uiLanguage: unknown): 'he' | 'en' {
  return uiLanguage === 'he' ? 'he' : 'en';
}

/** Browser playback is authoritative while an utterance is active. */
export function resolveSpeakingState(
  _hostSpeaking: unknown,
  activeSpeechId: string | undefined,
): boolean {
  return activeSpeechId !== undefined;
}

export function continuesSpeakingAfterFinish(
  speechEnabled: unknown,
  queuedCount: number,
): boolean {
  return speechEnabled === true && Number.isInteger(queuedCount) && queuedCount > 0;
}

export function selectSpeechVoice<T extends SpeechVoiceLike>(
  voices: readonly T[],
  savedVoiceUri?: string,
  preferredLanguage?: string,
): T | undefined {
  if (voices.length === 0) return undefined;

  const saved = savedVoiceUri?.trim();
  if (saved) {
    const exactUri = voices.find((voice) => voice.voiceURI === saved);
    if (exactUri) return exactUri;

    // Older settings may contain a voice name instead of its stable URI.
    const exactName = voices.find((voice) => voice.name === saved);
    if (exactName) return exactName;

    // A missing saved voice means the operating system changed. Prefer its
    // current default rather than silently persisting a different language
    // match as the user's choice.
    return voices.find((voice) => voice.default) ?? voices[0];
  }

  const language = preferredLanguage?.trim().toLowerCase();
  const languagePrefix = language?.split('-')[0];
  const matchingLanguage = languagePrefix
    ? voices.filter((voice) => voice.lang.toLowerCase().split('-')[0] === languagePrefix)
    : [];

  return matchingLanguage.find((voice) => voice.default)
    ?? matchingLanguage[0]
    ?? voices.find((voice) => voice.default)
    ?? voices[0];
}

/** A bounded FIFO used by the webview's speechSynthesis adapter. */
export class SpeechQueue {
  private readonly items: SpeechQueueItem[] = [];
  private readonly usedIds = new Set<string>();

  constructor(private readonly maxLength = MAX_SPEECH_QUEUE_LENGTH) {
    if (!Number.isInteger(maxLength) || maxLength < 1) {
      throw new RangeError('speech queue length must be a positive integer');
    }
  }

  get length(): number {
    return this.items.length;
  }

  enqueue(item: SpeechQueueItem): boolean {
    const id = item.id.trim();
    const text = item.text.trim();
    if (!id || !text || text.length > MAX_SPEECH_TEXT_LENGTH || this.usedIds.has(id)) return false;
    if (this.items.length >= this.maxLength) return false;
    this.usedIds.add(id);
    if (this.usedIds.size > 100) {
      const oldest = this.usedIds.values().next().value as string | undefined;
      if (oldest) this.usedIds.delete(oldest);
    }
    this.items.push({ ...item, id, text });
    return true;
  }

  take(): SpeechQueueItem | undefined {
    return this.items.shift();
  }

  cancel(): SpeechQueueItem[] {
    return this.items.splice(0);
  }
}

/** Generation guard preventing late browser callbacks from finishing a newer utterance. */
export class SpeechLifecycle {
  private generation = 0;
  private currentId: string | undefined;

  get activeId(): string | undefined {
    return this.currentId;
  }

  start(id: string): number | undefined {
    const normalized = id.trim();
    if (!normalized || this.currentId) return undefined;
    this.currentId = normalized;
    this.generation += 1;
    return this.generation;
  }

  finish(id: string, generation: number): boolean {
    if (this.currentId !== id || this.generation !== generation) return false;
    this.currentId = undefined;
    return true;
  }

  cancel(): string | undefined {
    const cancelled = this.currentId;
    this.currentId = undefined;
    this.generation += 1;
    return cancelled;
  }
}
