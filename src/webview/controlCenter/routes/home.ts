import type { ControlCenterHostMessage } from '../contracts';
import { element, labelledButton, sectionCard } from '../dom';
import type { ControlCenterStrings } from '../i18n';
import type { SystemSpeechPresentation } from '../systemSpeech';
import { renderSetupWorkflow } from './setup';

export function renderHomeRoute(
  container: HTMLElement,
  snapshot: Extract<ControlCenterHostMessage, { type: 'stateSnapshot' }>,
  strings: ControlCenterStrings,
  setupState: Extract<ControlCenterHostMessage, { type: 'setupState' }> | undefined,
  systemSpeech: SystemSpeechPresentation,
): void {
  const summary = sectionCard(strings.status, providerLabel(snapshot, strings));
  if (snapshot.state.effectiveAutoMode) {
    const disable = labelledButton(strings.disableAuto, 'disable-auto', 'button danger');
    disable.id = 'home-auto-kill';
    summary.append(disable);
  }
  let pending: HTMLElement | undefined;
  if (snapshot.state.pendingReview) {
    pending = sectionCard(strings.pendingReview, snapshot.state.pendingReview.displayLabel);
    const review = labelledButton(strings.review, 'preview-pending-action');
    review.id = 'pending-review';
    pending.append(review);
  }
  const setup = renderSetupWorkflow(snapshot, setupState, systemSpeech, strings);
  const localStatus = element('p', { className: 'callout neutral', text: strings.localPending });
  container.replaceChildren(summary, ...(pending ? [pending] : []), setup, localStatus);
}

function providerLabel(
  snapshot: Extract<ControlCenterHostMessage, { type: 'stateSnapshot' }>,
  strings: ControlCenterStrings,
): string {
  if (snapshot.capabilities.sttProvider === 'soniox' && snapshot.capabilities.sttState === 'ready') {
    return strings.sonioxConfigured;
  }
  if (snapshot.capabilities.systemTtsState === 'ready'
    || snapshot.capabilities.systemTtsState === 'configured-unverified') return strings.systemVoice;
  if (snapshot.capabilities.systemTtsState === 'unavailable') return strings.systemVoiceUnavailable;
  return strings.notConfigured;
}
