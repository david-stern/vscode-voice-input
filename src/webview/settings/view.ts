import {
  ASSISTANT_ROUTE_IDS,
  SETUP_STEP_IDS,
  type AssistantRouteId,
  type PresentationReadiness,
  type SettingsProviderState,
  type SettingsViewState,
} from './contracts';
import {
  applyTranslations,
  byId,
  includeSelected,
  setChecked,
  setDisabled,
  setHidden,
  setInputValue,
  setText,
  syncOptions,
  type SelectOption,
} from './dom';
import { SETTINGS_STRINGS, type SettingsStrings } from './i18n';
import {
  updateDiagnosticsList,
  updateInlineOverrides,
  updateMappingList,
  updateWorkspaceOverrides,
} from './lists';
import { renderSettingsShell } from './shell';
import {
  createReadinessPresentation,
  createSetupReadiness,
  projectCompatibilityPresentation,
} from './presentation';
import {
  updateAgentResources,
  updateProviderPrivacy,
  updateProviderResources,
} from './resourceLists';
import { updateApprovalContext } from './approvalList';
import { setupResultText } from './setupI18n';
import type { SettingsUiState } from './state';

export interface SettingsVoice {
  voiceURI: string;
  name: string;
  lang: string;
  default: boolean;
}

type ProviderFocusTarget = 'set' | 'replace' | 'clear' | 'test-start' | 'test-cancel' | 'status';

export function providerFocusTarget(
  active: ProviderFocusTarget | undefined,
  provider: SettingsProviderState,
): ProviderFocusTarget | undefined {
  if (!active) return undefined;
  if (provider.credential.phase === 'updating') return 'status';
  if (active === 'test-start' || active === 'test-cancel') {
    if (!provider.configured) return 'set';
    return provider.test.phase === 'running' ? 'test-cancel' : 'test-start';
  }
  if (active === 'clear' && provider.configured) return 'clear';
  if (active === 'set' && !provider.configured) return 'set';
  if (active === 'replace' && provider.configured) return 'replace';
  return provider.configured ? 'replace' : 'set';
}

/** Incrementally updates one stable Settings DOM tree. */
export class SettingsView {
  private noticeId: string | undefined;

  constructor(private readonly root: HTMLElement) {
    root.innerHTML = renderSettingsShell();
  }

  update(
    state: SettingsViewState,
    voices: readonly SettingsVoice[],
    localSpeechActive: boolean,
    ui: Readonly<SettingsUiState>,
    authoritative = false,
  ): void {
    const strings = SETTINGS_STRINGS[state.uiLang];
    document.documentElement.lang = state.uiLang;
    document.documentElement.dir = state.uiLang === 'he' ? 'rtl' : 'ltr';
    document.title = strings.pageTitle;
    applyTranslations(this.root, strings);
    this.updateRoute(ui.route);
    this.updateSetup(state, ui, strings);
    this.updateReadiness(state, strings);
    this.updateCompatibility(state, strings);
    this.updateGeneral(state, strings, authoritative);
    this.updateAssistant(state, strings, authoritative);
    this.updateProviders(state, strings, authoritative);
    updateAgentResources(state, strings, authoritative);
    this.updateSpeech(state, voices, localSpeechActive, strings, authoritative);
    this.updateMicrophone(state, strings, authoritative);
    this.updateMappings(state, strings);
    this.updatePrivacy(state, strings);
    this.updateDiagnostics(state, strings);
    updateInlineOverrides(state, strings);
    this.updateNotice(state, strings);
  }

