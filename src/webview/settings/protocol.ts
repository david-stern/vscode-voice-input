import { PERSONA_IDS, isRevision, type HistoryTtlDays, type PersonaId } from '../protocol';
import {
  SETTINGS_SECTION_IDS,
  SETUP_STEP_IDS,
  SETTINGS_SETTING_NAMES,
  PLANNER_PROVIDER_IDS,
  type ConsentAction,
  type ConsentId,
  type InjectionMode,
  type ProviderId,
  type PlannerProviderId,
  type SettingsHostMessage,
  type SettingsSettingName,
  type SettingsMicrophoneSelection,
  type SettingsViewState,
  type SettingsWebviewMessage,
} from './contracts';
import {
  projectSafeAgentCollection,
  projectSafeMappings,
  projectSafeProviderCollection,
  projectSafeProviderState,
} from './safeResources';

export * from './contracts';

type UnknownRecord = Record<string, unknown>;

const HISTORY_TTLS = new Set<HistoryTtlDays>([0, 1, 7, 30]);
const PERSONAS = new Set<PersonaId>(PERSONA_IDS);
const INJECTION_MODES = new Set<InjectionMode>([
  'auto', 'paste-key', 'type-key', 'editor-only', 'clipboard-only',
]);
const PLANNER_PROVIDERS = new Set<PlannerProviderId>(PLANNER_PROVIDER_IDS);
const PROVIDERS = new Set<ProviderId>(['soniox', ...PLANNER_PROVIDER_IDS]);
const CONSENTS = new Set<ConsentId>(['assistant-listening', ...PLANNER_PROVIDER_IDS]);
const CONSENT_ACTIONS = new Set<ConsentAction>(['acknowledge', 'revoke']);
const SETTINGS = new Set<SettingsSettingName>(SETTINGS_SETTING_NAMES);
const SECTIONS = new Set(SETTINGS_SECTION_IDS);
const SETUP_STEPS = new Set(SETUP_STEP_IDS);
const MAPPING_ID_PATTERN = /^vm_[A-Za-z0-9_-]{22,64}$/;
const AGENT_ID_PATTERN = /^agent_[A-Za-z0-9_-]{12,80}$/;
const MODEL_ID_PATTERN = /^[A-Za-z0-9~][A-Za-z0-9._~:/@+-]*$/;
const MAX_MESSAGE_STRING_LENGTH = 10_000;
const MAX_MODEL_ID_LENGTH = 256;

