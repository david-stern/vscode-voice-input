import {
  CONTROL_CENTER_AGENT_TEMPLATES,
  type ControlCenterHostMessage,
  type ControlCenterPlanningProvider,
} from '../contracts';
import { element, labelledButton, mixedText, sectionCard } from '../dom';
import type { ControlCenterStrings } from '../i18n';

type Snapshot = Extract<ControlCenterHostMessage, { type: 'stateSnapshot' }>;
type Providers = Extract<ControlCenterHostMessage, { type: 'planningProviderState' }>;
type Agents = Extract<ControlCenterHostMessage, { type: 'agentPageState' }>;

export function renderAssistantRoute(
  container: HTMLElement,
  snapshot: Snapshot,
  strings: ControlCenterStrings,
  providers?: Providers,
  agents?: Agents,
): void {
  const speech = sectionCard(strings.speechProvider);
  speech.id = 'provider-card';
  const speechState = snapshot.capabilities.sttProvider === 'soniox'
    ? snapshot.capabilities.sttState === 'ready' ? strings.sonioxConfigured : `${strings.remoteProcessing} — ${strings.notConfigured}`
    : strings.notConfigured;
  speech.append(element('p', { text: speechState }));
  if (snapshot.capabilities.sttProvider === 'none') {
    speech.append(labelledButton(strings.configureSoniox, 'configure-soniox'));
  } else {
    const actions = element('div', { className: 'button-row' });
    actions.append(labelledButton(
      snapshot.capabilities.sttState === 'ready' ? strings.sonioxCredentialReplace : strings.sonioxCredentialConfigure,
      'configure-soniox-secret', 'button secondary',
    ));
    if (!snapshot.capabilities.remoteProcessing) {
      actions.append(labelledButton(strings.sonioxConsentReview, 'request-soniox-consent', 'button secondary'));
    }
    actions.append(labelledButton(strings.sonioxTest, 'test-soniox', 'button secondary'));
    if (snapshot.capabilities.remoteProcessing) {
      actions.append(labelledButton(strings.sonioxRevoke, 'revoke-soniox', 'button danger'));
    }
    speech.append(actions);
  }
  speech.append(labelledButton(strings.providerDetails, 'provider-details', 'button secondary'));

  const planning = sectionCard(strings.planningProviders, strings.planningProvidersHelp);
  planning.append(providerSelection(providers, strings));
  const providerList = element('div', { className: 'resource-list' });
  if (!providers) providerList.append(element('p', { className: 'muted', text: strings.managementLoading }));
  else if (providers.items.length === 0) providerList.append(element('p', { className: 'muted', text: strings.providersEmpty }));
  else for (const provider of providers.items) providerList.append(providerCard(provider, strings));
  planning.append(providerList);

  const agentManagement = sectionCard(strings.agents, strings.agentsHelp);
  const agentHeading = agentManagement.querySelector('h2');
  if (agentHeading) agentHeading.id = 'agent-management-heading';
  agentManagement.append(agentCreateForm(strings), agentList(agents, providers, strings));
  if (agents) agentManagement.append(managementPagination(
    agents.pageIndex, agents.totalCount, agents.pageSize, strings,
  ));

  const system = sectionCard(
    strings.systemVoice,
    snapshot.capabilities.systemTtsState === 'ready'
      || snapshot.capabilities.systemTtsState === 'configured-unverified'
      ? strings.systemVoice
      : strings.systemVoiceUnavailable,
  );
  const boundary = element('p', { className: 'callout neutral', text: strings.localPending });
  container.replaceChildren(speech, planning, agentManagement, system, boundary);
}

function providerSelection(providers: Providers | undefined, strings: ControlCenterStrings): HTMLLabelElement {
  const label = element('label', { className: 'field' });
  label.htmlFor = 'planning-provider-select';
  label.append(element('span', { text: strings.selectedProvider }));
  const select = element('select', { id: 'planning-provider-select' });
  select.dataset.action = 'select-planning-provider';
  select.append(option('off', strings.providerOff, providers?.selectedProvider === 'off'));
  for (const provider of providers?.items ?? []) {
    select.append(option(provider.id, provider.name, providers?.selectedProvider === provider.id));
  }
  select.disabled = !providers;
  label.append(select);
  return label;
}

