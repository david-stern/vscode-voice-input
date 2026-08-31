import type {
  PlannerProviderId,
  SettingsAgentCard,
  SettingsProviderCard,
  SettingsViewState,
} from './contracts';
import {
  byId,
  createButton,
  createElement,
  includeSelected,
  setChecked,
  setHidden,
  setInputValue,
  syncOptions,
} from './dom';
import type { SettingsStrings } from './i18n';
/** Update provider and agent resources without replacing focused cards. */
export function updateProviderResources(
  state: SettingsViewState,
  strings: SettingsStrings,
  authoritative: boolean,
): void {
  syncOptions(
    'assistant-provider',
    [
      { value: 'off', label: strings.providerOff },
      ...state.providers.items.map(({ id, name }) => ({ value: id, label: name })),
    ],
    state.providers.selectedProvider,
    authoritative,
  );
  updateKeyedList(
    'provider-list',
    '.provider-card[data-provider-id]',
    state.providers.items,
    (provider) => provider.id,
    createProviderCard,
    (card, provider) => updateProviderCard(card, provider, strings, authoritative),
    strings.providerCardsEmpty,
  );
}
export function updateAgentResources(
  state: SettingsViewState,
  strings: SettingsStrings,
  authoritative: boolean,
): void {
  const list = byId('agent-list');
  const currentCards = list
    ? Array.from(list.querySelectorAll<HTMLElement>('.agent-card[data-agent-id]'))
    : [];
  const active = document.activeElement instanceof HTMLElement
    ? document.activeElement.closest<HTMLElement>('.agent-card[data-agent-id]')
    : null;
  const focus = active ? {
    id: active.dataset.agentId,
    index: currentCards.indexOf(active),
    action: (document.activeElement as HTMLElement).dataset.agentAction,
  } : undefined;
  updateKeyedList(
    'agent-list',
    '.agent-card[data-agent-id]',
    state.agents.items,
    (agent) => agent.id,
    createAgentCard,
    (card, agent) => updateAgentCard(card, agent, state, strings, authoritative),
    strings.agentsEmpty,
  );
  if (focus?.id && !state.agents.items.some(({ id }) => id === focus.id)) {
    const next = list?.querySelectorAll<HTMLElement>('.agent-card[data-agent-id]')
      .item(Math.max(0, Math.min(focus.index, state.agents.items.length - 1)));
    const action = focus.action
      ? next?.querySelector<HTMLElement>(`[data-agent-action="${focus.action}"]`)
      : undefined;
    (action ?? next ?? byId('agent-create'))?.focus({ preventScroll: true });
  }
}
export function updateProviderPrivacy(
  state: SettingsViewState,
  strings: SettingsStrings,
): void {
  updateKeyedList(
    'provider-privacy-list',
    '.provider-privacy-card[data-provider-id]',
    state.providers.items,
    (provider) => provider.id,
    createProviderPrivacyCard,
    (card, provider) => updateProviderPrivacyCard(card, provider, strings),
    strings.providerCardsEmpty,
  );
}
function createProviderCard(provider: SettingsProviderCard): HTMLElement {
  const card = createElement('article', 'provider-card');
  card.dataset.providerId = provider.id;
  card.setAttribute('aria-labelledby', `provider-${provider.id}-title`);
  const heading = createElement('div', 'card-heading');
  const identity = createElement('div');
  const role = createElement('p', 'eyebrow');
  role.dataset.providerRole = 'reasoning';
  const title = createElement('h3');
  title.id = `provider-${provider.id}-title`;
  const readiness = createElement('span', 'status-badge provider-readiness');
  identity.append(role, title);
  heading.append(identity, readiness);
  const facts = createElement('dl', 'identity-list provider-facts');
  facts.append(detailRow('endpoint'), detailRow('locality'));

  const enabled = createElement('label', 'check-row');
  enabled.htmlFor = `provider-${provider.id}-enabled`;
  const checkbox = createElement('input');
  checkbox.id = `provider-${provider.id}-enabled`;
  checkbox.type = 'checkbox';
  checkbox.dataset.providerEnabled = provider.id;
  enabled.append(checkbox, createElement('span', 'provider-enabled-label'));

  const modelFields = createElement('div', 'form-grid');
  modelFields.append(
    fieldWithSelect(`provider-${provider.id}-preset`, 'provider-preset-label', 'providerPreset', provider.id),
    fieldWithInput(`provider-${provider.id}-model`, 'provider-model-label', 'providerModel', provider.id),
  );
  const modelHelp = createElement('p', 'help provider-model-help');

  const profileActions = createElement('div', 'button-row');
  const save = createButton('');
  save.dataset.providerAction = 'save-profile';
  save.dataset.provider = provider.id;
  profileActions.append(save);

  const status = createElement('p', 'credential-status');
  status.id = `provider-${provider.id}-credential-status`;
  status.tabIndex = -1;
  const nativeHelp = createElement('p', 'help provider-native-help');
  const actions = createElement('div', 'button-row provider-actions');
  actions.dataset.provider = provider.id;
  for (const action of ['set', 'replace', 'clear'] as const) {
    const button = createButton('', action === 'clear' ? 'danger' : undefined);
    button.dataset.credentialAction = action;
    actions.append(button);
  }
  for (const action of ['start', 'cancel'] as const) {
    const button = createButton('', 'secondary');
    button.dataset.testAction = action;
    actions.append(button);
  }
  const testStatus = createElement('p', 'inline-status provider-test-status');
  const consent = createElement('div', 'consent-row provider-consent');
  const consentStatus = createElement('span');
  const consentButton = createButton('', 'secondary');
  consentButton.dataset.consent = provider.id;
  consent.append(consentStatus, consentButton);

  card.append(
    heading,
    facts,
    enabled,
    modelFields,
    modelHelp,
    profileActions,
    status,
    nativeHelp,
    actions,
    testStatus,
    consent,
  );
  return card;
}