  navigate(route: AssistantRouteId, focus = true): void {
    this.updateRoute(route);
    if (!focus) return;
    const heading = byId<HTMLElement>(`route-${route}-title`);
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: 'start', behavior: 'auto' });
  }

  announce(message: string, kind: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
    const live = byId('settings-live');
    if (!live) return;
    live.className = `live-status ${kind}`;
    live.textContent = message;
  }

  private updateRoute(route: AssistantRouteId): void {
    for (const id of ASSISTANT_ROUTE_IDS) {
      const selected = id === route;
      setHidden(byId(`route-${id}`), !selected);
      const button = this.root.querySelector<HTMLButtonElement>(`[data-route="${id}"].route-link`);
      if (!button) continue;
      if (selected) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
  }

  private updateSetup(
    state: SettingsViewState,
    ui: Readonly<SettingsUiState>,
    strings: SettingsStrings,
  ): void {
    const readiness = createSetupReadiness(state);
    const completeCount = SETUP_STEP_IDS.filter(
      (step) => state.setup.steps[step].status === 'ready',
    ).length;
    const progress = byId<HTMLProgressElement>('setup-progress');
    if (progress) progress.value = completeCount;
    setText('setup-progress-value', `${completeCount} / ${SETUP_STEP_IDS.length}`);

    for (const step of SETUP_STEP_IDS) {
      const active = step === ui.setup.currentStep;
      const stepState = state.setup.steps[step];
      const complete = stepState.status === 'ready';
      setHidden(this.root.querySelector<HTMLElement>(`[data-setup-panel="${step}"]`), !active);
      const button = this.root.querySelector<HTMLButtonElement>(`[data-setup-step="${step}"]`);
      button?.classList.toggle('complete', complete);
      if (active) button?.setAttribute('aria-current', 'step');
      else button?.removeAttribute('aria-current');
      if (button) {
        const stepIndex = SETUP_STEP_IDS.indexOf(step);
        const currentIndex = SETUP_STEP_IDS.indexOf(state.setup.currentStep);
        button.disabled = stepIndex > currentIndex;
      }
      setText(`setup-step-state-${step}`, complete
        ? strings.setupComplete
        : stepState.status === 'running'
          ? strings.setupRunning
          : stepState.result
            ? setupResultText(stepState.result, strings)
            : active ? strings.setupCurrent : strings.setupPending);
      setReadiness(`setup-status-${step}`, readiness[step], strings);
      const run = this.root.querySelector<HTMLButtonElement>(`[data-setup-run="${step}"]`);
      if (run) {
        run.disabled = state.setup.complete
          || step !== state.setup.currentStep
          || stepState.status === 'running'
          || Boolean(state.setup.speechRequest);
        run.textContent = stepState.status === 'running'
          ? strings.setupRunning
          : strings.setupRunCheck;
      }
    }

    const busy = SETUP_STEP_IDS.some((step) => state.setup.steps[step].status === 'running')
      || Boolean(state.setup.speechRequest);
    setHidden(byId('setup-cancel'), !busy);
    setDisabled('setup-cancel', !busy);
  }

  private updateReadiness(state: SettingsViewState, strings: SettingsStrings): void {
    for (const item of createReadinessPresentation(state)) {
      setReadiness(`readiness-${item.id}`, item.readiness, strings);
    }
  }

  private updateCompatibility(state: SettingsViewState, strings: SettingsStrings): void {
    const presentation = projectCompatibilityPresentation(state);
    const soniox = presentation.providers.find((provider) => provider.id === 'soniox');
    const reasoning = presentation.providers.find((provider) => provider.role === 'reasoning');
    const speech = presentation.providers.find((provider) => provider.id === 'system-tts');
    const agent = presentation.agents.find(({ id }) => id === state.agents.defaultAgentId)
      ?? presentation.agents[0];
    if (soniox) setReadiness('soniox-readiness', soniox.readiness, strings);
    if (reasoning) setReadiness('reasoning-readiness', reasoning.readiness, strings);
    if (speech) setReadiness('system-tts-readiness', speech.readiness, strings);
    if (agent) setReadiness('agent-readiness', agent.readiness, strings);
  }

  private updateGeneral(state: SettingsViewState, strings: SettingsStrings, authoritative: boolean): void {
    setInputValue('ui-language', state.uiLang, authoritative);
    const languages = languageHintOptions(state.general.languages, strings);
    syncOptions('language-hint', includeSelected(languages, state.general.languageHint), state.general.languageHint, authoritative);
    const models = state.general.models.map(({ id, description }) => ({
      value: id,
      label: description ? `${id} — ${description}` : id,
    }));
    syncOptions('stt-model', includeSelected(models, state.general.sttModel), state.general.sttModel, authoritative);
    setInputValue('history-ttl', String(state.general.historyTtlDays), authoritative);
    setInputValue('injection-mode', state.general.injectionMode, authoritative);
    setText('shortcut-default', state.general.shortcut.packageDefault);
    const status = state.general.metadataStatus === 'loading'
      ? strings.metadataLoading
      : state.general.metadataStatus === 'error' ? strings.metadataError : '';
    setText('metadata-status', status);
    byId('metadata-status')?.classList.toggle('error', state.general.metadataStatus === 'error');
  }

  private updateAssistant(state: SettingsViewState, strings: SettingsStrings, authoritative: boolean): void {
    const statusText = {
      stopped: strings.assistantStopped,
      starting: strings.assistantStarting,
      listening: strings.assistantListening,
      stopping: strings.assistantStopping,
      error: strings.assistantError,
    }[state.assistant.status];
    setText('assistant-status', statusText);
    const active = state.assistant.status === 'listening' || state.assistant.status === 'starting';
    setText('assistant-action', active ? strings.assistantStop : strings.assistantStart);
    setDisabled('assistant-action', state.assistant.status === 'starting' || state.assistant.status === 'stopping');
    setInputValue('assistant-wake-phrase', state.assistant.wakePhrase, authoritative);
    setText('assistant-consent-status', state.assistant.consentAcknowledged
      ? strings.assistantConsentReady
      : strings.assistantConsentNeeded);
    setText('assistant-consent-action', state.assistant.consentAcknowledged
      ? strings.consentRevoke
      : strings.consentAcknowledge);
  }

  private updateProviders(state: SettingsViewState, strings: SettingsStrings, authoritative: boolean): void {
    this.updateProvider('soniox', state.transcription, strings);
    updateProviderResources(state, strings, authoritative);
  }

  private updateProvider(id: 'soniox', provider: SettingsProviderState, strings: SettingsStrings): void {
    const updating = provider.credential.phase === 'updating';
    setText(`${id}-credential-status`, updating
      ? strings.credentialUpdating
      : provider.configured ? strings.credentialConfigured : strings.credentialMissing);
    const status = byId(`${id}-credential-status`);
    status?.classList.toggle('configured', provider.configured && !updating);
    status?.classList.toggle('missing', !provider.configured && !updating);
    const container = this.root.querySelector<HTMLElement>(`.provider-actions[data-provider="${id}"]`);
    const focused = providerButtonFocusTarget(container);
    const set = container?.querySelector<HTMLElement>('[data-credential-action="set"]');
    const replace = container?.querySelector<HTMLElement>('[data-credential-action="replace"]');
    const clear = container?.querySelector<HTMLButtonElement>('[data-credential-action="clear"]');
    const start = container?.querySelector<HTMLButtonElement>('[data-test-action="start"]');
    const cancel = container?.querySelector<HTMLElement>('[data-test-action="cancel"]');
    setHidden(set, provider.configured);
    setHidden(replace, !provider.configured);
    setHidden(clear, !provider.configured);
    setHidden(start, provider.test.phase === 'running');
    setHidden(cancel, provider.test.phase !== 'running');
    container?.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
      button.disabled = updating;
    });
    if (start) start.disabled = updating || !provider.configured;
    restoreProviderFocus(container, status, providerFocusTarget(focused, provider));
    setText(`${id}-test-status`, providerTestText(provider, strings));
  }

  private updateSpeech(
    state: SettingsViewState,
    voices: readonly SettingsVoice[],
    localSpeechActive: boolean,
    strings: SettingsStrings,
    authoritative: boolean,
  ): void {
    setChecked('speech-enabled', state.speech.enabled, authoritative);
    const voiceOptions = [
      { value: '', label: strings.speechSystemDefault },
      ...voices.map((voice) => ({
        value: voice.voiceURI,
        label: `${voice.name} (${voice.lang})${voice.default ? ` — ${strings.speechSystemDefault}` : ''}`,
      })),
    ];
    syncOptions('speech-voice', includeSelected(voiceOptions, state.speech.voiceUri), state.speech.voiceUri, authoritative);
    setInputValue('speech-rate', String(state.speech.rate), authoritative);
    setText('speech-rate-value', `${state.speech.rate.toFixed(1)}×`);
    setDisabled('speech-voice', !state.speech.enabled || voices.length === 0);
    setDisabled('speech-rate', !state.speech.enabled);
    setDisabled('speech-test', !state.speech.enabled);
    setDisabled('speech-stop', !localSpeechActive && !state.speech.speaking);
    setText('speech-status', localSpeechActive || state.speech.speaking
      ? strings.speechSpeaking
      : strings.speechIdle);
  }

  private updateMicrophone(state: SettingsViewState, strings: SettingsStrings, authoritative: boolean): void {
    const devices = [
      { value: '', label: strings.microphoneDefault },
      ...state.microphone.devices.map(({ id, label }) => ({ value: id, label })),
    ];
    syncOptions('microphone-device', includeSelected(devices, state.microphone.deviceId), state.microphone.deviceId, authoritative);
    const status = state.microphone.status === 'scanning' || state.microphone.status === 'error'
      ? {
        scanning: strings.microphoneScanning,
        error: strings.microphoneError,
      }[state.microphone.status]
      : state.microphone.selection
        ? microphoneSelectionStatus(state.microphone.selection, strings)
        : {
      idle: strings.microphoneIdle,
      scanning: strings.microphoneScanning,
      ready: strings.microphoneReady,
      unavailable: strings.microphoneUnavailable,
      error: strings.microphoneError,
        }[state.microphone.status];
    setText('microphone-status', status);
    setDisabled('microphone-scan', state.microphone.status === 'scanning');
    byId('microphone-status')?.classList.toggle('error', state.microphone.status === 'error');
  }

  private updateMappings(state: SettingsViewState, strings: SettingsStrings): void {
    updateMappingList(state, strings);
    updateApprovalContext(state, strings);
    const status = {
      loading: strings.mappingLoading,
      ready: state.mappings.items.length === 0 ? strings.mappingEmpty : '',
      untrusted: strings.mappingUntrusted,
      error: strings.mappingError,
    }[state.mappings.status];
    setText('mappings-status', status);
    byId('mappings-status')?.classList.toggle('error', state.mappings.status === 'error');
    setDisabled('mapping-add', state.mappings.status === 'loading' || state.mappings.status === 'error');
  }

  private updatePrivacy(state: SettingsViewState, strings: SettingsStrings): void {
    setText('workspace-trust-status', state.privacy.workspaceTrusted
      ? strings.workspaceTrusted
      : strings.workspaceUntrusted);
    setText('privacy-assistant-consent', state.assistant.consentAcknowledged
      ? strings.assistantConsentReady
      : strings.assistantConsentNeeded);
    const listening = this.root.querySelector<HTMLButtonElement>('[data-consent="assistant-listening"]');
    if (listening) {
      listening.textContent = state.assistant.consentAcknowledged
        ? strings.consentRevoke
        : strings.consentAcknowledge;
    }
    updateProviderPrivacy(state, strings);
    updateWorkspaceOverrides(state, strings);
  }

  private updateDiagnostics(state: SettingsViewState, strings: SettingsStrings): void {
    setText('diagnostics-version', state.diagnostics.extensionVersion || '—');
    setText('diagnostics-platform', state.diagnostics.platform);
    const status = {
      idle: strings.diagnosticsIdle,
      running: strings.diagnosticsRunning,
      ready: strings.diagnosticsReady,
      attention: strings.diagnosticsAttention,
      error: strings.diagnosticsError,
    }[state.diagnostics.status];
    setText('diagnostics-status', status);
    byId('diagnostics-status')?.classList.toggle('error', state.diagnostics.status === 'error');
    this.root.querySelectorAll<HTMLButtonElement>('[data-diagnostics]').forEach((button) => {
      button.disabled = state.diagnostics.status === 'running'
        || (button.dataset.diagnostics !== 'run' && !state.diagnostics.reportAvailable);
    });
    updateDiagnosticsList(state.diagnostics.checks, strings);
  }

  private updateNotice(state: SettingsViewState, strings: SettingsStrings): void {
    if (!state.notice || state.notice.id === this.noticeId) return;
    this.noticeId = state.notice.id;
    const messages = {
      'settings-saved': strings.settingsSaved,
      'operation-cancelled': strings.operationCancelled,
      'operation-failed': strings.operationFailed,
      'stale-state': strings.staleState,
      'credential-updated': strings.credentialUpdated,
      'credential-cleared': strings.credentialCleared,
      'provider-updated': strings.providerUpdated,
      'agent-updated': strings.agentUpdated,
      'mapping-updated': strings.mappingUpdated,
      'diagnostics-copied': strings.diagnosticsCopied,
    };
    this.announce(messages[state.notice.code], state.notice.kind);
  }
}

