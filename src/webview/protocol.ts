/**
 * Data contract shared by extension-host webview providers and browser clients.
 *
 * Keep this module platform-neutral: it must not import VS Code, Node.js, or
 * host-only application modules. Runtime validation is intentionally applied
 * only to messages crossing from an untrusted webview into the extension host.
 */

export type UiLang = 'he' | 'en';
export type HistoryTtlDays = 0 | 1 | 7 | 30;
export type AssistantProviderId =
  | 'deepseek'
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'openrouter'
  | 'ollama'
  | 'bedrock'
  | 'grok';
export type AssistantProviderSelection = 'off' | AssistantProviderId;
export type AssistantProviderStatus =
  | 'off'
  | 'not-configured'
  | 'consent-required'
  | 'checking'
  | 'ready'
  | 'error';
export type SpeechOutcome = 'completed' | 'cancelled' | 'error' | 'unavailable' | 'queue-full';
export type Revision = number;

export const INITIAL_REVISION: Revision = 0;

/** Revisions are serialized as finite, non-negative safe integers. */
export function isRevision(value: unknown): value is Revision {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= INITIAL_REVISION;
}

/** Guard stale asynchronous completions before they overwrite newer state. */
export function isNewerRevision(candidate: unknown, current: Revision): candidate is Revision {
  return isRevision(candidate) && candidate > current;
}

export function nextRevision(current: Revision): Revision {
  if (!isRevision(current) || current >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError('revision must be a non-negative safe integer with room to advance');
  }
  return current + 1;
}

export const PERSONA_IDS = [
  'teacher-lecturer',
  'secretary',
  'friend',
  'tour-guide',
  'mathematician',
  'philosopher',
] as const;

export type PersonaId = (typeof PERSONA_IDS)[number];

export interface HistoryEntry {
  id: string;
  text: string;
  lang: string;
  ts: number;
}

export interface ModelInfo {
  id: string;
  type?: string;
  description?: string;
}

export interface LanguageInfo {
  code: string;
  name: string;
}

export interface AudioDeviceInfo {
  id: string;
  label: string;
}

export interface PendingAssistantSend {
  id: string;
  preview: string;
  targetLabel?: string;
}

/** Summary-only mapping state; command arguments and tool input stay host-side. */
export interface AssistantMappingSummary {
  total: number;
  enabled: number;
  agentExposed: number;
  status: 'ready' | 'untrusted' | 'error';
}

/** A pending capability is named, but its arguments/input stay host-side. */
export interface PendingAssistantAction {
  id: string;
  label: string;
  targetId: string;
}

export interface ViewState {
  uiLang: UiLang;
  speechLang: string;
  ttlDays: HistoryTtlDays;
  model: string;
  history: HistoryEntry[];
  recording: boolean;
  keybinding: string;
  models: ModelInfo[];
  languages: LanguageInfo[];
  metaLoading: boolean;
  metaError?: string;
  audioDevice: string;
  audioDevices: AudioDeviceInfo[];
  assistantEnabled?: boolean;
  assistantListening?: boolean;
  assistantWakePhrase?: string;
  assistantDisclosureAcknowledged?: boolean;
  assistantPersona?: PersonaId;
  assistantProviderId?: AssistantProviderSelection;
  assistantProviderName?: string;
  assistantProviderStatus?: AssistantProviderStatus;
  assistantProviderError?: string;
  assistantSpeechEnabled?: boolean;
  assistantSpeechVoiceUri?: string;
  assistantSpeechRate?: number;
  assistantSpeaking?: boolean;
  assistantTargetLabel?: string;
  assistantPlanConfidence?: number;
  assistantPendingSend?: PendingAssistantSend;
  assistantMappingSummary?: AssistantMappingSummary;
  assistantPendingAction?: PendingAssistantAction;
  assistantFeedback?: string;
}

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'toggle' }
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'history-copy'; id: string }
  | { type: 'history-remove'; id: string }
  | { type: 'history-clear-request' }
  | { type: 'set-api-key' }
  | { type: 'open-keybindings' }
  | { type: 'refresh-meta' }
  | { type: 'audio-device-change'; deviceId: string }
  | { type: 'audio-device-scan' }
  | { type: 'assistant-enabled-change'; enabled: boolean }
  | { type: 'assistant-wake-phrase-change'; wakePhrase: string }
  | { type: 'assistant-disclosure-acknowledged' }
  | { type: 'assistant-persona-change'; persona: PersonaId }
  | { type: 'assistant-provider-manage' }
  | { type: 'assistant-speech-settings-change'; enabled: boolean; voiceUri: string; rate: number }
  | { type: 'assistant-stop-speaking' }
  | { type: 'assistant-speech-started'; id: string }
  | { type: 'assistant-speech-finished'; id: string; outcome: SpeechOutcome }
  | { type: 'assistant-pending-send-confirm'; id: string }
  | { type: 'assistant-pending-send-cancel'; id: string }
  | { type: 'assistant-mappings-manage' }
  | { type: 'assistant-pending-action-confirm'; id: string }
  | { type: 'assistant-pending-action-cancel'; id: string }
  | { type: 'open-settings-center' }
  | {
      type: 'settings-update';
      speechLang: string;
      uiLang: UiLang;
      ttlDays: HistoryTtlDays;
      model: string;
    };

