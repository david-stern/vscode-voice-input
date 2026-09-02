import { mappingFingerprint, type CustomMapping } from '../assistant';
import { isProviderId, type ProviderId } from '../inference';
import type { AgentRecord } from './contracts';
import type { AgentRegistry, AgentRegistryDisposable } from './registry';
import type { MappingApprovalStore } from './mappingApprovals';

export const AGENT_ACTION_KINDS = Object.freeze([
  'answer', 'draft', 'send', 'command', 'tool', 'terminal', 'file-change', 'external-state',
] as const);
export type AgentActionKind = (typeof AGENT_ACTION_KINDS)[number];
export type AgentPermissionTier = 'automatic' | 'confirmation-required';

export interface AgentActionProposal {
  proposalId: string;
  agentId: string;
  provider: ProviderId;
  model: string;
  action: AgentActionKind;
  reason: string;
  confidence: number;
  targetEvidence: string;
  mappingId?: string;
}

export interface AgentAuthorityContext {
  workspaceTrusted: boolean;
  activeAgent: AgentRecord | undefined;
  targetFingerprint: string;
  targetEvidence: string;
  resolveMapping(mappingId: string): CustomMapping | undefined;
}

export interface AgentAutoModeSnapshot { effective: boolean; epoch: number; fingerprint: string }
export interface AgentAutoModePort {
  snapshot(): AgentAutoModeSnapshot; onWillChange(listener: () => void): AgentRegistryDisposable;
}

export type AgentAuthorityDecision =
  | {
      status: 'authorized';
      authorizationId: string;
      permissionTier: AgentPermissionTier;
      mode: 'automatic' | 'always-approved' | 'auto-mode' | 'confirmed';
      expiresAt: number;
    }
  | {
      status: 'confirmation-required';
      pendingId: string;
      permissionTier: 'confirmation-required';
      expiresAt: number;
      preview: Readonly<AgentActionProposal>;
    }
  | {
      status: 'denied';
      permissionTier: AgentPermissionTier;
      reason: AgentAuthorityFailure;
    };

export type AgentAuthorityFailure =
  | 'invalid-proposal' | 'agent-changed' | 'workspace-untrusted' | 'mapping-unavailable'
  | 'no-pending-approval' | 'approval-expired' | 'approval-replayed'
  | 'confirmation-not-later' | 'target-changed' | 'authority-changed'
  | 'authorization-invalid' | 'busy' | 'outcome-unknown-do-not-retry';

export interface AgentApprovalHistoryEntry {
  id: string;
  proposalId: string;
  agentId: string;
  provider: ProviderId;
  model: string;
  action: AgentActionKind;
  reason: string;
  confidence: number;
  targetEvidence: string;
  mappingId?: string;
  permissionTier: AgentPermissionTier;
  decision: 'automatic' | 'always-approved' | 'auto-mode' | 'requested' | 'confirmed' | 'denied' | 'executed';
  timestamp: number;
  expiresAt?: number;
}

interface PendingApproval {
  id: string; proposal: AgentActionProposal; targetFingerprint: string;
  mappingFingerprint?: string; requestedAt: number; expiresAt: number;
}

interface Authorization {
  id: string; proposal: AgentActionProposal; targetFingerprint: string;
  mappingFingerprint?: string; mode: 'automatic' | 'always-approved' | 'auto-mode' | 'confirmed';
  expiresAt: number; autoModeEpoch?: number; autoModeFingerprint?: string;
}

export interface AgentAuthorityOptions {
  approvals: Pick<MappingApprovalStore, 'isApproved' | 'onWillChange'>;
  agents?: Pick<AgentRegistry, 'onWillChange'>; autoMode?: AgentAutoModePort;
  ttlMs?: number; now?: () => number; idFactory?: () => string;
}

export type AgentExecutionResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: AgentAuthorityFailure };

/** Local permission boundary. Model output never carries approval authority. */
export class AgentAuthorityPolicy {
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private pending: PendingApproval | undefined;
  private readonly authorizations = new Map<string, Authorization>();
  private readonly usedConfirmationIds = new Set<string>();
  private readonly historyEntries: AgentApprovalHistoryEntry[] = [];
  private running = false;
  private readonly subscriptions: AgentRegistryDisposable[] = [];

