import type {
  AudioDeviceInfo,
  HistoryTtlDays,
  LanguageInfo,
  ModelInfo,
  PersonaId,
  Revision,
  UiLang,
} from '../protocol';

export const SETTINGS_SECTION_IDS = [
  'general', 'assistant', 'providers', 'speech',
  'microphone', 'mappings', 'privacy', 'diagnostics',
] as const;

/** Legacy host navigation targets retained until the extension host speaks routes. */
export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

export const ASSISTANT_ROUTE_IDS = [
  'setup',
  'home',
  'conversation',
  'agents',
  'providers',
  'voice',
  'actions',
  'privacy',
  'diagnostics',
] as const;

export type AssistantRouteId = (typeof ASSISTANT_ROUTE_IDS)[number];

export const SETUP_STEP_IDS = [
  'microphone',
  'soniox',
  'transcription',
  'speech',
  'provider',
  'agent',
  'rehearsal',
] as const;

export type SetupStepId = (typeof SETUP_STEP_IDS)[number];

export type SetupCheckStatus = 'pending' | 'running' | 'ready' | 'attention' | 'error';

export type SetupResultCode =
  | 'microphone-unavailable'
  | 'no-audio'
  | 'credential-required'
  | 'consent-required'
  | 'transcription-unavailable'
  | 'speech-disabled'
  | 'provider-disabled'
  | 'provider-unavailable'
  | 'agent-unavailable'
  | 'wake-phrase-required'
  | 'cancelled'
  | 'unavailable';

export interface SettingsSetupStepState {
  status: SetupCheckStatus;
  result?: SetupResultCode;
}

export interface SettingsSetupSpeechRequest {
  id: string;
  kind: 'preview' | 'rehearsal';
  text: string;
  voiceUri: string;
  rate: number;
  lang: UiLang;
}

export interface SettingsSetupState {
  revision: Revision;
  currentStep: SetupStepId;
  complete: boolean;
  steps: Record<SetupStepId, SettingsSetupStepState>;
  speechRequest?: SettingsSetupSpeechRequest;
}

export type PresentationReadiness = 'ready' | 'attention' | 'loading' | 'unavailable';

/**
 * Browser-safe provider description. It deliberately models a provider role,
 * not a credential or provider SDK response, so future providers can be added
 * without widening the current host authority boundary.
 */
export interface ProviderPresentation {
  id: string;
  name: string;
  role: 'speech-to-text' | 'reasoning' | 'text-to-speech';
  execution: 'remote' | 'system';
  readiness: PresentationReadiness;
  configured: boolean;
  modelId?: string;
  credentialSurface: 'native-host' | 'not-applicable';
}

/** Browser-safe agent projection for the single current compatibility agent. */
export interface AgentPresentation {
  id: string;
  name: string;
  persona: PersonaId;
  readiness: PresentationReadiness;
  listening: boolean;
  authority: 'host-policy';
  approval: 'explicit-before-send-or-action';
}

/** Only presentation data may cross into Actions cards; arguments stay host-side. */
export interface ActionPresentation {
  id: string;
  name: string;
  kind: SettingsMappingCard['kind'];
  targetId: string;
  enabled: boolean;
  agentEnabled: boolean;
  approval: 'host-confirmed';
}

export interface CompatibilityPresentation {
  providers: ProviderPresentation[];
  agents: AgentPresentation[];
  actions: ActionPresentation[];
}

export const SETTINGS_SETTING_NAMES = [
  'uiLanguage', 'languageHint', 'sttModel', 'historyTtlDays', 'injectionMode',
  'assistantWakePhrase', 'assistantPersona', 'assistantIntelligence', 'deepSeekModel',
  'assistantSpeechEnabled', 'assistantSpeechVoiceUri', 'assistantSpeechRate', 'audioDevice',
] as const;

