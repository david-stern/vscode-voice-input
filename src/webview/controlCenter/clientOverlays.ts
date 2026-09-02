import {
  CONTROL_CENTER_ROUTES,
  type ControlCenterBrowserMessage,
  type ControlCenterHostMessage,
} from './contracts';
import { parsePhraseLines } from './customCommands';
import { element, labelledButton, mixedText } from './dom';
import { CONTROL_CENTER_STRINGS } from './i18n';
import type { OverlayController } from './overlay';

type Snapshot = Extract<ControlCenterHostMessage, { type: 'stateSnapshot' }>;
type CommandDetails = Extract<ControlCenterHostMessage, { type: 'commandDetails' }>;
type PostMessage = (message: ControlCenterBrowserMessage) => void;
type CloseOverlay = (
  reason: 'close' | 'escape' | 'cancel' | 'save',
  returnFocus: boolean,
) => void;
type DecidePending = (decision: 'request-native-confirmation' | 'cancel') => void;

export function openNavigationOverlay(
  snapshot: Snapshot,
  overlay: OverlayController | undefined,
  trigger: HTMLElement,
  post: PostMessage,
): void {
  if (!overlay) return;
  const strings = CONTROL_CENTER_STRINGS[snapshot.state.language];
  trigger.setAttribute('aria-expanded', 'true');
  post({ type: 'openOverlayIntent', revision: snapshot.revision, kind: 'narrow-nav' });
  overlay.open({
    kind: 'narrow-nav', title: strings.menu, trigger, closeLabel: strings.close,
    initialFocus: 'current-route',
    renderBody: (body) => {
      const nav = element('nav', { className: 'drawer-navigation' });
      nav.setAttribute('aria-label', strings.product);
      for (const route of CONTROL_CENTER_ROUTES) {
        const button = labelledButton(strings.routes[route].title, 'navigate', 'nav-item');
        button.dataset.route = route;
        if (route === snapshot.state.route) button.setAttribute('aria-current', 'page');
        nav.append(button);
      }
      body.append(nav);
    },
  });
}

export function openAutoExplanationOverlay(
  snapshot: Snapshot,
  overlay: OverlayController | undefined,
  trigger: HTMLElement,
  post: PostMessage,
  closeOverlay: CloseOverlay,
): void {
  if (!overlay) return;
  const revision = snapshot.revision;
  const strings = CONTROL_CENTER_STRINGS[snapshot.state.language];
  post({ type: 'openOverlayIntent', revision, kind: 'auto-explanation' });
  overlay.open({
    kind: 'auto-explanation', title: strings.enableAuto, description: strings.autoWarning,
    trigger, closeLabel: strings.close,
    renderBody: (_body, footer) => {
      const cancel = labelledButton(strings.cancel, 'overlay-cancel', 'button secondary');
      const proceed = labelledButton(strings.continueNative, 'native-auto-confirm');
      cancel.addEventListener('click', () => closeOverlay('cancel', true));
      proceed.addEventListener('click', () => {
        overlay.closeForNativePrompt();
        post({ type: 'requestAutoEnableIntent', revision });
      });
      footer.append(cancel, proceed);
      queueMicrotask(() => cancel.focus());
    },
  });
}

export function openActionPreviewOverlay(
  snapshot: Snapshot,
  overlay: OverlayController | undefined,
  trigger: HTMLElement,
  post: PostMessage,
  closeOverlay: CloseOverlay,
  decidePending: DecidePending,
): void {
  if (!snapshot.state.pendingReview || !overlay) return;
  const revision = snapshot.revision;
  const pending = snapshot.state.pendingReview;
  const strings = CONTROL_CENTER_STRINGS[snapshot.state.language];
  post({ type: 'openOverlayIntent', revision, kind: 'action-preview' });
  overlay.open({
    kind: 'action-preview', title: strings.actionPreviewTitle,
    description: strings.actionPreviewWarning, trigger, closeLabel: strings.close,
    renderBody: (body, footer) => {
      const summary = element('p');
      summary.append(mixedText(pending.displayLabel));
      const keep = labelledButton(strings.keepPending, 'keep-pending', 'button secondary');
      const cancel = labelledButton(strings.cancelPendingAction, 'cancel-pending-action', 'button danger');
      const confirm = labelledButton(strings.confirmPendingNative, 'confirm-pending-native');
      keep.addEventListener('click', () => closeOverlay('cancel', true));
      cancel.addEventListener('click', () => decidePending('cancel'));
      confirm.addEventListener('click', () => decidePending('request-native-confirmation'));
      body.append(summary);
      footer.append(keep, cancel, confirm);
      queueMicrotask(() => keep.focus());
    },
  });
}

