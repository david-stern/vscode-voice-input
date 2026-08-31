import {
  PROVIDER_IDS,
  providerConsentRequired,
  providerDisclosure,
  type ConsentService,
  type CredentialService,
  type ProviderDisclosure,
  type ProviderId,
  type ProviderProfile,
} from '../../config';
import { getProviderDescriptor, type ProviderId as PlannerProviderId } from '../../inference';

export interface CredentialCommandUi {
  confirmDeepSeekDisclosure(): PromiseLike<boolean>;
  confirmCredentialClear(provider: ProviderId): PromiseLike<boolean>;
  promptSonioxKey(): PromiseLike<string | undefined>;
  promptDeepSeekKey(): PromiseLike<string | undefined>;
  chooseDeepSeekAction(): PromiseLike<'set' | 'clear' | undefined>;
  confirmProviderDisclosure?(disclosure: ProviderDisclosure): PromiseLike<boolean>;
  promptProviderKey?(provider: PlannerProviderId): PromiseLike<string | undefined>;
  chooseProviderAction?(
    provider: PlannerProviderId,
  ): PromiseLike<'set' | 'clear' | undefined>;
  showInformation(message: string): PromiseLike<unknown>;
  offerSonioxSetup(): PromiseLike<boolean>;
}

export type CredentialOperationAction = 'set' | 'replace' | 'clear';
export type CredentialOperationResult = 'saved' | 'cleared' | 'cancelled' | 'unavailable';

export type CredentialOperationState =
  | { phase: 'idle'; operationRevision: number }
  | { phase: 'updating'; operationRevision: number }
  | { phase: 'complete'; operationRevision: number; result: CredentialOperationResult };

export type CredentialOperationAcceptance = 'accepted' | 'stale';

export interface CredentialChangeLease {
  dispose(): void;
}

/** Keeps a shared authority gate closed until every overlapping native prompt has settled. */
export class CredentialChangeAuthorityGate {
  private active = 0;
  private token: number | undefined;

  constructor(
    private readonly begin: () => number,
    private readonly finish: (token: number) => void,
  ) {}

  acquire(): CredentialChangeLease {
    if (this.active === 0) this.token = this.begin();
    this.active += 1;
    let released = false;
    return {
      dispose: () => {
        if (released) return;
        released = true;
        this.active -= 1;
        if (this.active !== 0) return;
        const token = this.token;
        this.token = undefined;
        if (token !== undefined) this.finish(token);
      },
    };
  }
}

export interface CredentialCommandControllerOptions {
  credentials: Pick<CredentialService, 'set' | 'clear' | 'status'>;
  consents: Pick<
    ConsentService,
    'status' | 'revision' | 'acknowledgeIfCurrent'
  >;
  ui: CredentialCommandUi;
  profile?(provider: PlannerProviderId): Readonly<ProviderProfile>;
  clearDeepSeekError(): void;
  clearProviderError?(provider: PlannerProviderId): void;
  beginCredentialChange?(provider: ProviderId): CredentialChangeLease | undefined;
  publish(): Promise<void> | void;
  executeCommand(commandId: string): PromiseLike<unknown>;
  localize?(english: string, hebrew: string): string;
}

/** Owns explicit native credential prompts while keeping key values out of view state. */
export class CredentialCommandController {
  private readonly revisions = new Map<ProviderId, number>();
  private readonly states = new Map<ProviderId, CredentialOperationState>();
  private readonly mutationTails = new Map<ProviderId, Promise<void>>();

  constructor(private readonly options: CredentialCommandControllerOptions) {
    for (const provider of PROVIDER_IDS) {
      this.states.set(provider, { phase: 'idle', operationRevision: 0 });
    }
  }

  async setSoniox(): Promise<void> {
    await this.run('soniox', 'set', this.nextRevision('soniox'), false);
  }

  async clearSoniox(): Promise<void> {
    await this.run('soniox', 'clear', this.nextRevision('soniox'), false);
  }

  async setDeepSeek(): Promise<void> {
    await this.setProvider('deepseek');
  }

