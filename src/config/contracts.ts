export const CONFIGURATION_SECTION = 'voiceInput';

export const SONIOX_SECRET_KEY = 'SONIOX_API_KEY';
export const DEEPSEEK_SECRET_KEY = 'DEEPSEEK_API_KEY';

export const ASSISTANT_CONSENT_KEY = 'voiceInput.assistantDisclosureAcknowledged.v1';
export const DEEPSEEK_CONSENT_KEY = 'voiceInput.deepSeekDisclosureAcknowledged.v1';
export const HISTORY_STORAGE_KEY = 'voiceInput.history.v1';
export const CUSTOM_MAPPING_STORAGE_KEY = 'voiceInput.customMappings';
export const CUSTOM_MAPPING_SCHEMA_VERSION = 1 as const;
export const CUSTOM_MAPPING_ID_PATTERN = '^vm_[A-Za-z0-9_-]{22,64}$';

export const CONFIGURATION_KEYS = [
  'voiceInput.languageHint',
  'voiceInput.uiLanguage',
  'voiceInput.audioDevice',
  'voiceInput.assistantWakePhrase',
  'voiceInput.assistantResumeOnStartup',
  'voiceInput.assistantPersona',
  'voiceInput.assistantIntelligence',
  'voiceInput.deepSeekModel',
  'voiceInput.assistantProvider',
  'voiceInput.providerProfiles',
  'voiceInput.assistantSpeechEnabled',
  'voiceInput.assistantSpeechVoiceUri',
  'voiceInput.assistantSpeechRate',
  'voiceInput.historyTtlDays',
  'voiceInput.sttModel',
  'voiceInput.injectionMode',
] as const;

export const PERSISTED_CONTRACT_INVENTORY = Object.freeze({
  configuration: Object.freeze([...CONFIGURATION_KEYS]),
  secrets: Object.freeze([SONIOX_SECRET_KEY, DEEPSEEK_SECRET_KEY]),
  globalState: Object.freeze([
    ASSISTANT_CONSENT_KEY,
    DEEPSEEK_CONSENT_KEY,
    HISTORY_STORAGE_KEY,
    CUSTOM_MAPPING_STORAGE_KEY,
  ]),
  customMappings: Object.freeze({
    storageKey: CUSTOM_MAPPING_STORAGE_KEY,
    schemaVersion: CUSTOM_MAPPING_SCHEMA_VERSION,
    opaqueIdPattern: CUSTOM_MAPPING_ID_PATTERN,
    storageScope: 'global' as const,
  }),
  migrations: Object.freeze([
    Object.freeze({
      id: 'audio-device-label-to-stable-id',
      configurationKey: 'voiceInput.audioDevice' as const,
      writesTo: 'global' as const,
      remoteCalls: false,
    }),
    Object.freeze({
      id: 'deepseek-settings-to-provider-profile',
      configurationKey: 'voiceInput.assistantProvider' as const,
      writesTo: 'global' as const,
      remoteCalls: false,
      preservesSecretKey: DEEPSEEK_SECRET_KEY,
      preservesConsentKey: DEEPSEEK_CONSENT_KEY,
    }),
  ]),
});