export type HostMessage =
  | { type: 'init'; payload: ViewState }
  | { type: 'state'; payload: ViewState }
  | { type: 'recording-state'; recording: boolean }
  | { type: 'history'; entries: HistoryEntry[] }
  | { type: 'meta'; models: ModelInfo[]; languages: LanguageInfo[]; loading: boolean; error?: string }
  | { type: 'speak'; id: string; text: string; lang?: string }
  | { type: 'cancel-speaking' };

type UnknownRecord = Record<string, unknown>;

const NO_PAYLOAD_MESSAGES = new Set<WebviewMessage['type']>([
  'ready',
  'toggle',
  'start',
  'stop',
  'history-clear-request',
  'set-api-key',
  'open-keybindings',
  'refresh-meta',
  'audio-device-scan',
  'assistant-disclosure-acknowledged',
  'assistant-provider-manage',
  'assistant-stop-speaking',
  'assistant-mappings-manage',
  'open-settings-center',
]);

const SPEECH_OUTCOMES = new Set<SpeechOutcome>([
  'completed',
  'cancelled',
  'error',
  'unavailable',
  'queue-full',
]);

const HISTORY_TTLS = new Set<HistoryTtlDays>([0, 1, 7, 30]);
const PERSONAS = new Set<PersonaId>(PERSONA_IDS);
const MAX_MESSAGE_STRING_LENGTH = 10_000;

/** Validate a value received from a webview before dispatching it host-side. */
export function isWebviewMessage(value: unknown): value is WebviewMessage {
  const message = asRecord(value);
  if (!message || !isString(message.type)) return false;

  if (NO_PAYLOAD_MESSAGES.has(message.type as WebviewMessage['type'])) {
    return hasExactKeys(message, ['type']);
  }

  switch (message.type) {
    case 'history-copy':
    case 'history-remove':
    case 'assistant-speech-started':
    case 'assistant-pending-send-confirm':
    case 'assistant-pending-send-cancel':
    case 'assistant-pending-action-confirm':
    case 'assistant-pending-action-cancel':
      return hasExactKeys(message, ['type', 'id']) && isBoundedString(message.id);
    case 'audio-device-change':
      return hasExactKeys(message, ['type', 'deviceId']) && isBoundedString(message.deviceId, true);
    case 'assistant-enabled-change':
      return hasExactKeys(message, ['type', 'enabled']) && typeof message.enabled === 'boolean';
    case 'assistant-wake-phrase-change':
      return hasExactKeys(message, ['type', 'wakePhrase']) && isBoundedString(message.wakePhrase, true);
    case 'assistant-persona-change':
      return hasExactKeys(message, ['type', 'persona']) && PERSONAS.has(message.persona as PersonaId);
    case 'assistant-speech-settings-change':
      return hasExactKeys(message, ['type', 'enabled', 'voiceUri', 'rate'])
        && typeof message.enabled === 'boolean'
        && isBoundedString(message.voiceUri, true)
        && typeof message.rate === 'number'
        && Number.isFinite(message.rate)
        && message.rate >= 0.5
        && message.rate <= 2;
    case 'assistant-speech-finished':
      return hasExactKeys(message, ['type', 'id', 'outcome'])
        && isBoundedString(message.id)
        && SPEECH_OUTCOMES.has(message.outcome as SpeechOutcome);
    case 'settings-update':
      return hasExactKeys(message, ['type', 'speechLang', 'uiLang', 'ttlDays', 'model'])
        && isBoundedString(message.speechLang)
        && (message.uiLang === 'he' || message.uiLang === 'en')
        && HISTORY_TTLS.has(message.ttlDays as HistoryTtlDays)
        && isBoundedString(message.model);
    default:
      return false;
  }
}

