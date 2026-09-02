import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { GlobalStatePort } from './consent';
import type { SecretStoragePort } from './credentials';

export const AUTO_MODE_RECEIPT_KEY = 'voiceInput.autoModeReceipt.v1';
export const AUTO_MODE_INSTALLATION_SECRET_KEY = 'voiceInput.autoModeInstallation.v1';
export const AUTO_MODE_CONSENT_VERSION = 1;
export const AUTO_MODE_RECEIPT_SCHEMA_VERSION = 1 as const;
export const AUTO_MODE_ENABLE_REQUEST_TTL_MS = 120_000;

interface InstallationSecret {
  nonce: string;
  epoch: number;
}

export interface AutoModeReceipt {
  schemaVersion: typeof AUTO_MODE_RECEIPT_SCHEMA_VERSION;
  enabled: true;
  epoch: number;
  consentVersion: number;
  installationIdHash: string;
  policyFingerprint: string;
  enabledAt: number;
  authTag: string;
}

export interface AutoModeContext {
  workspaceTrusted: boolean;
  consentVersion: number;
  policyFingerprint: string;
  targetFingerprint: string;
}

export interface AutoModeAuthoritySnapshot {
  effective: boolean;
  epoch: number;
  fingerprint: string;
}

export interface AutoModeEnableRequest {
  requestId: string;
  epoch: number;
  consentVersion: number;
  policyFingerprint: string;
  targetFingerprint: string;
}

export interface AutoModeDisposable {
  dispose(): void;
}

export interface AutoModeNativePromptHost {
  confirmEnable(): Promise<boolean>;
}

interface PendingEnable extends AutoModeEnableRequest {
  revocationIntent: number;
  requestedAt: number;
  expiresAt: number;
}

/**
 * Machine-local authority. Raw configuration is deliberately absent from this
 * API and a receipt is valid only with the installation secret in SecretStorage.
 */
