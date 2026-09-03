import type {
  ControlCenterCapabilities,
  ControlCenterDisplayState,
  ControlCenterProjection,
  ControlCenterSetupStepState,
} from '../webview/controlCenter/contracts';
import type { CompactMicState } from '../webview/mic/compactContracts';
import type { ControlCenterSetupChoices } from './controlCenterSetupChoices';

/**
 * Runs one native or long-running Control Center operation off the controller's
 * serialized browser-message queue.
 *
 * A device QuickPick, a native modal, a microphone capture test, or a diagnostics
 * run can take seconds or wait for the user indefinitely. Awaiting one inside the
 * message queue stalls every later click, and publishes made while it runs advance
 * the host revision, so the queued clicks are then rejected as stale and the menu
 * looks frozen. Each such operation therefore runs detached: it is keyed so a
 * repeated click is a contained no-op instead of a second stacked prompt, its
 * failures are contained and logged content-free, and its own completion publish
 * delivers the finished state to the panel.
 */
export class ControlCenterDetachedOperations {
  private readonly running = new Map<string, Promise<void>>();

  constructor(private readonly log: (message: string) => void) {}

  run(key: string, operation: () => unknown): void {
    if (this.running.has(key)) {
      this.log(`Control Center rejected intent: ${key} is already running`);
      return;
    }
    const settled = (async () => operation())().then(
      () => undefined,
      () => {
        try {
          this.log(`Control Center contained a failed operation: ${key}`);
        } catch {
          // Containment must hold even when the log sink itself fails, or the
          // rejection would resurface through whenIdle().
        }
      },
    ).finally(() => { this.running.delete(key); });
    this.running.set(key, settled);
  }

  /** Host and test seam: resolves once every detached operation has settled. */
  async whenIdle(): Promise<void> {
    while (this.running.size > 0) await Promise.all([...this.running.values()]);
  }
}

export function speechToTextStepState(
  provider: 'none' | 'soniox' | 'legacy-soniox-pending',
  state: ControlCenterCapabilities['sttState'] | undefined,
  decision: ReturnType<ControlCenterSetupChoices['snapshot']>['stt'],
): ControlCenterSetupStepState {
  if (provider === 'none') return decision === 'none' ? 'complete' : 'pending';
  if (provider !== 'soniox' || decision !== 'soniox') return 'pending';
  if (state === 'ready') return 'complete';
  if (state === 'error') return 'attention';
  return 'pending';
}

export function routeState(
  route: ControlCenterDisplayState['route'],
  capabilities: ControlCenterCapabilities,
): ControlCenterProjection['routeState'] {
  return route === 'voice' || route === 'assistant' || route === 'home'
    ? capabilities.sttState === 'ready' ? 'ready' : 'not-configured'
    : 'ready';
}

export function refresh(trigger: 'auto-badge' | 'provider-card' | 'mic-control' | 'pending-review') {
  return { refresh: true as const, focusTarget: { kind: 'trigger' as const, trigger } };
}

export function nextSequence(value: number): number {
  if (value >= Number.MAX_SAFE_INTEGER) return 1;
  return value + 1;
}

export function compactProviderStatus(
  capabilities: ControlCenterCapabilities,
): CompactMicState['providerStatus'] {
  if (capabilities.sttProvider === 'soniox' && capabilities.sttState === 'ready') {
    return 'soniox-configured';
  }
  if (capabilities.systemTtsState === 'ready'
    || capabilities.systemTtsState === 'configured-unverified') return 'system-voice';
  if (capabilities.systemTtsState === 'unavailable') return 'system-voice-unavailable';
  return 'not-configured';
}
