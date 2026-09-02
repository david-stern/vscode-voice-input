import {
  MappingError,
  mappingFingerprint as fingerprintForExecution,
  type CustomMapping,
  type JsonObject,
  type JsonValue,
  validateCustomMappingPayload,
} from './mappings';

export interface MappingCancellationToken {
  readonly isCancellationRequested: boolean;
  readonly onCancellationRequested?: (listener: () => void) => { dispose(): void };
}

export interface MappingExecutionHost {
  isWorkspaceTrusted(): boolean;
  getCommandIds(): Promise<readonly string[]>;
  getToolNames(): readonly string[];
  executeCommand(commandId: string, ...args: JsonValue[]): PromiseLike<unknown>;
  invokeTool(
    toolName: string,
    options: { input: JsonObject; toolInvocationToken: unknown | undefined },
    cancellationToken?: MappingCancellationToken,
  ): PromiseLike<unknown>;
  getAuthoritySnapshot?(): { effective: boolean; epoch: number; fingerprint: string };
  getTargetFingerprint?(): string;
}

export type MappingInvocationSource = 'voice' | 'agent';

export interface MappingInvocationOptions {
  source: MappingInvocationSource;
  toolInvocationToken?: unknown;
  cancellationToken?: MappingCancellationToken;
  expectedFingerprint?: string;
  expectedAuthority?: { epoch: number; fingerprint: string };
  expectedTargetFingerprint?: string;
}

export type MappingExecutionFailure =
  | 'workspace-untrusted'
  | 'cancelled'
  | 'busy'
  | 'mapping-not-found'
  | 'mapping-disabled'
  | 'mapping-not-agent-enabled'
  | 'mapping-changed'
  | 'authority-changed'
  | 'target-changed'
  | 'target-unavailable'
  | 'invalid-voice-token'
  | 'outcome-unknown-do-not-retry'
  | 'execution-failed';

export type MappingExecutionResult =
  | { ok: true; mappingId: string; kind: CustomMapping['kind'] }
  | { ok: false; reason: MappingExecutionFailure };

/**
 * One instance must be shared by voice and Agent entry points. It never accepts
 * a raw target or runtime arguments and intentionally discards target results.
 */
export class CustomMappingExecutor {
  private running = false;

