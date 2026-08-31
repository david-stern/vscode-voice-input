import type { AssistantIntent } from '../../assistant/intents';
import type { TargetSnapshot } from '../../assistant/context';
import type {
  ConsentInvalidation,
  ConsentService,
  CredentialInvalidation,
  CredentialService,
  ProviderProfile,
  SettingsRepository,
  VoiceInputSettings,
} from '../../config';
import { providerConsentRequired } from '../../config';
import {
  PlannerError,
  createPlannerClient,
  getProviderDescriptor,
  type AssistantPlan,
  type PlannerClient,
  type PlannerInput,
  type ProviderId,
} from '../../inference';
import type { AgentRecord, AgentRegistry } from '../../agents';

interface DisposableSubscription {
  dispose(): void;
}

type PlanningCredentials = Pick<CredentialService, 'status' | 'use'>
  & Partial<Pick<CredentialService, 'useOptional' | 'onDidInvalidate'>>;
type PlanningConsents = Pick<ConsentService, 'status'>
  & Partial<Pick<ConsentService, 'onDidRevoke'>>;
type PlanningSettings = Pick<SettingsRepository, 'read'>
  & Partial<Pick<
    SettingsRepository,
    'providerChangePending' | 'providerAuthorityRevision' | 'onProviderAuthorityChanged'
  >>;

export interface AssistantPlanningOptions {
  credentials: PlanningCredentials;
  consents: PlanningConsents;
  settings: PlanningSettings;
  agents?: Pick<AgentRegistry, 'getDefault' | 'onWillChange'>;
  createClient?(options: {
    provider: ProviderId;
    apiKey?: string;
    model: string;
    endpoint: string;
    logger(event: string): void;
  }): PlannerClient;
  localize(english: string, hebrew: string): string;
  publish(): Promise<void> | void;
  log(event: string): void;
}

interface PlanningSelection {
  source: 'primary' | 'fallback';
  provider: ProviderId;
  model: string;
  endpoint: string;
  persona: AgentRecord['persona'];
  instructions?: AgentRecord['instructions'];
  agentId?: string;
  fallback?: { provider: ProviderId; model: string };
  signature: string;
  primarySignature?: string;
}

/** Provider-neutral planning with revision-safe credential, consent, and profile gates. */
export class AssistantPlanningService {
  private busy = false;
  private lastError: string | undefined;
  private revision = 0;
  private activeController: AbortController | undefined;
  private providerChangeRevision = 0;
  private pendingProviderChange: number | undefined;
  private activeProvider: ProviderId | undefined;
  private lastResolvedSelection:
    | { agentId?: string; provider: ProviderId; model: string }
    | undefined;
  private readonly subscriptions: DisposableSubscription[] = [];

  constructor(private readonly options: AssistantPlanningOptions) {
    const consentSubscription = options.consents.onDidRevoke?.(
      (event: ConsentInvalidation) => {
        if (event.id === this.activeProvider) this.invalidate();
      },
    );
    if (consentSubscription) this.subscriptions.push(consentSubscription);
    const credentialSubscription = options.credentials.onDidInvalidate?.(
      (event: CredentialInvalidation) => {
        if (event.provider === this.activeProvider) this.invalidate();
      },
    );
    if (credentialSubscription) this.subscriptions.push(credentialSubscription);
    const settingsSubscription = options.settings.onProviderAuthorityChanged?.(
      () => this.invalidate(),
    );
    if (settingsSubscription) this.subscriptions.push(settingsSubscription);
    const agentSubscription = options.agents?.onWillChange(() => this.invalidate());
    if (agentSubscription) this.subscriptions.push(agentSubscription);
  }
  get isBusy(): boolean {
    return this.busy;
  }
  get error(): string | undefined {
    return this.lastError;
  }
  get provider(): ProviderId | undefined {
    return this.activeProvider;
  }

  clearError(): void {
    this.invalidate();
  }

  beginIntelligenceChange(): number {
    return this.beginProviderChange();
  }

  finishIntelligenceChange(token: number): void {
    this.finishProviderChange(token);
  }