export function openProviderDetailsOverlay(
  snapshot: Snapshot,
  overlay: OverlayController | undefined,
  trigger: HTMLElement,
  post: PostMessage,
): void {
  if (!overlay) return;
  const strings = CONTROL_CENTER_STRINGS[snapshot.state.language];
  post({ type: 'openOverlayIntent', revision: snapshot.revision, kind: 'provider-details' });
  overlay.open({
    kind: 'provider-details', title: strings.providerDetails,
    description: snapshot.capabilities.sttProvider === 'soniox' ? strings.sonioxConfigured : strings.notConfigured,
    trigger, closeLabel: strings.close, initialFocus: 'heading',
    renderBody: (body) => body.append(element('p', {
      className: 'muted', text: strings.credentialsNative,
    })),
  });
}

export function openCommandLoadingOverlay(
  snapshot: Snapshot,
  overlay: OverlayController | undefined,
  trigger: HTMLElement,
  commandId: string,
  requestSequence: number,
  post: PostMessage,
): void {
  if (!overlay) return;
  const strings = CONTROL_CENTER_STRINGS[snapshot.state.language];
  post({ type: 'openOverlayIntent', revision: snapshot.revision, kind: 'command-details' });
  post({
    type: 'commandEditIntent', revision: snapshot.revision, commandId,
    operation: 'open', requestSequence,
  });
  overlay.open({
    kind: 'command-details', title: strings.edit, description: commandId,
    trigger, closeLabel: strings.close, initialFocus: 'heading',
    renderBody: (body) => body.append(element('p', { className: 'muted', text: strings.loading })),
  });
}

export function showCommandDetailsOverlay(
  snapshot: Snapshot | undefined,
  overlay: OverlayController | undefined,
  message: CommandDetails,
  pendingCommandId: string | undefined,
  fallbackTrigger: HTMLElement | undefined,
  post: PostMessage,
): void {
  if (!snapshot || message.revision !== snapshot.revision || !overlay
    || overlay.activeKind !== 'command-details' || pendingCommandId !== message.commandId) return;
  const trigger = Array.from(document.querySelectorAll<HTMLElement>('[data-command-id]'))
    .find((row) => row.dataset.commandId === message.commandId)
    ?.querySelector<HTMLElement>('[data-action="edit-command"]') ?? fallbackTrigger;
  if (!trigger) return;
  const strings = CONTROL_CENTER_STRINGS[snapshot.state.language];
  overlay.open({
    kind: 'command-details', title: `${strings.edit}: ${message.commandId}`,
    description: message.slotSummary, trigger, closeLabel: strings.close, initialFocus: 'heading',
    renderBody: (body, footer) => renderCommandDetails(body, footer, message, strings, post),
  });
}

function renderCommandDetails(
  body: HTMLElement,
  footer: HTMLElement,
  message: CommandDetails,
  strings: (typeof CONTROL_CENTER_STRINGS)['en'],
  post: PostMessage,
): void {
  const form = element('form', { className: 'management-form' });
  const enabledLabel = element('label', { className: 'check-filter' });
  const enabled = element('input', { id: `command-enabled-${message.commandId}` });
  enabled.type = 'checkbox';
  enabled.checked = message.enabled;
  enabled.addEventListener('change', () => post({
    type: 'commandEditIntent', revision: message.revision, commandId: message.commandId,
    operation: 'set-enabled', value: enabled.checked,
  }));
  enabledLabel.append(enabled, element('span', { text: strings.enabled }));
  const label = element('label', { className: 'field' });
  label.append(element('span', { text: strings.customPhrases }));
  const phrases = element('textarea', { id: `command-phrases-${message.commandId}` });
  phrases.value = message.phrases.join('\n');
  phrases.dir = 'auto';
  phrases.setAttribute('aria-describedby', `command-phrases-error-${message.commandId}`);
  label.append(phrases);
  const error = element('p', { id: `command-phrases-error-${message.commandId}`,
    className: 'form-error', text: strings.phrasesRequired });
  error.hidden = true;
  error.tabIndex = -1;
  const executor = element('p', { className: 'muted', text: message.executorLabel });
  const save = labelledButton(strings.save, 'save-command-phrases');
  save.type = 'submit';
  const reset = labelledButton(strings.resetDefault, 'reset-command', 'button secondary');
  reset.addEventListener('click', () => post({
    type: 'commandEditIntent', revision: message.revision, commandId: message.commandId, operation: 'reset',
  }));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = parsePhraseLines(phrases.value);
    if (!value) {
      phrases.setAttribute('aria-invalid', 'true');
      error.hidden = false;
      error.focus();
      return;
    }
    phrases.removeAttribute('aria-invalid');
    error.hidden = true;
    post({
      type: 'commandEditIntent', revision: message.revision,
      commandId: message.commandId, operation: 'replace-phrases', value,
    });
  });
  form.append(enabledLabel, label, error, executor, save);
  body.append(form);
  footer.append(reset);
}
