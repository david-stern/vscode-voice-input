import {
  PROVIDER_IDS as PLANNER_PROVIDER_IDS,
  type ProviderId as PlannerProviderId,
} from '../inference';
import {
  DEEPSEEK_SECRET_KEY,
  SONIOX_CREDENTIAL_EPOCH_SECRET_KEY,
  SONIOX_SECRET_KEY,
} from './contracts';

export const ANTHROPIC_SECRET_KEY = 'ANTHROPIC_API_KEY';
export const OPENAI_SECRET_KEY = 'OPENAI_API_KEY';
export const GEMINI_SECRET_KEY = 'GEMINI_API_KEY';
export const OPENROUTER_SECRET_KEY = 'OPENROUTER_API_KEY';
export const OLLAMA_SECRET_KEY = 'OLLAMA_API_KEY';
export const BEDROCK_SECRET_KEY = 'AWS_BEARER_TOKEN_BEDROCK';
export const GROK_SECRET_KEY = 'XAI_API_KEY';

export const PROVIDER_IDS = Object.freeze([
  'soniox',
  ...PLANNER_PROVIDER_IDS,
] as const);
export type ProviderId = 'soniox' | PlannerProviderId;

export const PROVIDER_SECRET_KEYS: Readonly<Record<ProviderId, string>> = Object.freeze({
  soniox: SONIOX_SECRET_KEY,
  deepseek: DEEPSEEK_SECRET_KEY,
  anthropic: ANTHROPIC_SECRET_KEY,
  openai: OPENAI_SECRET_KEY,
  gemini: GEMINI_SECRET_KEY,
  openrouter: OPENROUTER_SECRET_KEY,
  ollama: OLLAMA_SECRET_KEY,
  bedrock: BEDROCK_SECRET_KEY,
  grok: GROK_SECRET_KEY,
});

export interface CredentialDisposable {
  dispose(): void;
}

export interface SecretStorageChange {
  readonly key: string;
}

export interface SecretStoragePort {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
  onDidChange?(listener: (event: SecretStorageChange) => unknown): CredentialDisposable;
}

export interface CredentialStatus {
  provider: ProviderId;
  configured: boolean;
}

export interface CredentialInvalidation {
  provider: ProviderId;
  revision: number;
}

export function providerRequiresCredential(provider: ProviderId): boolean {
  return provider !== 'ollama';
}

/** Keeps secret values inside callbacks and projects provider-specific status only. */
export class CredentialService {
  private readonly forcedMissing = new Set<ProviderId>();
  private readonly revocationRevisions = new Map<ProviderId, number>();
  private readonly mutationRevisions = new Map<ProviderId, number>();
  private readonly mutationTails = new Map<ProviderId, Promise<void>>();
  private readonly invalidationListeners = new Set<(event: CredentialInvalidation) => void>();
  private readonly storageSubscription: CredentialDisposable | undefined;

  constructor(private readonly storage: SecretStoragePort) {
    this.storageSubscription = storage.onDidChange?.((event) => {
      const provider = providerForSecretKey(event?.key);
      if (provider) this.invalidate(provider, false);
    });
  }

  onDidInvalidate(listener: (event: CredentialInvalidation) => void): CredentialDisposable {
    this.invalidationListeners.add(listener);
    return { dispose: () => this.invalidationListeners.delete(listener) };
  }

  revision(provider: ProviderId): number {
    return this.revocationRevisions.get(provider) ?? 0;
  }

