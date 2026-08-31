import type { UiLang } from '../protocol';
import type {
  AssistantRouteId,
  ConsentId,
  PlannerProviderId,
  ProviderId,
  SettingsSettingName,
  SettingsViewState,
  SettingsWebviewMessage,
  SetupStepId,
} from './contracts';
import { byId, clearDeferredControlUpdate, hasDeferredControlUpdate } from './dom';
import { SETTINGS_STRINGS } from './i18n';
import { providerForAgentSelection } from './resourceLists';
import type { SettingsSpeechPreview } from './speechPreview';
import { isProviderModelValueValid, type SetupProgressAction } from './state';

export interface SettingsEventDependencies {
  root: HTMLElement;
  state(): SettingsViewState;
  post(message: SettingsWebviewMessage): void;
  previewLanguage(language: UiLang): void;
  navigate(route: AssistantRouteId): void;
  updateSetup(action: SetupProgressAction): void;
  render(): void;
  speech: SettingsSpeechPreview;
}

/** One delegated event layer survives every incremental state publication. */
export function attachSettingsEvents(dependencies: SettingsEventDependencies): void {
  let genericOperationRevision = 0;
  const { root, post, speech } = dependencies;

  root.addEventListener('focusout', (event) => {
    const control = event.target;
    if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) return;
    if (hasDeferredControlUpdate(control)) {
      queueMicrotask(dependencies.render);
    }
  });

  root.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    clearDeferredControlUpdate(target);
    const state = dependencies.state();
    const revision = state.general.settingsRevision;
    switch (target.id) {
      case 'ui-language': {
        const value = target.value as UiLang;
        dependencies.previewLanguage(value);
        post({ type: 'settings-change', settingsRevision: revision, setting: 'uiLanguage', value });
        break;
      }
      case 'language-hint': postChange('languageHint', target.value, state, post); break;
      case 'stt-model': postChange('sttModel', target.value, state, post); break;
      case 'history-ttl': postChange('historyTtlDays', Number(target.value) as 0 | 1 | 7 | 30, state, post); break;
      case 'injection-mode': postChange('injectionMode', target.value as SettingsViewState['general']['injectionMode'], state, post); break;
      case 'assistant-wake-phrase': postChange('assistantWakePhrase', target.value.trim(), state, post); break;
      case 'assistant-provider':
        post({
          type: 'settings-provider-select',
          providerRevision: state.providers.revision,
          provider: target.value as SettingsViewState['providers']['selectedProvider'],
        });
        break;
      case 'speech-enabled':
        if (target instanceof HTMLInputElement) {
          postChange('assistantSpeechEnabled', target.checked, state, post);
        }
        break;
      case 'speech-voice': postChange('assistantSpeechVoiceUri', target.value, state, post); break;
      case 'speech-rate': postChange('assistantSpeechRate', normalizedRate(target.value), state, post); break;
      case 'microphone-device': postChange('audioDevice', target.value, state, post); break;
    }
    if (target.dataset.providerPreset) {
      setModelFromPreset(`provider-${target.dataset.providerPreset}-model`, target.value);
    }
    if (target.dataset.agentPreset) {
      setModelFromPreset(`agent-${target.dataset.agentPreset}-model`, target.value);
    }
    if (target.dataset.agentProvider) {
      updateAgentPresets(target.dataset.agentProvider, target.value, state);
    }
  });

  root.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.id !== 'speech-rate') return;
    const output = byId<HTMLOutputElement>('speech-rate-value');
    if (output) output.value = `${normalizedRate(target.value).toFixed(1)}×`;
  });

  root.addEventListener('click', (event) => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>('button');
    if (!button || button.disabled) return;
    const state = dependencies.state();

    if (button.dataset.route) {
      dependencies.navigate(button.dataset.route as AssistantRouteId);
      return;
    }
    if (button.dataset.setupStep) {
      dependencies.updateSetup({ type: 'go', step: button.dataset.setupStep as SetupStepId });
      return;
    }
    if (button.dataset.setupRun) {
      post({
        type: 'settings-setup-run',
        setupRevision: state.setup.revision,
        step: button.dataset.setupRun as SetupStepId,
      });
      return;
    }
    if (button.dataset.setupCancel !== undefined) {
      post({ type: 'settings-setup-cancel', setupRevision: state.setup.revision });
      speech.stop();
      return;
    }

    if (button.id === 'open-keybindings') {
      post({ type: 'settings-open-keybindings', operationRevision: ++genericOperationRevision });
      return;
    }
    if (button.id === 'open-native-settings') {
      post({ type: 'settings-open-native', operationRevision: ++genericOperationRevision });
      return;
    }
    if (button.id === 'assistant-action') {
      const active = state.assistant.status === 'listening' || state.assistant.status === 'starting';
      post({
        type: 'settings-assistant-action',
        operationRevision: state.assistant.operationRevision + 1,
        action: active ? 'stop' : 'start',
      });
      return;
    }
    if (button.id === 'assistant-consent-action') {
      postConsent('assistant-listening', state.assistant.consentAcknowledged, state, post);
      return;
    }
    if (button.id === 'speech-test') {
      const input = byId<HTMLInputElement>('speech-test-phrase');
      const phrase = input?.value.trim() || input?.placeholder || '';
      const voiceUri = byId<HTMLSelectElement>('speech-voice')?.value ?? state.speech.voiceUri;
      const rate = normalizedRate(byId<HTMLInputElement>('speech-rate')?.value ?? String(state.speech.rate));
      speech.speak(phrase, voiceUri, rate, state.uiLang);
      return;
    }
    if (button.id === 'speech-stop') {
      speech.stop();
      post({ type: 'settings-speech-stop', operationRevision: state.speech.operationRevision + 1 });
      return;
    }
    if (button.id === 'microphone-scan') {
      post({ type: 'settings-microphone-scan', operationRevision: state.microphone.operationRevision + 1 });
      return;
    }
    if (button.id === 'microphone-guide-button') {
      toggleMicrophoneGuide(button);
      return;
    }
    if (button.id === 'mapping-add') {
      post({ type: 'settings-mapping-add', mappingsRevision: state.mappings.revision });
      return;
    }
    if (button.id === 'agent-create') {
      const templateId = byId<HTMLSelectElement>('agent-template')?.value as SettingsViewState['assistant']['persona'];
      post({ type: 'settings-agent-create', agentRevision: state.agents.revision, templateId });
      return;
    }
    if (button.dataset.consent) {
      const consent = button.dataset.consent as ConsentId;
      const acknowledged = consent === 'assistant-listening'
        ? state.assistant.consentAcknowledged
        : state.providers.items.find(({ id }) => id === consent)?.consentAcknowledged;
      if (acknowledged === undefined) return;
      postConsent(consent, acknowledged, state, post);
      return;
    }
    if (button.dataset.providerAction === 'save-profile') {
      postProviderProfile(button, state, post);
      return;
    }
    if (button.dataset.credentialAction || button.dataset.testAction) {
      postProviderAction(button, state, post);
      return;
    }
    if (button.dataset.agentAction) {
      postAgentAction(button, state, post);
      return;
    }
    if (button.dataset.mappingAction) {
      postMappingAction(button, state, post);
      return;
    }
    if (button.dataset.diagnostics) {
      post({
        type: 'settings-diagnostics-action',
        operationRevision: state.diagnostics.operationRevision + 1,
        action: button.dataset.diagnostics as 'run' | 'open' | 'copy',
      });
    }
  });
}

