import type { ControlCenterObservedSystemVoice } from './contractSetup';

/**
 * The host speech fallback is presented as one synthetic voice so the browser and the
 * host agree on a single stable identity. It is never enumerated per synthesizer voice.
 */
export const HOST_SPEECH_VOICE_URI = 'voice-input-host:speech-dispatcher';

/**
 * Soniox speech output is host-owned as well: only the host holds the API key and the
 * machine-local remote-processing receipt, so the browser can name such a voice but can
 * never play it. The identifier after the scheme is the provider voice id.
 */
export const SONIOX_TTS_VOICE_SCHEME = 'voice-input-soniox:';

/** Provider voice ids are opaque labels; `assistantSpeechVoiceUri` is user-editable. */
const SONIOX_TTS_VOICE_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u;

/** The protocol bounds a voice index to 0..49, so the effective list never grows past 50. */
export const MAX_SYSTEM_VOICE_CHOICES = 50;

/** The browser may observe at most this many voices; the host indexes them first. */
export const MAX_BROWSER_SPEECH_VOICES = 20;

/** Host voices are appended last, so the host reserves capacity for them up front. */
export const MAX_HOST_SPEECH_VOICES = 2;

/**
 * The remote roster is bounded before it ever reaches the host voice channel.
 *
 * Soniox voices travel as bare ids rather than as full voice records: the shared message
 * envelope allows 100 scalars per message, and a four-field record per voice would spend
 * that budget after roughly twenty voices. Both sides expand the ids through
 * `sonioxSystemVoices`, so the host and the browser still index one identical list.
 */
export const MAX_SONIOX_TTS_VOICES = 28;

/** The whole host channel: the speech-dispatcher fallback plus the expanded roster. */
export const MAX_HOST_CHANNEL_VOICES = MAX_HOST_SPEECH_VOICES + MAX_SONIOX_TTS_VOICES;

export function isHostSpeechVoice(voiceUri: unknown): boolean {
  return voiceUri === HOST_SPEECH_VOICE_URI;
}

/** True only for a well-formed stored Soniox voice URI; a malformed id is not a voice. */
export function isSonioxTtsVoice(voiceUri: unknown): boolean {
  return sonioxVoiceId(voiceUri) !== undefined;
}

/** Parses a stored URI defensively: settings are user-editable and never trusted. */
export function sonioxVoiceId(voiceUri: unknown): string | undefined {
  if (typeof voiceUri !== 'string' || !voiceUri.startsWith(SONIOX_TTS_VOICE_SCHEME)) {
    return undefined;
  }
  const id = voiceUri.slice(SONIOX_TTS_VOICE_SCHEME.length);
  return SONIOX_TTS_VOICE_ID.test(id) ? id : undefined;
}

/** Builds a voice URI, or an empty string when the provider offered an unusable id. */
export function sonioxVoiceUri(voiceId: unknown): string {
  return typeof voiceId === 'string' && SONIOX_TTS_VOICE_ID.test(voiceId)
    ? `${SONIOX_TTS_VOICE_SCHEME}${voiceId}`
    : '';
}

/**
 * Host-channel voices are played by the extension host. The browser must never be able to
 * claim one of these identities, and the host preview owns every one of them.
 */
export function isHostChannelVoice(voiceUri: unknown): boolean {
  return isHostSpeechVoice(voiceUri) || isSonioxTtsVoice(voiceUri);
}

/** The one label both sides render, so a voice reads the same wherever it is listed. */
export function sonioxVoiceLabel(voiceId: string, language: unknown): string {
  return language === 'he'
    ? `Soniox ${voiceId} (מרוחק)`
    : `Soniox ${voiceId} (remote)`;
}

/** The protocol bounds every voice index to this range on both sides of the channel. */
export function isSystemVoiceIndex(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= -1
    && value < MAX_SYSTEM_VOICE_CHOICES;
}

/**
 * The whole host-owned channel in its indexed order: the speech-dispatcher fallback
 * first, then the expanded Soniox roster. The host composes the same list, so a voice
 * index means the same voice on both sides.
 */
export function hostChannelVoices(
  setup: {
    hostVoices?: readonly ControlCenterObservedSystemVoice[];
    sonioxVoices?: readonly string[];
  } | undefined,
  language: unknown,
): ControlCenterObservedSystemVoice[] {
  return [
    ...setup?.hostVoices ?? [],
    ...sonioxSystemVoices(setup?.sonioxVoices ?? [], language),
  ];
}

/**
 * Expands the bounded id list into voice records. Malformed and duplicate ids are dropped
 * on both sides identically, so the host and the browser always agree on the indices.
 */
export function sonioxSystemVoices(
  voiceIds: readonly string[],
  language: unknown,
): ControlCenterObservedSystemVoice[] {
  const voices: ControlCenterObservedSystemVoice[] = [];
  const seen = new Set<string>();
  for (const voiceId of voiceIds.slice(0, MAX_SONIOX_TTS_VOICES)) {
    const voiceUri = sonioxVoiceUri(voiceId);
    if (!voiceUri || seen.has(voiceUri)) continue;
    seen.add(voiceUri);
    voices.push({
      voiceUri,
      name: sonioxVoiceLabel(voiceId, language).slice(0, 120),
      language: '',
      isDefault: false,
    });
  }
  return voices;
}

/**
 * Builds the one effective voice list rendered by the browser and indexed by the host.
 *
 * Browser-observed voices keep their order and their indices; host voices are appended
 * and always fit, because the browser contribution is capped by the remaining capacity.
 * With no host voices this returns the browser list unchanged.
 */
export function mergeSystemVoices(
  observed: readonly ControlCenterObservedSystemVoice[],
  host: readonly ControlCenterObservedSystemVoice[],
): ControlCenterObservedSystemVoice[] {
  const hostVoices = host.slice(0, MAX_HOST_CHANNEL_VOICES);
  const capacity = Math.max(0, MAX_SYSTEM_VOICE_CHOICES - hostVoices.length);
  const browserVoices = observed
    .filter((voice) => !hostVoices.some((entry) => entry.voiceUri === voice.voiceUri))
    .slice(0, capacity);
  return [...browserVoices, ...hostVoices];
}
