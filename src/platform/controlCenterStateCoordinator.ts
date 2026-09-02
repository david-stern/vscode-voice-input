import type { AgentRegistry } from '../agents';
import {
  providerConsentRequired,
  type ConsentService,
  type SettingsRepository,
} from '../config';
import type { SonioxRemoteConsentService } from '../config/sonioxConsent';
import type { CredentialService } from '../config/credentials';
import type { AutoModeAuthorityCache } from '../config/autoMode';
import type {
  ControlCenterIntentResult,
  ControlCenterStateSource,
} from '../features/controlCenter/controller';
import type { MappingFeature } from '../features/mappings';
import type { AudioDeviceService } from '../features/recording';
import type { StreamingTranscriptEvent } from '../speech/contracts';
import { PROVIDER_DESCRIPTORS } from '../inference';
import type {
  ControlCenterAgentRow,
  ControlCenterBrowserMessage,
  ControlCenterCapabilities,
  ControlCenterCustomCommandRow,
  ControlCenterDisplayState,
  ControlCenterManagementPageProjection,
  ControlCenterPlanningProviderProjection,
  ControlCenterProjection,
  ControlCenterSetupStepState,
  ControlCenterSetupStepStates,
} from '../webview/controlCenter/contracts';
import type { CompactMicState } from '../webview/mic/compactContracts';
import type { BuiltinVoiceCoordinator } from './builtinVoiceCoordinator';
import { recommendedSetupStep, type ControlCenterOperations } from './controlCenterOperations';
import type { ControlCenterSetupChoices } from './controlCenterSetupChoices';

type Intent = Exclude<ControlCenterBrowserMessage, { type: 'ready' | 'ack' }>;
type PlanningProviderIntent = Extract<Intent, { type: 'planningProviderIntent' }>;
type AgentManagementIntent = Extract<Intent, { type: 'agentManagementIntent' }>;
type CustomCommandIntent = Extract<Intent, { type: 'customCommandIntent' }>;

export interface ControlCenterStateCoordinatorOptions {
  settings: Pick<SettingsRepository, 'read'>;
  credentials: Pick<CredentialService, 'status'>;
  consents: Pick<ConsentService, 'status'>;
  sonioxConsent: Pick<SonioxRemoteConsentService, 'capture'>;
  autoMode: AutoModeAuthorityCache;
  setupChoices: Pick<ControlCenterSetupChoices, 'snapshot' | 'recordStt'>;
  builtins: BuiltinVoiceCoordinator;
  mappings: Pick<
    MappingFeature,
    | 'pendingAction'
    | 'pendingBuiltin'
    | 'settingsSnapshot'
    | 'settingsAddVisible'
    | 'settingsEditVisible'
    | 'settingsToggleEnabled'
    | 'settingsDelete'
  >;
  agents: Pick<AgentRegistry, 'list' | 'defaultId' | 'isCorrupted'>;
  devices: Pick<AudioDeviceService, 'hasCachedResult' | 'cachedDevices' | 'selectionStatus'>;
  latestTranscript(): PromiseLike<string | undefined>;
  enableAuto(): PromiseLike<boolean>;
  disableAuto(): PromiseLike<void>;
  setupSoniox(request: 'select' | 'configure-secret' | 'request-remote-consent' | 'test' | 'revoke'):
    PromiseLike<void>;
  selectNoProvider(): PromiseLike<void>;
  microphone(action: 'start' | 'stop' | 'test'): PromiseLike<void>;
  confirmPending(kind: 'builtin' | 'custom'): PromiseLike<void>;
  cancelPending(): void;
  planningProvider(message: PlanningProviderIntent): PromiseLike<void>;
  agentManagement(message: AgentManagementIntent): PromiseLike<void>;
  operations?: Pick<
    ControlCenterOperations,
    | 'setupState'
    | 'diagnosticsState'
    | 'systemTtsState'
    | 'microphone'
    | 'observeVoices'
    | 'systemTts'
    | 'diagnostics'
  >;
  publish(): Promise<void> | void;
  log(message: string): void;
}

