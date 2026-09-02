import { createHash, randomBytes } from 'node:crypto';

import type {
  BuiltinCommandDefinition,
  BuiltinExecutionResult,
  BuiltinMatchResult,
  PreparedBuiltinExecution,
} from './contracts';
import type { BuiltinCommandExecutor } from './executor';

export interface BuiltinNativeConfirmationHost {
  /** Must be implemented with a VS Code-owned modal, never a webview result. */
  confirm(definition: BuiltinCommandDefinition): Promise<boolean>;
}

export interface BuiltinAuthorityPort {
  snapshot(): { effective: boolean; epoch: number; fingerprint: string };
  onWillChange(listener: () => void): { dispose(): void };
}

export interface PendingBuiltinSummary {
  commandId: string;
  label: BuiltinCommandDefinition['label'];
  riskTier: 'confirmation-required';
}

export type BuiltinActionDecision =
  | { status: 'executed'; result: BuiltinExecutionResult }
  | { status: 'confirmation-required'; summary: PendingBuiltinSummary }
  | { status: 'blocked'; reason: 'target-unavailable' | 'cancelled' };

export interface BuiltinActionControllerOptions {
  /** Pending native confirmations expire quickly and never survive host restart. */
  pendingTtlMs?: number;
  /** Test seam. Production callers should use the default wall clock. */
  now?: () => number;
  /** Test seam. Production callers should use the default cryptographic nonce source. */
  nonceFactory?: () => string;
  /** Additional host-owned trust/focus/panel binding, never projected to the browser. */
  contextFingerprint?: () => string;
}

interface AuthorityBinding {
  effective: boolean;
  epoch: number;
  fingerprint: string;
}

interface PendingBuiltin {
  prepared: PreparedBuiltinExecution;
  nonce: string;
  promptEpoch: number;
  createdAt: number;
  expiresAt: number;
  authority: AuthorityBinding;
  contextFingerprint: string;
  actionFingerprint: string;
  prompting: boolean;
  consumed: boolean;
}

const DEFAULT_PENDING_TTL_MS = 30_000;
const MAX_PENDING_TTL_MS = 60_000;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/u;
const CONTEXT_FINGERPRINT_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/u;

/** Host-only confirmation owner; browser messages never carry pending authority. */
export class BuiltinActionController {
  private pending: PendingBuiltin | undefined;
  private promptEpoch = 0;
  private epochExhausted = false;
  private readonly subscription: { dispose(): void };
  private readonly pendingTtlMs: number;
  private readonly now: () => number;
  private readonly nonceFactory: () => string;
  private readonly contextFingerprint: () => string;

  constructor(
    private readonly executor: Pick<
      BuiltinCommandExecutor,
      'prepare' | 'targetStillCurrent' | 'execute'
    >,
    private readonly autoMode: BuiltinAuthorityPort,
    private readonly nativePrompt: BuiltinNativeConfirmationHost,
    options: BuiltinActionControllerOptions = {},
  ) {
    this.pendingTtlMs = validTtl(options.pendingTtlMs ?? DEFAULT_PENDING_TTL_MS);
    this.now = options.now ?? Date.now;
    this.nonceFactory = options.nonceFactory ?? (() => randomBytes(32).toString('base64url'));
    this.contextFingerprint = options.contextFingerprint ?? (() => 'builtin-context');
    this.subscription = autoMode.onWillChange(() => this.cancel());
  }

  get pendingSummary(): PendingBuiltinSummary | undefined {
    const pending = this.pending;
    if (pending && !this.bindingStillCurrent(pending)) {
      this.invalidateIfCurrent(pending);
      return undefined;
    }
    const definition = pending?.prepared.definition;
    return definition ? summary(definition) : undefined;
  }

  async request(
    match: Extract<BuiltinMatchResult, { status: 'matched' }>,
  ): Promise<BuiltinActionDecision> {
    const requestEpoch = this.invalidatePending();
    if (requestEpoch === undefined) return blocked();
    const prepared = await this.executor.prepare(match);
    if (requestEpoch !== this.promptEpoch) return blocked();
    if (!prepared) return { status: 'blocked', reason: 'target-unavailable' };
    if (prepared.definition.riskTier === 'automatic') {
      return { status: 'executed', result: await this.executor.execute(prepared) };
    }
    const auto = safeAuthority(this.autoMode);
    if (!auto) return blocked();
    if (auto?.effective) {
      return {
        status: 'executed',
        result: await this.executor.execute(prepared, undefined, auto),
      };
    }
    const createdAt = safeNow(this.now);
    const nonce = safeNonce(this.nonceFactory);
    const contextFingerprint = safeContextFingerprint(this.contextFingerprint);
    const preparedFingerprint = safeActionFingerprint(prepared);
    const expiresAt = createdAt === undefined ? undefined : createdAt + this.pendingTtlMs;
    if (
      createdAt === undefined
      || expiresAt === undefined
      || !Number.isSafeInteger(expiresAt)
      || nonce === undefined
      || contextFingerprint === undefined
      || preparedFingerprint === undefined
    ) {
      return blocked();
    }
    this.pending = {
      prepared,
      nonce,
      promptEpoch: requestEpoch,
      createdAt,
      expiresAt,
      authority: auto,
      contextFingerprint,
      actionFingerprint: preparedFingerprint,
      prompting: false,
      consumed: false,
    };
    return { status: 'confirmation-required', summary: summary(prepared.definition) };
  }

