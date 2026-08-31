import type { Strings, UiLang } from '../i18n';
import type { HistoryEntry } from '../protocol';
import { formatHistoryTime, languageFlag } from './renderHelpers';

export interface HistoryFocusSnapshot {
  id: string;
  index: number;
  action?: 'copy' | 'remove';
}

export interface HistoryReconciliationPlan {
  orderedIds: string[];
  removedIds: string[];
  focusId?: string;
  focusAction?: 'copy' | 'remove';
  focusHeading: boolean;
}

/** Reconciles keyed history rows without replacing focused DOM nodes. */
export function patchHistory(
  root: HTMLElement,
  entries: readonly HistoryEntry[],
  uiLang: UiLang,
  strings: Strings,
): void {
  setText(root, 'history-heading-label', strings.history);
  setText(root, 'history-count', String(entries.length));
  setText(root, 'history-empty', strings.noHistory);
  setHidden(root, 'history-empty', entries.length !== 0);
  const clear = byId<HTMLButtonElement>(root, 'clear-all');
  if (clear) {
    clear.disabled = entries.length === 0;
    clear.textContent = strings.clearAll;
    clear.setAttribute('aria-label', strings.clearAll);
  }
  const history = byId(root, 'history');
  if (!history) return;

  const rows = Array.from(history.querySelectorAll<HTMLElement>('.entry[data-id]'));
  const focus = captureHistoryFocus(rows);
  const plan = planHistoryReconciliation(
    rows.map((row) => row.dataset.id ?? ''),
    entries.map((entry) => entry.id),
    focus,
  );
  const existing = new Map(rows.map((row) => [row.dataset.id ?? '', row]));
  let cursor: ChildNode | null = history.firstChild;
  for (const entry of entries) {
    const row = existing.get(entry.id) ?? createHistoryEntry(entry.id);
    existing.delete(entry.id);
    patchHistoryEntry(row, entry, uiLang, strings);
    if (row === cursor) cursor = cursor.nextSibling;
    else {
      history.insertBefore(row, cursor);
      cursor = row.nextSibling;
    }
  }
  for (const row of existing.values()) row.remove();
  restoreHistoryFocus(root, history, plan, focus);
}

/** Keeps keyed focus and chooses a deterministic fallback when its row is removed. */
export function planHistoryReconciliation(
  currentIds: readonly string[],
  nextIds: readonly string[],
  focus?: HistoryFocusSnapshot,
): HistoryReconciliationPlan {
  const next = new Set(nextIds);
  const plan: HistoryReconciliationPlan = {
    orderedIds: [...nextIds],
    removedIds: currentIds.filter((id) => !next.has(id)),
    focusHeading: false,
  };
  if (!focus) return plan;
  if (next.has(focus.id)) {
    plan.focusId = focus.id;
    plan.focusAction = focus.action;
    return plan;
  }
  if (nextIds.length === 0) {
    plan.focusHeading = true;
    return plan;
  }
  plan.focusId = nextIds[Math.min(focus.index, nextIds.length - 1)];
  plan.focusAction = focus.action;
  return plan;
}

export function setHistoryActionLabel(button: HTMLButtonElement, label: string): void {
  button.setAttribute('aria-label', label);
  button.title = label;
  const visible = button.querySelector<HTMLElement>('.history-action-label');
  if (visible) visible.textContent = label;
}

function createHistoryEntry(id: string): HTMLElement {
  const row = document.createElement('article');
  row.className = 'entry';
  row.dataset.id = id;
  const text = document.createElement('div');
  text.className = 'entry-text';
  text.dir = 'auto';
  const meta = document.createElement('div');
  meta.className = 'entry-meta';
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.dir = 'ltr';
  const timestamp = document.createElement('span');
  timestamp.className = 'ts';
  meta.append(
    badge,
    timestamp,
    createHistoryAction('copy', copyPath),
    createHistoryAction('remove', removePath),
  );
  row.append(text, meta);
  return row;
}

function createHistoryAction(
  action: 'copy' | 'remove',
  pathData: string,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = action === 'remove' ? 'history-action danger' : 'history-action';
  button.type = 'button';
  button.dataset.act = action;
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('width', '14');
  icon.setAttribute('height', '14');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('fill', 'currentColor');
  icon.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', pathData);
  icon.append(path);
  const label = document.createElement('span');
  label.className = 'history-action-label';
  button.append(icon, label);
  return button;
}

function patchHistoryEntry(
  row: HTMLElement,
  entry: HistoryEntry,
  uiLang: UiLang,
  strings: Strings,
): void {
  row.dataset.id = entry.id;
  const text = row.querySelector<HTMLElement>('.entry-text');
  if (text) {
    text.textContent = entry.text;
    text.lang = entry.lang;
  }
  const badge = row.querySelector<HTMLElement>('.badge');
  if (badge) badge.textContent = languageFlag(entry.lang);
  const timestamp = row.querySelector<HTMLElement>('.ts');
  if (timestamp) timestamp.textContent = formatHistoryTime(entry.ts, uiLang);
  const copy = row.querySelector<HTMLButtonElement>('[data-act="copy"]');
  if (copy) {
    copy.dataset.id = entry.id;
    copy.dataset.defaultLabel = strings.copy;
    setHistoryActionLabel(copy, copy.dataset.feedbackActive === 'true' ? strings.copied : strings.copy);
  }
  const remove = row.querySelector<HTMLButtonElement>('[data-act="remove"]');
  if (remove) {
    remove.dataset.id = entry.id;
    setHistoryActionLabel(remove, strings.remove);
  }
}

function captureHistoryFocus(rows: readonly HTMLElement[]): HistoryFocusSnapshot | undefined {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return undefined;
  const row = active.closest<HTMLElement>('.entry[data-id]');
  if (!row) return undefined;
  const index = rows.indexOf(row);
  if (index < 0) return undefined;
  const action = active.closest<HTMLButtonElement>('[data-act]')?.dataset.act;
  return {
    id: row.dataset.id ?? '',
    index,
    ...(action === 'copy' || action === 'remove' ? { action } : {}),
  };
}

function restoreHistoryFocus(
  root: HTMLElement,
  history: HTMLElement,
  plan: HistoryReconciliationPlan,
  previous: HistoryFocusSnapshot | undefined,
): void {
  if (!previous) return;
  if (plan.focusHeading) {
    byId<HTMLElement>(root, 'history-heading')?.focus({ preventScroll: true });
    return;
  }
  const row = Array.from(history.querySelectorAll<HTMLElement>('.entry[data-id]'))
    .find((candidate) => candidate.dataset.id === plan.focusId);
  const action = plan.focusAction
    ? row?.querySelector<HTMLButtonElement>(`[data-act="${plan.focusAction}"]`)
    : undefined;
  (action ?? row?.querySelector<HTMLButtonElement>('button'))?.focus({ preventScroll: true });
}

const copyPath = 'M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z';
const removePath = 'M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z';

function byId<T extends HTMLElement = HTMLElement>(root: HTMLElement, id: string): T | null {
  return root.querySelector<T>(`#${id}`);
}

function setText(root: HTMLElement, id: string, value: string): void {
  const element = byId(root, id);
  if (element) element.textContent = value;
}

function setHidden(root: HTMLElement, id: string, hidden: boolean): void {
  const element = byId(root, id);
  if (element) element.hidden = hidden;
}