  async clearDeepSeek(): Promise<void> {
    await this.clearProvider('deepseek');
  }

  async setProvider(provider: PlannerProviderId): Promise<void> {
    await this.run(provider, 'set', this.nextRevision(provider), false);
  }

  async clearProvider(provider: PlannerProviderId): Promise<void> {
    await this.run(provider, 'clear', this.nextRevision(provider), false);
  }

  async configureDeepSeek(): Promise<void> {
    await this.configureProvider('deepseek');
  }

  async configureProvider(provider: PlannerProviderId): Promise<void> {
    const revision = this.currentRevision(provider);
    const configured = (await this.options.credentials.status(provider)).configured;
    if (!this.isCurrent(provider, revision)) return;
    if (!configured) {
      await this.setProvider(provider);
      return;
    }
    const action = provider === 'deepseek' && !this.options.ui.chooseProviderAction
      ? await this.options.ui.chooseDeepSeekAction()
      : await this.options.ui.chooseProviderAction?.(provider);
    if (!this.isCurrent(provider, revision)) return;
    if (action === 'set') await this.setProvider(provider);
    else if (action === 'clear') await this.clearProvider(provider);
  }

  async offerInitialSonioxSetup(): Promise<void> {
    const revision = this.currentRevision('soniox');
    if ((await this.options.credentials.status('soniox')).configured) return;
    if (!this.isCurrent('soniox', revision)) return;
    void Promise.resolve(this.options.ui.offerSonioxSetup()).then((accepted) => {
      if (accepted && this.isCurrent('soniox', revision)) {
        void this.options.executeCommand('voiceInput.setApiKey');
      }
    });
  }

  credentialState(provider: ProviderId): CredentialOperationState {
    return { ...(this.states.get(provider) ?? { phase: 'idle', operationRevision: 0 }) };
  }

  isChanging(provider: ProviderId): boolean {
    return this.states.get(provider)?.phase === 'updating';
  }

  async runSettingsOperation(
    provider: ProviderId,
    action: CredentialOperationAction,
    requestedRevision: number,
  ): Promise<CredentialOperationAcceptance> {
    if (requestedRevision !== this.nextRevision(provider)) return 'stale';
    await this.run(provider, action, requestedRevision, true);
    return this.isCurrent(provider, requestedRevision) ? 'accepted' : 'stale';
  }

  private currentRevision(provider: ProviderId): number {
    return this.revisions.get(provider) ?? 0;
  }

  private nextRevision(provider: ProviderId): number {
    const revision = this.currentRevision(provider);
    if (revision >= Number.MAX_SAFE_INTEGER) {
      throw new RangeError('credential operation revision cannot advance');
    }
    return revision + 1;
  }

  private isCurrent(provider: ProviderId, revision: number): boolean {
    return this.currentRevision(provider) === revision;
  }

  private async mutate(
    provider: ProviderId,
    revision: number,
    operation: () => PromiseLike<unknown>,
  ): Promise<boolean> {
    let applied = false;
    const run = async () => {
      if (!this.isCurrent(provider, revision)) return;
      await operation();
      applied = true;
    };
    const tail = this.mutationTails.get(provider) ?? Promise.resolve();
    const pending = tail.then(run, run);
    this.mutationTails.set(provider, pending.then(() => undefined, () => undefined));
    await pending;
    return applied && this.isCurrent(provider, revision);
  }