/** Return a validated message or undefined for convenient boundary routing. */
export function parseWebviewMessage(value: unknown): WebviewMessage | undefined {
  return isWebviewMessage(value) ? value : undefined;
}

/**
 * Build a fresh, allowlisted state object before it crosses into a webview.
 * This prevents accidental extra host properties (including credentials) from
 * being carried by structurally compatible objects.
 */
export function projectViewState(state: Readonly<ViewState>): ViewState {
  const projected: ViewState = {
    uiLang: state.uiLang,
    speechLang: state.speechLang,
    ttlDays: state.ttlDays,
    model: state.model,
    history: state.history.map(({ id, text, lang, ts }) => ({ id, text, lang, ts })),
    recording: state.recording,
    keybinding: state.keybinding,
    models: state.models.map(({ id, type, description }) => ({ id, type, description })),
    languages: state.languages.map(({ code, name }) => ({ code, name })),
    metaLoading: state.metaLoading,
    audioDevice: state.audioDevice,
    audioDevices: state.audioDevices.map(({ id, label }) => ({ id, label })),
  };

  copyOptional(projected, state, 'metaError');
  copyOptional(projected, state, 'assistantEnabled');
  copyOptional(projected, state, 'assistantListening');
  copyOptional(projected, state, 'assistantWakePhrase');
  copyOptional(projected, state, 'assistantDisclosureAcknowledged');
  copyOptional(projected, state, 'assistantPersona');
  copyOptional(projected, state, 'assistantProviderId');
  copyOptional(projected, state, 'assistantProviderName');
  copyOptional(projected, state, 'assistantProviderStatus');
  copyOptional(projected, state, 'assistantProviderError');
  copyOptional(projected, state, 'assistantSpeechEnabled');
  copyOptional(projected, state, 'assistantSpeechVoiceUri');
  copyOptional(projected, state, 'assistantSpeechRate');
  copyOptional(projected, state, 'assistantSpeaking');
  copyOptional(projected, state, 'assistantTargetLabel');
  copyOptional(projected, state, 'assistantPlanConfidence');
  copyOptional(projected, state, 'assistantFeedback');

  if (state.assistantPendingSend) {
    const { id, preview, targetLabel } = state.assistantPendingSend;
    projected.assistantPendingSend = targetLabel === undefined
      ? { id, preview }
      : { id, preview, targetLabel };
  }
  if (state.assistantMappingSummary) {
    const { total, enabled, agentExposed, status } = state.assistantMappingSummary;
    projected.assistantMappingSummary = { total, enabled, agentExposed, status };
  }
  if (state.assistantPendingAction) {
    const { id, label, targetId } = state.assistantPendingAction;
    projected.assistantPendingAction = { id, label, targetId };
  }

  return projected;
}

/** Stable JSON serialization used by tests and diagnostics-safe boundaries. */
export function serializeViewState(state: Readonly<ViewState>): string {
  return JSON.stringify(projectViewState(state));
}

function asRecord(value: unknown): UnknownRecord | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null
    ? value as UnknownRecord
    : undefined;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isBoundedString(value: unknown, allowEmpty = false): value is string {
  return typeof value === 'string'
    && value.length <= MAX_MESSAGE_STRING_LENGTH
    && (allowEmpty || value.length > 0);
}

function hasExactKeys(value: UnknownRecord, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function copyOptional<K extends keyof ViewState>(
  target: ViewState,
  source: Readonly<ViewState>,
  key: K,
): void {
  if (source[key] !== undefined) {
    target[key] = source[key];
  }
}