/** Projects capability-only UI state and translates validated intents to host operations. */
export class ControlCenterStateCoordinator implements ControlCenterStateSource {
  private partialTranscript = '';
  private finalTranscript = '';
  private transcriptSequence = 0;
  private latestCapabilities: ControlCenterCapabilities | undefined;

  constructor(private readonly options: ControlCenterStateCoordinatorOptions) {}

  isKnownCommandId(commandId: string): boolean {
    return this.options.builtins.isKnownCommandId(commandId);
  }

  async readProjection(display: Readonly<ControlCenterDisplayState>): Promise<ControlCenterProjection> {
    const settings = this.options.settings.read().values;
    const capabilities = await this.capabilities();
    this.latestCapabilities = capabilities;
    const pending = this.pendingReview();
    return {
      routeState: routeState(display.route, capabilities),
      language: settings.uiLanguage,
      direction: settings.uiLanguage === 'he' ? 'rtl' : 'ltr',
      effectiveAutoMode: this.options.autoMode.snapshot().effective,
      capabilities,
      ...(pending ? { pendingReview: pending } : {}),
    };
  }

  readCommandPage(display: Readonly<ControlCenterDisplayState>) {
    return this.options.builtins.commandRows(display.filter ?? '', display.page ?? 1);
  }

  async readPlanningProviders(): Promise<ControlCenterPlanningProviderProjection> {
    const values = this.options.settings.read().values;
    const items = await Promise.all(PROVIDER_DESCRIPTORS.map(async (descriptor) => {
      const profile = values.providerProfiles[descriptor.id];
      const consentRequired = providerConsentRequired(descriptor.id, profile.endpoint);
      const credentialRequired = descriptor.id !== 'ollama' || consentRequired;
      let credentialConfigured = !credentialRequired;
      if (credentialRequired) {
        try {
          credentialConfigured = (await this.options.credentials.status(descriptor.id)).configured;
        } catch {
          credentialConfigured = false;
        }
      }
      return {
        id: descriptor.id,
        name: descriptor.name,
        enabled: profile.enabled,
        model: profile.model,
        locality: consentRequired ? 'remote' as const : 'local-loopback' as const,
        credentialRequired,
        credentialConfigured,
        consentRequired,
        consentAcknowledged: !consentRequired
          || this.options.consents.status(descriptor.id).acknowledged,
      };
    }));
    return { selectedProvider: values.assistantProvider, items };
  }

  readAgentPage(page: number): ControlCenterManagementPageProjection<ControlCenterAgentRow> {
    try {
      if (this.options.agents.isCorrupted) return { totalCount: 0, rows: [] };
      const language = this.options.settings.read().values.uiLanguage;
      const agents = this.options.agents.list().slice(0, 32);
      const start = (page - 1) * 8;
      return {
        totalCount: agents.length,
        rows: agents.slice(start, start + 8).map((agent) => ({
          id: agent.id,
          name: agent.name,
          description: agent.description[language],
          provider: agent.provider,
          model: agent.model,
          enabled: agent.enabled,
          isDefault: agent.id === this.options.agents.defaultId,
          instructionsConfigured: agent.instructions[language].trim().length > 0,
        })),
      };
    } catch {
      return { totalCount: 0, rows: [] };
    }
  }

  readCustomCommandPage(
    page: number,
  ): ControlCenterManagementPageProjection<ControlCenterCustomCommandRow> {
    try {
      const commands = this.options.mappings.settingsSnapshot().items.slice(0, 50);
      const start = (page - 1) * 10;
      return {
        totalCount: commands.length,
        rows: commands.slice(start, start + 10).map((command) => ({
          id: command.id,
          label: command.label,
          description: command.description,
          kind: command.kind,
          targetId: command.targetId,
          enabled: command.enabled,
          agentEnabled: command.agentEnabled,
        })),
      };
    } catch {
      return { totalCount: 0, rows: [] };
    }
  }

