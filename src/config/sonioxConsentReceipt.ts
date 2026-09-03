import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import type { TranscriptionProviderSelection } from '../speech/contracts';

export const SONIOX_REMOTE_CONSENT_RECEIPT_KEY = 'voiceInput.sonioxRemoteConsent.v1';
export const SONIOX_REMOTE_CONSENT_SECRET_KEY = 'voiceInput.sonioxRemoteConsentInstallation.v1';
export const SONIOX_REMOTE_CONSENT_VERSION = 1;
export const SONIOX_ENDPOINT_POLICY_VERSION = 1;
export const SONIOX_REMOTE_CONSENT_SCHEMA_VERSION = 1 as const;
export const SONIOX_CONSENT_PROMPT_TTL_MS = 120_000;

export interface ConsentSecret { nonce: string; epoch: number }

export interface SonioxRemoteConsentReceipt {
  schemaVersion: typeof SONIOX_REMOTE_CONSENT_SCHEMA_VERSION;
  provider: 'soniox';
  epoch: number;
  consentVersion: number;
  endpointPolicyVersion: number;
  credentialRevision: number;
  credentialFingerprint: string;
  profileHash: string;
  grantedAt: number;
  authTag: string;
}

export interface SonioxConsentContext {
  selection: TranscriptionProviderSelection;
  profileIdentity: string;
  credentialRevision: number;
  focused: boolean;
  panelGeneration: number;
}

export interface SonioxConnectionAuthoritySnapshot {
  readonly provider: 'soniox';
  readonly epoch: number;
  readonly credentialRevision: number;
  readonly profileHash: string;
  readonly fingerprint: string;
}

export interface PendingConsent {
  requestId: string;
  secretEpoch: number;
  invalidationGeneration: number;
  profileHash: string;
  credentialRevision: number;
  credentialFingerprint: string;
  panelGeneration: number;
  expiresAt: number;
}

export function receiptMatches(
  receipt: SonioxRemoteConsentReceipt,
  secret: ConsentSecret,
  context: SonioxConsentContext,
  credentialFingerprint: string,
): boolean {
  return receipt.epoch === secret.epoch
    && receipt.consentVersion === SONIOX_REMOTE_CONSENT_VERSION
    && receipt.endpointPolicyVersion === SONIOX_ENDPOINT_POLICY_VERSION
    && receipt.credentialRevision === context.credentialRevision
    && receipt.credentialFingerprint === credentialFingerprint
    && receipt.profileHash === profileHash(context.profileIdentity)
    && validTag(receipt, secret.nonce);
}

/** The native confirmation is the gesture, and focus after a modal closes is not given. */
export function promptStillCurrent(
  pending: PendingConsent,
  context: SonioxConsentContext,
  generation: number,
): boolean {
  return context.selection === 'soniox'
    && pending.invalidationGeneration === generation
    && pending.profileHash === profileHash(context.profileIdentity)
    && pending.credentialRevision === context.credentialRevision
    && pending.panelGeneration === context.panelGeneration;
}

export function promptFreshAt(pending: PendingConsent, now: number): boolean {
  return safeEpoch(now) && now < pending.expiresAt;
}

export function safeContext(value: SonioxConsentContext): SonioxConsentContext | undefined {
  return value
    && (value.selection === 'none' || value.selection === 'soniox' || value.selection === 'legacy-soniox-pending')
    && typeof value.profileIdentity === 'string'
    && value.profileIdentity.length > 0
    && value.profileIdentity.length <= 2_048
    && safeEpoch(value.credentialRevision)
    && typeof value.focused === 'boolean'
    && safeEpoch(value.panelGeneration)
    ? value
    : undefined;
}

export function parseReceipt(value: unknown): SonioxRemoteConsentReceipt | undefined {
  if (!plain(value)) return undefined;
  const keys = [
    'authTag', 'consentVersion', 'credentialFingerprint', 'credentialRevision',
    'endpointPolicyVersion', 'epoch', 'grantedAt', 'profileHash', 'provider', 'schemaVersion',
  ];
  if (Object.keys(value).sort().join(',') !== keys.sort().join(',')) return undefined;
  if (
    value.schemaVersion !== SONIOX_REMOTE_CONSENT_SCHEMA_VERSION
    || value.provider !== 'soniox'
    || !safeEpoch(value.epoch)
    || !safeEpoch(value.consentVersion)
    || !safeEpoch(value.endpointPolicyVersion)
    || !safeEpoch(value.credentialRevision)
    || !safeEpoch(value.grantedAt)
    || !hex(value.credentialFingerprint)
    || !hex(value.profileHash)
    || !hex(value.authTag)
  ) return undefined;
  return value as unknown as SonioxRemoteConsentReceipt;
}

export function parseSecret(value: string | undefined): ConsentSecret | undefined {
  if (!value || value.length > 512) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!plain(parsed) || Object.keys(parsed).sort().join(',') !== 'epoch,nonce') return undefined;
    if (!safeEpoch(parsed.epoch) || typeof parsed.nonce !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/u.test(parsed.nonce)) {
      return undefined;
    }
    return { nonce: parsed.nonce, epoch: parsed.epoch };
  } catch {
    return undefined;
  }
}

export function parseAuthority(value: Readonly<object>): SonioxConnectionAuthoritySnapshot | undefined {
  if (!plain(value) || Object.keys(value).sort().join(',') !== 'credentialRevision,epoch,fingerprint,profileHash,provider') {
    return undefined;
  }
  if (
    value.provider !== 'soniox'
    || !safeEpoch(value.epoch)
    || !safeEpoch(value.credentialRevision)
    || !hex(value.profileHash)
    || !hex(value.fingerprint)
  ) return undefined;
  return value as unknown as SonioxConnectionAuthoritySnapshot;
}

export function exactAuthority(
  a: SonioxConnectionAuthoritySnapshot,
  b: SonioxConnectionAuthoritySnapshot,
): boolean {
  return a.provider === b.provider
    && a.epoch === b.epoch
    && a.credentialRevision === b.credentialRevision
    && a.profileHash === b.profileHash
    && a.fingerprint === b.fingerprint;
}

export function receiptFingerprint(receipt: SonioxRemoteConsentReceipt): string {
  return createHash('sha256').update(JSON.stringify(receipt)).digest('hex');
}

export function receiptTag(
  value: Omit<SonioxRemoteConsentReceipt, 'authTag'>,
  nonce: string,
): string {
  return createHmac('sha256', nonce).update(JSON.stringify(value)).digest('hex');
}

export function credentialTag(credential: string, nonce: string): string {
  return createHmac('sha256', nonce)
    .update(`voice-input-soniox-credential:${credential}`)
    .digest('hex');
}

export function profileHash(identity: string): string {
  return createHash('sha256').update(`voice-input-soniox-profile:${identity}`).digest('hex');
}

export function normalizeCredential(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized
    && normalized.length <= 4_096
    && !/[\r\n\u0000]/u.test(normalized)
    ? normalized
    : undefined;
}

export function nextEpoch(value: number): number {
  if (!safeEpoch(value) || value >= Number.MAX_SAFE_INTEGER) throw new RangeError('consent epoch exhausted');
  return value + 1;
}

export function safeEpoch(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function validTag(receipt: SonioxRemoteConsentReceipt, nonce: string): boolean {
  const { authTag, ...unsigned } = receipt;
  const expected = Buffer.from(receiptTag(unsigned, nonce), 'hex');
  const actual = Buffer.from(authTag, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function hex(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function plain(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