export function microphoneSelectionStatus(
  selection: NonNullable<SettingsViewState['microphone']['selection']>,
  strings: SettingsStrings,
): string {
  if (selection.status === 'unavailable' || selection.recovery === 'select-device') {
    return strings.microphoneSelectDeviceRecovery;
  }
  if (selection.kind === 'repaired') {
    return selection.label
      ? strings.microphoneRepairedLabel.replace('{label}', selection.label)
      : strings.microphoneRepaired;
  }
  if (selection.kind === 'default') return strings.microphoneUsingDefault;
  return strings.microphoneSelectedAvailable;
}

export function languageHintOptions(
  languages: SettingsViewState['general']['languages'],
  strings: Pick<SettingsStrings, 'auto'>,
): SelectOption[] {
  return [
    { value: 'auto', label: strings.auto },
    ...languages
      .filter(({ code }) => code.toLowerCase() !== 'auto')
      .map(({ code, name }) => ({ value: code, label: `${name} (${code})` })),
  ];
}

function providerTestText(provider: SettingsProviderState, strings: SettingsStrings): string {
  if (provider.test.phase === 'idle') return strings.testIdle;
  if (provider.test.phase === 'running') return strings.testRunning;
  return {
    connected: strings.testConnected,
    'not-configured': strings.testNotConfigured,
    'consent-required': strings.testConsentRequired,
    unauthorized: strings.testUnauthorized,
    'rate-limited': strings.testRateLimited,
    rejected: strings.testRejected,
    unavailable: strings.testUnavailable,
    'timed-out': strings.testTimedOut,
    cancelled: strings.testCancelled,
  }[provider.test.result];
}