  /** Closes planning before a provider/profile write begins. */
  beginProviderChange(): number {
    if (this.providerChangeRevision >= Number.MAX_SAFE_INTEGER) {
      throw new RangeError('provider change revision cannot advance');
    }
    const token = ++this.providerChangeRevision;
    this.pendingProviderChange = token;
    this.invalidate();
    return token;
  }

  finishProviderChange(token: number): void {
    if (token !== this.pendingProviderChange) return;
    this.pendingProviderChange = undefined;
    this.invalidate();
  }

  invalidate(): void {
    const changed = this.busy || this.lastError !== undefined || this.activeProvider !== undefined;
    this.revision += 1;
    this.activeController?.abort();
    this.activeController = undefined;
    this.activeProvider = undefined;
    this.lastResolvedSelection = undefined;
    this.busy = false;
    this.lastError = undefined;
    if (changed) void this.options.publish();
  }

  deterministic(postWakeText: string, intent: AssistantIntent): AssistantPlan {
    if (intent.kind === 'paste') {
      return {
        action: 'write-here',
        target: 'current',
        content: postWakeText,
        spokenReply: '',
        reason: this.options.localize(
          'You asked me to write in the focused control.',
          'ביקשת ממני לכתוב ברכיב הממוקד.',
        ),
        confidence: 1,
        requiresConfirmation: false,
      };
    }
    return {
      action: intent.action,
      target: intent.action === 'open-chat' ? 'chat'
        : intent.action === 'open-terminal' ? 'terminal'
        : intent.action === 'confirm-send' || intent.action === 'repeat-last' ? 'current'
        : 'none',
      content: null,
      spokenReply: '',
      reason: this.options.localize(
        'This is an explicit supported voice command.',
        'זו פקודה קולית מפורשת ונתמכת.',
      ),
      confidence: 1,
      requiresConfirmation: false,
    };
  }

  async create(
    postWakeRequest: string,
    snapshot: TargetSnapshot,
    signal: AbortSignal,
    fallbackPlan: AssistantPlan,
  ): Promise<AssistantPlan> {
    const revision = ++this.revision;
    this.activeController?.abort();
    this.activeController = undefined;
    this.activeProvider = undefined;
    this.lastResolvedSelection = undefined;

    if (!postWakeRequest.trim()) {
      this.finishLocalOperation(revision);
      return {
        action: 'answer-only',
        target: 'none',
        content: null,
        spokenReply: this.options.localize(
          'I am listening. What would you like me to do?',
          'אני מקשיב. מה תרצה שאעשה?',
        ),
        reason: this.options.localize(
          'No request followed the wake phrase.',
          'לא נאמרה בקשה לאחר ביטוי ההפעלה.',
        ),
        confidence: 1,
        requiresConfirmation: false,
      };
    }

    const settings = this.options.settings.read().values;
    const selection = this.selection(settings);
    if (!selection || this.remotePlanningBlocked(settings)) {
      this.finishLocalOperation(revision);
      return fallbackPlan;
    }

    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', abort, { once: true });
    this.activeController = controller;
    this.activeProvider = selection.provider;
    this.busy = true;
    this.lastError = undefined;
    void this.options.publish();
    try {
      const input: PlannerInput = {
        postWakeRequest,
        persona: selection.persona,
        ...(selection.instructions
          ? { agentInstructions: selection.instructions[settings.uiLanguage] }
          : {}),
        locale: settings.uiLanguage,
        target: {
          kind: snapshot.resolvedTarget,
          vscodeFocused: snapshot.vscodeFocused,
        },
      };
      try {
        const primary = await this.planWithSelection(selection, input, controller.signal, revision);
        if (primary) {
          this.rememberResolvedSelection(selection);
          return primary;
        }
        const fallbackSelection = selection.fallback
          ? this.fallbackSelection(selection, settings)
          : undefined;
        if (fallbackSelection && !controller.signal.aborted) {
          this.activeProvider = fallbackSelection.provider;
          const planned = await this.planWithSelection(
            fallbackSelection,
            input,
            controller.signal,
            revision,
          );
          if (planned) {
            this.rememberResolvedSelection(fallbackSelection);
            return planned;
          }
        }
      } catch (error) {
        if (!selection.fallback || !retryable(error) || controller.signal.aborted) throw error;
        const fallbackSelection = this.fallbackSelection(selection, settings);
        if (fallbackSelection) {
          this.activeProvider = fallbackSelection.provider;
          const planned = await this.planWithSelection(
            fallbackSelection,
            input,
            controller.signal,
            revision,
          );
          if (planned) {
            this.rememberResolvedSelection(fallbackSelection);
            return planned;
          }
        }
        throw error;
      }
      return fallbackPlan;
    } catch (error) {
      if (revision === this.revision && !controller.signal.aborted) {
        this.lastError = this.options.localize(
          'Planning request failed safely.',
          'בקשת התכנון נכשלה באופן בטוח.',
        );
      }
      throw error;
    } finally {
      signal.removeEventListener('abort', abort);
      if (revision === this.revision) {
        this.activeController = undefined;
        this.activeProvider = undefined;
        this.busy = false;
        void this.options.publish();
      }
    }
  }