function providerCard(provider: ControlCenterPlanningProvider, strings: ControlCenterStrings): HTMLElement {
  const card = element('article', { className: 'resource-card' });
  card.dataset.providerId = provider.id;
  const title = element('h3', { text: provider.name });
  title.id = `planning-provider-${provider.id}`;
  card.setAttribute('aria-labelledby', title.id);
  const status = element('p', {
    className: `badge ${provider.enabled && (!provider.credentialRequired || provider.credentialConfigured)
      ? 'ready' : 'attention'}`,
    text: provider.enabled ? strings.providerEnabled : strings.providerDisabled,
  });
  const facts = element('p', { className: 'muted', text: provider.locality === 'remote'
    ? strings.providerRemote : strings.providerLoopback });
  const form = element('form', { className: 'management-form' });
  form.dataset.action = 'provider-profile-form';
  form.dataset.providerId = provider.id;
  const enabled = checkboxField(
    `planning-provider-${provider.id}-enabled`, strings.providerEnabled,
    provider.enabled, 'provider-enabled',
  );
  const model = textField(
    `planning-provider-${provider.id}-model`, strings.providerModel,
    provider.model, 256, 'provider-model',
  );
  const save = labelledButton(strings.providerSave, 'save-provider-profile');
  save.type = 'submit';
  form.append(enabled, model, save);

  const operations = element('div', { className: 'button-row' });
  if (provider.credentialRequired) {
    operations.append(labelledButton(
      provider.credentialConfigured ? strings.credentialReplace : strings.credentialSet,
      provider.credentialConfigured ? 'replace-provider-credential' : 'set-provider-credential',
      'button secondary',
    ));
    if (provider.credentialConfigured) {
      operations.append(labelledButton(strings.credentialClear, 'clear-provider-credential', 'button danger'));
    }
  }
  operations.append(labelledButton(strings.providerTest, 'test-planning-provider', 'button secondary'));
  operations.append(labelledButton(strings.providerCancelTest, 'cancel-planning-provider-test', 'button secondary'));
  if (provider.consentRequired) {
    operations.append(labelledButton(
      provider.consentAcknowledged ? strings.consentRevoke : strings.consentReview,
      provider.consentAcknowledged ? 'revoke-provider-consent' : 'review-provider-consent',
      'button secondary',
    ));
  }
  card.append(title, status, facts, form, element('p', {
    className: 'muted', text: strings.credentialsNative,
  }), operations);
  return card;
}

function agentCreateForm(strings: ControlCenterStrings): HTMLFormElement {
  const form = element('form', { className: 'management-form' });
  form.dataset.action = 'agent-create-form';
  const label = element('label', { className: 'field' });
  label.htmlFor = 'agent-template';
  label.append(element('span', { text: strings.agentTemplate }));
  const select = element('select', { id: 'agent-template' });
  CONTROL_CENTER_AGENT_TEMPLATES.forEach((template, index) => {
    select.append(option(template, strings.agentTemplates[index], false));
  });
  label.append(select);
  const submit = labelledButton(strings.agentCreate, 'create-agent');
  submit.type = 'submit';
  form.append(label, submit);
  return form;
}