export class AutoModeService {
  private pending: PendingEnable | undefined;
  private revocationIntent = 0;
  private forcedOff = false;
  private mutationTail = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly state: GlobalStatePort,
    private readonly secrets: SecretStoragePort,
    private readonly now: () => number = Date.now,
    private readonly nonceFactory: () => string = () => randomBytes(32).toString('base64url'),
    private readonly requestIdFactory: () => string = () => randomBytes(24).toString('base64url'),
  ) {}

  onWillChange(listener: () => void): AutoModeDisposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  async snapshot(context: AutoModeContext): Promise<AutoModeAuthoritySnapshot> {
    const secret = await this.installationSecret();
    const raw = this.state.get<unknown>(AUTO_MODE_RECEIPT_KEY, undefined);
    const receipt = parseReceipt(raw);
    const effective = !this.forcedOff
      && context.workspaceTrusted
      && receipt !== undefined
      && receipt.enabled
      && receipt.epoch === secret.epoch
      && receipt.consentVersion === context.consentVersion
      && receipt.policyFingerprint === context.policyFingerprint
      && receipt.installationIdHash === installationHash(secret.nonce)
      && validTag(receipt, secret.nonce);
    return Object.freeze({
      effective,
      epoch: secret.epoch,
      fingerprint: authorityFingerprint(secret, context, effective),
    });
  }

  async beginEnable(context: AutoModeContext): Promise<AutoModeEnableRequest | undefined> {
    if (!validContext(context) || !context.workspaceTrusted) return undefined;
    const secret = await this.installationSecret();
    const requestedAt = this.now();
    if (
      !safeEpoch(requestedAt)
      || requestedAt > Number.MAX_SAFE_INTEGER - AUTO_MODE_ENABLE_REQUEST_TTL_MS
    ) return undefined;
    const request = Object.freeze({
      requestId: this.requestIdFactory(),
      epoch: secret.epoch,
      consentVersion: context.consentVersion,
      policyFingerprint: context.policyFingerprint,
      targetFingerprint: context.targetFingerprint,
      revocationIntent: this.revocationIntent,
      requestedAt,
      expiresAt: requestedAt + AUTO_MODE_ENABLE_REQUEST_TTL_MS,
    });
    this.pending = request;
    return publicRequest(request);
  }

  async completeEnable(
    requestId: string,
    nativeConfirmed: boolean,
    current: AutoModeContext,
  ): Promise<boolean> {
    const pending = this.pending;
    this.pending = undefined;
    if (!nativeConfirmed || !pending || pending.requestId !== requestId) return false;
    if (
      !requestIsFresh(pending, this.now())
      || !validContext(current)
      || !current.workspaceTrusted
      || pending.revocationIntent !== this.revocationIntent
      || pending.consentVersion !== current.consentVersion
      || pending.policyFingerprint !== current.policyFingerprint
      || pending.targetFingerprint !== current.targetFingerprint
    ) return false;

    return this.serialize(async () => {
      if (!requestIsFresh(pending, this.now())) return false;
      const secret = await this.installationSecret();
      const committedAt = this.now();
      if (
        !requestIsFresh(pending, committedAt)
        || secret.epoch !== pending.epoch
        || pending.revocationIntent !== this.revocationIntent
      ) {
        return false;
      }
      const nextSecret = { nonce: secret.nonce, epoch: nextEpoch(secret.epoch) };
      const receipt = signReceipt(nextSecret, current, committedAt);
      await this.secrets.store(AUTO_MODE_INSTALLATION_SECRET_KEY, JSON.stringify(nextSecret));
      if (pending.revocationIntent !== this.revocationIntent) return false;
      if (!requestIsFresh(pending, this.now())) {
        this.forcedOff = true;
        this.emit();
        await this.state.update(AUTO_MODE_RECEIPT_KEY, undefined);
        return false;
      }
      await this.state.update(AUTO_MODE_RECEIPT_KEY, receipt);
      if (
        pending.revocationIntent !== this.revocationIntent
        || !requestIsFresh(pending, this.now())
      ) {
        this.forcedOff = true;
        this.emit();
        await this.state.update(AUTO_MODE_RECEIPT_KEY, undefined);
        return false;
      }
      this.forcedOff = false;
      this.emit();
      return true;
    });
  }

  /** Immediate in memory; persistence is serialized behind any racing enable. */
  disable(): Promise<void> {
    this.revocationIntent = nextEpoch(this.revocationIntent);
    this.pending = undefined;
    this.forcedOff = true;
    this.emit();
    return this.serialize(async () => {
      const secret = await this.installationSecret();
      const nextSecret = { nonce: secret.nonce, epoch: nextEpoch(secret.epoch) };
      await this.secrets.store(AUTO_MODE_INSTALLATION_SECRET_KEY, JSON.stringify(nextSecret));
      await this.state.update(AUTO_MODE_RECEIPT_KEY, undefined);
    });
  }

  /** Consent/policy/import changes invalidate authority without trusting their payload. */
  invalidate(): Promise<void> {
    return this.disable();
  }

  private async installationSecret(): Promise<InstallationSecret> {
    const raw = await this.secrets.get(AUTO_MODE_INSTALLATION_SECRET_KEY);
    const parsed = parseInstallationSecret(raw);
    if (parsed) return parsed;
    const created = { nonce: this.nonceFactory(), epoch: 0 };
    if (!/^[A-Za-z0-9_-]{32,128}$/u.test(created.nonce)) throw new TypeError('invalid nonce source');
    await this.secrets.store(AUTO_MODE_INSTALLATION_SECRET_KEY, JSON.stringify(created));
    return created;
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.mutationTail.then(operation, operation);
    this.mutationTail = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private emit(): void {
    for (const listener of [...this.listeners]) {
      try { listener(); } catch { /* Revocation remains effective. */ }
    }
  }
}

/** Synchronous fail-closed projection for existing synchronous authority policies. */
export class AutoModeAuthorityCache {
  private current: AutoModeAuthoritySnapshot = Object.freeze({
    effective: false,
    epoch: 0,
    fingerprint: 'auto:uninitialized',
  });
  private generation = 0;
  private readonly listeners = new Set<() => void>();
  private readonly subscription: AutoModeDisposable;

  constructor(private readonly service: AutoModeService) {
    this.subscription = service.onWillChange(() => this.invalidate());
  }

  snapshot(): AutoModeAuthoritySnapshot {
    return this.current;
  }

  onWillChange(listener: () => void): AutoModeDisposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  async refresh(context: AutoModeContext): Promise<AutoModeAuthoritySnapshot> {
    const generation = this.generation;
    const next = await this.service.snapshot(context);
    if (generation === this.generation) this.current = next;
    return this.current;
  }

  dispose(): void {
    this.subscription.dispose();
    this.invalidate();
    this.listeners.clear();
  }

  private invalidate(): void {
    this.generation = nextEpoch(this.generation);
    this.current = Object.freeze({
      effective: false,
      epoch: nextEpoch(this.current.epoch),
      fingerprint: `auto:invalidated:${this.generation}`,
    });
    for (const listener of [...this.listeners]) {
      try { listener(); } catch { /* Invalidation remains effective. */ }
    }
  }
}

