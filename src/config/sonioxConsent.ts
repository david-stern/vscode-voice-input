import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { TranscriptionProviderSelection } from '../speech/contracts';
import type { GlobalStatePort } from './consent';
import { SONIOX_SECRET_KEY } from './contracts';
import type { SecretStoragePort } from './credentials';

export const SONIOX_REMOTE_CONSENT_RECEIPT_KEY = 'voiceInput.sonioxRemoteConsent.v1';
export const SONIOX_REMOTE_CONSENT_SECRET_KEY = 'voiceInput.sonioxRemoteConsentInstallation.v1';
export const SONIOX_REMOTE_CONSENT_VERSION = 1;
export const SONIOX_ENDPOINT_POLICY_VERSION = 1;
export const SONIOX_REMOTE_CONSENT_SCHEMA_VERSION = 1 as const;
export const SONIOX_CONSENT_PROMPT_TTL_MS = 120_000;

interface ConsentSecret { nonce: string; epoch: number }

interface SonioxRemoteConsentReceipt {
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

export interface SonioxConsentPromptHost {
  confirmRemoteProcessing(): PromiseLike<boolean>;
}

export interface SonioxConsentDisposable { dispose(): void }

interface PendingConsent {
  requestId: string;
  secretEpoch: number;
  invalidationGeneration: number;
  profileHash: string;
  credentialRevision: number;
  credentialFingerprint: string;
  panelGeneration: number;
  expiresAt: number;
}

/** Machine/profile-local remote-audio consent. Receipts and prompt bindings never leave the host. */
export class SonioxRemoteConsentService {
  private pending: PendingConsent | undefined;
  private invalidationGeneration = 0;
  private forcedInvalid = false;
  private tail = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  private readonly storageSubscription: SonioxConsentDisposable | undefined;
  private readonly observesSecretChanges: boolean;
  private localConsentSecretWrite: { events: number } | undefined;
  private disposed = false;

  constructor(
    private readonly state: GlobalStatePort,
    private readonly secrets: SecretStoragePort,
    private readonly context: () => SonioxConsentContext,
    private readonly now: () => number = Date.now,
    private readonly nonceFactory: () => string = () => randomBytes(32).toString('base64url'),
    private readonly requestFactory: () => string = () => randomBytes(24).toString('base64url'),
  ) {
    this.storageSubscription = secrets.onDidChange?.((event) => {
      if (this.disposed) return;
      let key: unknown;
      try { key = event?.key; } catch {
        this.announceInvalidation();
        return;
      }
      if (key === SONIOX_SECRET_KEY) {
        this.announceInvalidation();
        return;
      }
      if (key !== SONIOX_REMOTE_CONSENT_SECRET_KEY) return;
      const localWrite = this.localConsentSecretWrite;
      if (localWrite) {
        localWrite.events += 1;
        if (localWrite.events === 1) return;
      }
      this.announceInvalidation();
    });
    this.observesSecretChanges = this.storageSubscription !== undefined;
  }

