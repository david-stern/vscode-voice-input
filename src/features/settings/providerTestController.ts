import type { ProviderId } from '../../config';
import {
  ConnectionTestController,
  type ConnectionTestCategory,
  type ConnectionTestService,
} from '../../providers';

export type ProviderTestState =
  | { phase: 'idle'; operationRevision: number }
  | { phase: 'running'; operationRevision: number }
  | { phase: 'complete'; operationRevision: number; result: ConnectionTestCategory };

export type ProviderTestAction = 'start' | 'cancel';
export type ProviderTestAcceptance = 'accepted' | 'stale';

/** Owns one provider's independently cancellable, monotonic connection-test state. */
export class SettingsProviderTestController {
  private readonly controller: ConnectionTestController;
  private current: ProviderTestState = { phase: 'idle', operationRevision: 0 };

  constructor(
    private readonly provider: ProviderId,
    service: Pick<ConnectionTestService, 'test'>,
    private readonly publish: () => Promise<void> | void,
  ) {
    this.controller = new ConnectionTestController(service);
  }

  get state(): ProviderTestState {
    return { ...this.current };
  }

  async handle(
    requestedRevision: number,
    action: ProviderTestAction,
  ): Promise<ProviderTestAcceptance> {
    if (requestedRevision !== this.current.operationRevision + 1) return 'stale';
    if (action === 'cancel') {
      this.controller.cancel();
      this.current = {
        phase: 'complete',
        operationRevision: requestedRevision,
        result: 'cancelled',
      };
      await this.publish();
      return 'accepted';
    }

    this.current = { phase: 'running', operationRevision: requestedRevision };
    await this.publish();
    const completion = await this.controller.run(this.provider);
    if (
      !completion.publish
      || this.current.operationRevision !== requestedRevision
      || this.current.phase !== 'running'
    ) return 'accepted';
    this.current = {
      phase: 'complete',
      operationRevision: requestedRevision,
      result: completion.result.category,
    };
    await this.publish();
    return 'accepted';
  }

  cancelIfRunning(): void {
    if (this.current.phase !== 'running') return;
    this.controller.cancel();
    this.current = {
      phase: 'complete',
      operationRevision: this.current.operationRevision + 1,
      result: 'cancelled',
    };
    void this.publish();
  }

  dispose(): void {
    this.controller.cancel();
  }
}
