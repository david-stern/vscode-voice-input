import { randomBytes } from 'node:crypto';

import type { GlobalStatePort } from './consent';
import { SONIOX_SECRET_KEY } from './contracts';
import type { SecretStoragePort } from './credentials';
import {
  SONIOX_CONSENT_PROMPT_TTL_MS,
  SONIOX_ENDPOINT_POLICY_VERSION,
  SONIOX_REMOTE_CONSENT_RECEIPT_KEY,
  SONIOX_REMOTE_CONSENT_SCHEMA_VERSION,
  SONIOX_REMOTE_CONSENT_SECRET_KEY,
  SONIOX_REMOTE_CONSENT_VERSION,
  credentialTag,
  exactAuthority,
  nextEpoch,
  normalizeCredential,
  parseAuthority,
  parseReceipt,
  parseSecret,
  profileHash,
  promptFreshAt,
  promptStillCurrent,
  receiptFingerprint,
  receiptMatches,
  receiptTag,
  safeContext,
  safeEpoch,
  type ConsentSecret,
  type PendingConsent,
  type SonioxConnectionAuthoritySnapshot,
  type SonioxConsentContext,
  type SonioxRemoteConsentReceipt,
} from './sonioxConsentReceipt';

export {
  SONIOX_CONSENT_PROMPT_TTL_MS,
  SONIOX_ENDPOINT_POLICY_VERSION,
  SONIOX_REMOTE_CONSENT_RECEIPT_KEY,
  SONIOX_REMOTE_CONSENT_SCHEMA_VERSION,
  SONIOX_REMOTE_CONSENT_SECRET_KEY,
  SONIOX_REMOTE_CONSENT_VERSION,
  type SonioxConnectionAuthoritySnapshot,
  type SonioxConsentContext,
} from './sonioxConsentReceipt';

export interface SonioxConsentPromptHost {
  confirmRemoteProcessing(): PromiseLike<boolean>;
}

export interface SonioxConsentDisposable { dispose(): void }