function updateProviderCard(
  card: HTMLElement,
  provider: SettingsProviderCard,
  strings: SettingsStrings,
  authoritative: boolean,
): void {
  card.dataset.providerId = provider.id;
  card.classList.toggle('selected', provider.selected);
  setChildText(card, 'h3', provider.name);
  setChildText(card, '[data-provider-role]', strings.providerRoleReasoning);
  setChildText(card, '[data-detail="endpoint"] dt', strings.providerEndpointHost);
  setChildText(card, '[data-detail="endpoint"] dd', provider.endpointHost);
  setChildText(card, '[data-detail="locality"] dt', strings.providerLocality);
  setChildText(
    card,
    '[data-detail="locality"] dd',
    provider.locality === 'local-loopback' ? strings.localityLoopback : strings.localityRemote,
  );
  const endpoint = card.querySelector<HTMLElement>('[data-detail="endpoint"] dd');
  if (endpoint) endpoint.dir = 'ltr';

  setChecked(`provider-${provider.id}-enabled`, provider.enabled, authoritative);
  setChildText(card, '.provider-enabled-label', strings.providerEnabled);
  setChildText(card, '.provider-preset-label', strings.providerModelPreset);
  setChildText(card, '.provider-model-label', strings.providerCustomModel);
  setChildText(card, '.provider-model-help', strings.providerModelHelp);
  syncOptions(
    `provider-${provider.id}-preset`,
    [
      { value: '', label: strings.providerCustomModel },
      ...provider.modelPresets.map((model) => ({ value: model, label: model })),
    ],
    provider.modelPresets.includes(provider.model) ? provider.model : '',
    authoritative,
  );
  setInputValue(`provider-${provider.id}-model`, provider.model, authoritative);
  setChildText(card, '[data-provider-action="save-profile"]', strings.providerSaveProfile);
  updateProviderOperations(card, provider, strings);
}