  /** Durable, secret-scoped binding for machine-local Soniox consent receipts. */
  async persistentRevision(provider: ProviderId): Promise<number> {
    if (provider !== 'soniox') return this.revision(provider);
    const raw = await this.storage.get(SONIOX_CREDENTIAL_EPOCH_SECRET_KEY);
    if (raw === undefined) return 0;
    if (!/^(?:0|[1-9][0-9]{0,15})$/u.test(raw)) {
      throw new Error('credential epoch is unavailable');
    }
    const revision = Number(raw);
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new Error('credential epoch is unavailable');
    }
    return revision;
  }

  async set(provider: ProviderId, credential: string): Promise<CredentialStatus> {
    const normalized = normalizeCredential(credential);
    if (!normalized) return this.status(provider);
    // Creation and replacement are authority changes too. Close every active
    // connection/prompt synchronously before the new secret is persisted.
    const expectedMutation = this.beginMutation(provider);
    return this.serialize(provider, async () => {
      await this.advancePersistentRevision(provider);
      await this.storage.store(PROVIDER_SECRET_KEYS[provider], normalized);
      const configured = Boolean(normalizeCredential(
        await this.storage.get(PROVIDER_SECRET_KEYS[provider]),
      ));
      if (expectedMutation === this.mutationRevision(provider)) {
        this.forcedMissing.delete(provider);
        return { provider, configured };
      }
      return { provider, configured: false };
    });
  }

  clear(provider: ProviderId): Promise<CredentialStatus> {
    this.beginMutation(provider);
    return this.serialize(provider, async () => {
      await this.advancePersistentRevision(provider);
      await this.storage.delete(PROVIDER_SECRET_KEYS[provider]);
      return { provider, configured: false };
    });
  }

  async status(provider: ProviderId): Promise<CredentialStatus> {
    const revision = this.revision(provider);
    if (this.forcedMissing.has(provider)) return { provider, configured: false };
    const credential = await this.storage.get(PROVIDER_SECRET_KEYS[provider]);
    return {
      provider,
      configured: revision === this.revision(provider)
        && !this.forcedMissing.has(provider)
        && Boolean(normalizeCredential(credential)),
    };
  }

  async statuses(): Promise<readonly CredentialStatus[]> {
    return Promise.all(PROVIDER_IDS.map((provider) => this.status(provider)));
  }

  async use<T>(
    provider: ProviderId,
    operation: (credential: string) => Promise<T>,
  ): Promise<T | undefined> {
    const revision = this.revision(provider);
    if (this.forcedMissing.has(provider)) return undefined;
    const credential = normalizeCredential(
      await this.storage.get(PROVIDER_SECRET_KEYS[provider]),
    );
    if (
      !credential
      || revision !== this.revision(provider)
      || this.forcedMissing.has(provider)
    ) return undefined;
    return operation(credential);
  }

  /** Ollama loopback may execute the callback without a secret; all other providers stay required. */
  async useOptional<T>(
    provider: ProviderId,
    operation: (credential: string | undefined) => Promise<T>,
  ): Promise<T | undefined> {
    const revision = this.revision(provider);
    if (this.forcedMissing.has(provider)) {
      return providerRequiresCredential(provider) ? undefined : operation(undefined);
    }
    const credential = normalizeCredential(
      await this.storage.get(PROVIDER_SECRET_KEYS[provider]),
    );
    if (revision !== this.revision(provider) || this.forcedMissing.has(provider)) {
      return providerRequiresCredential(provider) ? undefined : operation(undefined);
    }
    if (!credential && providerRequiresCredential(provider)) return undefined;
    return operation(credential);
  }

  dispose(): void {
    this.storageSubscription?.dispose();
    this.invalidationListeners.clear();
  }

  private beginMutation(provider: ProviderId): number {
    const current = this.mutationRevision(provider);
    if (current >= Number.MAX_SAFE_INTEGER) {
      throw new RangeError('credential mutation revision cannot advance');
    }
    const revision = current + 1;
    this.mutationRevisions.set(provider, revision);
    this.invalidate(provider, true);
    return revision;
  }

  private mutationRevision(provider: ProviderId): number {
    return this.mutationRevisions.get(provider) ?? 0;
  }

  private invalidate(provider: ProviderId, forceMissing: boolean): void {
    const current = this.revision(provider);
    if (current >= Number.MAX_SAFE_INTEGER) {
      throw new RangeError('credential revision cannot advance');
    }
    const revision = current + 1;
    this.revocationRevisions.set(provider, revision);
    if (forceMissing) this.forcedMissing.add(provider);
    const event = Object.freeze({ provider, revision });
    for (const listener of [...this.invalidationListeners]) {
      try {
        listener(event);
      } catch {
        // Revocation remains synchronous even when an observer fails.
      }
    }
  }

  private async advancePersistentRevision(provider: ProviderId): Promise<void> {
    if (provider !== 'soniox') return;
    const current = await this.persistentRevision(provider);
    if (current >= Number.MAX_SAFE_INTEGER) {
      throw new RangeError('credential epoch cannot advance');
    }
    await this.storage.store(SONIOX_CREDENTIAL_EPOCH_SECRET_KEY, String(current + 1));
  }

  private serialize<T>(provider: ProviderId, operation: () => Promise<T>): Promise<T> {
    const tail = this.mutationTails.get(provider) ?? Promise.resolve();
    const pending = tail.then(operation, operation);
    this.mutationTails.set(provider, pending.then(() => undefined, () => undefined));
    return pending;
  }
}

function normalizeCredential(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > 4_096 || /[\r\n\u0000]/u.test(normalized)) {
    return undefined;
  }
  return normalized;
}

function providerForSecretKey(key: unknown): ProviderId | undefined {
  if (typeof key !== 'string') return undefined;
  return PROVIDER_IDS.find((provider) => PROVIDER_SECRET_KEYS[provider] === key);
}