  constructor(private readonly options: AgentAuthorityOptions) {
    this.ttlMs = Math.max(1, Math.min(30_000, Math.floor(options.ttlMs ?? 15_000)));
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory ?? (() => `authority_${this.now()}_${Math.random().toString(36).slice(2)}`);
    this.subscriptions.push(options.approvals.onWillChange(() => this.revoke()));
    const agentSubscription = options.agents?.onWillChange(() => this.revoke());
    if (agentSubscription) this.subscriptions.push(agentSubscription);
    const autoModeSubscription = options.autoMode?.onWillChange(() => this.revoke());
    if (autoModeSubscription) this.subscriptions.push(autoModeSubscription);
  }

  request(raw: unknown, context: AgentAuthorityContext): AgentAuthorityDecision {
    this.revokePending();
    const proposal = parseProposal(raw);
    const tier = proposal && automaticAction(proposal.action)
      ? 'automatic'
      : 'confirmation-required';
    if (!proposal) return this.denied(tier, 'invalid-proposal');
    const contextFailure = validateContext(proposal, context, tier !== 'automatic');
    if (contextFailure) return this.denied(tier, contextFailure, proposal);

    const mapping = proposal.mappingId
      ? safeResolve(context.resolveMapping, proposal.mappingId)
      : undefined;
    if (proposal.mappingId && (!mapping || !mapping.enabled || !mapping.agentEnabled)) {
      return this.denied(tier, 'mapping-unavailable', proposal);
    }
    const mappingHash = mapping ? mappingFingerprint(mapping) : undefined;
    if (tier === 'automatic') {
      return this.authorize(proposal, context.targetFingerprint, mappingHash, 'automatic');
    }
    const autoMode = safeAutoModeSnapshot(this.options.autoMode);
    if (
      autoMode?.effective
      && mapping
      && mapping.enabled
      && mapping.agentEnabled
      && (proposal.action === 'command' || proposal.action === 'tool')
    ) {
      return this.authorize(
        proposal,
        context.targetFingerprint,
        mappingHash,
        'auto-mode',
        undefined,
        autoMode,
      );
    }
    if (
      (proposal.action === 'command' || proposal.action === 'tool')
      && proposal.mappingId
      && this.options.approvals.isApproved(proposal.mappingId)
    ) {
      return this.authorize(proposal, context.targetFingerprint, mappingHash, 'always-approved');
    }

    const requestedAt = this.now();
    const pending: PendingApproval = {
      id: this.idFactory(),
      proposal,
      targetFingerprint: context.targetFingerprint,
      ...(mappingHash ? { mappingFingerprint: mappingHash } : {}),
      requestedAt,
      expiresAt: requestedAt + this.ttlMs,
    };
    this.pending = pending;
    this.remember(proposal, 'requested', 'confirmation-required', requestedAt, pending.expiresAt);
    return {
      status: 'confirmation-required',
      pendingId: pending.id,
      permissionTier: 'confirmation-required',
      expiresAt: pending.expiresAt,
      preview: Object.freeze({ ...proposal }),
    };
  }

  confirm(
    pendingId: string,
    confirmationId: string,
    context: AgentAuthorityContext,
  ): AgentAuthorityDecision {
    const pending = this.pending;
    this.pending = undefined;
    if (!pending || pending.id !== pendingId) {
      return this.denied('confirmation-required', 'no-pending-approval');
    }
    const now = this.now();
    if (now > pending.expiresAt) {
      return this.denied('confirmation-required', 'approval-expired', pending.proposal);
    }
    if (!confirmationId || this.usedConfirmationIds.has(confirmationId)) {
      return this.denied('confirmation-required', 'approval-replayed', pending.proposal);
    }
    if (now <= pending.requestedAt) {
      return this.denied('confirmation-required', 'confirmation-not-later', pending.proposal);
    }
    this.rememberConfirmation(confirmationId);
    const failure = validateContext(pending.proposal, context, true);
    if (failure) return this.denied('confirmation-required', failure, pending.proposal);
    if (pending.targetFingerprint !== context.targetFingerprint) {
      return this.denied('confirmation-required', 'target-changed', pending.proposal);
    }
    if (!mappingStillMatches(pending, context)) {
      return this.denied('confirmation-required', 'mapping-unavailable', pending.proposal);
    }
    return this.authorize(
      pending.proposal,
      pending.targetFingerprint,
      pending.mappingFingerprint,
      'confirmed',
      pending.expiresAt,
    );
  }