function updateProviderOperations(
  card: HTMLElement,
  provider: SettingsProviderCard,
  strings: SettingsStrings,
): void {
  const updating = provider.credential.phase === 'updating';
  const credentialStatus = card.querySelector<HTMLElement>('.credential-status');
  const configured = !provider.credentialRequired || provider.configured;
  const credentialText = provider.credentialRequired
    ? updating ? strings.credentialUpdating : configured ? strings.credentialConfigured : strings.credentialMissing
    : strings.providerCredentialOptional;
  if (credentialStatus) {
    credentialStatus.textContent = credentialText;
    credentialStatus.classList.toggle('configured', configured && !updating);
    credentialStatus.classList.toggle('missing', !configured && !updating);
  }
  setChildText(card, '.provider-native-help', strings.credentialNativeOnly);
  setHidden(card.querySelector<HTMLElement>('.provider-native-help'), !provider.credentialRequired);
  const set = card.querySelector<HTMLElement>('[data-credential-action="set"]');
  const replace = card.querySelector<HTMLElement>('[data-credential-action="replace"]');
  const clear = card.querySelector<HTMLElement>('[data-credential-action="clear"]');
  setHidden(set, !provider.credentialRequired || provider.configured);
  setHidden(replace, !provider.credentialRequired || !provider.configured);
  setHidden(clear, !provider.credentialRequired || !provider.configured);
  setChildText(card, '[data-credential-action="set"]', strings.credentialSet);
  setChildText(card, '[data-credential-action="replace"]', strings.credentialReplace);
  setChildText(card, '[data-credential-action="clear"]', strings.credentialClear);

  const running = provider.test.phase === 'running';
  setHidden(card.querySelector<HTMLElement>('[data-test-action="start"]'), running);
  setHidden(card.querySelector<HTMLElement>('[data-test-action="cancel"]'), !running);
  setChildText(card, '[data-test-action="start"]', strings.credentialTest);
  setChildText(card, '[data-test-action="cancel"]', strings.credentialCancelTest);
  card.querySelectorAll<HTMLButtonElement>('.provider-actions button').forEach((button) => {
    button.disabled = updating || (button.dataset.testAction === 'start' && !configured);
  });
  setChildText(card, '.provider-test-status', providerTestText(provider, strings));

  const ready = provider.enabled && configured && provider.consentAcknowledged;
  const readiness = card.querySelector<HTMLElement>('.provider-readiness');
  if (readiness) {
    readiness.className = `status-badge provider-readiness ${ready ? 'ready' : 'attention'}`;
    readiness.textContent = ready ? strings.readinessReady : strings.readinessAttention;
  }
  const consentText = !provider.consentRequired
    ? strings.providerConsentNotRequired
    : provider.consentAcknowledged ? strings.providerConsentReady : strings.providerConsentNeeded;
  setChildText(card, '.provider-consent span', consentText);
  const consentButton = card.querySelector<HTMLButtonElement>('[data-consent]');
  if (consentButton) {
    consentButton.hidden = !provider.consentRequired;
    consentButton.textContent = provider.consentAcknowledged
      ? strings.providerRevokeConsent
      : strings.providerReviewConsent;
  }
}

