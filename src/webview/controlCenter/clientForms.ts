import {
  type ControlCenterBrowserMessage,
  type ControlCenterHostMessage,
  type ControlCenterPlanningProviderId,
} from './contracts';
import { readCustomCommandDraft } from './customCommands';
import { updateCommandFilterState } from './filters';
import { isSystemVoiceIndex } from './hostVoices';
import { submitAgentProfile, submitProviderProfile } from './managementClient';

type ControlCenterSnapshot = Extract<ControlCenterHostMessage, { type: 'stateSnapshot' }>;

export interface ControlCenterFormContext {
  /** The currently applied snapshot; every intent is dropped while there is none. */
  snapshot(): ControlCenterSnapshot | undefined;
  post(message: ControlCenterBrowserMessage): void;
}

/** Wires the change, input, and submit listeners behind every Control Center form field. */
export function registerControlCenterFormHandlers(context: ControlCenterFormContext): void {
  document.addEventListener('change', (event) => handleControlChange(event, context));
  document.addEventListener('input', (event) => reflectSpeechRate(event));
  document.addEventListener('submit', (event) => handleFormSubmit(event, context));
}

function handleControlChange(event: Event, context: ControlCenterFormContext): void {
  const target = event.target as HTMLInputElement | HTMLSelectElement | null;
  const snapshot = context.snapshot();
  if (!target || !snapshot) return;
  const post = context.post;
  const postFilter = (filter: string): void => {
    post({ type: 'setFilterIntent', revision: snapshot.revision, filter });
  };
  if (target.id === 'command-search') {
    postFilter(updateCommandFilterState(snapshot.state.filter, { query: target.value }));
  } else if (target instanceof HTMLInputElement && target.dataset.action === 'boolean-filter') {
    const field = target.dataset.filterField as 'enabledOnly' | 'changedOnly' | undefined;
    if (field) postFilter(updateCommandFilterState(snapshot.state.filter, { [field]: target.checked }));
  } else if (target instanceof HTMLInputElement && target.dataset.action === 'toggle-command') {
    const commandId = target.closest<HTMLElement>('[data-command-id]')?.dataset.commandId;
    if (commandId) post({
      type: 'commandEditIntent', revision: snapshot.revision, commandId,
      operation: 'set-enabled', value: target.checked,
    });
  } else if (target.dataset.action === 'system-tts-mode') {
    post({ type: 'systemTtsIntent', revision: snapshot.revision,
      operation: 'set-enabled', enabled: target.value === 'system' });
  } else if (target.dataset.action === 'system-tts-voice') {
    const voiceIndex = Number(target.value);
    if (isSystemVoiceIndex(voiceIndex)) post({
      type: 'systemTtsIntent', revision: snapshot.revision, operation: 'set-voice', voiceIndex,
    });
  } else if (target.dataset.action === 'system-tts-rate') {
    const rate = Number(target.value);
    if (Number.isFinite(rate) && rate >= 0.5 && rate <= 2) post({
      type: 'systemTtsIntent', revision: snapshot.revision, operation: 'set-rate', rate,
    });
  } else if (target.dataset.action === 'select-planning-provider') {
    post({
      type: 'planningProviderIntent', revision: snapshot.revision,
      provider: target.value as ControlCenterPlanningProviderId | 'off', operation: 'select',
    });
  }
}

function reflectSpeechRate(event: Event): void {
  const target = event.target as HTMLInputElement | null;
  if (target?.dataset.action !== 'system-tts-rate') return;
  const output = document.getElementById('system-tts-rate-value');
  const rate = Number(target.value);
  if (output && Number.isFinite(rate)) output.textContent = `${rate.toFixed(1)}×`;
}

function handleFormSubmit(event: Event, context: ControlCenterFormContext): void {
  const form = event.target as HTMLFormElement | null;
  const snapshot = context.snapshot();
  if (!form || !snapshot) return;
  const post = context.post;
  if (form.dataset.action === 'custom-command-form') {
    event.preventDefault();
    const draft = readCustomCommandDraft(form);
    if (!draft) return;
    const id = form.dataset.customCommandId;
    post(id
      ? { type: 'customCommandIntent', revision: snapshot.revision, operation: 'edit', id, ...draft }
      : { type: 'customCommandIntent', revision: snapshot.revision, operation: 'add', ...draft });
  } else if (form.dataset.action === 'provider-profile-form') {
    event.preventDefault();
    submitProviderProfile(form, snapshot.revision, post);
  } else if (form.dataset.action === 'agent-create-form') {
    event.preventDefault();
    const template = form.querySelector<HTMLSelectElement>('#agent-template')?.value;
    if (template) post({
      type: 'agentManagementIntent', revision: snapshot.revision,
      operation: 'create', templateId: template as Extract<ControlCenterBrowserMessage,
        { type: 'agentManagementIntent' }>['templateId'],
    });
  } else if (form.dataset.action === 'agent-profile-form') {
    event.preventDefault();
    submitAgentProfile(form, snapshot.revision, post);
  }
}