  onDidInvalidate(listener: () => void): SonioxConsentDisposable {
    if (this.disposed) return { dispose: () => {} };
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  async capture(): Promise<SonioxConnectionAuthoritySnapshot | undefined> {
    if (this.disposed) return undefined;
    const captureGeneration = this.invalidationGeneration;
    const context = safeContext(this.context());
    if (!context || context.selection !== 'soniox' || this.forcedInvalid) return undefined;
    const receipt = parseReceipt(this.state.get<unknown>(SONIOX_REMOTE_CONSENT_RECEIPT_KEY, undefined));
    if (!receipt) return undefined;
    const secret = await this.installationSecret();
    if (!this.generationCurrent(captureGeneration)) return undefined;
    const credentialFingerprint = await this.credentialFingerprint(secret.nonce);
    if (
      !this.generationCurrent(captureGeneration)
      || this.forcedInvalid
      || !credentialFingerprint
      || !receiptMatches(receipt, secret, context, credentialFingerprint)
    ) return undefined;
    return Object.freeze({
      provider: 'soniox' as const,
      epoch: receipt.epoch,
      credentialRevision: receipt.credentialRevision,
      profileHash: receipt.profileHash,
      fingerprint: receiptFingerprint(receipt),
    });
  }

  async revalidate(authority: Readonly<object>): Promise<boolean> {
    const current = await this.capture();
    const candidate = parseAuthority(authority);
    return Boolean(current && candidate && exactAuthority(current, candidate));
  }

  async beginPrompt(): Promise<string | undefined> {
    if (this.disposed) return undefined;
    const context = safeContext(this.context());
    if (!context || context.selection !== 'soniox' || !context.focused) return undefined;
    const secret = await this.installationSecret();
    if (this.disposed) return undefined;
    const promptGeneration = this.invalidationGeneration;
    const credentialFingerprint = await this.credentialFingerprint(secret.nonce);
    if (!this.generationCurrent(promptGeneration) || !credentialFingerprint) return undefined;
    const requestId = this.requestFactory();
    if (!/^[A-Za-z0-9_-]{24,128}$/u.test(requestId)) throw new TypeError('invalid request source');
    const requestedAt = this.now();
    if (!safeEpoch(requestedAt)
      || requestedAt > Number.MAX_SAFE_INTEGER - SONIOX_CONSENT_PROMPT_TTL_MS) return undefined;
    this.pending = {
      requestId,
      secretEpoch: secret.epoch,
      invalidationGeneration: promptGeneration,
      profileHash: profileHash(context.profileIdentity),
      credentialRevision: context.credentialRevision,
      credentialFingerprint,
      panelGeneration: context.panelGeneration,
      expiresAt: requestedAt + SONIOX_CONSENT_PROMPT_TTL_MS,
    };
    return requestId;
  }

  async completePrompt(requestId: string, nativeConfirmed: boolean): Promise<boolean> {
    const pending = this.pending;
    this.pending = undefined;
    if (this.disposed
      || !nativeConfirmed
      || !pending
      || pending.requestId !== requestId
      || !this.promptFresh(pending)) {
      return false;
    }
    const context = safeContext(this.context());
    if (!context || !promptStillCurrent(pending, context, this.invalidationGeneration)) return false;

    return this.serialize(async () => {
      if (!this.promptFresh(pending)) return false;
      const secret = parseSecret(await this.secrets.get(SONIOX_REMOTE_CONSENT_SECRET_KEY));
      if (this.disposed || !this.promptFresh(pending) || !secret || secret.epoch !== pending.secretEpoch) return false;
      const current = safeContext(this.context());
      if (!current || !promptStillCurrent(pending, current, this.invalidationGeneration)) return false;
      const credentialFingerprint = await this.credentialFingerprint(secret.nonce);
      if (
        !this.promptFresh(pending)
        || !credentialFingerprint
        || credentialFingerprint !== pending.credentialFingerprint
      ) return false;
      const commitContext = safeContext(this.context());
      if (!commitContext
        || !promptStillCurrent(pending, commitContext, this.invalidationGeneration)) return false;
      const grantedAt = this.now();
      if (!promptFreshAt(pending, grantedAt)) return false;
      const commitGeneration = this.announceInvalidation();
      const nextSecret = { nonce: secret.nonce, epoch: nextEpoch(secret.epoch) };
      const unsigned: Omit<SonioxRemoteConsentReceipt, 'authTag'> = {
        schemaVersion: SONIOX_REMOTE_CONSENT_SCHEMA_VERSION,
        provider: 'soniox',
        epoch: nextSecret.epoch,
        consentVersion: SONIOX_REMOTE_CONSENT_VERSION,
        endpointPolicyVersion: SONIOX_ENDPOINT_POLICY_VERSION,
        credentialRevision: commitContext.credentialRevision,
        credentialFingerprint,
        profileHash: profileHash(commitContext.profileIdentity),
        grantedAt,
      };
      const receipt: SonioxRemoteConsentReceipt = Object.freeze({
        ...unsigned,
        authTag: receiptTag(unsigned, nextSecret.nonce),
      });
      if (!this.promptFresh(pending)) return false;
      if (!await this.storeConsentSecret(nextSecret)) return false;
      if (!this.promptFresh(pending) || !this.generationCurrent(commitGeneration)) return false;
      const prewriteFingerprint = await this.credentialFingerprint(nextSecret.nonce);
      if (!this.promptFresh(pending)
        || prewriteFingerprint !== credentialFingerprint
        || !this.generationCurrent(commitGeneration)) return false;
      if (!this.promptFresh(pending) || !this.generationCurrent(commitGeneration)) return false;
      await this.state.update(SONIOX_REMOTE_CONSENT_RECEIPT_KEY, receipt);
      if (!this.promptFresh(pending) || !this.generationCurrent(commitGeneration)) {
        await this.state.update(SONIOX_REMOTE_CONSENT_RECEIPT_KEY, undefined);
        return false;
      }
      const persistedFingerprint = await this.credentialFingerprint(nextSecret.nonce);
      if (!this.promptFresh(pending)
        || !this.generationCurrent(commitGeneration)
        || persistedFingerprint !== credentialFingerprint) {
        await this.state.update(SONIOX_REMOTE_CONSENT_RECEIPT_KEY, undefined);
        return false;
      }
      this.forcedInvalid = false;
      return true;
    });
  }

  /** Synchronously closes readiness; persistence is ordered behind any prompt completion. */
  revoke(): Promise<void> {
    this.announceInvalidation();
    return this.serialize(async () => {
      const secret = await this.installationSecret();
      const nextSecret = { nonce: secret.nonce, epoch: nextEpoch(secret.epoch) };
      await this.storeConsentSecret(nextSecret);
      await this.state.update(SONIOX_REMOTE_CONSENT_RECEIPT_KEY, undefined);
    });
  }

  invalidatePendingPrompt(): void {
    this.pending = undefined;
    this.invalidationGeneration = nextEpoch(this.invalidationGeneration);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pending = undefined;
    this.invalidationGeneration = nextEpoch(this.invalidationGeneration);
    this.forcedInvalid = true;
    this.storageSubscription?.dispose();
    for (const listener of [...this.listeners]) {
      try { listener(); } catch { /* Authority remains invalid. */ }
    }
    this.listeners.clear();
  }

  private announceInvalidation(): number {
    this.pending = undefined;
    this.invalidationGeneration = nextEpoch(this.invalidationGeneration);
    this.forcedInvalid = true;
    for (const listener of [...this.listeners]) {
      try { listener(); } catch { /* Authority remains invalid. */ }
    }
    return this.invalidationGeneration;
  }

  private async installationSecret(): Promise<ConsentSecret> {
    const raw = await this.secrets.get(SONIOX_REMOTE_CONSENT_SECRET_KEY);
    const parsed = parseSecret(raw);
    if (parsed) return parsed;
    const created = { nonce: this.nonceFactory(), epoch: 0 };
    if (!/^[A-Za-z0-9_-]{32,128}$/u.test(created.nonce)) throw new TypeError('invalid nonce source');
    await this.secrets.store(SONIOX_REMOTE_CONSENT_SECRET_KEY, JSON.stringify(created));
    return created;
  }

  private async credentialFingerprint(nonce: string): Promise<string | undefined> {
    const credential = normalizeCredential(await this.secrets.get(SONIOX_SECRET_KEY));
    return credential
      ? createHmac('sha256', nonce)
        .update(`voice-input-soniox-credential:${credential}`)
        .digest('hex')
      : undefined;
  }

  private async storeConsentSecret(secret: ConsentSecret): Promise<boolean> {
    if (!this.observesSecretChanges) {
      await this.secrets.store(SONIOX_REMOTE_CONSENT_SECRET_KEY, JSON.stringify(secret));
      return true;
    }
    if (this.localConsentSecretWrite) return false;
    const observation = { events: 0 };
    this.localConsentSecretWrite = observation;
    try {
      await this.secrets.store(SONIOX_REMOTE_CONSENT_SECRET_KEY, JSON.stringify(secret));
      return observation.events === 1;
    } finally {
      if (this.localConsentSecretWrite === observation) this.localConsentSecretWrite = undefined;
    }
  }

  private promptFresh(pending: PendingConsent): boolean {
    return !this.disposed && promptFreshAt(pending, this.now());
  }

  private generationCurrent(generation: number): boolean {
    return !this.disposed && this.invalidationGeneration === generation;
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(operation, operation);
    this.tail = pending.then(() => undefined, () => undefined);
    return pending;
  }
}

export async function requestSonioxConsentWithNativePrompt(
  service: SonioxRemoteConsentService,
  prompt: SonioxConsentPromptHost,
): Promise<boolean> {
  const requestId = await service.beginPrompt();
  if (!requestId) return false;
  const confirmed = await prompt.confirmRemoteProcessing();
  return service.completePrompt(requestId, confirmed);
}

function receiptMatches(
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

function promptStillCurrent(
  pending: PendingConsent,
  context: SonioxConsentContext,
  generation: number,
): boolean {
  return context.selection === 'soniox'
    && context.focused
    && pending.invalidationGeneration === generation
    && pending.profileHash === profileHash(context.profileIdentity)
    && pending.credentialRevision === context.credentialRevision
    && pending.panelGeneration === context.panelGeneration;
}

function promptFreshAt(pending: PendingConsent, now: number): boolean {
  return safeEpoch(now) && now < pending.expiresAt;
}

function safeContext(value: SonioxConsentContext): SonioxConsentContext | undefined {
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

function parseReceipt(value: unknown): SonioxRemoteConsentReceipt | undefined {
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

function parseSecret(value: string | undefined): ConsentSecret | undefined {
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

function parseAuthority(value: Readonly<object>): SonioxConnectionAuthoritySnapshot | undefined {
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

function exactAuthority(a: SonioxConnectionAuthoritySnapshot, b: SonioxConnectionAuthoritySnapshot): boolean {
  return a.provider === b.provider
    && a.epoch === b.epoch
    && a.credentialRevision === b.credentialRevision
    && a.profileHash === b.profileHash
    && a.fingerprint === b.fingerprint;
}

function validTag(receipt: SonioxRemoteConsentReceipt, nonce: string): boolean {
  const { authTag, ...unsigned } = receipt;
  const expected = Buffer.from(receiptTag(unsigned, nonce), 'hex');
  const actual = Buffer.from(authTag, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function receiptTag(value: Omit<SonioxRemoteConsentReceipt, 'authTag'>, nonce: string): string {
  return createHmac('sha256', nonce).update(JSON.stringify(value)).digest('hex');
}

function receiptFingerprint(receipt: SonioxRemoteConsentReceipt): string {
  return createHash('sha256').update(JSON.stringify(receipt)).digest('hex');
}

function profileHash(identity: string): string {
  return createHash('sha256').update(`voice-input-soniox-profile:${identity}`).digest('hex');
}

function normalizeCredential(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized
    && normalized.length <= 4_096
    && !/[\r\n\u0000]/u.test(normalized)
    ? normalized
    : undefined;
}

function nextEpoch(value: number): number {
  if (!safeEpoch(value) || value >= Number.MAX_SAFE_INTEGER) throw new RangeError('consent epoch exhausted');
  return value + 1;
}

function safeEpoch(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function hex(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function plain(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
