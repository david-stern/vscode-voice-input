import { projectViewState, type UiLang, type ViewState } from '../protocol';

export type CompactProviderStatus =
  | 'not-configured'
  | 'soniox-configured'
  | 'system-voice'
  | 'system-voice-unavailable'
  | 'local-pending';

export interface CompactMicState {
  language: UiLang;
  providerStatus: CompactProviderStatus;
  effectiveAutoMode: boolean;
  microphoneAvailable: boolean;
  microphoneUnavailableReason?: string;
  streamingPartials: boolean;
  partialTranscript?: string;
  finalTranscript?: string;
  pendingActionLabel?: string;
}

export type CompactMicBrowserMessage =
  | { type: 'mic-control-center-open'; route: 'home' | 'voice' | 'commands' }
  | { type: 'mic-open-pending-review' }
  | { type: 'mic-disable-auto' };

export type CompactMicHostMessage = { type: 'compact-state'; payload: CompactMicState };

export function parseCompactMicBrowserMessage(value: unknown): CompactMicBrowserMessage | undefined {
  const message = plainRecord(value);
  if (!message || typeof message.type !== 'string') return undefined;
  if (message.type === 'mic-control-center-open') {
    return exact(message, ['type', 'route'])
      && (message.route === 'home' || message.route === 'voice' || message.route === 'commands')
      ? { type: message.type, route: message.route }
      : undefined;
  }
  return (message.type === 'mic-open-pending-review' || message.type === 'mic-disable-auto')
    && exact(message, ['type'])
    ? { type: message.type }
    : undefined;
}

export function parseCompactMicHostMessage(value: unknown): CompactMicHostMessage | undefined {
  const message = plainRecord(value);
  if (!message || !exact(message, ['type', 'payload']) || message.type !== 'compact-state') return undefined;
  const payload = projectCompactMicState(message.payload);
  return payload ? { type: 'compact-state', payload } : undefined;
}

export function projectCompactMicState(value: unknown): CompactMicState | undefined {
  const state = plainRecord(value);
  if (!state || !optionalExact(state, [
    'language', 'providerStatus', 'effectiveAutoMode', 'microphoneAvailable', 'streamingPartials',
  ], ['microphoneUnavailableReason', 'partialTranscript', 'finalTranscript', 'pendingActionLabel'])
    || (state.language !== 'he' && state.language !== 'en')
    || ![
      'not-configured', 'soniox-configured', 'system-voice',
      'system-voice-unavailable', 'local-pending',
    ].includes(state.providerStatus as string)
    || typeof state.effectiveAutoMode !== 'boolean'
    || typeof state.microphoneAvailable !== 'boolean'
    || typeof state.streamingPartials !== 'boolean') return undefined;
  for (const key of [
    'microphoneUnavailableReason', 'partialTranscript', 'finalTranscript', 'pendingActionLabel',
  ] as const) {
    if (state[key] !== undefined && !boundedString(state[key], key.includes('Transcript') ? 4000 : 120)) {
      return undefined;
    }
  }
  return {
    language: state.language,
    providerStatus: state.providerStatus as CompactProviderStatus,
    effectiveAutoMode: state.effectiveAutoMode,
    microphoneAvailable: state.microphoneAvailable,
    streamingPartials: state.streamingPartials,
    ...(state.microphoneUnavailableReason === undefined ? {} : { microphoneUnavailableReason: state.microphoneUnavailableReason as string }),
    ...(state.partialTranscript === undefined ? {} : { partialTranscript: state.partialTranscript as string }),
    ...(state.finalTranscript === undefined ? {} : { finalTranscript: state.finalTranscript as string }),
    ...(state.pendingActionLabel === undefined ? {} : { pendingActionLabel: state.pendingActionLabel as string }),
  };
}

/** Safe compatibility projection until coordinator supplies the richer host capability snapshot. */
export function compactMicStateFromLegacy(
  state: Readonly<ViewState>,
  systemVoiceAvailable: boolean,
): CompactMicState {
  const latest = state.history.at(-1)?.text;
  return {
    language: state.uiLang,
    providerStatus: state.assistantSpeechEnabled
      ? systemVoiceAvailable ? 'system-voice' : 'system-voice-unavailable'
      : 'not-configured',
    effectiveAutoMode: false,
    microphoneAvailable: false,
    microphoneUnavailableReason: state.uiLang === 'he'
      ? 'יש להשלים את הגדרת ספק הדיבור במרכז הבקרה.'
      : 'Complete speech provider setup in the Control Center.',
    streamingPartials: false,
    ...(latest ? { finalTranscript: latest } : {}),
    ...(state.assistantPendingAction?.label
      ? { pendingActionLabel: state.assistantPendingAction.label.slice(0, 120) }
      : {}),
  };
}

/** Removes settings/history/authority detail that the compact browser no longer renders. */
export function projectCompactSidebarLegacyState(state: Readonly<ViewState>): ViewState {
  const projected = projectViewState(state);
  projected.history = projected.history.slice(-1);
  for (const key of [
    'assistantEnabled', 'assistantListening', 'assistantWakePhrase',
    'assistantDisclosureAcknowledged', 'assistantPersona', 'assistantProviderId',
    'assistantProviderName', 'assistantProviderStatus', 'assistantProviderError',
    'assistantTargetLabel', 'assistantPlanConfidence', 'assistantPendingSend',
    'assistantMappingSummary', 'assistantPendingAction', 'assistantFeedback',
  ] as const) delete projected[key];
  return projected;
}

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null
    ? value as Record<string, unknown>
    : undefined;
}

function exact(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(record).length === keys.length && keys.every((key) => Object.hasOwn(record, key))
    && Object.keys(record).every((key) => allowed.has(key));
}

function optionalExact(record: Record<string, unknown>, required: readonly string[], optional: readonly string[]): boolean {
  return required.every((key) => Object.hasOwn(record, key))
    && Object.keys(record).every((key) => required.includes(key) || optional.includes(key));
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && Array.from(value).length <= maximum;
}
