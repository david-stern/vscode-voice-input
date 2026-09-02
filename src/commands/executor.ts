import { createHash } from 'node:crypto';

import type {
  BuiltinCancellationToken,
  BuiltinCommandDefinition,
  BuiltinCommandHost,
  BuiltinExecutionResult,
  BuiltinExecutionAuthorityPort,
  BuiltinMatchResult,
  GitCommandHost,
  PreparedBuiltinExecution,
} from './contracts';
import { parseCommitMessage, parseNewRef, parseQuery } from './slotParsers';

export class BuiltinCommandExecutor {
  private running = false;

  constructor(
    private readonly host: BuiltinCommandHost,
    private readonly gitHost: GitCommandHost,
    private readonly authority?: BuiltinExecutionAuthorityPort,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  async prepare(
    match: Extract<BuiltinMatchResult, { status: 'matched' }>,
  ): Promise<PreparedBuiltinExecution | undefined> {
    const selectedHost = this.selectHost(match.definition);
    if (!await selectedHost.isAvailable(match.definition)) return undefined;
    const snapshot = await selectedHost.captureTarget(match.definition);
    if (!snapshot.workspaceTrusted || snapshot.remoteName && match.definition.availability.remote === false) {
      return undefined;
    }
    return Object.freeze({
      definition: match.definition,
      slots: match.slots,
      targetFingerprint: snapshot.fingerprint,
      definitionFingerprint: definitionFingerprint(match.definition),
    });
  }

  /** Re-captures the live host target for native confirmation before authority is consumed. */
  async targetStillCurrent(prepared: PreparedBuiltinExecution): Promise<boolean> {
    if (definitionFingerprint(prepared.definition) !== prepared.definitionFingerprint) return false;
    try {
      const selectedHost = this.selectHost(prepared.definition);
      if (!await selectedHost.isAvailable(prepared.definition)) return false;
      const current = await selectedHost.captureTarget(prepared.definition);
      return current.workspaceTrusted
        && !(current.remoteName && prepared.definition.availability.remote === false)
        && current.fingerprint === prepared.targetFingerprint;
    } catch {
      return false;
    }
  }

  async execute(
    prepared: PreparedBuiltinExecution,
    token?: BuiltinCancellationToken,
    expectedAuthority?: { epoch: number; fingerprint: string },
  ): Promise<BuiltinExecutionResult> {
    if (token?.isCancellationRequested) return { ok: false, reason: 'cancelled' };
    if (this.running) return { ok: false, reason: 'busy' };
    if (definitionFingerprint(prepared.definition) !== prepared.definitionFingerprint) {
      return { ok: false, reason: 'definition-changed' };
    }
    if (!validTypedSlots(prepared)) return { ok: false, reason: 'invalid-slot' };
    if (!this.authorityStillCurrent(expectedAuthority)) {
      return { ok: false, reason: 'authority-changed' };
    }
    this.running = true;
    let dispatchBegan = false;
    try {
      const selectedHost = this.selectHost(prepared.definition);
      if (!await selectedHost.isAvailable(prepared.definition)) {
        return { ok: false, reason: 'target-unavailable' };
      }
      const current = await selectedHost.captureTarget(prepared.definition);
      if (!current.workspaceTrusted) return { ok: false, reason: 'workspace-untrusted' };
      if (current.remoteName && prepared.definition.availability.remote === false) {
        return { ok: false, reason: 'remote-unavailable' };
      }
      if (current.fingerprint !== prepared.targetFingerprint) {
        return { ok: false, reason: 'target-changed' };
      }
      if (token?.isCancellationRequested) return { ok: false, reason: 'cancelled' };
      if (!this.authorityStillCurrent(expectedAuthority)) {
        return { ok: false, reason: 'authority-changed' };
      }
      dispatchBegan = true;
      await selectedHost.execute(
        prepared.definition,
        prepared.slots,
        prepared.targetFingerprint,
      );
      return { ok: true, commandId: prepared.definition.id };
    } catch (error) {
      if (error instanceof BuiltinTargetChangedError) return { ok: false, reason: 'target-changed' };
      if (isPartialError(error)) return { ok: false, reason: 'partial' };
      return {
        ok: false,
        reason: dispatchBegan ? 'outcome-unknown-do-not-retry' : 'execution-failed',
      };
    } finally {
      this.running = false;
    }
  }

  private selectHost(definition: BuiltinCommandDefinition): BuiltinCommandHost {
    return definition.category === 'git' ? this.gitHost : this.host;
  }

  private authorityStillCurrent(
    expected: { epoch: number; fingerprint: string } | undefined,
  ): boolean {
    if (!expected) return true;
    try {
      const current = this.authority?.snapshot();
      return Boolean(
        current?.effective
        && current.epoch === expected.epoch
        && current.fingerprint === expected.fingerprint,
      );
    } catch {
      return false;
    }
  }
}

export function definitionFingerprint(definition: BuiltinCommandDefinition): string {
  return createHash('sha256').update(JSON.stringify(definition)).digest('hex');
}

export class PartialBuiltinExecutionError extends Error {
  constructor() {
    super('partial builtin execution');
    this.name = 'PartialBuiltinExecutionError';
  }
}

export class BuiltinTargetChangedError extends Error {
  constructor() {
    super('builtin target changed');
    this.name = 'BuiltinTargetChangedError';
  }
}

function isPartialError(error: unknown): boolean {
  return error instanceof PartialBuiltinExecutionError;
}

function validTypedSlots(prepared: PreparedBuiltinExecution): boolean {
  const expected = prepared.definition.slots.map(({ name }) => name).sort();
  if (Object.keys(prepared.slots).sort().join(',') !== expected.join(',')) return false;
  return prepared.definition.slots.every((slot) => {
    const value = prepared.slots[slot.name];
    switch (slot.kind) {
      case 'line': return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
      case 'query': return typeof value === 'string' && parseQuery(value).ok;
      case 'commitMessage': return typeof value === 'string' && parseCommitMessage(value).ok;
      case 'newRef': return typeof value === 'string' && parseNewRef(value).ok;
      case 'existingRef': return typeof value === 'string' && value.length <= 128;
      case 'workspaceFile':
        return typeof value === 'object'
          && value !== null
          && !Array.isArray(value)
          && Object.keys(value).sort().join(',') === 'id,label,relativePath';
    }
  });
}
