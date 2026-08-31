import { mappingFingerprint, type CustomMapping } from '../assistant';
import { MAPPING_ID_PATTERN } from '../assistant/mappingTypes';
import type { AgentStorage } from './contracts';

export const MAPPING_APPROVAL_STORAGE_KEY = 'voiceInput.mappingApprovals.v1';
export const MAPPING_APPROVAL_SCHEMA_VERSION = 1 as const;
export const MAX_MAPPING_APPROVALS = 50;

interface StoredMappingApproval {
  mappingId: string;
  fingerprint: string;
  approvedAt: number;
}

interface MappingApprovalPayload {
  schemaVersion: typeof MAPPING_APPROVAL_SCHEMA_VERSION;
  approvals: StoredMappingApproval[];
}

export interface MappingApprovalSummary {
  mappingId: string;
  approvedAt: number;
  effective: boolean;
}

export type MappingApprovalState = 'none' | 'approved' | 'revoked';

export interface MappingApprovalHistoryEntry {
  mappingId: string;
  decision: 'granted' | 'revoked' | 'confirmed-execution' | 'always-approved-execution';
  timestamp: number;
}

export interface MappingApprovalDisposable {
  dispose(): void;
}

export interface MappingApprovalStoreOptions {
  isWorkspaceTrusted(): boolean;
}

/** Separate, default-deny approval metadata; mapping schema v1 remains unchanged. */
export class MappingApprovalStore {
  private approvals = new Map<string, StoredMappingApproval>();
  private loaded = false;
  private corrupted = false;
  private mutationTail: Promise<void> = Promise.resolve();
  private readonly forcedRevoked = new Set<string>();
  private readonly revisions = new Map<string, number>();
  private readonly listeners = new Set<(mappingId?: string) => void>();
  private readonly historyEntries: MappingApprovalHistoryEntry[] = [];

  constructor(
    private readonly storage: AgentStorage,
    private readonly resolveMapping: (mappingId: string) => CustomMapping | undefined,
    private readonly options: MappingApprovalStoreOptions = { isWorkspaceTrusted: () => false },
  ) {}

  onWillChange(listener: (mappingId?: string) => void): MappingApprovalDisposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  load(): { corrupted: boolean; approvals: readonly MappingApprovalSummary[] } {
    const raw = this.storage.get<unknown>(MAPPING_APPROVAL_STORAGE_KEY);
    if (raw === undefined) {
      this.approvals.clear();
      this.loaded = true;
      this.corrupted = false;
      return { corrupted: false, approvals: [] };
    }
    try {
      const payload = validatePayload(raw);
      this.approvals = new Map(payload.approvals.map((approval) => [
        approval.mappingId,
        { ...approval },
      ]));
      this.loaded = true;
      this.corrupted = false;
    } catch {
      this.approvals.clear();
      this.loaded = true;
      this.corrupted = true;
    }
    return { corrupted: this.corrupted, approvals: this.list() };
  }

  list(): readonly MappingApprovalSummary[] {
    this.ensureLoaded();
    return [...this.approvals.values()].map(({ mappingId, approvedAt }) => ({
      mappingId,
      approvedAt,
      effective: this.isApproved(mappingId),
    }));
  }

  isApproved(mappingId: string): boolean {
    return this.state(mappingId) === 'approved';
  }

  state(mappingId: string): MappingApprovalState {
    this.ensureLoaded();
    if (
      this.corrupted
      || this.forcedRevoked.has(mappingId)
      || !this.options.isWorkspaceTrusted()
    ) return 'revoked';
    const approval = this.approvals.get(mappingId);
    if (!approval) return 'none';
    const mapping = safeResolve(this.resolveMapping, mappingId);
    return (
      mapping
      && mapping.enabled
      && mapping.agentEnabled
      && mappingFingerprint(mapping) === approval.fingerprint
    ) ? 'approved' : 'revoked';
  }

  grant(mappingId: string, now = Date.now()): Promise<MappingApprovalSummary> {
    this.ensureLoaded();
    if (!this.options.isWorkspaceTrusted()) {
      return Promise.reject(new Error('workspace-untrusted'));
    }
    const mapping = safeResolve(this.resolveMapping, mappingId);
    if (!mapping || !mapping.enabled || !mapping.agentEnabled) {
      return Promise.reject(new Error('mapping-unavailable'));
    }
    const expectedRevision = this.revision(mappingId);
    const approval: StoredMappingApproval = {
      mappingId,
      fingerprint: mappingFingerprint(mapping),
      approvedAt: boundedTimestamp(now),
    };
    this.notify(mappingId);
    return this.serialize(async () => {
      if (
        expectedRevision !== this.revision(mappingId)
        || !this.grantStillCurrent(mappingId, approval.fingerprint)
      ) {
        this.invalidate(mappingId);
        throw new Error('mapping-approval-revoked');
      }
      const next = new Map(this.approvals);
      next.set(mappingId, approval);
      if (next.size > MAX_MAPPING_APPROVALS) throw new Error('mapping-approval-limit');
      await this.persist(next);
      if (
        expectedRevision !== this.revision(mappingId)
        || !this.grantStillCurrent(mappingId, approval.fingerprint)
      ) {
        this.invalidate(mappingId);
        const revoked = new Map(this.approvals);
        revoked.delete(mappingId);
        await this.persist(revoked);
        throw new Error('mapping-approval-revoked');
      }
      this.forcedRevoked.delete(mappingId);
      this.remember(mappingId, 'granted', approval.approvedAt);
      return {
        mappingId,
        approvedAt: approval.approvedAt,
        effective: this.isApproved(mappingId),
      };
    });
  }