function providerButtonFocusTarget(
  container: HTMLElement | null,
): ProviderFocusTarget | undefined {
  const active = document.activeElement;
  if (!(active instanceof HTMLButtonElement) || !container?.contains(active)) return undefined;
  if (active.dataset.credentialAction) {
    return active.dataset.credentialAction as 'set' | 'replace' | 'clear';
  }
  return active.dataset.testAction === 'cancel' ? 'test-cancel' : 'test-start';
}

function restoreProviderFocus(
  container: HTMLElement | null,
  status: HTMLElement | undefined,
  target: ProviderFocusTarget | undefined,
): void {
  if (!target) return;
  if (target === 'status') {
    status?.focus({ preventScroll: true });
    return;
  }
  const selector = target === 'set' || target === 'replace' || target === 'clear'
    ? `[data-credential-action="${target}"]`
    : `[data-test-action="${target === 'test-cancel' ? 'cancel' : 'start'}"]`;
  const button = container?.querySelector<HTMLButtonElement>(selector);
  if (button && !button.hidden && !button.disabled) button.focus({ preventScroll: true });
  else status?.focus({ preventScroll: true });
}

function setReadiness(
  id: string,
  readiness: PresentationReadiness,
  strings: SettingsStrings,
): void {
  const badge = byId(id);
  if (!badge) return;
  badge.className = `status-badge ${readiness}`;
  badge.textContent = readinessText(readiness, strings);
}

function readinessText(
  readiness: PresentationReadiness,
  strings: SettingsStrings,
): string {
  return {
    ready: strings.readinessReady,
    attention: strings.readinessAttention,
    loading: strings.readinessLoading,
    unavailable: strings.readinessUnavailable,
  }[readiness];
}
