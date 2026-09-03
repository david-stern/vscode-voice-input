import type { ControlCenterBrowserMessage } from '../../webview/controlCenter/contracts';

/** Every browser message that asks for work; the `ready`/`ack` handshake is gated separately. */
export type ControlCenterIntentMessage = Exclude<
  ControlCenterBrowserMessage,
  { type: 'ready' | 'ack' }
>;

export type ControlCenterIntentTier = 'lenient' | 'strict';

export type ControlCenterIntentDecision =
  | { accepted: true; tier: ControlCenterIntentTier }
  | { accepted: false; reason: 'stale-revision' | 'stale-revision-strict' };

/**
 * How many delivered revisions stay acceptable for lenient intents. The host republishes on
 * every observable state change (detached operation completions, voice observations, status
 * refreshes), so a real click can only ever trail the current revision by the handful of
 * snapshots that raced its round trip. Eight bounds that race without becoming a replay window.
 */
export const CONTROL_CENTER_RECENT_REVISION_LIMIT = 8;

/**
 * Lenient intents are navigation, presentation, observation, or local-device actions: acting on
 * a slightly stale view is harmless because the host re-resolves current state before it acts,
 * and rejecting them silently swallowed clicks made while a snapshot was in flight.
 * Strict intents mutate authority, credentials, agents, or custom commands, or confirm a pending
 * voice action, so the user must have seen the latest rendered state before they can land.
 */
const INTENT_TIERS: Record<
  ControlCenterIntentMessage['type'],
  ControlCenterIntentTier | 'by-operation'
> = {
  navigateIntent: 'lenient',
  setFilterIntent: 'lenient',
  setPageIntent: 'lenient',
  setManagementPageIntent: 'lenient',
  // Overlay open/close change no host state at all; the host handler is a no-op.
  openOverlayIntent: 'lenient',
  closeOverlayIntent: 'lenient',
  // Opening the review only re-renders the current pending state; deciding it is strict below.
  openPendingReviewIntent: 'lenient',
  systemTtsVoicesObservedIntent: 'lenient',
  micIntent: 'lenient',
  microphoneSetupIntent: 'lenient',
  diagnosticsIntent: 'lenient',
  // Enable/rate/voice writes are user-visible toggles whose slightly stale view is harmless,
  // and preview/preview-stop are host-composed local playback.
  systemTtsIntent: 'lenient',
  // 'open' is a read-only detail request; 'reset'/'set-enabled'/'replace-phrases' mutate.
  commandEditIntent: 'by-operation',
  pendingReviewIntent: 'strict',
  requestAutoEnableIntent: 'strict',
  disableAutoIntent: 'strict',
  providerSetupIntent: 'strict',
  planningProviderIntent: 'strict',
  agentManagementIntent: 'strict',
  customCommandIntent: 'strict',
};

export function classifyControlCenterIntent(
  message: ControlCenterIntentMessage,
): ControlCenterIntentTier {
  const tier: ControlCenterIntentTier | 'by-operation' | undefined = INTENT_TIERS[message.type];
  if (tier === undefined) return 'strict';
  if (tier !== 'by-operation') return tier;
  return message.type === 'commandEditIntent' && message.operation === 'open'
    ? 'lenient'
    : 'strict';
}

/**
 * Bounded FIFO of the revisions one panel attachment actually delivered to its webview.
 * A revision that was never delivered is never in here, so it can never be accepted, and a
 * new attachment starts empty so a previous panel's revisions cannot be replayed into it.
 */
export class ControlCenterRevisionWindow {
  private readonly delivered: number[] = [];

  record(revision: number): void {
    this.delivered.push(revision);
    if (this.delivered.length > CONTROL_CENTER_RECENT_REVISION_LIMIT) this.delivered.shift();
  }

  has(revision: number): boolean { return this.delivered.includes(revision); }

  clear(): void { this.delivered.length = 0; }

  get size(): number { return this.delivered.length; }
}

export interface ControlCenterRevisionGate {
  readonly currentRevision: number;
  /** Last revision actually delivered; a never-sent revision is never accepted. */
  readonly sentRevision: number | undefined;
  readonly recentRevisions: Pick<ControlCenterRevisionWindow, 'has'>;
}

export function evaluateControlCenterIntent(
  message: ControlCenterIntentMessage,
  gate: ControlCenterRevisionGate,
): ControlCenterIntentDecision {
  const tier = classifyControlCenterIntent(message);
  if (message.revision === gate.currentRevision && gate.sentRevision === gate.currentRevision) {
    return { accepted: true, tier };
  }
  // Not the latest snapshot: only revisions this attachment really rendered stay eligible.
  if (!gate.recentRevisions.has(message.revision)) return { accepted: false, reason: 'stale-revision' };
  return tier === 'lenient'
    ? { accepted: true, tier }
    : { accepted: false, reason: 'stale-revision-strict' };
}