  revoke(mappingId: string): Promise<void> {
    this.ensureLoaded();
    this.invalidate(mappingId);
    this.remember(mappingId, 'revoked', Date.now());
    return this.serialize(async () => {
      if (!this.approvals.has(mappingId)) return;
      const next = new Map(this.approvals);
      next.delete(mappingId);
      await this.persist(next);
    });
  }

  revokeAll(): Promise<void> {
    this.ensureLoaded();
    for (const mappingId of this.approvals.keys()) {
      this.invalidate(mappingId, false);
      this.remember(mappingId, 'revoked', Date.now());
    }
    this.notify();
    return this.serialize(async () => this.persist(new Map()));
  }

  recordExecution(mappingId: string, alwaysApproved: boolean, now = Date.now()): void {
    if (!MAPPING_ID_PATTERN.test(mappingId)) return;
    this.remember(
      mappingId,
      alwaysApproved ? 'always-approved-execution' : 'confirmed-execution',
      boundedTimestamp(now),
    );
  }

  history(): readonly MappingApprovalHistoryEntry[] {
    return this.historyEntries.map((entry) => ({ ...entry }));
  }

  private ensureLoaded(): void {
    if (!this.loaded) this.load();
  }

  private revision(mappingId: string): number {
    return this.revisions.get(mappingId) ?? 0;
  }

  private invalidate(mappingId: string, notify = true): void {
    const revision = this.revision(mappingId);
    if (revision >= Number.MAX_SAFE_INTEGER) throw new RangeError('approval revision cannot advance');
    this.revisions.set(mappingId, revision + 1);
    this.forcedRevoked.add(mappingId);
    if (notify) this.notify(mappingId);
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.mutationTail.then(operation, operation);
    this.mutationTail = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private async persist(next: Map<string, StoredMappingApproval>): Promise<void> {
    const payload: MappingApprovalPayload = {
      schemaVersion: MAPPING_APPROVAL_SCHEMA_VERSION,
      approvals: [...next.values()].map((approval) => ({ ...approval })),
    };
    await this.storage.update(MAPPING_APPROVAL_STORAGE_KEY, payload);
    this.approvals = new Map(payload.approvals.map((approval) => [
      approval.mappingId,
      { ...approval },
    ]));
    this.corrupted = false;
  }

  private grantStillCurrent(mappingId: string, fingerprint: string): boolean {
    if (!this.options.isWorkspaceTrusted()) return false;
    const mapping = safeResolve(this.resolveMapping, mappingId);
    return Boolean(
      mapping
      && mapping.enabled
      && mapping.agentEnabled
      && mappingFingerprint(mapping) === fingerprint,
    );
  }

  private notify(mappingId?: string): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(mappingId);
      } catch {
        // Effective approval is recomputed and never depends on observer success.
      }
    }
  }

  private remember(
    mappingId: string,
    decision: MappingApprovalHistoryEntry['decision'],
    timestamp: number,
  ): void {
    this.historyEntries.push({ mappingId, decision, timestamp });
    if (this.historyEntries.length > 100) this.historyEntries.shift();
  }
}

function validatePayload(value: unknown): MappingApprovalPayload {
  if (!isPlainObject(value) || value.schemaVersion !== MAPPING_APPROVAL_SCHEMA_VERSION) {
    throw new Error('invalid-approval-payload');
  }
  if (!hasExactKeys(value, ['schemaVersion', 'approvals']) || !Array.isArray(value.approvals)) {
    throw new Error('invalid-approval-payload');
  }
  if (value.approvals.length > MAX_MAPPING_APPROVALS) throw new Error('invalid-approval-payload');
  const ids = new Set<string>();
  const approvals = value.approvals.map((raw) => {
    if (!isPlainObject(raw) || !hasExactKeys(raw, ['mappingId', 'fingerprint', 'approvedAt'])) {
      throw new Error('invalid-approval-payload');
    }
    if (
      typeof raw.mappingId !== 'string'
      || !MAPPING_ID_PATTERN.test(raw.mappingId)
      || ids.has(raw.mappingId)
      || typeof raw.fingerprint !== 'string'
      || !/^[a-f0-9]{64}$/u.test(raw.fingerprint)
      || typeof raw.approvedAt !== 'number'
      || !Number.isSafeInteger(raw.approvedAt)
      || raw.approvedAt < 0
    ) throw new Error('invalid-approval-payload');
    ids.add(raw.mappingId);
    return {
      mappingId: raw.mappingId,
      fingerprint: raw.fingerprint,
      approvedAt: raw.approvedAt,
    };
  });
  return { schemaVersion: MAPPING_APPROVAL_SCHEMA_VERSION, approvals };
}

function boundedTimestamp(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid-approval-time');
  return value;
}

function safeResolve(
  resolve: (mappingId: string) => CustomMapping | undefined,
  mappingId: string,
): CustomMapping | undefined {
  try {
    return resolve(mappingId);
  } catch {
    return undefined;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}