  async execute<T>(
    authorizationId: string,
    context: AgentAuthorityContext,
    operation: () => PromiseLike<T>,
  ): Promise<AgentExecutionResult<T>> {
    const authorization = this.authorizations.get(authorizationId);
    this.authorizations.delete(authorizationId);
    if (!authorization) return { ok: false, reason: 'authorization-invalid' };
    if (this.running) return { ok: false, reason: 'busy' };
    if (this.now() > authorization.expiresAt) {
      return { ok: false, reason: 'approval-expired' };
    }
    const privileged = !automaticAction(authorization.proposal.action);
    const failure = validateContext(authorization.proposal, context, privileged);
    if (
      failure
      || authorization.targetFingerprint !== context.targetFingerprint
      || !authorizationStillMatches(authorization, context, this.options.approvals)
      || !autoModeStillMatches(authorization, this.options.autoMode)
    ) {
      return {
        ok: false,
        reason: failure
          ?? (authorization.mode === 'auto-mode' ? 'authority-changed' : 'target-changed'),
      };
    }

    this.running = true;
    try {
      const value = await operation();
      this.remember(
        authorization.proposal,
        'executed',
        privileged ? 'confirmation-required' : 'automatic',
        this.now(),
      );
      return { ok: true, value };
    } catch {
      return {
        ok: false,
        reason: 'outcome-unknown-do-not-retry',
      };
    } finally {
      this.running = false;
    }
  }

  revoke(): void { this.revokePending(); this.authorizations.clear(); }

  history(): readonly AgentApprovalHistoryEntry[] { return this.historyEntries.map((entry) => ({ ...entry })); }

  dispose(): void {
    this.revoke(); for (const subscription of this.subscriptions.splice(0)) subscription.dispose();
  }

  private authorize(
    proposal: AgentActionProposal,
    targetFingerprint: string,
    mappingHash: string | undefined,
    mode: Authorization['mode'],
    expiresAt = this.now() + this.ttlMs,
    autoMode?: AgentAutoModeSnapshot,
  ): Extract<AgentAuthorityDecision, { status: 'authorized' }> {
    const authorization: Authorization = {
      id: this.idFactory(),
      proposal,
      targetFingerprint,
      ...(mappingHash ? { mappingFingerprint: mappingHash } : {}),
      mode,
      expiresAt,
      ...(autoMode ? {
        autoModeEpoch: autoMode.epoch,
        autoModeFingerprint: autoMode.fingerprint,
      } : {}),
    };
    this.authorizations.set(authorization.id, authorization);
    this.remember(
      proposal,
      mode === 'confirmed' ? 'confirmed' : mode,
      automaticAction(proposal.action) ? 'automatic' : 'confirmation-required',
      this.now(),
      expiresAt,
    );
    return {
      status: 'authorized',
      authorizationId: authorization.id,
      permissionTier: automaticAction(proposal.action) ? 'automatic' : 'confirmation-required',
      mode,
      expiresAt,
    };
  }

  private denied(
    tier: AgentPermissionTier,
    reason: AgentAuthorityFailure,
    proposal?: AgentActionProposal,
  ): Extract<AgentAuthorityDecision, { status: 'denied' }> {
    if (proposal) this.remember(proposal, 'denied', tier, this.now());
    return { status: 'denied', permissionTier: tier, reason };
  }

  private remember(
    proposal: AgentActionProposal,
    decision: AgentApprovalHistoryEntry['decision'],
    permissionTier: AgentPermissionTier,
    timestamp: number,
    expiresAt?: number,
  ): void {
    this.historyEntries.push({
      id: this.idFactory(),
      proposalId: proposal.proposalId,
      agentId: proposal.agentId,
      provider: proposal.provider,
      model: proposal.model,
      action: proposal.action,
      reason: proposal.reason,
      confidence: proposal.confidence,
      targetEvidence: proposal.targetEvidence,
      ...(proposal.mappingId ? { mappingId: proposal.mappingId } : {}),
      permissionTier,
      decision,
      timestamp,
      ...(expiresAt === undefined ? {} : { expiresAt }),
    });
    if (this.historyEntries.length > 100) this.historyEntries.shift();
  }

  private revokePending(): void { this.pending = undefined; }

  private rememberConfirmation(id: string): void {
    this.usedConfirmationIds.add(id);
    if (this.usedConfirmationIds.size > 100) {
      const oldest = this.usedConfirmationIds.values().next().value as string | undefined;
      if (oldest) this.usedConfirmationIds.delete(oldest);
    }
  }
}