  readSetupState() {
    const settings = this.options.settings.read().values;
    const base = this.options.operations?.setupState() ?? {
      microphoneState: 'untested' as const,
      microphoneLabel: '',
      systemTtsEnabled: settings.assistantSpeechEnabled,
      systemTtsVoiceIndex: -1,
      systemTtsRate: settings.assistantSpeechRate,
      stepStates: ['pending', 'pending', 'attention', 'pending'] as const,
      recommendedStep: 1 as const,
    };
    const capabilities = this.latestCapabilities;
    const stepStates: ControlCenterSetupStepStates = [
      base.stepStates[0],
      speechToTextStepState(
        settings.transcriptionProvider,
        capabilities?.sttState,
        this.options.setupChoices.snapshot().stt,
      ),
      base.stepStates[2],
      this.commandsAuthorityStepState(),
    ];
    return { ...base, stepStates, recommendedStep: recommendedSetupStep(stepStates) };
  }

  readDiagnosticsState() {
    return this.options.operations?.diagnosticsState() ?? {
      status: 'idle' as const, summary: '', checks: [], canOpen: false, canCopy: false,
    };
  }

  async handleIntent(
    message: Intent,
  ): Promise<ControlCenterIntentResult | void> {
    switch (message.type) {
      case 'requestAutoEnableIntent':
        await this.options.enableAuto();
        return refresh('auto-badge');
      case 'disableAutoIntent':
        await this.options.disableAuto();
        return refresh('auto-badge');
      case 'providerSetupIntent':
        if (message.provider === 'none') await this.options.selectNoProvider();
        else await this.options.setupSoniox(message.request);
        if (this.options.settings.read().values.transcriptionProvider === message.provider) {
          await this.options.setupChoices.recordStt(message.provider);
        }
        return refresh('provider-card');
      case 'micIntent':
        await this.options.microphone(message.action);
        return refresh('mic-control');
      case 'microphoneSetupIntent':
        await this.options.operations?.microphone(message);
        return refresh('mic-control');
      case 'systemTtsVoicesObservedIntent':
        this.options.operations?.observeVoices(message.voices);
        return;
      case 'systemTtsIntent':
        await this.options.operations?.systemTts(message);
        return { refresh: true, focusTarget: { kind: 'route-h1' } };
      case 'diagnosticsIntent':
        await this.options.operations?.diagnostics(message);
        return { refresh: true, focusTarget: { kind: 'route-h1' } };
      case 'openPendingReviewIntent':
        return refresh('pending-review');
      case 'pendingReviewIntent': {
        const pending = this.pendingReview();
        const builtinCommandId = pending?.kind === 'builtin'
          ? this.options.mappings.pendingBuiltin?.commandId
          : undefined;
        const validBuiltinCommandId = builtinCommandId
          && this.options.builtins.isKnownCommandId(builtinCommandId)
          ? builtinCommandId
          : undefined;
        if (message.decision === 'cancel') this.options.cancelPending();
        else if (pending) await this.options.confirmPending(pending.kind);
        return {
          refresh: true,
          focusTarget: pending?.kind === 'builtin' && validBuiltinCommandId
            ? { kind: 'command-row', commandId: validBuiltinCommandId }
            : pending?.kind === 'custom'
              ? { kind: 'pending-custom-review' }
              : { kind: 'route-h1' },
        };
      }
      case 'commandEditIntent':
        if (message.operation === 'open') {
          const details = this.options.builtins.commandDetails(message.commandId);
          return details ? { commandDetails: details } : undefined;
        }
        if (message.operation === 'reset') {
          await this.options.builtins.edit(message.commandId, 'reset');
        } else {
          await this.options.builtins.edit(message.commandId, message.operation, message.value);
        }
        return { refresh: true, focusTarget: { kind: 'command-row', commandId: message.commandId } };
      case 'planningProviderIntent':
        await this.options.planningProvider(message);
        return refresh('provider-card');
      case 'agentManagementIntent':
        await this.options.agentManagement(message);
        return { refresh: true, focusTarget: { kind: 'results-heading' } };
      case 'customCommandIntent':
        if (message.operation === 'open') {
          const details = this.customCommandDetails(message.id);
          return details ? { customCommandDetails: details } : undefined;
        }
        await this.manageCustomCommand(message);
        return { refresh: true, focusTarget: { kind: 'results-heading' } };
      case 'openOverlayIntent':
      case 'closeOverlayIntent':
        return;
      case 'navigateIntent':
      case 'setFilterIntent':
      case 'setPageIntent':
      case 'setManagementPageIntent':
        return;
    }
  }