/** Reject malformed, inherited, over-posted, and capability-expanding messages. */
export function isSettingsWebviewMessage(value: unknown): value is SettingsWebviewMessage {
  const message = asRecord(value);
  if (!message || !isString(message.type)) return false;

  switch (message.type) {
    case 'settings-ready':
      return hasExactKeys(message, ['type']);
    case 'settings-setup-run':
      return hasExactKeys(message, ['type', 'setupRevision', 'step'])
        && isRevision(message.setupRevision)
        && SETUP_STEPS.has(message.step as (typeof SETUP_STEP_IDS)[number]);
    case 'settings-setup-cancel':
      return hasExactKeys(message, ['type', 'setupRevision'])
        && isRevision(message.setupRevision);
    case 'settings-setup-speech-result':
      return hasExactKeys(message, ['type', 'setupRevision', 'requestId', 'outcome'])
        && isRevision(message.setupRevision)
        && isBoundedString(message.requestId)
        && (message.outcome === 'completed'
          || message.outcome === 'cancelled'
          || message.outcome === 'error'
          || message.outcome === 'unavailable');
    case 'settings-change':
      return hasExactKeys(message, ['type', 'settingsRevision', 'setting', 'value'])
        && isRevision(message.settingsRevision)
        && isValidSettingsChange(message.setting, message.value);
    case 'settings-open-keybindings':
    case 'settings-speech-stop':
    case 'settings-microphone-scan':
      return hasExactKeys(message, ['type', 'operationRevision'])
        && isRevision(message.operationRevision);
    case 'settings-open-native':
      return hasOptionalExactKeys(message, ['type', 'operationRevision'], ['setting'])
        && isRevision(message.operationRevision)
        && (message.setting === undefined || SETTINGS.has(message.setting as SettingsSettingName));
    case 'settings-assistant-action':
      return hasExactKeys(message, ['type', 'operationRevision', 'action'])
        && isRevision(message.operationRevision)
        && (message.action === 'start' || message.action === 'stop');
    case 'settings-consent-action':
      return hasExactKeys(message, ['type', 'consentRevision', 'consent', 'action'])
        && isRevision(message.consentRevision)
        && CONSENTS.has(message.consent as ConsentId)
        && CONSENT_ACTIONS.has(message.action as ConsentAction);
    case 'settings-provider-credential':
      return hasExactKeys(message, ['type', 'operationRevision', 'provider', 'action'])
        && isRevision(message.operationRevision)
        && PROVIDERS.has(message.provider as ProviderId)
        && (message.action === 'set' || message.action === 'replace' || message.action === 'clear');
    case 'settings-provider-test':
      return hasExactKeys(message, ['type', 'operationRevision', 'provider', 'action'])
        && isRevision(message.operationRevision)
        && PROVIDERS.has(message.provider as ProviderId)
        && (message.action === 'start' || message.action === 'cancel');
    case 'settings-provider-select':
      return hasExactKeys(message, ['type', 'providerRevision', 'provider'])
        && isRevision(message.providerRevision)
        && (message.provider === 'off' || PLANNER_PROVIDERS.has(message.provider as PlannerProviderId));
    case 'settings-provider-profile':
      return hasExactKeys(message, ['type', 'providerRevision', 'provider', 'enabled', 'model'])
        && isRevision(message.providerRevision)
        && PLANNER_PROVIDERS.has(message.provider as PlannerProviderId)
        && typeof message.enabled === 'boolean'
        && isModelId(message.model);
    case 'settings-agent-create':
      return hasExactKeys(message, ['type', 'agentRevision', 'templateId'])
        && isRevision(message.agentRevision)
        && PERSONAS.has(message.templateId as PersonaId);
    case 'settings-agent-update-profile':
      return hasExactKeys(message, ['type', 'agentRevision', 'id', 'provider', 'model'])
        && isRevision(message.agentRevision)
        && isAgentId(message.id)
        && PLANNER_PROVIDERS.has(message.provider as PlannerProviderId)
        && isModelId(message.model);
    case 'settings-agent-duplicate':
    case 'settings-agent-set-default':
    case 'settings-agent-delete':
      return hasExactKeys(message, ['type', 'agentRevision', 'id'])
        && isRevision(message.agentRevision)
        && isAgentId(message.id);
    case 'settings-agent-set-enabled':
      return hasExactKeys(message, ['type', 'agentRevision', 'id', 'enabled'])
        && isRevision(message.agentRevision)
        && isAgentId(message.id)
        && typeof message.enabled === 'boolean';
    case 'settings-mapping-add':
      return hasExactKeys(message, ['type', 'mappingsRevision'])
        && isRevision(message.mappingsRevision);
    case 'settings-mapping-edit':
    case 'settings-mapping-toggle-enabled':
    case 'settings-mapping-toggle-agent':
    case 'settings-mapping-delete':
      return hasExactKeys(message, ['type', 'mappingsRevision', 'id'])
        && isRevision(message.mappingsRevision)
        && isString(message.id)
        && MAPPING_ID_PATTERN.test(message.id);
    case 'settings-mapping-approval':
      return hasExactKeys(message, ['type', 'mappingsRevision', 'id', 'action'])
        && isRevision(message.mappingsRevision)
        && isString(message.id)
        && MAPPING_ID_PATTERN.test(message.id)
        && (message.action === 'grant' || message.action === 'revoke');
    case 'settings-diagnostics-action':
      return hasExactKeys(message, ['type', 'operationRevision', 'action'])
        && isRevision(message.operationRevision)
        && (message.action === 'run' || message.action === 'open' || message.action === 'copy');
    default:
      return false;
  }
}

export function parseSettingsWebviewMessage(value: unknown): SettingsWebviewMessage | undefined {
  return isSettingsWebviewMessage(value) ? value : undefined;
}

/** Browser-side guard for the small host message envelope. */
export function isSettingsHostMessage(value: unknown): value is SettingsHostMessage {
  const message = asRecord(value);
  if (!message || !isString(message.type)) return false;
  if (message.type === 'settings-state') {
    const payload = asRecord(message.payload);
    return hasExactKeys(message, ['type', 'payload'])
      && Boolean(payload)
      && isRevision(payload?.revision);
  }
  return message.type === 'settings-navigate'
    && hasExactKeys(message, ['type', 'revision', 'section'])
    && isRevision(message.revision)
    && SECTIONS.has(message.section as (typeof SETTINGS_SECTION_IDS)[number]);
}