/** Machine/profile-local remote-audio consent. Receipts and prompt bindings never leave the host. */
export class SonioxRemoteConsentService {
  private pending: PendingConsent | undefined;
  private invalidationGeneration = 0;
  private pendingCloses = 0;
  /** A revoke whose persistence failed must never fail open into the previous receipt. */
  private closedByFailedRevoke = false;
  private tail = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  private readonly storageSubscription: SonioxConsentDisposable | undefined;
  private lastLocalSecretValue: string | undefined;
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
        this.invalidateAuthority();
        return;
      }
      if (key === SONIOX_SECRET_KEY) {
        // Credential rotation closes authority at once; receipts stay fingerprint-bound.
        this.invalidateAuthority();
        return;
      }
      if (key !== SONIOX_REMOTE_CONSENT_SECRET_KEY) return;
      // The host delivers SecretStorage events asynchronously, so neither event order nor
      // event count identifies a self-write. Compare the stored value instead.
      void this.reconcileConsentSecret();
    });
  }

  onDidInvalidate(listener: () => void): SonioxConsentDisposable {
    if (this.disposed) return { dispose: () => {} };
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  async capture(): Promise<SonioxConnectionAuthoritySnapshot | undefined> {
    if (this.disposed || this.pendingCloses > 0 || this.closedByFailedRevoke) return undefined;
    const captureGeneration = this.invalidationGeneration;
    const context = safeContext(this.context());
    if (!context || context.selection !== 'soniox') return undefined;
    const receipt = parseReceipt(this.state.get<unknown>(SONIOX_REMOTE_CONSENT_RECEIPT_KEY, undefined));
    if (!receipt) return undefined;
    const secret = await this.installationSecret();
    if (!this.generationCurrent(captureGeneration)) return undefined;
    const credentialFingerprint = await this.credentialFingerprint(secret.nonce);
    if (
      !this.generationCurrent(captureGeneration)
      || this.pendingCloses > 0 || this.closedByFailedRevoke
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
      // Only real invalidations (revoke, credential change, external tamper) may abort the
      // commit, so the commit observes the generation instead of bumping it.
      const commitGeneration = this.invalidationGeneration;
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
      // A committed grant supersedes a failed close: this receipt is freshly signed against
      // the current secret epoch and credential fingerprint.
      this.closedByFailedRevoke = false;
      // Listeners are an invalidation channel only: they cancel live transcription, final,
      // and probe work. A grant precedes any authorized session, so it announces nothing.
      return true;
    });
  }

  /** Synchronously closes readiness; persistence is ordered behind any prompt completion. */
  revoke(): Promise<void> {
    this.pendingCloses += 1;
    this.invalidateAuthority();
    return this.serialize(async () => {
      try {
        // The receipt is dropped first: a failure while rotating the installation secret
        // must never leave a readable receipt behind for the next host to load.
        await this.state.update(SONIOX_REMOTE_CONSENT_RECEIPT_KEY, undefined);
        const secret = await this.installationSecret();
        const nextSecret = { nonce: secret.nonce, epoch: nextEpoch(secret.epoch) };
        await this.storeConsentSecret(nextSecret);
        this.closedByFailedRevoke = false;
      } catch (error) {
        // The receipt may still be readable, so stay closed until a close or grant succeeds.
        this.closedByFailedRevoke = true;
        throw error;
      } finally {
        this.pendingCloses -= 1;
      }
    });
  }

  invalidatePendingPrompt(): void {
    this.pending = undefined;
    this.invalidationGeneration = nextEpoch(this.invalidationGeneration);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.storageSubscription?.dispose();
    this.invalidateAuthority();
    this.listeners.clear();
  }

  /** Clears the pending prompt, closes the generation, notifies observers, never sticks. */
  private invalidateAuthority(): number {
    this.pending = undefined;
    this.invalidationGeneration = nextEpoch(this.invalidationGeneration);
    for (const listener of [...this.listeners]) {
      try { listener(); } catch { /* Authority remains invalid. */ }
    }
    return this.invalidationGeneration;
  }

  /** A stored value this service never wrote is an external mutation: fail closed. */
  private async reconcileConsentSecret(): Promise<void> {
    try {
      const current = await this.secrets.get(SONIOX_REMOTE_CONSENT_SECRET_KEY);
      if (!this.disposed && current !== this.lastLocalSecretValue) this.handleExternalMutation();
    } catch {
      if (!this.disposed) this.handleExternalMutation();
    }
  }

  private handleExternalMutation(): void {
    this.invalidateAuthority();
  }

  private async installationSecret(): Promise<ConsentSecret> {
    const raw = await this.secrets.get(SONIOX_REMOTE_CONSENT_SECRET_KEY);
    const parsed = parseSecret(raw);
    if (parsed) return parsed;
    const created = { nonce: this.nonceFactory(), epoch: 0 };
    if (!/^[A-Za-z0-9_-]{32,128}$/u.test(created.nonce)) throw new TypeError('invalid nonce source');
    const json = JSON.stringify(created);
    this.lastLocalSecretValue = json;
    await this.secrets.store(SONIOX_REMOTE_CONSENT_SECRET_KEY, json);
    return created;
  }

  private async credentialFingerprint(nonce: string): Promise<string | undefined> {
    const credential = normalizeCredential(await this.secrets.get(SONIOX_SECRET_KEY));
    return credential ? credentialTag(credential, nonce) : undefined;
  }

  /** Claims the value this service owns, writes it, and confirms the write by read-back. */
  private async storeConsentSecret(secret: ConsentSecret): Promise<boolean> {
    const json = JSON.stringify(secret);
    this.lastLocalSecretValue = json;
    await this.secrets.store(SONIOX_REMOTE_CONSENT_SECRET_KEY, json);
    const readBack = await this.secrets.get(SONIOX_REMOTE_CONSENT_SECRET_KEY);
    return readBack === json;
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

/** `onRefused` names the stage that refused so hosts can log it; it carries no receipt data. */
export async function requestSonioxConsentWithNativePrompt(
  service: SonioxRemoteConsentService,
  prompt: SonioxConsentPromptHost,
  onRefused?: (stage: 'begin' | 'declined' | 'complete') => void,
): Promise<boolean> {
  const requestId = await service.beginPrompt();
  if (!requestId) {
    onRefused?.('begin');
    return false;
  }
  const confirmed = await prompt.confirmRemoteProcessing();
  const granted = await service.completePrompt(requestId, confirmed);
  if (!granted) onRefused?.(confirmed ? 'complete' : 'declined');
  return granted;
}
