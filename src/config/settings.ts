import { normalizePersonaId, type PersonaId } from '../assistant/personas';
import { DEFAULT_DEEPSEEK_MODEL } from '../assistant/deepseek';
import {
  TRANSCRIPTION_PROVIDER_SELECTIONS,
  type TranscriptionProviderSelection,
} from '../speech/contracts';
import {
  DEFAULT_PROVIDER_PROFILES,
  cloneProviderProfiles,
  normalizeAssistantProvider,
  normalizeProviderProfiles,
  type AssistantProviderSelection,
  type ProviderProfiles,
} from './providerProfiles';

export const UI_LANGUAGES = ['he', 'en'] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

export const HISTORY_TTL_DAYS = [0, 1, 7, 30] as const;
export type HistoryTtlDays = (typeof HISTORY_TTL_DAYS)[number];

export const ASSISTANT_INTELLIGENCE_OPTIONS = ['off', 'deepseek'] as const;
export type AssistantIntelligence = (typeof ASSISTANT_INTELLIGENCE_OPTIONS)[number];

export const INJECTION_MODES = [
  'auto',
  'paste-key',
  'type-key',
  'editor-only',
  'clipboard-only',
] as const;
export type InjectionMode = (typeof INJECTION_MODES)[number];

export interface VoiceInputSettings {
  languageHint: string;
  uiLanguage: UiLanguage;
  audioDevice: string;
  assistantWakePhrase: string;
  assistantResumeOnStartup: boolean;
  assistantPersona: PersonaId;
  assistantIntelligence: AssistantIntelligence;
  deepSeekModel: string;
  assistantProvider: AssistantProviderSelection;
  providerProfiles: ProviderProfiles;
  assistantSpeechEnabled: boolean;
  assistantSpeechVoiceUri: string;
  assistantSpeechRate: number;
  transcriptionProvider: TranscriptionProviderSelection;
  autoMode: boolean;
  historyTtlDays: HistoryTtlDays;
  sttModel: string;
  injectionMode: InjectionMode;
}

export type SettingName = keyof VoiceInputSettings;

export const SETTINGS_DEFAULTS: Readonly<VoiceInputSettings> = Object.freeze({
  languageHint: 'he',
  uiLanguage: 'en',
  audioDevice: '',
  assistantWakePhrase: '',
  assistantResumeOnStartup: false,
  assistantPersona: 'teacher-lecturer',
  assistantIntelligence: 'deepseek',
  deepSeekModel: DEFAULT_DEEPSEEK_MODEL,
  assistantProvider: 'deepseek',
  providerProfiles: DEFAULT_PROVIDER_PROFILES,
  assistantSpeechEnabled: true,
  assistantSpeechVoiceUri: '',
  assistantSpeechRate: 1,
  transcriptionProvider: 'none',
  autoMode: false,
  historyTtlDays: 30,
  sttModel: 'stt-async-v5',
  injectionMode: 'auto',
});

export const SETTING_NAMES = Object.freeze(Object.keys(SETTINGS_DEFAULTS) as SettingName[]);

export function normalizeSetting<K extends SettingName>(
  name: K,
  value: unknown,
): VoiceInputSettings[K] {
  switch (name) {
    case 'languageHint':
      return normalizeNonEmptyString(value, SETTINGS_DEFAULTS.languageHint) as VoiceInputSettings[K];
    case 'uiLanguage':
      return normalizeEnum(value, UI_LANGUAGES, SETTINGS_DEFAULTS.uiLanguage) as VoiceInputSettings[K];
    case 'audioDevice':
    case 'assistantWakePhrase':
    case 'assistantSpeechVoiceUri':
      return normalizeOptionalString(value) as VoiceInputSettings[K];
    case 'assistantPersona':
      return normalizePersonaId(value) as VoiceInputSettings[K];
    case 'assistantIntelligence':
      return normalizeEnum(
        value,
        ASSISTANT_INTELLIGENCE_OPTIONS,
        SETTINGS_DEFAULTS.assistantIntelligence,
      ) as VoiceInputSettings[K];
    case 'deepSeekModel':
      return normalizeNonEmptyString(value, SETTINGS_DEFAULTS.deepSeekModel) as VoiceInputSettings[K];
    case 'assistantProvider':
      return normalizeAssistantProvider(value) as VoiceInputSettings[K];
    case 'providerProfiles':
      return normalizeProviderProfiles(value) as VoiceInputSettings[K];
    case 'assistantSpeechEnabled':
      return (typeof value === 'boolean' ? value : SETTINGS_DEFAULTS.assistantSpeechEnabled) as VoiceInputSettings[K];
    case 'autoMode':
      return (typeof value === 'boolean' ? value : SETTINGS_DEFAULTS.autoMode) as VoiceInputSettings[K];
    case 'assistantResumeOnStartup':
      return (typeof value === 'boolean' ? value : SETTINGS_DEFAULTS.assistantResumeOnStartup) as VoiceInputSettings[K];
    case 'assistantSpeechRate':
      return normalizeSpeechRate(value) as VoiceInputSettings[K];
    case 'transcriptionProvider':
      return normalizeEnum(
        value,
        TRANSCRIPTION_PROVIDER_SELECTIONS,
        SETTINGS_DEFAULTS.transcriptionProvider,
      ) as VoiceInputSettings[K];
    case 'historyTtlDays':
      return normalizeEnum(value, HISTORY_TTL_DAYS, SETTINGS_DEFAULTS.historyTtlDays) as VoiceInputSettings[K];
    case 'sttModel':
      return normalizeNonEmptyString(value, SETTINGS_DEFAULTS.sttModel) as VoiceInputSettings[K];
    case 'injectionMode':
      return normalizeEnum(value, INJECTION_MODES, SETTINGS_DEFAULTS.injectionMode) as VoiceInputSettings[K];
  }
}

export function normalizeSettings(values: Partial<Record<SettingName, unknown>>): VoiceInputSettings {
  const normalized = {
    ...SETTINGS_DEFAULTS,
    providerProfiles: cloneProviderProfiles(SETTINGS_DEFAULTS.providerProfiles),
  } as VoiceInputSettings;
  for (const name of SETTING_NAMES) {
    setNormalized(normalized, name, values[name]);
  }
  return normalized;
}

function setNormalized<K extends SettingName>(
  target: VoiceInputSettings,
  name: K,
  value: unknown,
): void {
  target[name] = normalizeSetting(name, value);
}

function normalizeOptionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNonEmptyString(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  return value.trim() || fallback;
}

function normalizeEnum<T extends string | number>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function normalizeSpeechRate(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return SETTINGS_DEFAULTS.assistantSpeechRate;
  return Math.min(2, Math.max(0.5, parsed));
}