  private async run(
    provider: ProviderId,
    action: CredentialOperationAction,
    revision: number,
    confirmClear: boolean,
  ): Promise<void> {
    this.revisions.set(provider, revision);
    this.states.set(provider, { phase: 'updating', operationRevision: revision });
    const changeLease = this.options.beginCredentialChange?.(provider);
    try {
      await this.publishSafely();
      if (action === 'clear') {
        if (confirmClear && !await this.options.ui.confirmCredentialClear(provider)) {
          await this.complete(provider, revision, 'cancelled');
          return;
        }
        if (!await this.mutate(
          provider,
          revision,
          () => this.options.credentials.clear(provider),
        )) return;
        this.clearPlanningError(provider);
        void this.options.ui.showInformation(this.text(
          `Voice Input: ${providerName(provider)} credential cleared.`,
          `Voice Input: פרטי האימות של ${providerName(provider)} נמחקו.`,
        ));
        await this.complete(provider, revision, 'cleared');
        return;
      }

      if (provider !== 'soniox') {
        const profile = this.profile(provider);
        const disclosureRequired = providerConsentRequired(provider, profile.endpoint);
        if (disclosureRequired && !this.options.consents.status(provider).acknowledged) {
          const consentRevision = this.options.consents.revision(provider);
          const accepted = provider === 'deepseek' && !this.options.ui.confirmProviderDisclosure
            ? await this.options.ui.confirmDeepSeekDisclosure()
            : await this.options.ui.confirmProviderDisclosure?.(
              providerDisclosure(provider, profile.endpoint),
            ) ?? false;
          if (!accepted) {
            await this.complete(provider, revision, 'cancelled');
            return;
          }
          if (!this.isCurrent(provider, revision)) return;
          const acknowledged = await this.options.consents.acknowledgeIfCurrent(
            provider,
            consentRevision,
          );
          if (!this.isCurrent(provider, revision)) return;
          if (!acknowledged && !this.options.consents.status(provider).acknowledged) {
            await this.complete(provider, revision, 'cancelled');
            return;
          }
        }

        if (provider === 'ollama' && !disclosureRequired) {
          this.clearPlanningError(provider);
          await this.complete(provider, revision, 'saved');
          return;
        }
      }

      const key = await this.promptKey(provider);
      if (!this.isCurrent(provider, revision)) return;
      if (!key?.trim()) {
        await this.complete(provider, revision, 'cancelled');
        return;
      }
      if (!await this.mutate(provider, revision, () => this.options.credentials.set(provider, key))) {
        return;
      }
      this.clearPlanningError(provider);
      void this.options.ui.showInformation(this.text(
        `Voice Input: ${providerName(provider)} credential saved securely.`,
        `Voice Input: פרטי האימות של ${providerName(provider)} נשמרו באופן מאובטח.`,
      ));
      await this.complete(provider, revision, 'saved');
    } catch {
      await this.complete(provider, revision, 'unavailable');
    } finally {
      try {
        changeLease?.dispose();
      } catch {
        // Credential authority remains closed until the native operation has completed.
      }
    }
  }

  private promptKey(provider: ProviderId): PromiseLike<string | undefined> {
    if (provider === 'soniox') return this.options.ui.promptSonioxKey();
    if (provider === 'deepseek' && !this.options.ui.promptProviderKey) {
      return this.options.ui.promptDeepSeekKey();
    }
    return this.options.ui.promptProviderKey?.(provider) ?? Promise.resolve(undefined);
  }

  private profile(provider: PlannerProviderId): Readonly<ProviderProfile> {
    return this.options.profile?.(provider) ?? {
      endpoint: getProviderDescriptor(provider).defaultEndpoint,
      model: getProviderDescriptor(provider).defaultModel,
      enabled: true,
    };
  }

  private clearPlanningError(provider: ProviderId): void {
    if (provider === 'soniox') return;
    if (this.options.clearProviderError) this.options.clearProviderError(provider);
    else if (provider === 'deepseek') this.options.clearDeepSeekError();
  }

  private async complete(
    provider: ProviderId,
    revision: number,
    result: CredentialOperationResult,
  ): Promise<void> {
    if (!this.isCurrent(provider, revision)) return;
    this.states.set(provider, { phase: 'complete', operationRevision: revision, result });
    await this.publishSafely();
  }

  private async publishSafely(): Promise<void> {
    try {
      await this.options.publish();
    } catch {
      // A transient view refresh failure must not capture or expose the native credential flow.
    }
  }

  private text(english: string, hebrew: string): string {
    return this.options.localize?.(english, hebrew) ?? english;
  }
}

function providerName(provider: ProviderId): string {
  return provider === 'soniox' ? 'Soniox' : getProviderDescriptor(provider).name;
}
