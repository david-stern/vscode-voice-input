import {
  PROVIDER_IDS as PLANNER_PROVIDER_IDS,
  type ProviderId as PlannerProviderId,
} from '../inference';
import { DEEPSEEK_SECRET_KEY, SONIOX_SECRET_KEY } from './contracts';

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

export interface SecretStoragePort {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}

export interface CredentialStatus {
  provider: ProviderId;
  configured: boolean;
}

export interface CredentialInvalidation {
  provider: ProviderId;
  revision: number;
}

export interface CredentialDisposable {
  dispose(): void;
}

export function providerRequiresCredential(provider: ProviderId): boolean {
  return provider !== 'ollama';
}

/** Keeps secret values inside callbacks and projects provider-specific status only. */
export class CredentialService {
  private readonly forcedMissing = new Set<ProviderId>();
  private readonly revocationRevisions = new Map<ProviderId, number>();
  private readonly mutationTails = new Map<ProviderId, Promise<void>>();
  private readonly invalidationListeners = new Set<(event: CredentialInvalidation) => void>();

  constructor(private readonly storage: SecretStoragePort) {}

  onDidInvalidate(listener: (event: CredentialInvalidation) => void): CredentialDisposable {
    this.invalidationListeners.add(listener);
    return { dispose: () => this.invalidationListeners.delete(listener) };
  }

  revision(provider: ProviderId): number {
    return this.revocationRevisions.get(provider) ?? 0;
  }

  async set(provider: ProviderId, credential: string): Promise<CredentialStatus> {
    const normalized = normalizeCredential(credential);
    if (!normalized) return this.status(provider);
    const expectedRevocation = this.revision(provider);
    return this.serialize(provider, async () => {
      await this.storage.store(PROVIDER_SECRET_KEYS[provider], normalized);
      if (expectedRevocation === this.revision(provider)) {
        this.forcedMissing.delete(provider);
        return { provider, configured: true };
      }
      return { provider, configured: false };
    });
  }

  clear(provider: ProviderId): Promise<CredentialStatus> {
    this.invalidate(provider);
    return this.serialize(provider, async () => {
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

  private invalidate(provider: ProviderId): void {
    const current = this.revision(provider);
    if (current >= Number.MAX_SAFE_INTEGER) {
      throw new RangeError('credential revision cannot advance');
    }
    const revision = current + 1;
    this.revocationRevisions.set(provider, revision);
    this.forcedMissing.add(provider);
    const event = Object.freeze({ provider, revision });
    for (const listener of [...this.invalidationListeners]) {
      try {
        listener(event);
      } catch {
        // Revocation remains synchronous even when an observer fails.
      }
    }
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