export async function enableAutoModeWithNativePrompt(
  service: AutoModeService,
  context: AutoModeContext,
  prompt: AutoModeNativePromptHost,
  currentContext: () => AutoModeContext,
): Promise<boolean> {
  const request = await service.beginEnable(context);
  if (!request) return false;
  const confirmed = await prompt.confirmEnable();
  return service.completeEnable(request.requestId, confirmed, currentContext());
}

function signReceipt(
  secret: InstallationSecret,
  context: AutoModeContext,
  enabledAt: number,
): AutoModeReceipt {
  const unsigned = {
    schemaVersion: AUTO_MODE_RECEIPT_SCHEMA_VERSION,
    enabled: true as const,
    epoch: secret.epoch,
    consentVersion: context.consentVersion,
    installationIdHash: installationHash(secret.nonce),
    policyFingerprint: context.policyFingerprint,
    enabledAt,
  };
  return Object.freeze({ ...unsigned, authTag: tag(unsigned, secret.nonce) });
}

function validTag(receipt: AutoModeReceipt, nonce: string): boolean {
  const { authTag, ...unsigned } = receipt;
  const expected = tag(unsigned, nonce);
  const actualBytes = Buffer.from(authTag, 'hex');
  const expectedBytes = Buffer.from(expected, 'hex');
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function tag(value: Omit<AutoModeReceipt, 'authTag'>, nonce: string): string {
  return createHmac('sha256', nonce).update(JSON.stringify(value)).digest('hex');
}

function installationHash(nonce: string): string {
  return createHash('sha256').update(`voice-input-auto:${nonce}`).digest('hex');
}

function authorityFingerprint(
  secret: InstallationSecret,
  context: AutoModeContext,
  effective: boolean,
): string {
  return createHmac('sha256', secret.nonce).update(JSON.stringify({
    epoch: secret.epoch,
    consentVersion: context.consentVersion,
    policyFingerprint: context.policyFingerprint,
    targetFingerprint: context.targetFingerprint,
    workspaceTrusted: context.workspaceTrusted,
    effective,
  })).digest('hex');
}

function parseReceipt(value: unknown): AutoModeReceipt | undefined {
  if (!plain(value)) return undefined;
  const keys = [
    'authTag', 'consentVersion', 'enabled', 'enabledAt', 'epoch',
    'installationIdHash', 'policyFingerprint', 'schemaVersion',
  ];
  if (Object.keys(value).sort().join(',') !== keys.sort().join(',')) return undefined;
  if (
    value.schemaVersion !== AUTO_MODE_RECEIPT_SCHEMA_VERSION
    || value.enabled !== true
    || !safeEpoch(value.epoch)
    || !safeEpoch(value.consentVersion)
    || !safeEpoch(value.enabledAt)
    || !hex(value.installationIdHash)
    || !hex(value.authTag)
    || !boundedFingerprint(value.policyFingerprint)
  ) return undefined;
  return value as unknown as AutoModeReceipt;
}

function parseInstallationSecret(value: string | undefined): InstallationSecret | undefined {
  if (!value || value.length > 512) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !plain(parsed)
      || Object.keys(parsed).sort().join(',') !== 'epoch,nonce'
      || !safeEpoch(parsed.epoch)
      || typeof parsed.nonce !== 'string'
      || !/^[A-Za-z0-9_-]{32,128}$/u.test(parsed.nonce)
    ) return undefined;
    return { nonce: parsed.nonce, epoch: parsed.epoch };
  } catch {
    return undefined;
  }
}

function publicRequest(pending: PendingEnable): AutoModeEnableRequest {
  return Object.freeze({
    requestId: pending.requestId,
    epoch: pending.epoch,
    consentVersion: pending.consentVersion,
    policyFingerprint: pending.policyFingerprint,
    targetFingerprint: pending.targetFingerprint,
  });
}

function requestIsFresh(pending: PendingEnable, now: number): boolean {
  return safeEpoch(now)
    && now >= pending.requestedAt
    && now <= pending.expiresAt;
}

function validContext(value: AutoModeContext): boolean {
  return typeof value.workspaceTrusted === 'boolean'
    && value.consentVersion === AUTO_MODE_CONSENT_VERSION
    && boundedFingerprint(value.policyFingerprint)
    && boundedFingerprint(value.targetFingerprint);
}

function boundedFingerprint(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 256
    && /^[A-Za-z0-9._:-]+$/u.test(value);
}

function hex(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function safeEpoch(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function nextEpoch(value: number): number {
  if (!safeEpoch(value) || value >= Number.MAX_SAFE_INTEGER) throw new RangeError('epoch exhausted');
  return value + 1;
}

function plain(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