  constructor(
    private readonly resolveMapping: (id: string) => CustomMapping | undefined,
    private readonly host: MappingExecutionHost,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  async execute(
    mappingId: string,
    options: MappingInvocationOptions,
  ): Promise<MappingExecutionResult> {
    if (!this.host.isWorkspaceTrusted()) return { ok: false, reason: 'workspace-untrusted' };
    if (options.cancellationToken?.isCancellationRequested) return { ok: false, reason: 'cancelled' };
    if (this.running) return { ok: false, reason: 'busy' };
    if (options.source === 'voice' && options.toolInvocationToken !== undefined) {
      return { ok: false, reason: 'invalid-voice-token' };
    }

    this.running = true;
    let dispatchBegan = false;
    try {
      const resolved = this.resolveMapping(mappingId);
      if (!resolved) return { ok: false, reason: 'mapping-not-found' };
      const mapping = validateCustomMappingPayload({
        schemaVersion: 1,
        mappings: [resolved],
      }).mappings[0];
      if (!mapping || mapping.id !== mappingId) {
        return { ok: false, reason: 'mapping-not-found' };
      }
      if (!mapping.enabled) return { ok: false, reason: 'mapping-disabled' };
      if (options.source === 'agent' && !mapping.agentEnabled) {
        return { ok: false, reason: 'mapping-not-agent-enabled' };
      }
      if (
        options.expectedFingerprint !== undefined &&
        options.expectedFingerprint !== fingerprintForExecution(mapping)
      ) {
        return { ok: false, reason: 'mapping-changed' };
      }
      if (options.cancellationToken?.isCancellationRequested) {
        return { ok: false, reason: 'cancelled' };
      }
      if (!this.authorityStillCurrent(options) || !this.targetStillCurrent(options)) {
        return {
          ok: false,
          reason: !this.authorityStillCurrent(options) ? 'authority-changed' : 'target-changed',
        };
      }

      if (mapping.kind === 'command') {
        const commands = await this.host.getCommandIds();
        if (!commands.includes(mapping.commandId)) return { ok: false, reason: 'target-unavailable' };
        if (options.cancellationToken?.isCancellationRequested) {
          return { ok: false, reason: 'cancelled' };
        }
        if (!this.host.isWorkspaceTrusted()) {
          return { ok: false, reason: 'workspace-untrusted' };
        }
        if (!this.mappingStillCurrent(mapping)) return { ok: false, reason: 'mapping-changed' };
        if (!this.authorityStillCurrent(options)) return { ok: false, reason: 'authority-changed' };
        if (!this.targetStillCurrent(options)) return { ok: false, reason: 'target-changed' };
        dispatchBegan = true;
        await this.host.executeCommand(mapping.commandId, ...mapping.args);
      } else {
        if (!this.host.getToolNames().includes(mapping.toolName)) {
          return { ok: false, reason: 'target-unavailable' };
        }
        if (options.cancellationToken?.isCancellationRequested) {
          return { ok: false, reason: 'cancelled' };
        }
        if (!this.host.isWorkspaceTrusted()) {
          return { ok: false, reason: 'workspace-untrusted' };
        }
        if (!this.mappingStillCurrent(mapping)) return { ok: false, reason: 'mapping-changed' };
        if (!this.authorityStillCurrent(options)) return { ok: false, reason: 'authority-changed' };
        if (!this.targetStillCurrent(options)) return { ok: false, reason: 'target-changed' };
        dispatchBegan = true;
        await this.host.invokeTool(
          mapping.toolName,
          {
            input: mapping.input,
            toolInvocationToken:
              options.source === 'agent' ? options.toolInvocationToken : undefined,
          },
          options.cancellationToken,
        );
      }

      // Once the target promise resolves, the side effect may already have
      // happened. Report success even if cancellation arrived during dispatch,
      // so callers cannot mistake a completed action for a safe-to-retry one.
      return { ok: true, mappingId: mapping.id, kind: mapping.kind };
    } catch (error) {
      if (dispatchBegan) {
        // The target may have completed a side effect before rejecting. Never
        // label this as cancellation or a retryable failure: callers must not
        // automatically dispatch the same authority again.
        return { ok: false, reason: 'outcome-unknown-do-not-retry' };
      }
      if (options.cancellationToken?.isCancellationRequested) {
        return { ok: false, reason: 'cancelled' };
      }
      if (error instanceof MappingError && error.code === 'target-unavailable') {
        return { ok: false, reason: 'target-unavailable' };
      }
      return { ok: false, reason: 'execution-failed' };
    } finally {
      this.running = false;
    }
  }

  private mappingStillCurrent(mapping: CustomMapping): boolean {
    try {
      const current = this.resolveMapping(mapping.id);
      if (!current) return false;
      const validated = validateCustomMappingPayload({
        schemaVersion: 1,
        mappings: [current],
      }).mappings[0];
      return validated !== undefined && fingerprintForExecution(validated) === fingerprintForExecution(mapping);
    } catch {
      return false;
    }
  }

  private authorityStillCurrent(options: MappingInvocationOptions): boolean {
    if (!options.expectedAuthority) return true;
    try {
      const current = this.host.getAuthoritySnapshot?.();
      return Boolean(
        current?.effective
        && current.epoch === options.expectedAuthority.epoch
        && current.fingerprint === options.expectedAuthority.fingerprint,
      );
    } catch {
      return false;
    }
  }

  private targetStillCurrent(options: MappingInvocationOptions): boolean {
    if (options.expectedTargetFingerprint === undefined) return true;
    try {
      return this.host.getTargetFingerprint?.() === options.expectedTargetFingerprint;
    } catch {
      return false;
    }
  }
}
