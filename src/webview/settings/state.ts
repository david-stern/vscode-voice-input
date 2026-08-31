import { isNewerRevision, nextRevision, type Revision } from '../protocol';
import type {
  AssistantRouteId,
  SettingsSectionId,
  SettingsSettingName,
  SettingsViewState,
  SetupStepId,
  WorkspaceOverrideView,
} from './contracts';
import { ASSISTANT_ROUTE_IDS, SETUP_STEP_IDS } from './contracts';

export interface SettingsStateReduction {
  state: SettingsViewState;
  applied: boolean;
}

export interface NavigationState {
  revision: Revision;
  section: SettingsSectionId;
}

export interface SetupProgressState {
  currentStep: SetupStepId;
}

export interface SettingsUiState {
  route: AssistantRouteId;
  setup: SetupProgressState;
}

export type SetupProgressAction =
  | { type: 'resume'; value: unknown }
  | { type: 'go'; step: SetupStepId };

const LEGACY_ROUTE_MAP: Readonly<Record<SettingsSectionId, AssistantRouteId>> = {
  general: 'home',
  assistant: 'agents',
  providers: 'providers',
  speech: 'voice',
  microphone: 'conversation',
  mappings: 'actions',
  privacy: 'privacy',
  diagnostics: 'diagnostics',
};

/** Deterministic browser fallback shown before the host publishes real state. */
export function createInitialSettingsState(): SettingsViewState {
  return {
    revision: 0,
    uiLang: 'en',
    setup: {
      revision: 0,
      currentStep: 'microphone',
      complete: false,
      steps: Object.fromEntries(
        SETUP_STEP_IDS.map((step) => [step, { status: 'pending' }]),
      ) as SettingsViewState['setup']['steps'],
    },
    general: {
      settingsRevision: 0,
      languageHint: 'he',
      sttModel: 'stt-async-v4',
      historyTtlDays: 30,
      injectionMode: 'auto',
      shortcut: { packageDefault: 'Alt+M', effectiveBindingKnown: false },
      languages: [],
      models: [],
      metadataStatus: 'idle',
      workspaceOverrides: [],
    },
    assistant: {
      operationRevision: 0,
      status: 'stopped',
      wakePhrase: '',
      persona: 'teacher-lecturer',
      consentAcknowledged: false,
    },
    transcription: {
      configured: false,
      credential: { operationRevision: 0, phase: 'idle' },
      test: { operationRevision: 0, phase: 'idle' },
    },
    providers: { revision: 0, selectedProvider: 'deepseek', items: [] },
    agents: { revision: 0, status: 'ready', items: [] },
    speech: {
      operationRevision: 0,
      enabled: true,
      voiceUri: '',
      rate: 1,
      speaking: false,
    },
    microphone: {
      operationRevision: 0,
      deviceId: '',
      devices: [],
      status: 'idle',
    },
    mappings: { revision: 0, status: 'loading', items: [], approvalHistory: [] },
    privacy: { consentRevision: 0, workspaceTrusted: true },
    diagnostics: {
      operationRevision: 0,
      status: 'idle',
      extensionVersion: '',
      platform: 'other',
      checks: [],
      reportAvailable: false,
    },
  };
}

/** Restore browser-owned navigation only; host state and credentials never enter this snapshot. */
export function createInitialSettingsUiState(saved?: unknown): SettingsUiState {
  const record = asRecord(saved);
  const route = ASSISTANT_ROUTE_IDS.includes(record?.route as AssistantRouteId)
    ? record?.route as AssistantRouteId
    : 'setup';
  return {
    route,
    setup: reduceSetupProgress(
      { currentStep: 'microphone' },
      { type: 'resume', value: record?.setup },
    ),
  };
}

export function projectSettingsUiState(state: Readonly<SettingsUiState>): SettingsUiState {
  return {
    route: ASSISTANT_ROUTE_IDS.includes(state.route) ? state.route : 'setup',
    setup: reduceSetupProgress(
      { currentStep: 'microphone' },
      { type: 'resume', value: state.setup },
    ),
  };
}

export function reduceSetupProgress(
  current: Readonly<SetupProgressState>,
  action: SetupProgressAction,
): SetupProgressState {
  if (action.type === 'resume') {
    const record = asRecord(action.value);
    const currentStep = SETUP_STEP_IDS.includes(record?.currentStep as SetupStepId)
      ? record?.currentStep as SetupStepId
      : current.currentStep;
    return { currentStep };
  }
  return { currentStep: action.step };
}

export function routeForLegacySection(section: SettingsSectionId): AssistantRouteId {
  return LEGACY_ROUTE_MAP[section];
}

/** First host snapshot always wins; subsequent snapshots must advance monotonically. */
export function reduceSettingsState(
  current: SettingsViewState,
  incoming: SettingsViewState,
  initialized: boolean,
): SettingsStateReduction {
  if (initialized && !isNewerRevision(incoming.revision, current.revision)) {
    return { state: current, applied: false };
  }
  return { state: incoming, applied: true };
}

export function reduceNavigation(
  current: NavigationState | undefined,
  incoming: NavigationState,
): NavigationState | undefined {
  if (current && !isNewerRevision(incoming.revision, current.revision)) return current;
  return incoming;
}

export function nextResourceOperation(current: Revision): Revision {
  return nextRevision(current);
}

/**
 * Mapping mutations are authorized only against the exact collection snapshot
 * rendered by the webview. The host must serialize mutations and advance the
 * collection revision after every accepted change, making a replay stale.
 */
export function isCurrentMappingsRevision(
  requested: Revision,
  current: Revision,
): boolean {
  return requested === current;
}

export function isProviderModelValueValid(value: string): boolean {
  return /^[A-Za-z0-9~][A-Za-z0-9._~:/@+-]{0,255}$/u.test(value.trim());
}

/** Compatibility alias retained for older consumers while the generalized UI migrates. */
export function isDeepSeekModelValueValid(mode: 'off' | 'deepseek', value: string): boolean {
  return mode === 'off' || isProviderModelValueValid(value);
}

export function workspaceOverrideFor(
  state: SettingsViewState,
  setting: SettingsSettingName,
): WorkspaceOverrideView | undefined {
  return state.general.workspaceOverrides.find((override) => override.setting === setting);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