export type SettingsSettingName = (typeof SETTINGS_SETTING_NAMES)[number];
export type InjectionMode = 'auto' | 'paste-key' | 'type-key' | 'editor-only' | 'clipboard-only';
export type AssistantIntelligence = 'off' | 'deepseek';
export const PLANNER_PROVIDER_IDS = [
  'deepseek',
  'anthropic',
  'openai',
  'gemini',
  'openrouter',
  'ollama',
  'bedrock',
  'grok',
] as const;
export type PlannerProviderId = (typeof PLANNER_PROVIDER_IDS)[number];
export type AssistantProviderSelection = 'off' | PlannerProviderId;
export type ProviderId = 'soniox' | PlannerProviderId;
export type ConsentId = 'assistant-listening' | PlannerProviderId;
export type ConsentAction = 'acknowledge' | 'revoke';
export type SettingsDisplayValue = string | number | boolean;

export type ConnectionTestCategory =
  | 'connected'
  | 'not-configured'
  | 'consent-required'
  | 'unauthorized'
  | 'rate-limited'
  | 'rejected'
  | 'unavailable'
  | 'timed-out'
  | 'cancelled';

export type SettingsFailureCategory =
  | 'permission-denied'
  | 'unavailable'
  | 'invalid-value'
  | 'busy'
  | 'unknown';

/**
 * Browser-safe recovery summary of the latest host-owned microphone scan.
 * Native identities and legacy setting values deliberately stay in the host.
 */
export interface SettingsMicrophoneSelection {
  kind: 'default' | 'available' | 'repaired' | 'stale' | 'legacy';
  status: 'ready' | 'unavailable';
  recovery: 'none' | 'select-device';
  label?: string;
}

export interface WorkspaceOverrideView {
  setting: SettingsSettingName;
  source: 'workspace' | 'workspace-folder';
  effectiveValue: SettingsDisplayValue;
  globalValue: SettingsDisplayValue;
}

export type SettingsProviderTestState =
  | { phase: 'idle'; operationRevision: Revision }
  | { phase: 'running'; operationRevision: Revision }
  | { phase: 'complete'; operationRevision: Revision; result: ConnectionTestCategory };

export type SettingsCredentialState =
  | { phase: 'idle'; operationRevision: Revision }
  | { phase: 'updating'; operationRevision: Revision }
  | {
      phase: 'complete';
      operationRevision: Revision;
      result: 'saved' | 'cleared' | 'cancelled' | 'unavailable';
    };

export interface SettingsProviderState {
  configured: boolean;
  credential: SettingsCredentialState;
  test: SettingsProviderTestState;
}

/** Safe reasoning-provider card. Full endpoints and all credential material stay host-side. */
export interface SettingsProviderCard extends SettingsProviderState {
  id: PlannerProviderId;
  name: string;
  enabled: boolean;
  selected: boolean;
  model: string;
  modelPresets: string[];
  endpointHost: string;
  locality: 'local-loopback' | 'remote';
  credentialRequired: boolean;
  consentRequired: boolean;
  consentAcknowledged: boolean;
}

export interface SettingsProviderCollection {
  revision: Revision;
  selectedProvider: AssistantProviderSelection;
  items: SettingsProviderCard[];
}

export interface SettingsAgentCard {
  id: string;
  name: string;
  description: string;
  provider: PlannerProviderId;
  model: string;
  persona: PersonaId;
  enabled: boolean;
  isDefault: boolean;
  instructionsConfigured: boolean;
  speechEnabled: boolean;
  speechRate: number;
  templateId?: PersonaId;
  fallback?: { provider: PlannerProviderId; model: string };
}

export interface SettingsAgentCollection {
  revision: Revision;
  status: 'ready' | 'error';
  defaultAgentId?: string;
  items: SettingsAgentCard[];
}

export type SettingsMappingApprovalState = 'none' | 'approved' | 'revoked';

export interface SettingsApprovalHistoryEntry {
  mappingId: string;
  decision: 'granted' | 'revoked' | 'confirmed-execution' | 'always-approved-execution';
  timestamp: number;
}

