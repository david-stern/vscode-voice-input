import type { ControlCenterFocusTarget } from './contracts';
import type { ControlCenterShell } from './shell';

export interface ControlCenterFocusBookmark {
  id?: string;
  action?: string;
  commandId?: string;
  customCommandId?: string;
}

export function focusControlCenterTarget(
  shell: ControlCenterShell,
  target: ControlCenterFocusTarget | undefined,
): HTMLElement {
  const resolved = resolveTarget(shell, target) ?? shell.heading;
  if (!resolved.hasAttribute('tabindex') && !isNaturallyFocusable(resolved)) resolved.tabIndex = -1;
  resolved.focus({ preventScroll: true });
  resolved.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
  return resolved;
}

export function captureFocusBookmark(): ControlCenterFocusBookmark {
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  if (!active || active === document.body) return {};
  const command = active.closest<HTMLElement>('[data-command-id]')?.dataset.commandId;
  const custom = active.closest<HTMLElement>('[data-custom-command-id]')?.dataset.customCommandId;
  return {
    ...(active.id ? { id: active.id } : {}),
    ...(active.dataset.action ? { action: active.dataset.action } : {}),
    ...(command ? { commandId: command } : {}),
    ...(custom ? { customCommandId: custom } : {}),
  };
}

export function restoreFocusBookmark(bookmark: ControlCenterFocusBookmark): boolean {
  const byId = bookmark.id ? document.getElementById(bookmark.id) : undefined;
  if (byId instanceof HTMLElement) return focusIfAvailable(byId);
  if (!bookmark.action) return false;
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(`[data-action="${bookmark.action}"]`));
  const match = candidates.find((candidate) => {
    const command = candidate.closest<HTMLElement>('[data-command-id]')?.dataset.commandId;
    const custom = candidate.closest<HTMLElement>('[data-custom-command-id]')?.dataset.customCommandId;
    return (!bookmark.commandId || command === bookmark.commandId)
      && (!bookmark.customCommandId || custom === bookmark.customCommandId);
  });
  return match ? focusIfAvailable(match) : false;
}

function resolveTarget(
  shell: ControlCenterShell,
  target: ControlCenterFocusTarget | undefined,
): HTMLElement | undefined {
  if (!target || target.kind === 'route-h1') return shell.heading;
  if (target.kind === 'results-heading') {
    return document.getElementById('commands-empty-heading')
      ?? document.getElementById('commands-results-heading')
      ?? shell.heading;
  }
  if (target.kind === 'pending-custom-review') {
    return document.getElementById('pending-custom-review')
      ?? document.getElementById('commands-results-heading')
      ?? shell.heading;
  }
  if (target.kind === 'command-row') {
    for (const row of Array.from(document.querySelectorAll<HTMLElement>('[data-command-id]'))) {
      if (row.dataset.commandId === target.commandId) return row;
    }
    return document.getElementById('commands-results-heading') ?? shell.heading;
  }
  return document.getElementById({
    'auto-badge': 'auto-badge',
    'provider-card': 'provider-card',
    'mic-control': 'mic-control',
    'pending-review': 'pending-review',
  }[target.trigger]) ?? shell.heading;
}

function isNaturallyFocusable(element: HTMLElement): boolean {
  return element instanceof HTMLButtonElement
    || element instanceof HTMLInputElement
    || element instanceof HTMLSelectElement
    || element instanceof HTMLTextAreaElement
    || element instanceof HTMLAnchorElement;
}

function focusIfAvailable(target: HTMLElement): boolean {
  const control = target as HTMLElement & { disabled?: boolean };
  if (!control.isConnected || control.hidden || control.disabled) return false;
  control.focus({ preventScroll: true });
  return document.activeElement === control;
}
