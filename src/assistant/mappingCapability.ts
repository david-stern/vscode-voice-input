import { revalidateTargetSnapshot, type TargetSnapshot } from './context';
import {
  DEFAULT_MAPPING_CONFIRMATION_TTL_MS,
  MappingError,
  type CustomMapping,
  type MappingCapabilityDecision,
} from './mappingTypes';
import { mappingFingerprint } from './mappingValidation';

interface PendingMappingCapability {
  mappingId: string;
  fingerprint: string;
  requestUtteranceId: string;
  snapshot: TargetSnapshot;
  requestedAt: number;
  expiresAt: number;
}

export class MappingCapabilityPolicy {
  private pending: PendingMappingCapability | null = null;
  private readonly usedConfirmationIds = new Set<string>();
  private readonly ttlMs: number;

  constructor(options: { ttlMs?: number } = {}) {
    const requested = options.ttlMs;
    this.ttlMs = requested === undefined || !Number.isFinite(requested) || requested <= 0
      ? DEFAULT_MAPPING_CONFIRMATION_TTL_MS
      : Math.min(requested, DEFAULT_MAPPING_CONFIRMATION_TTL_MS);
  }

  request(
    mapping: CustomMapping,
    requestUtteranceId: string,
    snapshot: TargetSnapshot,
    now = Date.now(),
  ): { mappingId: string; fingerprint: string; expiresAt: number } {
    this.pending = null;
    if (!mapping.enabled || !requestUtteranceId || !snapshot.vscodeFocused) {
      throw new MappingError('invalid-payload');
    }
    const fingerprint = mappingFingerprint(mapping);
    const expiresAt = now + this.ttlMs;
    this.pending = {
      mappingId: mapping.id,
      fingerprint,
      requestUtteranceId,
      snapshot: cloneSnapshot(snapshot),
      requestedAt: now,
      expiresAt,
    };
    return { mappingId: mapping.id, fingerprint, expiresAt };
  }

  confirm(
    resolveMapping: (id: string) => CustomMapping | undefined,
    currentSnapshot: TargetSnapshot,
    confirmationUtteranceId: string,
    now = Date.now(),
  ): MappingCapabilityDecision {
    const pending = this.pending;
    this.pending = null;
    if (!pending) return { allowed: false, reason: 'no-pending-action' };
    if (now > pending.expiresAt) return { allowed: false, reason: 'confirmation-expired' };
    if (!confirmationUtteranceId) return { allowed: false, reason: 'invalid-confirmation' };
    if (confirmationUtteranceId === pending.requestUtteranceId) {
      return { allowed: false, reason: 'same-utterance-confirmation' };
    }
    if (now <= pending.requestedAt) {
      return { allowed: false, reason: 'confirmation-not-later' };
    }
    if (this.usedConfirmationIds.has(confirmationUtteranceId)) {
      return { allowed: false, reason: 'confirmation-replayed' };
    }
    this.rememberConfirmationId(confirmationUtteranceId);
    const mapping = resolveMapping(pending.mappingId);
    if (
      !mapping ||
      !mapping.enabled ||
      mappingFingerprint(mapping) !== pending.fingerprint
    ) {
      return { allowed: false, reason: 'mapping-changed' };
    }
    if (!revalidateTargetSnapshot(pending.snapshot, currentSnapshot).valid) {
      return { allowed: false, reason: 'target-changed' };
    }
    return {
      allowed: true,
      mappingId: pending.mappingId,
      fingerprint: pending.fingerprint,
    };
  }

  cancel(): void {
    this.pending = null;
  }

  getPending(now = Date.now()): {
    mappingId: string;
    fingerprint: string;
    expiresAt: number;
  } | null {
    if (!this.pending) return null;
    if (now > this.pending.expiresAt) {
      this.pending = null;
      return null;
    }
    return {
      mappingId: this.pending.mappingId,
      fingerprint: this.pending.fingerprint,
      expiresAt: this.pending.expiresAt,
    };
  }

  private rememberConfirmationId(id: string): void {
    this.usedConfirmationIds.add(id);
    if (this.usedConfirmationIds.size > 100) {
      const oldest = this.usedConfirmationIds.values().next().value as string | undefined;
      if (oldest) this.usedConfirmationIds.delete(oldest);
    }
  }
}

function cloneSnapshot(snapshot: TargetSnapshot): TargetSnapshot {
  return { ...snapshot };
}