  acceptTranscript(event: StreamingTranscriptEvent): {
    operationId: string;
    sequence: number;
    kind: 'partial' | 'final';
    text: string;
  } {
    this.transcriptSequence = nextSequence(this.transcriptSequence);
    if (event.kind === 'partial') this.partialTranscript = event.text;
    else {
      this.finalTranscript = event.text;
      this.partialTranscript = '';
    }
    return {
      operationId: 'assistant-stream',
      sequence: this.transcriptSequence,
      kind: event.kind,
      text: event.text,
    };
  }

  async readCompactState(): Promise<CompactMicState> {
    const settings = this.options.settings.read().values;
    const capabilities = await this.capabilities();
    const latest = this.finalTranscript || await this.options.latestTranscript();
    const microphoneAvailable = capabilities.sttState === 'ready' && this.microphoneAvailable();
    const pending = this.pendingReview();
    return {
      language: settings.uiLanguage,
      providerStatus: compactProviderStatus(capabilities),
      effectiveAutoMode: this.options.autoMode.snapshot().effective,
      microphoneAvailable,
      streamingPartials: capabilities.streamingPartials,
      ...(!microphoneAvailable ? {
        microphoneUnavailableReason: settings.uiLanguage === 'he'
          ? 'יש להשלים הגדרת Soniox ומיקרופון במרכז הבקרה.'
          : 'Complete Soniox and microphone setup in the Control Center.',
      } : {}),
      ...(this.partialTranscript ? { partialTranscript: this.partialTranscript } : {}),
      ...(latest ? { finalTranscript: latest } : {}),
      ...(pending ? { pendingActionLabel: pending.displayLabel } : {}),
    };
  }

  logRejected(event: string, reason: string): void {
    this.options.log(`Control Center rejected ${event}: ${reason}`);
  }

  invalidateAuthority(): void {
    this.options.cancelPending();
  }

  private async capabilities(): Promise<ControlCenterCapabilities> {
    const settings = this.options.settings.read().values;
    const selected = settings.transcriptionProvider;
    const configured = selected === 'soniox'
      && (await this.options.credentials.status('soniox')).configured;
    const consent = configured && Boolean(await this.options.sonioxConsent.capture());
    const ready = configured && consent;
    return {
      sttProvider: selected === 'soniox' ? 'soniox' : 'none',
      sttState: ready
        ? 'ready'
        : selected === 'legacy-soniox-pending' ? 'configuring' : 'not-configured',
      streamingPartials: ready,
      systemTtsState: this.options.operations?.systemTtsState()
        ?? (settings.assistantSpeechEnabled ? 'configured-unverified' : 'off'),
      localSpeechState: 'pending-not-available',
      remoteProcessing: ready,
    };
  }

  private pendingReview() {
    const builtin = this.options.mappings.pendingBuiltin;
    if (builtin) {
      const language = this.options.settings.read().values.uiLanguage;
      return { kind: 'builtin' as const, displayLabel: builtin.label[language] };
    }
    const custom = this.options.mappings.pendingAction;
    return custom ? { kind: 'custom' as const, displayLabel: custom.label } : undefined;
  }