function createAgentCard(agent: SettingsAgentCard): HTMLElement {
  const card = createElement('article', 'agent-card surface');
  card.tabIndex = -1;
  card.dataset.agentId = agent.id;
  card.setAttribute('aria-labelledby', `agent-${agent.id}-title`);
  const heading = createElement('div', 'card-heading');
  const identity = createElement('div');
  const title = createElement('h3');
  title.id = `agent-${agent.id}-title`;
  title.dir = 'auto';
  const description = createElement('p', 'help agent-description');
  description.dir = 'auto';
  identity.append(title, description);
  heading.append(identity, createElement('span', 'status-badge agent-status'));
  const id = createElement('code', 'command-id agent-id');
  id.dir = 'ltr';

  const fields = createElement('div', 'form-grid');
  fields.append(
    fieldWithSelect(`agent-${agent.id}-provider`, 'agent-provider-label', 'agentProvider', agent.id),
    fieldWithSelect(`agent-${agent.id}-preset`, 'agent-preset-label', 'agentPreset', agent.id),
    fieldWithInput(`agent-${agent.id}-model`, 'agent-model-label', 'agentModel', agent.id),
  );
  const flags = createElement('div', 'mapping-flags agent-flags');
  flags.append(createElement('span', 'status-badge agent-default'), createElement('span', 'status-badge agent-instructions'));
  const actions = createElement('div', 'button-row agent-actions');
  for (const action of ['save-profile', 'set-default', 'toggle-enabled', 'duplicate', 'delete'] as const) {
    const button = createButton('', action === 'delete' ? 'danger' : action === 'save-profile' ? undefined : 'secondary');
    button.dataset.agentAction = action;
    actions.append(button);
  }
  card.append(heading, id, fields, flags, actions);
  return card;
}

function updateAgentCard(
  card: HTMLElement,
  agent: SettingsAgentCard,
  state: SettingsViewState,
  strings: SettingsStrings,
  authoritative: boolean,
): void {
  setChildText(card, 'h3', agent.name);
  setChildText(card, '.agent-description', agent.description);
  setChildText(card, '.agent-id', agent.id);
  setChildText(card, '.agent-status', agent.enabled ? strings.agentEnabled : strings.agentDisabled);
  card.querySelector('.agent-status')?.classList.toggle('ready', agent.enabled);
  card.querySelector('.agent-status')?.classList.toggle('attention', !agent.enabled);
  setChildText(card, '.agent-provider-label', strings.agentProvider);
  setChildText(card, '.agent-preset-label', strings.providerModelPreset);
  setChildText(card, '.agent-model-label', strings.agentModel);
  syncOptions(
    `agent-${agent.id}-provider`,
    includeSelected(
      state.providers.items.map(({ id, name }) => ({ value: id, label: name })),
      agent.provider,
    ),
    agent.provider,
    authoritative,
  );
  const provider = state.providers.items.find(({ id }) => id === agent.provider);
  const presets = provider?.modelPresets ?? [];
  syncOptions(
    `agent-${agent.id}-preset`,
    [{ value: '', label: strings.providerCustomModel }, ...presets.map((model) => ({ value: model, label: model }))],
    presets.includes(agent.model) ? agent.model : '',
    authoritative,
  );
  setInputValue(`agent-${agent.id}-model`, agent.model, authoritative);
  setChildText(card, '.agent-default', agent.isDefault ? strings.agentDefault : '');
  setHidden(card.querySelector<HTMLElement>('.agent-default'), !agent.isDefault);
  setChildText(
    card,
    '.agent-instructions',
    agent.instructionsConfigured ? strings.agentInstructionsConfigured : strings.agentInstructionsEmpty,
  );
  setActionLabel(card, 'save-profile', strings.agentSaveProfile);
  setActionLabel(card, 'set-default', strings.agentMakeDefault);
  setActionLabel(card, 'toggle-enabled', agent.enabled ? strings.agentDisable : strings.agentEnable);
  setActionLabel(card, 'duplicate', strings.agentDuplicate);
  setActionLabel(card, 'delete', strings.agentDelete);
  const defaultButton = card.querySelector<HTMLButtonElement>('[data-agent-action="set-default"]');
  if (defaultButton) defaultButton.disabled = agent.isDefault || !agent.enabled;
}

function createProviderPrivacyCard(provider: SettingsProviderCard): HTMLElement {
  const card = createElement('article', 'provider-privacy-card');
  card.dataset.providerId = provider.id;
  const heading = createElement('div', 'card-heading');
  heading.append(createElement('h3'), createElement('span', 'status-badge locality'));
  const host = createElement('code', 'command-id endpoint-host');
  host.dir = 'ltr';
  const consent = createElement('div', 'consent-row');
  consent.append(createElement('span'), createButton('', 'secondary'));
  consent.querySelector('button')!.dataset.consent = provider.id;
  card.append(heading, host, consent);
  return card;
}