function agentList(
  agents: Agents | undefined,
  providers: Providers | undefined,
  strings: ControlCenterStrings,
): HTMLElement {
  const list = element('div', { className: 'resource-list' });
  if (!agents) {
    list.append(element('p', { className: 'muted', text: strings.managementLoading }));
    return list;
  }
  if (agents.items.length === 0) {
    list.append(element('p', { className: 'muted', text: strings.agentsEmpty }));
    return list;
  }
  for (const agent of agents.items) {
    const card = element('article', { className: 'resource-card' });
    card.dataset.agentId = agent.id;
    const title = element('h3', { text: agent.name });
    title.dir = 'auto';
    const description = element('p', { className: 'muted', text: agent.description });
    description.dir = 'auto';
    const id = mixedText(agent.id, 'command-id');
    const flags = element('p', { className: 'resource-flags' });
    flags.append(
      element('span', { className: 'badge', text: agent.enabled ? strings.agentEnabled : strings.agentDisabled }),
      ...(agent.isDefault ? [element('span', { className: 'badge', text: strings.agentDefault })] : []),
      element('span', { className: 'badge', text: agent.instructionsConfigured
        ? strings.agentInstructionsConfigured : strings.agentInstructionsEmpty }),
    );
    const form = element('form', { className: 'management-form' });
    form.dataset.action = 'agent-profile-form';
    form.dataset.agentId = agent.id;
    const provider = selectField(
      `agent-${agent.id}-provider`, strings.selectedProvider,
      providers?.items.map((item) => ({ value: item.id, label: item.name })) ?? [],
      agent.provider, 'agent-provider',
    );
    const model = textField(`agent-${agent.id}-model`, strings.providerModel, agent.model, 256, 'agent-model');
    const save = labelledButton(strings.agentSave, 'save-agent-profile');
    save.type = 'submit';
    form.append(provider, model, save);
    const actions = element('div', { className: 'button-row' });
    const toggle = labelledButton(
      agent.enabled ? strings.agentDisable : strings.agentEnable,
      'toggle-agent-enabled', 'button secondary',
    );
    toggle.dataset.enabled = String(!agent.enabled);
    const makeDefault = labelledButton(strings.agentMakeDefault, 'set-default-agent', 'button secondary');
    makeDefault.disabled = agent.isDefault || !agent.enabled;
    actions.append(
      toggle,
      makeDefault,
      labelledButton(strings.agentDuplicate, 'duplicate-agent', 'button secondary'),
      labelledButton(strings.agentDelete, 'delete-agent', 'button danger'),
    );
    card.append(title, description, id, flags, form, actions);
    list.append(card);
  }
  return list;
}

function managementPagination(
  page: number, total: number, pageSize: number, strings: ControlCenterStrings,
): HTMLElement {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const controls = element('nav', { className: 'pagination' });
  controls.setAttribute('aria-label', strings.agents);
  const previous = labelledButton(strings.previous, 'management-page', 'button secondary');
  previous.dataset.managementTarget = 'agents';
  previous.dataset.page = String(page - 1);
  previous.disabled = page <= 1;
  const next = labelledButton(strings.next, 'management-page', 'button secondary');
  next.dataset.managementTarget = 'agents';
  next.dataset.page = String(page + 1);
  next.disabled = page >= pages;
  controls.append(previous, element('span', { text: `${page} / ${pages}` }), next);
  return controls;
}

function checkboxField(
  id: string, text: string, checked: boolean, action: string,
): HTMLLabelElement {
  const label = element('label', { className: 'check-filter' });
  const input = element('input', { id });
  input.type = 'checkbox';
  input.checked = checked;
  input.dataset.field = action;
  label.append(input, element('span', { text }));
  return label;
}

function textField(
  id: string, text: string, value: string, maxLength: number, action: string,
): HTMLLabelElement {
  const label = element('label', { className: 'field' });
  label.htmlFor = id;
  label.append(element('span', { text }));
  const input = element('input', { id });
  input.type = 'text';
  input.maxLength = maxLength;
  input.value = value;
  input.dir = 'ltr';
  input.dataset.field = action;
  label.append(input);
  return label;
}

function selectField(
  id: string,
  text: string,
  values: readonly { value: string; label: string }[],
  selected: string,
  action: string,
): HTMLLabelElement {
  const label = element('label', { className: 'field' });
  label.htmlFor = id;
  label.append(element('span', { text }));
  const select = element('select', { id });
  select.dataset.field = action;
  for (const value of values) select.append(option(value.value, value.label, value.value === selected));
  label.append(select);
  return label;
}

function option(value: string, label: string, selected: boolean): HTMLOptionElement {
  const item = element('option', { text: label });
  item.value = value;
  item.selected = selected;
  return item;
}