  private microphoneAvailable(): boolean {
    if (!this.options.devices.hasCachedResult || this.options.devices.cachedDevices.length === 0) {
      return false;
    }
    const kind = this.options.devices.selectionStatus?.kind;
    return kind !== 'stale' && kind !== 'legacy-ambiguous';
  }

  private commandsAuthorityStepState(): ControlCenterSetupStepState {
    let status: ReturnType<MappingFeature['settingsSnapshot']>['status'];
    try { status = this.options.mappings.settingsSnapshot().status; } catch { return 'attention'; }
    if (this.pendingReview() || status === 'error' || status === 'untrusted') {
      return 'attention';
    }
    return this.options.autoMode.snapshot().fingerprint === 'auto:uninitialized'
      ? 'pending'
      : 'complete';
  }

  private async manageCustomCommand(message: CustomCommandIntent): Promise<void> {
    const snapshot = this.options.mappings.settingsSnapshot();
    if (message.operation === 'add') {
      await this.options.mappings.settingsAddVisible(message, snapshot.revision);
      return;
    }
    if (!message.id) return;
    if (message.operation === 'edit') {
      await this.options.mappings.settingsEditVisible(message.id, message, snapshot.revision);
      return;
    }
    if (message.operation === 'delete') {
      await this.options.mappings.settingsDelete(message.id, snapshot.revision);
      return;
    }
    if (message.operation !== 'set-enabled') return;
    const existing = snapshot.items.find(({ id }) => id === message.id);
    if (!existing || existing.enabled === message.enabled) return;
    await this.options.mappings.settingsToggleEnabled(message.id, snapshot.revision);
  }

  private customCommandDetails(id: string) {
    const item = this.options.mappings.settingsSnapshot().items.find((candidate) => candidate.id === id);
    return item ? {
      id: item.id,
      label: item.label,
      description: item.description,
      phrases: [...item.phrases],
      kind: item.kind,
      targetId: item.targetId,
      enabled: item.enabled,
      agentEnabled: item.agentEnabled,
    } : undefined;
  }
}

function speechToTextStepState(
  provider: 'none' | 'soniox' | 'legacy-soniox-pending',
  state: ControlCenterCapabilities['sttState'] | undefined,
  decision: ReturnType<ControlCenterSetupChoices['snapshot']>['stt'],
): ControlCenterSetupStepState {
  if (provider === 'none') return decision === 'none' ? 'complete' : 'pending';
  if (provider !== 'soniox' || decision !== 'soniox') return 'pending';
  if (state === 'ready') return 'complete';
  if (state === 'error') return 'attention';
  return 'pending';
}

function routeState(
  route: ControlCenterDisplayState['route'],
  capabilities: ControlCenterCapabilities,
): ControlCenterProjection['routeState'] {
  return route === 'voice' || route === 'assistant' || route === 'home'
    ? capabilities.sttState === 'ready' ? 'ready' : 'not-configured'
    : 'ready';
}

function refresh(trigger: 'auto-badge' | 'provider-card' | 'mic-control' | 'pending-review') {
  return { refresh: true as const, focusTarget: { kind: 'trigger' as const, trigger } };
}

function nextSequence(value: number): number {
  if (value >= Number.MAX_SAFE_INTEGER) return 1;
  return value + 1;
}

function compactProviderStatus(
  capabilities: ControlCenterCapabilities,
): CompactMicState['providerStatus'] {
  if (capabilities.sttProvider === 'soniox' && capabilities.sttState === 'ready') {
    return 'soniox-configured';
  }
  if (capabilities.systemTtsState === 'ready'
    || capabilities.systemTtsState === 'configured-unverified') return 'system-voice';
  if (capabilities.systemTtsState === 'unavailable') return 'system-voice-unavailable';
  return 'not-configured';
}