function postChange<K extends SettingsSettingName>(
  setting: K,
  value: unknown,
  state: SettingsViewState,
  post: SettingsEventDependencies['post'],
): void {
  post({
    type: 'settings-change',
    settingsRevision: state.general.settingsRevision,
    setting,
    value,
  } as SettingsWebviewMessage);
}

function postConsent(
  consent: ConsentId,
  acknowledged: boolean,
  state: SettingsViewState,
  post: SettingsEventDependencies['post'],
): void {
  post({
    type: 'settings-consent-action',
    consentRevision: state.privacy.consentRevision,
    consent,
    action: acknowledged ? 'revoke' : 'acknowledge',
  });
}

function postProviderAction(
  button: HTMLButtonElement,
  state: SettingsViewState,
  post: SettingsEventDependencies['post'],
): void {
  const container = button.closest<HTMLElement>('.provider-actions');
  const provider = container?.dataset.provider as ProviderId | undefined;
  if (!provider) return;
  const providerState = provider === 'soniox'
    ? state.transcription
    : state.providers.items.find(({ id }) => id === provider);
  if (!providerState) return;
  if (button.dataset.credentialAction) {
    post({
      type: 'settings-provider-credential',
      operationRevision: providerState.credential.operationRevision + 1,
      provider,
      action: button.dataset.credentialAction as 'set' | 'replace' | 'clear',
    });
    return;
  }
  post({
    type: 'settings-provider-test',
    operationRevision: providerState.test.operationRevision + 1,
    provider,
    action: button.dataset.testAction === 'cancel' ? 'cancel' : 'start',
  });
}