export interface SettingsMappingCard {
  id: string;
  label: string;
  description: string;
  phrases: string[];
  kind: 'command' | 'language-model-tool';
  targetId: string;
  enabled: boolean;
  agentEnabled: boolean;
  approval: SettingsMappingApprovalState;
  permissionTier: 'confirmation-required' | 'always-approved';
}

export type DiagnosticCheckId =
  | 'extension'
  | 'soniox'
  | 'deepseek'
  | 'microphone'
  | 'paste-helper'
  | 'workspace-trust';

export interface SettingsDiagnosticCheck {
  id: DiagnosticCheckId;
  status: 'ok' | 'attention' | 'unavailable' | 'unknown';
}

export type SettingsNoticeCode =
  | 'settings-saved'
  | 'operation-cancelled'
  | 'operation-failed'
  | 'stale-state'
  | 'credential-updated'
  | 'credential-cleared'
  | 'provider-updated'
  | 'agent-updated'
  | 'mapping-updated'
  | 'diagnostics-copied';

/** Complete allowlisted state for the dedicated Settings view. */
export interface SettingsViewState {
  revision: Revision;
  uiLang: UiLang;
  setup: SettingsSetupState;
  general: {
    settingsRevision: Revision;
    languageHint: string;
    sttModel: string;
    historyTtlDays: HistoryTtlDays;
    injectionMode: InjectionMode;
    shortcut: {
      packageDefault: string;
      effectiveBindingKnown: false;
    };
    languages: LanguageInfo[];
    models: ModelInfo[];
    metadataStatus: 'idle' | 'loading' | 'ready' | 'error';
    metadataError?: SettingsFailureCategory;
    workspaceOverrides: WorkspaceOverrideView[];
  };
  assistant: {
    operationRevision: Revision;
    status: 'stopped' | 'starting' | 'listening' | 'stopping' | 'error';
    wakePhrase: string;
    persona: PersonaId;
    consentAcknowledged: boolean;
    error?: SettingsFailureCategory;
  };
  transcription: SettingsProviderState;
  providers: SettingsProviderCollection;
  agents: SettingsAgentCollection;
  speech: {
    operationRevision: Revision;
    enabled: boolean;
    voiceUri: string;
    rate: number;
    speaking: boolean;
  };
  microphone: {
    operationRevision: Revision;
    deviceId: string;
    devices: AudioDeviceInfo[];
    status: 'idle' | 'scanning' | 'ready' | 'unavailable' | 'error';
    selection?: SettingsMicrophoneSelection;
    error?: SettingsFailureCategory;
  };
  mappings: {
    revision: Revision;
    status: 'loading' | 'ready' | 'untrusted' | 'error';
    items: SettingsMappingCard[];
    approvalHistory: SettingsApprovalHistoryEntry[];
  };
  privacy: {
    consentRevision: Revision;
    workspaceTrusted: boolean;
  };
  diagnostics: {
    operationRevision: Revision;
    status: 'idle' | 'running' | 'ready' | 'attention' | 'error';
    extensionVersion: string;
    platform: 'darwin' | 'linux' | 'win32' | 'other';
    checks: SettingsDiagnosticCheck[];
    reportAvailable: boolean;
  };
  notice?: {
    id: string;
    kind: 'info' | 'success' | 'warning' | 'error';
    code: SettingsNoticeCode;
  };
}

