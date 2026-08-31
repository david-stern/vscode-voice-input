import { PROVIDER_IDS, type ProviderId } from '../inference';
import { ASSISTANT_CONSENT_KEY, DEEPSEEK_CONSENT_KEY } from './contracts';

export type ConsentId = 'assistant-listening' | ProviderId;

export interface GlobalStatePort {
  get<T>(key: string, fallback: T): T;
  update(key: string, value: unknown): PromiseLike<void>;
}

export interface ConsentStatus {
  id: ConsentId;
  acknowledged: boolean;
}

export interface ConsentInvalidation {
  id: ConsentId;
  revision: number;
}

export interface ConsentDisposable {
  dispose(): void;
}

export const PROVIDER_CONSENT_KEYS: Readonly<Record<ProviderId, string>> = Object.freeze({
  deepseek: DEEPSEEK_CONSENT_KEY,
  anthropic: 'voiceInput.providerDisclosureAcknowledged.anthropic.v1',
  openai: 'voiceInput.providerDisclosureAcknowledged.openai.v1',
  gemini: 'voiceInput.providerDisclosureAcknowledged.gemini.v1',
  openrouter: 'voiceInput.providerDisclosureAcknowledged.openrouter.v1',
  ollama: 'voiceInput.providerDisclosureAcknowledged.ollama.v1',
  bedrock: 'voiceInput.providerDisclosureAcknowledged.bedrock.v1',
  grok: 'voiceInput.providerDisclosureAcknowledged.grok.v1',
});

const CONSENT_KEYS: Readonly<Record<ConsentId, string>> = Object.freeze({
  'assistant-listening': ASSISTANT_CONSENT_KEY,
  ...PROVIDER_CONSENT_KEYS,
});

/** Persists explicit acknowledgement; it never prompts or grants consent itself. */
export class ConsentService {
  private readonly revisions = new Map<ConsentId, number>();
  private readonly mutationTails = new Map<ConsentId, Promise<void>>();
  private readonly forcedRevocations = new Set<ConsentId>();
  private readonly revocationIntents = new Map<ConsentId, number>();
  private readonly invalidationListeners = new Set<(event: ConsentInvalidation) => void>();

  constructor(private readonly state: GlobalStatePort) {}

  onDidRevoke(listener: (event: ConsentInvalidation) => void): ConsentDisposable {
    this.invalidationListeners.add(listener);
    return { dispose: () => this.invalidationListeners.delete(listener) };
  }

  status(id: ConsentId): ConsentStatus {
    return {
      id,
      acknowledged: !this.forcedRevocations.has(id)
        && this.state.get<boolean>(CONSENT_KEYS[id], false) === true,
    };
  }

  /** Compatibility projection retained for the original listening and DeepSeek UI. */
  statuses(): readonly ConsentStatus[] {
    return [this.status('assistant-listening'), this.status('deepseek')];
  }

  providerStatuses(): readonly ConsentStatus[] {
    return PROVIDER_IDS.map((provider) => this.status(provider));
  }

  revision(id: ConsentId): number {
    return this.revisions.get(id) ?? 0;
  }

  async acknowledge(id: ConsentId): Promise<ConsentStatus> {
    const revocationIntent = this.revocationIntent(id);
    return this.serialize(id, async () => {
      await this.state.update(CONSENT_KEYS[id], true);
      this.advance(id);
      if (revocationIntent === this.revocationIntent(id)) {
        this.forcedRevocations.delete(id);
      }
      return this.status(id);
    });
  }

  /** Compare-and-set used after a native modal so an intervening revoke wins. */
  async acknowledgeIfCurrent(id: ConsentId, expectedRevision: number): Promise<boolean> {
    const revocationIntent = this.revocationIntent(id);
    return this.serialize(id, async () => {
      if (
        expectedRevision !== this.revision(id)
        || revocationIntent !== this.revocationIntent(id)
      ) return false;
      await this.state.update(CONSENT_KEYS[id], true);
      this.advance(id);
      if (revocationIntent !== this.revocationIntent(id)) return false;
      this.forcedRevocations.delete(id);
      return true;
    });
  }

  revoke(id: ConsentId): Promise<ConsentStatus> {
    this.markRevoked(id);
    return this.serialize(id, async () => {
      await this.state.update(CONSENT_KEYS[id], false);
      return { id, acknowledged: false };
    });
  }

  private serialize<T>(id: ConsentId, operation: () => Promise<T>): Promise<T> {
    const tail = this.mutationTails.get(id) ?? Promise.resolve();
    const pending = tail.then(operation, operation);
    this.mutationTails.set(id, pending.then(() => undefined, () => undefined));
    return pending;
  }

  private advance(id: ConsentId): number {
    const current = this.revision(id);
    if (current >= Number.MAX_SAFE_INTEGER) {
      throw new RangeError('consent revision cannot advance');
    }
    const next = current + 1;
    this.revisions.set(id, next);
    return next;
  }

  private revocationIntent(id: ConsentId): number {
    return this.revocationIntents.get(id) ?? 0;
  }

  private markRevoked(id: ConsentId): void {
    const currentIntent = this.revocationIntent(id);
    if (currentIntent >= Number.MAX_SAFE_INTEGER) {
      throw new RangeError('consent revocation intent cannot advance');
    }
    this.revocationIntents.set(id, currentIntent + 1);
    this.forcedRevocations.add(id);
    const revision = this.advance(id);
    const event = Object.freeze({ id, revision });
    for (const listener of [...this.invalidationListeners]) {
      try {
        listener(event);
      } catch {
        // Revocation authority changes even if an observer fails.
      }
    }
  }
}
