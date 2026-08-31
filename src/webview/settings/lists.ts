import type { SettingsDiagnosticCheck, SettingsMappingCard, SettingsViewState } from './contracts';
import { byId, createButton, createElement } from './dom';
import type { SettingsStrings } from './i18n';

export interface MappingFocusSnapshot {
  id: string;
  index: number;
  action?: string;
}

export interface MappingListUpdatePlan {
  orderedIds: string[];
  removedIds: string[];
  focusId?: string;
  focusAction?: string;
  focusAdd: boolean;
}

/** Preserve storage order and follow an authority-ID rotation at the same index. */
export function planMappingListUpdate(
  currentIds: readonly string[],
  nextIds: readonly string[],
  focus?: MappingFocusSnapshot,
): MappingListUpdatePlan {
  const next = new Set(nextIds);
  const plan: MappingListUpdatePlan = {
    orderedIds: [...nextIds],
    removedIds: currentIds.filter((id) => !next.has(id)),
    focusAdd: false,
  };
  if (!focus) return plan;
  if (next.has(focus.id)) {
    plan.focusId = focus.id;
  } else if (nextIds.length > 0) {
    plan.focusId = nextIds[Math.min(focus.index, nextIds.length - 1)];
  } else {
    plan.focusAdd = true;
  }
  plan.focusAction = focus.action;
  return plan;
}

export function updateMappingList(state: SettingsViewState, strings: SettingsStrings): void {
  const list = byId('mapping-list');
  if (!list) return;
  const cards = Array.from(list.querySelectorAll<HTMLElement>('.mapping-card[data-mapping-id]'));
  const focus = captureMappingFocus(cards);
  const plan = planMappingListUpdate(
    cards.map((card) => card.dataset.mappingId ?? ''),
    state.mappings.items.map((item) => item.id),
    focus,
  );
  for (const id of plan.removedIds) list.querySelector<HTMLElement>(mappingSelector(id))?.remove();
  const mappings = new Map(state.mappings.items.map((mapping) => [mapping.id, mapping]));
  for (const id of plan.orderedIds) {
    const mapping = mappings.get(id);
    if (!mapping) continue;
    let card = list.querySelector<HTMLElement>(mappingSelector(mapping.id));
    if (!card) {
      card = createMappingCard(mapping.id);
    }
    updateMappingCard(card, mapping, strings);
    list.append(card);
  }
  restoreMappingFocus(list, plan);
}

export function mappingTextDirection(
  field: 'label' | 'description' | 'phrases' | 'target',
): 'auto' | 'ltr' {
  return field === 'target' ? 'ltr' : 'auto';
}

export function updateDiagnosticsList(
  checks: readonly SettingsDiagnosticCheck[],
  strings: SettingsStrings,
): void {
  const list = byId('diagnostics-checks');
  if (!list) return;
  const fragment = document.createDocumentFragment();
  for (const check of checks) {
    const row = createElement('div', 'diagnostic-check');
    const label = createElement('span');
    label.textContent = diagnosticLabel(check.id, strings);
    const status = createElement('span', check.status);
    status.textContent = diagnosticStatus(check.status, strings);
    row.append(label, status);
    fragment.append(row);
  }
  list.replaceChildren(fragment);
}