  dispose(): void {
    this.invalidate();
    for (const subscription of this.subscriptions.splice(0)) subscription.dispose();
  }

  /** Host-derived active identity used by the local action permission boundary. */
  agentForAuthority(): AgentRecord | undefined {
    const agent = this.options.agents?.getDefault();
    if (!agent) return undefined;
    const current = this.selection(this.options.settings.read().values);
    if (!current) return undefined;
    const resolved = this.lastResolvedSelection?.agentId === agent.id
      ? this.lastResolvedSelection
      : current;
    return {
      ...agent,
      description: { ...agent.description },
      instructions: { ...agent.instructions },
      speech: { ...agent.speech },
      ...(agent.fallback ? { fallback: { ...agent.fallback } } : {}),
      provider: resolved.provider,
      model: resolved.model,
    };
  }

  private async planWithSelection(
    selection: PlanningSelection,
    input: PlannerInput,
    signal: AbortSignal,
    revision: number,
  ): Promise<AssistantPlan | undefined> {
    if (!this.authorityCurrent(selection, revision) || signal.aborted) return undefined;
    const profile = this.profile(selection.provider);
    if (providerConsentRequired(selection.provider, profile.endpoint)) {
      if (!this.options.consents.status(selection.provider).acknowledged) return undefined;
      const configured = await this.options.credentials.status(selection.provider);
      if (!this.authorityCurrent(selection, revision) || !configured.configured) return undefined;
    }

    const invoke = async (apiKey: string | undefined): Promise<AssistantPlan> => {
      if (!this.authorityCurrent(selection, revision) || signal.aborted) {
        throw new PlannerError('aborted');
      }
      if (
        providerConsentRequired(selection.provider, profile.endpoint)
        && !this.options.consents.status(selection.provider).acknowledged
      ) throw new PlannerError('aborted');
      const client = this.createClient(selection, apiKey);
      return client.plan(input, signal);
    };

    const plan = selection.provider === 'ollama' && !providerConsentRequired('ollama', profile.endpoint)
      ? await (this.options.credentials.useOptional
        ? this.options.credentials.useOptional('ollama', invoke)
        : invoke(undefined))
      : await this.options.credentials.use(selection.provider, (apiKey) => invoke(apiKey));
    if (!this.authorityCurrent(selection, revision) || signal.aborted) return undefined;
    return plan;
  }

  private createClient(selection: PlanningSelection, apiKey: string | undefined): PlannerClient {
    const options = {
      provider: selection.provider,
      ...(apiKey ? { apiKey } : {}),
      model: selection.model,
      endpoint: selection.endpoint,
      logger: (event: string) => this.options.log(
        `${selection.provider} planner: ${event}`,
      ),
    };
    return this.options.createClient?.(options) ?? createPlannerClient(options);
  }