function postProviderProfile(
  button: HTMLButtonElement,
  state: SettingsViewState,
  post: SettingsEventDependencies['post'],
): void {
  const provider = button.dataset.provider as PlannerProviderId | undefined;
  const card = button.closest<HTMLElement>('[data-provider-id]');
  const enabled = card?.querySelector<HTMLInputElement>('[data-provider-enabled]')?.checked;
  const model = card?.querySelector<HTMLInputElement>('[data-provider-model]');
  if (!provider || enabled === undefined || !model || !validateModel(model, state)) return;
  post({
    type: 'settings-provider-profile',
    providerRevision: state.providers.revision,
    provider,
    enabled,
    model: model.value.trim(),
  });
}

function postAgentAction(
  button: HTMLButtonElement,
  state: SettingsViewState,
  post: SettingsEventDependencies['post'],
): void {
  const card = button.closest<HTMLElement>('[data-agent-id]');
  const id = card?.dataset.agentId;
  const agent = state.agents.items.find((item) => item.id === id);
  if (!id || !agent) return;
  const common = { agentRevision: state.agents.revision, id };
  switch (button.dataset.agentAction) {
    case 'save-profile': {
      const provider = card.querySelector<HTMLSelectElement>('[data-agent-provider]')?.value as PlannerProviderId;
      const model = card.querySelector<HTMLInputElement>('[data-agent-model]');
      if (!providerForAgentSelection(state, provider) || !model || !validateModel(model, state)) return;
      post({ type: 'settings-agent-update-profile', ...common, provider, model: model.value.trim() });
      break;
    }
    case 'set-default': post({ type: 'settings-agent-set-default', ...common }); break;
    case 'toggle-enabled': post({ type: 'settings-agent-set-enabled', ...common, enabled: !agent.enabled }); break;
    case 'duplicate': post({ type: 'settings-agent-duplicate', ...common }); break;
    case 'delete': post({ type: 'settings-agent-delete', ...common }); break;
  }
}

function postMappingAction(
  button: HTMLButtonElement,
  state: SettingsViewState,
  post: SettingsEventDependencies['post'],
): void {
  const id = button.closest<HTMLElement>('[data-mapping-id]')?.dataset.mappingId;
  if (!id) return;
  const common = { mappingsRevision: state.mappings.revision, id };
  switch (button.dataset.mappingAction) {
    case 'edit': post({ type: 'settings-mapping-edit', ...common }); break;
    case 'toggle-enabled': post({ type: 'settings-mapping-toggle-enabled', ...common }); break;
    case 'toggle-agent': post({ type: 'settings-mapping-toggle-agent', ...common }); break;
    case 'grant-approval': post({ type: 'settings-mapping-approval', ...common, action: 'grant' }); break;
    case 'revoke-approval': post({ type: 'settings-mapping-approval', ...common, action: 'revoke' }); break;
    case 'delete': post({ type: 'settings-mapping-delete', ...common }); break;
  }
}

function validateModel(input: HTMLInputElement, state: SettingsViewState): boolean {
  const valid = isProviderModelValueValid(input.value);
  input.setCustomValidity(valid ? '' : SETTINGS_STRINGS[state.uiLang].deepseekModelRequired);
  input.toggleAttribute('aria-invalid', !valid);
  if (!valid) input.reportValidity();
  return valid;
}

function setModelFromPreset(inputId: string, preset: string): void {
  if (!preset) return;
  const input = byId<HTMLInputElement>(inputId);
  if (!input) return;
  input.value = preset;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function updateAgentPresets(agentId: string, providerId: string, state: SettingsViewState): void {
  const provider = providerForAgentSelection(state, providerId);
  const select = byId<HTMLSelectElement>(`agent-${agentId}-preset`);
  if (!provider || !select) return;
  const fragment = document.createDocumentFragment();
  for (const value of ['', ...provider.modelPresets]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value || SETTINGS_STRINGS[state.uiLang].providerCustomModel;
    fragment.append(option);
  }
  select.replaceChildren(fragment);
  select.value = '';
}

function toggleMicrophoneGuide(button: HTMLButtonElement): void {
  const guide = byId('microphone-guide');
  if (!guide) return;
  guide.hidden = !guide.hidden;
  button.setAttribute('aria-expanded', String(!guide.hidden));
}

function normalizedRate(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(2, Math.max(0.5, parsed)) : 1;
}