export type SettingsChangeMessage =
  | { type: 'settings-change'; settingsRevision: Revision; setting: 'uiLanguage'; value: UiLang }
  | { type: 'settings-change'; settingsRevision: Revision; setting: 'languageHint'; value: string }
  | { type: 'settings-change'; settingsRevision: Revision; setting: 'sttModel'; value: string }
  | { type: 'settings-change'; settingsRevision: Revision; setting: 'historyTtlDays'; value: HistoryTtlDays }
  | { type: 'settings-change'; settingsRevision: Revision; setting: 'injectionMode'; value: InjectionMode }
  | { type: 'settings-change'; settingsRevision: Revision; setting: 'assistantWakePhrase'; value: string }
  | { type: 'settings-change'; settingsRevision: Revision; setting: 'assistantPersona'; value: PersonaId }
  | { type: 'settings-change'; settingsRevision: Revision; setting: 'assistantIntelligence'; value: AssistantIntelligence }
  | { type: 'settings-change'; settingsRevision: Revision; setting: 'deepSeekModel'; value: string }
  | { type: 'settings-change'; settingsRevision: Revision; setting: 'assistantSpeechEnabled'; value: boolean }
  | { type: 'settings-change'; settingsRevision: Revision; setting: 'assistantSpeechVoiceUri'; value: string }
  | { type: 'settings-change'; settingsRevision: Revision; setting: 'assistantSpeechRate'; value: number }
  | { type: 'settings-change'; settingsRevision: Revision; setting: 'audioDevice'; value: string };

export type SettingsWebviewMessage =
  | { type: 'settings-ready' }
  | { type: 'settings-setup-run'; setupRevision: Revision; step: SetupStepId }
  | { type: 'settings-setup-cancel'; setupRevision: Revision }
  | {
      type: 'settings-setup-speech-result';
      setupRevision: Revision;
      requestId: string;
      outcome: 'completed' | 'cancelled' | 'error' | 'unavailable';
    }
  | SettingsChangeMessage
  | { type: 'settings-open-keybindings'; operationRevision: Revision }
  | { type: 'settings-open-native'; operationRevision: Revision; setting?: SettingsSettingName }
  | { type: 'settings-assistant-action'; operationRevision: Revision; action: 'start' | 'stop' }
  | { type: 'settings-consent-action'; consentRevision: Revision; consent: ConsentId; action: ConsentAction }
  | { type: 'settings-provider-credential'; operationRevision: Revision; provider: ProviderId; action: 'set' | 'replace' | 'clear' }
  | { type: 'settings-provider-test'; operationRevision: Revision; provider: ProviderId; action: 'start' | 'cancel' }
  | { type: 'settings-provider-select'; providerRevision: Revision; provider: AssistantProviderSelection }
  | {
      type: 'settings-provider-profile';
      providerRevision: Revision;
      provider: PlannerProviderId;
      enabled: boolean;
      model: string;
    }
  | { type: 'settings-agent-create'; agentRevision: Revision; templateId: PersonaId }
  | { type: 'settings-agent-update-profile'; agentRevision: Revision; id: string; provider: PlannerProviderId; model: string }
  | { type: 'settings-agent-duplicate'; agentRevision: Revision; id: string }
  | { type: 'settings-agent-set-enabled'; agentRevision: Revision; id: string; enabled: boolean }
  | { type: 'settings-agent-set-default'; agentRevision: Revision; id: string }
  | { type: 'settings-agent-delete'; agentRevision: Revision; id: string }
  | { type: 'settings-speech-stop'; operationRevision: Revision }
  | { type: 'settings-microphone-scan'; operationRevision: Revision }
  // Mapping mutations deliberately carry only an opaque ID and the exact collection revision.
  // The host serializes them and increments the collection revision before accepting another,
  // so a replay of the same toggle is rejected as stale instead of inverting twice.
  | { type: 'settings-mapping-add'; mappingsRevision: Revision }
  | { type: 'settings-mapping-edit'; mappingsRevision: Revision; id: string }
  | { type: 'settings-mapping-toggle-enabled'; mappingsRevision: Revision; id: string }
  | { type: 'settings-mapping-toggle-agent'; mappingsRevision: Revision; id: string }
  | { type: 'settings-mapping-approval'; mappingsRevision: Revision; id: string; action: 'grant' | 'revoke' }
  | { type: 'settings-mapping-delete'; mappingsRevision: Revision; id: string }
  | { type: 'settings-diagnostics-action'; operationRevision: Revision; action: 'run' | 'open' | 'copy' };

export type SettingsHostMessage =
  | { type: 'settings-state'; payload: SettingsViewState }
  | { type: 'settings-navigate'; revision: Revision; section: SettingsSectionId };