export function updateWorkspaceOverrides(state: SettingsViewState, strings: SettingsStrings): void {
  const list = byId('workspace-overrides');
  if (!list) return;
  if (state.general.workspaceOverrides.length === 0) {
    const empty = createElement('p', 'help');
    empty.textContent = strings.noOverrides;
    list.replaceChildren(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const override of state.general.workspaceOverrides) {
    const card = createElement('div', 'override');
    const title = createElement('strong');
    title.textContent = settingLabel(override.setting, strings);
    const source = createElement('p', 'help');
    source.textContent = override.source === 'workspace-folder'
      ? strings.workspaceFolderOverride
      : strings.workspaceOverride;
    const values = createElement('dl');
    values.append(
      definition(strings.globalValue, override.globalValue),
      definition(strings.effectiveValue, override.effectiveValue),
    );
    card.append(title, source, values);
    fragment.append(card);
  }
  list.replaceChildren(fragment);
}

export function updateInlineOverrides(state: SettingsViewState, strings: SettingsStrings): void {
  for (const setting of [
    'uiLanguage', 'languageHint', 'sttModel', 'historyTtlDays', 'injectionMode',
    'assistantWakePhrase', 'assistantPersona', 'assistantIntelligence', 'deepSeekModel',
    'assistantSpeechEnabled', 'assistantSpeechVoiceUri', 'assistantSpeechRate', 'audioDevice',
  ] as const) {
    const box = byId(`override-${setting}`);
    if (!box) continue;
    const override = state.general.workspaceOverrides.find((item) => item.setting === setting);
    box.hidden = !override;
    if (!override) {
      box.replaceChildren();
      continue;
    }
    const description = createElement('div');
    description.textContent = override.source === 'workspace-folder'
      ? strings.workspaceFolderOverride
      : strings.workspaceOverride;
    const values = createElement('dl');
    values.append(
      definition(strings.globalValue, override.globalValue),
      definition(strings.effectiveValue, override.effectiveValue),
    );
    box.replaceChildren(description, values);
  }
}

function createMappingCard(id: string): HTMLElement {
  const card = createElement('article', 'mapping-card');
  card.tabIndex = -1;
  card.dataset.mappingId = id;
  const heading = createElement('div', 'mapping-heading');
  const label = createElement('h3', 'mapping-label');
  label.dir = mappingTextDirection('label');
  heading.append(label, createElement('span', 'mapping-kind'));
  const description = createElement('p', 'mapping-description');
  description.dir = mappingTextDirection('description');
  const details = createElement('dl', 'mapping-details');
  details.append(detailRow('phrases'), detailRow('target'));
  const flags = createElement('div', 'mapping-flags');
  flags.append(
    createElement('span', 'status-badge mapping-enabled'),
    createElement('span', 'status-badge mapping-agent'),
    createElement('span', 'status-badge mapping-approval'),
  );
  const actions = createElement('div', 'button-row mapping-actions');
  for (const action of ['edit', 'toggle-enabled', 'toggle-agent', 'grant-approval', 'revoke-approval', 'delete']) {
    const button = createButton('');
    button.dataset.mappingAction = action;
    if (action === 'delete') button.className = 'danger';
    actions.append(button);
  }
  card.append(heading, description, details, flags, actions);
  return card;
}

function updateMappingCard(card: HTMLElement, mapping: SettingsMappingCard, strings: SettingsStrings): void {
  card.dataset.mappingId = mapping.id;
  setChildText(card, '.mapping-label', mapping.label);
  setChildText(card, '.mapping-kind', mapping.kind === 'command' ? strings.mappingCommand : strings.mappingTool);
  setChildText(card, '.mapping-description', mapping.description);
  setChildText(card, '[data-detail="phrases"] dt', strings.mappingPhrases);
  setChildText(card, '[data-detail="phrases"] dd', mapping.phrases.join(' · '));
  const phrases = card.querySelector<HTMLElement>('[data-detail="phrases"] dd');
  if (phrases) phrases.dir = mappingTextDirection('phrases');
  setChildText(card, '[data-detail="target"] dt', strings.mappingTarget);
  setChildText(card, '[data-detail="target"] dd', mapping.targetId);
  const target = card.querySelector<HTMLElement>('[data-detail="target"] dd');
  if (target) target.dir = mappingTextDirection('target');
  setChildText(card, '.mapping-enabled', mapping.enabled ? strings.mappingEnabled : strings.mappingDisabled);
  setChildText(card, '.mapping-agent', mapping.agentEnabled ? strings.mappingAgentOn : strings.mappingAgentOff);
  setChildText(card, '.mapping-approval', mapping.permissionTier === 'always-approved'
    ? strings.approvalAlways
    : strings.approvalConfirmation);
  setActionLabel(card, 'edit', strings.mappingEdit);
  setActionLabel(card, 'toggle-enabled', mapping.enabled ? strings.mappingDisable : strings.mappingEnable);
  setActionLabel(card, 'toggle-agent', mapping.agentEnabled ? strings.mappingAgentDisable : strings.mappingAgentEnable);
  setActionLabel(card, 'grant-approval', strings.mappingGrantApproval);
  setActionLabel(card, 'revoke-approval', strings.mappingRevokeApproval);
  const grant = card.querySelector<HTMLButtonElement>('[data-mapping-action="grant-approval"]');
  const revoke = card.querySelector<HTMLButtonElement>('[data-mapping-action="revoke-approval"]');
  if (grant) grant.hidden = mapping.approval === 'approved';
  if (revoke) revoke.hidden = mapping.approval !== 'approved';
  setActionLabel(card, 'delete', strings.mappingDelete);
}

function detailRow(kind: 'phrases' | 'target'): HTMLDivElement {
  const row = createElement('div');
  row.dataset.detail = kind;
  row.append(createElement('dt'), createElement('dd'));
  return row;
}

function definition(label: string, value: string | number | boolean): HTMLDivElement {
  const row = createElement('div');
  const term = createElement('dt');
  const description = createElement('dd');
  term.textContent = label;
  description.textContent = String(value);
  description.dir = 'auto';
  row.append(term, description);
  return row;
}

function setChildText(root: HTMLElement, selector: string, value: string): void {
  const element = root.querySelector<HTMLElement>(selector);
  if (element && element.textContent !== value) element.textContent = value;
}

function setActionLabel(card: HTMLElement, action: string, label: string): void {
  setChildText(card, `[data-mapping-action="${action}"]`, label);
}

function mappingSelector(id: string): string {
  return `.mapping-card[data-mapping-id="${CSS.escape(id)}"]`;
}

function captureMappingFocus(cards: readonly HTMLElement[]): MappingFocusSnapshot | undefined {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return undefined;
  const card = active.closest<HTMLElement>('.mapping-card[data-mapping-id]');
  if (!card) return undefined;
  const index = cards.indexOf(card);
  if (index < 0) return undefined;
  return {
    id: card.dataset.mappingId ?? '',
    index,
    action: active.closest<HTMLElement>('[data-mapping-action]')?.dataset.mappingAction,
  };
}

function restoreMappingFocus(list: HTMLElement, plan: MappingListUpdatePlan): void {
  if (!plan.focusId) {
    if (plan.focusAdd) byId<HTMLButtonElement>('mapping-add')?.focus({ preventScroll: true });
    return;
  }
  const card = list.querySelector<HTMLElement>(mappingSelector(plan.focusId));
  const action = plan.focusAction
    ? card?.querySelector<HTMLElement>(`[data-mapping-action="${plan.focusAction}"]`)
    : undefined;
  (action ?? card)?.focus({ preventScroll: true });
}

function diagnosticLabel(id: SettingsDiagnosticCheck['id'], strings: SettingsStrings): string {
  const labels = {
    extension: strings.diagnosticExtension,
    soniox: strings.diagnosticSoniox,
    deepseek: strings.diagnosticDeepSeek,
    microphone: strings.diagnosticMicrophone,
    'paste-helper': strings.diagnosticPasteHelper,
    'workspace-trust': strings.diagnosticWorkspaceTrust,
  };
  return labels[id];
}

function diagnosticStatus(status: SettingsDiagnosticCheck['status'], strings: SettingsStrings): string {
  return {
    ok: strings.diagnosticOk,
    attention: strings.diagnosticNeedsAttention,
    unavailable: strings.diagnosticUnavailable,
    unknown: strings.diagnosticUnknown,
  }[status];
}

function settingLabel(setting: string, strings: SettingsStrings): string {
  const labels: Readonly<Record<string, string>> = {
    uiLanguage: strings.uiLanguage, languageHint: strings.transcriptionLanguage,
    sttModel: strings.transcriptionModel, historyTtlDays: strings.historyRetention,
    injectionMode: strings.insertionMode, assistantWakePhrase: strings.wakePhrase,
    assistantPersona: strings.persona, assistantIntelligence: strings.intelligenceMode,
    deepSeekModel: strings.deepseekModel, assistantSpeechEnabled: strings.speechEnabled,
    assistantSpeechVoiceUri: strings.speechVoice, assistantSpeechRate: strings.speechRate,
    audioDevice: strings.microphoneDevice,
  };
  return labels[setting] ?? setting;
}
