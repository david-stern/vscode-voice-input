import type { SettingsViewState } from './contracts';
import { byId, createElement, setText } from './dom';
import type { SettingsStrings } from './i18n';

/** Render only the bounded approval context and opaque decision history. */
export function updateApprovalContext(
  state: SettingsViewState,
  strings: SettingsStrings,
): void {
  const agent = state.agents.items.find(({ id }) => id === state.agents.defaultAgentId);
  const provider = agent
    ? state.providers.items.find(({ id }) => id === agent.provider)
    : state.providers.items.find(({ selected }) => selected);
  setText('approval-active-agent', agent?.name ?? '—');
  setText('approval-active-provider', provider?.name ?? state.providers.selectedProvider);
  setText('approval-active-model', agent?.model ?? provider?.model ?? '—');
  setText('approval-permission-tier', strings.approvalConfirmation);
  updateApprovalHistory(state, strings);
}

function updateApprovalHistory(state: SettingsViewState, strings: SettingsStrings): void {
  const list = byId('approval-history');
  if (!list) return;
  if (state.mappings.approvalHistory.length === 0) {
    const empty = createElement('p', 'help');
    empty.textContent = strings.approvalHistoryEmpty;
    list.replaceChildren(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const entry of [...state.mappings.approvalHistory].reverse()) {
    const row = createElement('div', 'approval-history-entry');
    const decision = createElement('strong');
    decision.textContent = approvalDecision(entry.decision, strings);
    const mapping = createElement('code', 'command-id');
    mapping.dir = 'ltr';
    mapping.textContent = entry.mappingId;
    const time = createElement('time');
    const instant = new Date(entry.timestamp);
    time.dateTime = instant.toISOString();
    time.textContent = new Intl.DateTimeFormat(state.uiLang, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(instant);
    row.append(decision, mapping, time);
    fragment.append(row);
  }
  list.replaceChildren(fragment);
}

function approvalDecision(
  decision: SettingsViewState['mappings']['approvalHistory'][number]['decision'],
  strings: SettingsStrings,
): string {
  return {
    granted: strings.approvalGranted,
    revoked: strings.approvalRevoked,
    'confirmed-execution': strings.approvalConfirmedExecution,
    'always-approved-execution': strings.approvalAutomaticExecution,
  }[decision];
}