  /** Payload-free: the host re-resolves its one current pending action. */
  async confirmPending(): Promise<BuiltinActionDecision> {
    const pending = this.pending;
    if (!pending || pending.prompting || pending.consumed) return blocked();
    if (!this.bindingStillCurrent(pending)) {
      this.invalidateIfCurrent(pending);
      return blocked();
    }

    pending.prompting = true;
    let confirmed = false;
    try {
      confirmed = await this.nativePrompt.confirm(pending.prepared.definition);
    } catch {
      confirmed = false;
    }
    if (!confirmed || !this.isSolePending(pending) || !this.bindingStillCurrent(pending)) {
      this.invalidateIfCurrent(pending);
      return blocked();
    }
    const targetStillCurrent = await this.executor.targetStillCurrent(pending.prepared);
    if (
      !targetStillCurrent
      || !this.isSolePending(pending)
      || !this.bindingStillCurrent(pending)
    ) {
      this.invalidateIfCurrent(pending);
      return blocked();
    }

    // Consume the one-shot host record before dispatch. A repeated or late callback
    // can no longer resolve any authority, while subsequent context changes cancel
    // the dynamic token before the typed executor reaches its dispatch boundary.
    pending.consumed = true;
    this.pending = undefined;
    const bindingStillCurrent = () => this.bindingStillCurrent(pending);
    const token = {
      get isCancellationRequested() {
        return !bindingStillCurrent();
      },
    };
    return { status: 'executed', result: await this.executor.execute(pending.prepared, token) };
  }

  cancel(): void {
    this.invalidatePending();
  }

  dispose(): void {
    this.cancel();
    this.subscription.dispose();
  }

  private invalidatePending(): number | undefined {
    this.pending = undefined;
    if (this.epochExhausted || this.promptEpoch >= Number.MAX_SAFE_INTEGER) {
      this.epochExhausted = true;
      return undefined;
    }
    this.promptEpoch += 1;
    return this.promptEpoch;
  }

  private invalidateIfCurrent(pending: PendingBuiltin): void {
    if (this.pending === pending) this.invalidatePending();
  }

  private isSolePending(pending: PendingBuiltin): boolean {
    return this.pending === pending
      && this.pending.nonce === pending.nonce
      && this.pending.promptEpoch === pending.promptEpoch
      && !pending.consumed;
  }

  private bindingStillCurrent(pending: PendingBuiltin): boolean {
    const now = safeNow(this.now);
    const authority = safeAuthority(this.autoMode);
    const contextFingerprint = safeContextFingerprint(this.contextFingerprint);
    return !this.epochExhausted
      && pending.promptEpoch === this.promptEpoch
      && now !== undefined
      && now >= pending.createdAt
      && now < pending.expiresAt
      && authority !== undefined
      && sameAuthority(authority, pending.authority)
      && contextFingerprint === pending.contextFingerprint
      && safeActionFingerprint(pending.prepared) === pending.actionFingerprint;
  }
}

function safeAuthority(port: BuiltinAuthorityPort) {
  try {
    const value = port.snapshot();
    if (
      typeof value.effective !== 'boolean'
      || !Number.isSafeInteger(value.epoch)
      || value.epoch < 0
      || !/^[A-Za-z0-9._:-]{1,256}$/u.test(value.fingerprint)
    ) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function safeNow(now: () => number): number | undefined {
  try {
    const value = now();
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function safeNonce(factory: () => string): string | undefined {
  try {
    const value = factory();
    return NONCE_PATTERN.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function safeContextFingerprint(factory: () => string): string | undefined {
  try {
    const value = factory();
    return CONTEXT_FINGERPRINT_PATTERN.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function sameAuthority(left: AuthorityBinding, right: AuthorityBinding): boolean {
  return left.effective === right.effective
    && left.epoch === right.epoch
    && left.fingerprint === right.fingerprint;
}

function safeActionFingerprint(prepared: PreparedBuiltinExecution): string | undefined {
  try {
    const slots = Object.keys(prepared.slots).sort().map((name) => {
      const value = prepared.slots[name];
      if (typeof value !== 'object') return [name, value];
      return [name, {
        id: value.id,
        label: value.label,
        relativePath: value.relativePath,
      }];
    });
    return createHash('sha256').update(JSON.stringify({
      commandId: prepared.definition.id,
      definitionFingerprint: prepared.definitionFingerprint,
      executorId: prepared.definition.executorId,
      riskTier: prepared.definition.riskTier,
      slots,
      targetFingerprint: prepared.targetFingerprint,
    })).digest('hex');
  } catch {
    return undefined;
  }
}

function validTtl(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PENDING_TTL_MS) {
    throw new RangeError(`pendingTtlMs must be an integer from 1 to ${MAX_PENDING_TTL_MS}`);
  }
  return value;
}

function blocked(): BuiltinActionDecision {
  return { status: 'blocked', reason: 'cancelled' };
}

function summary(definition: BuiltinCommandDefinition): PendingBuiltinSummary {
  return Object.freeze({
    commandId: definition.id,
    label: definition.label,
    riskTier: 'confirmation-required',
  });
}