function parseProposal(value: unknown): AgentActionProposal | undefined {
  if (!isPlainObject(value)) return undefined;
  const allowed = new Set([
    'proposalId', 'agentId', 'provider', 'model', 'action',
    'reason', 'confidence', 'targetEvidence', 'mappingId',
  ]);
  const required = [...allowed].filter((key) => key !== 'mappingId');
  if (
    Object.keys(value).some((key) => !allowed.has(key))
    || required.some((key) => !Object.hasOwn(value, key))
  ) return undefined;
  if (
    !boundedText(value.proposalId, 128)
    || !boundedText(value.agentId, 128)
    || !isProviderId(value.provider)
    || !boundedIdentifier(value.model, 256)
    || !(AGENT_ACTION_KINDS as readonly unknown[]).includes(value.action)
    || !boundedText(value.reason, 1_000)
    || !boundedText(value.targetEvidence, 1_000)
    || typeof value.confidence !== 'number'
    || !Number.isFinite(value.confidence)
    || value.confidence < 0
    || value.confidence > 1
    || (value.mappingId !== undefined && !boundedText(value.mappingId, 128))
  ) return undefined;
  return Object.freeze({
    proposalId: value.proposalId, agentId: value.agentId, provider: value.provider,
    model: value.model, action: value.action as AgentActionKind, reason: value.reason,
    confidence: value.confidence, targetEvidence: value.targetEvidence,
    ...(value.mappingId === undefined ? {} : { mappingId: value.mappingId }),
  });
}

function validateContext(
  proposal: AgentActionProposal,
  context: AgentAuthorityContext,
  privileged: boolean,
): AgentAuthorityFailure | undefined {
  if (
    !context.activeAgent
    || !context.activeAgent.enabled
    || context.activeAgent.id !== proposal.agentId
    || context.activeAgent.provider !== proposal.provider
    || context.activeAgent.model !== proposal.model
  ) return 'agent-changed';
  if (
    !boundedText(context.targetEvidence, 1_000)
    || proposal.targetEvidence !== context.targetEvidence
  ) return 'target-changed';
  if (privileged && !context.workspaceTrusted) return 'workspace-untrusted';
  return undefined;
}

function mappingStillMatches(pending: PendingApproval, context: AgentAuthorityContext): boolean {
  if (!pending.proposal.mappingId) return pending.mappingFingerprint === undefined;
  const mapping = safeResolve(context.resolveMapping, pending.proposal.mappingId);
  return Boolean(
    mapping
    && mapping.enabled
    && mapping.agentEnabled
    && pending.mappingFingerprint === mappingFingerprint(mapping),
  );
}

function authorizationStillMatches(
  authorization: Authorization,
  context: AgentAuthorityContext,
  approvals: Pick<MappingApprovalStore, 'isApproved'>,
): boolean {
  if (!authorization.proposal.mappingId) return authorization.mappingFingerprint === undefined;
  const mapping = safeResolve(context.resolveMapping, authorization.proposal.mappingId);
  if (
    !mapping
    || !mapping.enabled
    || !mapping.agentEnabled
    || authorization.mappingFingerprint !== mappingFingerprint(mapping)
  ) return false;
  return authorization.mode !== 'always-approved'
    || approvals.isApproved(authorization.proposal.mappingId);
}

function autoModeStillMatches(
  authorization: Authorization,
  port: AgentAutoModePort | undefined,
): boolean {
  if (authorization.mode !== 'auto-mode') return true;
  const current = safeAutoModeSnapshot(port);
  return Boolean(
    current?.effective
    && current.epoch === authorization.autoModeEpoch
    && current.fingerprint === authorization.autoModeFingerprint,
  );
}

function safeAutoModeSnapshot(port: AgentAutoModePort | undefined): AgentAutoModeSnapshot | undefined {
  try {
    const value = port?.snapshot();
    if (
      !value
      || typeof value.effective !== 'boolean'
      || !Number.isSafeInteger(value.epoch)
      || value.epoch < 0
      || !boundedIdentifier(value.fingerprint, 256)
    ) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function automaticAction(action: AgentActionKind): boolean { return action === 'answer' || action === 'draft'; }

function safeResolve(
  resolve: (mappingId: string) => CustomMapping | undefined,
  mappingId: string,
): CustomMapping | undefined {
  try { return resolve(mappingId); } catch { return undefined; }
}

function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
    && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value);
}

function boundedIdentifier(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
    && /^[A-Za-z0-9~][A-Za-z0-9._~:/@+-]*$/u.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