  private selection(settings: VoiceInputSettings): PlanningSelection | undefined {
    if (settings.assistantIntelligence === 'off' || settings.assistantProvider === 'off') {
      return undefined;
    }
    const agent = this.options.agents?.getDefault();
    if (this.options.agents && !agent) return undefined;
    const followsGlobalProfile = !agent || builtinFollowsGlobalProfile(agent);
    const provider = followsGlobalProfile ? settings.assistantProvider : agent.provider;
    const profile = settings.providerProfiles[provider];
    if (!profile.enabled) return undefined;
    const model = followsGlobalProfile ? profile.model : agent.model;
    const persona = agent?.persona ?? settings.assistantPersona;
    const fallback = agent?.fallback;
    return {
      source: 'primary',
      provider,
      model,
      endpoint: profile.endpoint,
      persona,
      ...(agent ? { instructions: agent.instructions, agentId: agent.id } : {}),
      ...(fallback ? { fallback: { ...fallback } } : {}),
      signature: selectionSignature(provider, model, profile, agent),
    };
  }

  private fallbackSelection(
    primary: PlanningSelection,
    settings: VoiceInputSettings,
  ): PlanningSelection | undefined {
    const fallback = primary.fallback;
    if (!fallback) return undefined;
    const profile = settings.providerProfiles[fallback.provider];
    if (!profile.enabled) return undefined;
    return {
      source: 'fallback',
      provider: fallback.provider,
      model: fallback.model,
      endpoint: profile.endpoint,
      persona: primary.persona,
      ...(primary.instructions ? { instructions: primary.instructions } : {}),
      ...(primary.agentId ? { agentId: primary.agentId } : {}),
      signature: selectionSignature(
        fallback.provider,
        fallback.model,
        profile,
        this.options.agents?.getDefault(),
      ),
      primarySignature: primary.signature,
    };
  }

  private profile(provider: ProviderId): Readonly<ProviderProfile> {
    return this.options.settings.read().values.providerProfiles[provider];
  }

  private authorityCurrent(selection: PlanningSelection, revision: number): boolean {
    if (revision !== this.revision || this.remotePlanningBlocked(this.options.settings.read().values)) {
      return false;
    }
    const settings = this.options.settings.read().values;
    const current = this.selection(settings);
    if (!current) return false;
    if (selection.source === 'primary') return current.signature === selection.signature;
    if (current.signature !== selection.primarySignature) return false;
    return this.fallbackSelection(current, settings)?.signature === selection.signature;
  }

  private finishLocalOperation(revision: number): void {
    if (revision !== this.revision) return;
    const changed = this.busy;
    this.busy = false;
    this.activeController = undefined;
    this.activeProvider = undefined;
    if (changed) void this.options.publish();
  }

  private rememberResolvedSelection(selection: PlanningSelection): void {
    this.lastResolvedSelection = {
      ...(selection.agentId ? { agentId: selection.agentId } : {}),
      provider: selection.provider,
      model: selection.model,
    };
  }

  private remotePlanningBlocked(settings: VoiceInputSettings): boolean {
    return this.pendingProviderChange !== undefined
      || Boolean(this.options.settings.providerChangePending)
      || settings.assistantIntelligence === 'off'
      || settings.assistantProvider === 'off';
  }
}

function selectionSignature(
  provider: ProviderId,
  model: string,
  profile: Readonly<ProviderProfile>,
  agent?: AgentRecord,
): string {
  return JSON.stringify([
    agent?.id ?? null,
    provider,
    model,
    profile.endpoint,
    profile.enabled,
    agent?.persona ?? null,
    agent?.instructions.en ?? null,
    agent?.instructions.he ?? null,
    agent?.fallback?.provider ?? null,
    agent?.fallback?.model ?? null,
  ]);
}

function builtinFollowsGlobalProfile(agent: AgentRecord): boolean {
  return agent.templateId !== undefined
    && agent.provider === 'deepseek'
    && agent.model === getProviderDescriptor('deepseek').defaultModel;
}

function retryable(error: unknown): boolean {
  return error instanceof PlannerError
    && ['http-error', 'network-error', 'timed-out'].includes(error.code);
}