/** Clone every Settings field explicitly so secrets, mapping arguments and tool input cannot hitchhike. */
export function projectSettingsViewState(state: Readonly<SettingsViewState>): SettingsViewState {
  const projected: SettingsViewState = {
    revision: state.revision,
    uiLang: state.uiLang,
    setup: {
      revision: state.setup.revision,
      currentStep: state.setup.currentStep,
      complete: state.setup.complete,
      steps: Object.fromEntries(SETUP_STEP_IDS.map((step) => {
        const value = state.setup.steps[step];
        return [step, value.result === undefined
          ? { status: value.status }
          : { status: value.status, result: value.result }];
      })) as SettingsViewState['setup']['steps'],
      ...(state.setup.speechRequest
        ? {
          speechRequest: {
            id: state.setup.speechRequest.id,
            kind: state.setup.speechRequest.kind,
            text: state.setup.speechRequest.text,
            voiceUri: state.setup.speechRequest.voiceUri,
            rate: state.setup.speechRequest.rate,
            lang: state.setup.speechRequest.lang,
          },
        }
        : {}),
    },
    general: {
      settingsRevision: state.general.settingsRevision,
      languageHint: state.general.languageHint,
      sttModel: state.general.sttModel,
      historyTtlDays: state.general.historyTtlDays,
      injectionMode: state.general.injectionMode,
      shortcut: {
        packageDefault: state.general.shortcut.packageDefault,
        effectiveBindingKnown: false,
      },
      languages: state.general.languages.map(({ code, name }) => ({ code, name })),
      models: state.general.models.map(({ id, type, description }) => ({ id, type, description })),
      metadataStatus: state.general.metadataStatus,
      workspaceOverrides: state.general.workspaceOverrides.map((override) => ({
        setting: override.setting,
        source: override.source,
        effectiveValue: override.effectiveValue,
        globalValue: override.globalValue,
      })),
    },
    assistant: {
      operationRevision: state.assistant.operationRevision,
      status: state.assistant.status,
      wakePhrase: state.assistant.wakePhrase,
      persona: state.assistant.persona,
      consentAcknowledged: state.assistant.consentAcknowledged,
    },
    transcription: projectSafeProviderState(state.transcription),
    providers: projectSafeProviderCollection(state.providers),
    agents: projectSafeAgentCollection(state.agents),
    speech: {
      operationRevision: state.speech.operationRevision,
      enabled: state.speech.enabled,
      voiceUri: state.speech.voiceUri,
      rate: state.speech.rate,
      speaking: state.speech.speaking,
    },
    microphone: {
      operationRevision: state.microphone.operationRevision,
      deviceId: state.microphone.deviceId,
      devices: state.microphone.devices.map(({ id, label }) => ({ id, label })),
      status: state.microphone.status,
    },
    mappings: projectSafeMappings(state.mappings),
    privacy: {
      consentRevision: state.privacy.consentRevision,
      workspaceTrusted: state.privacy.workspaceTrusted,
    },
    diagnostics: {
      operationRevision: state.diagnostics.operationRevision,
      status: state.diagnostics.status,
      extensionVersion: state.diagnostics.extensionVersion,
      platform: state.diagnostics.platform,
      checks: state.diagnostics.checks.map(({ id, status }) => ({ id, status })),
      reportAvailable: state.diagnostics.reportAvailable,
    },
  };

  if (state.general.metadataError !== undefined) projected.general.metadataError = state.general.metadataError;
  if (state.assistant.error !== undefined) projected.assistant.error = state.assistant.error;
  if (state.microphone.selection !== undefined) {
    projected.microphone.selection = projectMicrophoneSelection(state.microphone.selection);
  }
  if (state.microphone.error !== undefined) projected.microphone.error = state.microphone.error;
  if (state.notice) {
    projected.notice = {
      id: state.notice.id,
      kind: state.notice.kind,
      code: state.notice.code,
    };
  }
  return projected;
}

function projectMicrophoneSelection(
  selection: Readonly<SettingsMicrophoneSelection>,
): SettingsMicrophoneSelection {
  const projected: SettingsMicrophoneSelection = {
    kind: selection.kind,
    status: selection.status,
    recovery: selection.recovery,
  };
  const label = sanitizeDeviceLabel(selection.label);
  if (label !== undefined) projected.label = label;
  return projected;
}

function sanitizeDeviceLabel(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.replace(/[\u0000-\u001F\u007F]/gu, ' ').trim().replace(/\s+/gu, ' ');
  if (!normalized || normalized.length > 120 || /[\\/]/u.test(normalized)) return undefined;
  return normalized;
}

export function serializeSettingsViewState(state: Readonly<SettingsViewState>): string {
  return JSON.stringify(projectSettingsViewState(state));
}

function isValidSettingsChange(setting: unknown, value: unknown): boolean {
  switch (setting) {
    case 'uiLanguage': return value === 'he' || value === 'en';
    case 'languageHint':
    case 'sttModel': return isBoundedString(value);
    case 'deepSeekModel': return isBoundedString(value, true);
    case 'assistantWakePhrase':
    case 'assistantSpeechVoiceUri':
    case 'audioDevice': return isBoundedString(value, true);
    case 'historyTtlDays': return HISTORY_TTLS.has(value as HistoryTtlDays);
    case 'injectionMode': return INJECTION_MODES.has(value as InjectionMode);
    case 'assistantPersona': return PERSONAS.has(value as PersonaId);
    case 'assistantIntelligence': return value === 'off' || value === 'deepseek';
    case 'assistantSpeechEnabled': return typeof value === 'boolean';
    case 'assistantSpeechRate':
      return typeof value === 'number' && Number.isFinite(value) && value >= 0.5 && value <= 2;
    default: return false;
  }
}

function asRecord(value: unknown): UnknownRecord | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? value as UnknownRecord : undefined;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isBoundedString(value: unknown, allowEmpty = false): value is string {
  return typeof value === 'string'
    && value.length <= MAX_MESSAGE_STRING_LENGTH
    && (allowEmpty || value.length > 0);
}

function isModelId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_MODEL_ID_LENGTH
    && MODEL_ID_PATTERN.test(value);
}

function isAgentId(value: unknown): value is string {
  return typeof value === 'string' && AGENT_ID_PATTERN.test(value);
}

function hasExactKeys(value: UnknownRecord, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function hasOptionalExactKeys(value: UnknownRecord, required: readonly string[], optional: readonly string[]): boolean {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key)) && keys.every((key) => allowed.has(key));
}