function updateProviderPrivacyCard(
  card: HTMLElement,
  provider: SettingsProviderCard,
  strings: SettingsStrings,
): void {
  setChildText(card, 'h3', provider.name);
  setChildText(card, '.locality', provider.locality === 'local-loopback' ? strings.localityLoopback : strings.localityRemote);
  setChildText(card, '.endpoint-host', provider.endpointHost);
  const status = !provider.consentRequired
    ? strings.providerConsentNotRequired
    : provider.consentAcknowledged ? strings.providerConsentReady : strings.providerConsentNeeded;
  setChildText(card, '.consent-row span', status);
  const button = card.querySelector<HTMLButtonElement>('[data-consent]');
  if (button) {
    button.hidden = !provider.consentRequired;
    button.textContent = provider.consentAcknowledged ? strings.providerRevokeConsent : strings.providerReviewConsent;
  }
}

function updateKeyedList<T>(
  listId: string,
  selector: string,
  items: readonly T[],
  key: (item: T) => string,
  create: (item: T) => HTMLElement,
  update: (card: HTMLElement, item: T) => void,
  emptyText: string,
): void {
  const list = byId(listId);
  if (!list) return;
  const existing = new Map(
    Array.from(list.querySelectorAll<HTMLElement>(selector)).map((card) => [
      card.dataset.providerId ?? card.dataset.agentId ?? '',
      card,
    ]),
  );
  let cursor: ChildNode | null = list.firstChild;
  for (const item of items) {
    const id = key(item);
    const card = existing.get(id) ?? create(item);
    existing.delete(id);
    update(card, item);
    if (card === cursor) cursor = cursor.nextSibling;
    else {
      list.insertBefore(card, cursor);
      cursor = card.nextSibling;
    }
  }
  for (const card of existing.values()) card.remove();
  list.querySelector('.resource-empty')?.remove();
  if (items.length === 0) {
    const empty = createElement('p', 'help resource-empty');
    empty.textContent = emptyText;
    list.append(empty);
  }
}

function fieldWithSelect(
  id: string,
  labelClass: string,
  dataName: 'providerPreset' | 'agentProvider' | 'agentPreset',
  dataValue: string,
): HTMLDivElement {
  const field = createElement('div', 'field');
  const label = createElement('label', labelClass);
  label.htmlFor = id;
  const select = createElement('select');
  select.id = id;
  select.dataset[dataName] = dataValue;
  field.append(label, select);
  return field;
}

function fieldWithInput(
  id: string,
  labelClass: string,
  dataName: 'providerModel' | 'agentModel',
  dataValue: string,
): HTMLDivElement {
  const field = createElement('div', 'field');
  const label = createElement('label', labelClass);
  label.htmlFor = id;
  const input = createElement('input');
  input.id = id;
  input.type = 'text';
  input.maxLength = 128;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.dir = 'ltr';
  input.dataset[dataName] = dataValue;
  field.append(label, input);
  return field;
}

function detailRow(kind: 'endpoint' | 'locality'): HTMLDivElement {
  const row = createElement('div');
  row.dataset.detail = kind;
  row.append(createElement('dt'), createElement('dd'));
  return row;
}

function providerTestText(provider: SettingsProviderCard, strings: SettingsStrings): string {
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

function setChildText(root: HTMLElement, selector: string, value: string): void {
  const element = root.querySelector<HTMLElement>(selector);
  if (element && element.textContent !== value) element.textContent = value;
}

function setActionLabel(root: HTMLElement, action: string, label: string): void {
  setChildText(root, `[data-agent-action="${action}"]`, label);
}

export function providerForAgentSelection(
  state: SettingsViewState,
  provider: string,
): SettingsProviderCard | undefined {
  return state.providers.items.find(({ id }) => id === provider as PlannerProviderId);
}
