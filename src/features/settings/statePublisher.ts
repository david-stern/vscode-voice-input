import type {
  ConsentService,
  CredentialService,
  SettingsRepository,
  SettingsSnapshot,
} from '../../config';
import { PROVIDER_IDS } from '../../config';
import type { AgentRegistry } from '../../agents';
import type { ProviderId as PlannerProviderId } from '../../inference';
import { nextRevision } from '../../webview/protocol';
import {
  SETTINGS_SETTING_NAMES,
  projectSettingsViewState,
  type SettingsFailureCategory,
  type SettingsNoticeCode,
  type SettingsSettingName,
  type SettingsViewState,
} from '../../webview/settings/protocol';
import type { AssistantFeature } from '../assistant';
import type { CredentialCommandController } from '../commands/credentialController';
import type { DiagnosticsService } from '../diagnostics';
import type {
  AudioDeviceService,
  AudioDeviceSelectionStatus,
  TranscriptionMetadataService,
} from '../recording';
import type { SettingsMappingPort, SettingsViewPort } from './ports';
import type { SettingsProviderTestController } from './providerTestController';
import type { SetupWorkflowController } from './setupController';
import {
  projectAgentCollection,
  projectMappingCollection,
  projectProviderCollection,
} from './resourceProjection';

type AssistantStatus = SettingsViewState['assistant']['status'];
type MicrophoneStatus = SettingsViewState['microphone']['status'];
type DiagnosticsStatus = SettingsViewState['diagnostics']['status'];

export interface SettingsStatePublisherOptions {
  settings: Pick<SettingsRepository, 'read'>;
  credentials: Pick<CredentialService, 'status'>;
  consents: Pick<ConsentService, 'status'>;
  metadata: Pick<TranscriptionMetadataService, 'state'>;
  assistant: Pick<AssistantFeature, 'state'>;
  devices: Pick<AudioDeviceService, 'cachedDevices' | 'hasCachedResult' | 'selectionStatus'>;
  mappings: SettingsMappingPort;
  agents: Pick<AgentRegistry, 'list' | 'defaultId' | 'isCorrupted'>;
  credentialOperations: Pick<CredentialCommandController, 'credentialState'>;
  providerTests: Readonly<Record<(typeof PROVIDER_IDS)[number], SettingsProviderTestController>>;
  diagnostics: Pick<DiagnosticsService, 'result'>;
  view: SettingsViewPort;
  shortcut(): string;
  extensionVersion: string;
  platform: NodeJS.Platform;
  isWorkspaceTrusted(): boolean;
  setup: Pick<SetupWorkflowController, 'state'>;
}

/** Builds the allowlisted Settings projection and owns all browser-visible resource revisions. */
export class SettingsStatePublisher {
  private topRevision = 0;
  private publicationGeneration = 0;
  private settingsRevision = 0;
  private assistantResource = { operationRevision: 0, status: 'stopped' as AssistantStatus };
  private speechOperationRevision = 0;
  private microphoneResource: {
    operationRevision: number;
    status: MicrophoneStatus;
    error?: SettingsFailureCategory;
  } = { operationRevision: 0, status: 'idle' };
  private consentRevision = 0;
  private providerRevision = 0;
  private agentRevision = 0;
  private diagnosticsResource: {
    operationRevision: number;
    status: DiagnosticsStatus;
  } = { operationRevision: 0, status: 'idle' };
  private noticeSequence = 0;
  private notice: SettingsViewState['notice'];
  private consentSignature: string;
  private providerSignature: string;
  private agentSignature: string;

  constructor(private readonly options: SettingsStatePublisherOptions) {
    this.consentSignature = this.readConsentSignature();
    this.providerSignature = this.readProviderSignature();
    this.agentSignature = this.readAgentSignature();
  }

  get currentSettingsRevision(): number {
    return this.settingsRevision;
  }

  get currentAssistantRevision(): number {
    return this.assistantResource.operationRevision;
  }

  get currentSpeechRevision(): number {
    return this.speechOperationRevision;
  }

  get currentMicrophoneRevision(): number {
    return this.microphoneResource.operationRevision;
  }

  get currentConsentRevision(): number {
    return this.consentRevision;
  }

  get currentProviderRevision(): number {
    return this.providerRevision;
  }

  get currentAgentRevision(): number {
    return this.agentRevision;
  }

  get currentDiagnosticsRevision(): number {
    return this.diagnosticsResource.operationRevision;
  }

  settingsChanged(): void {
    this.settingsRevision = nextRevision(this.settingsRevision);
  }

  consentChanged(): void {
    this.consentRevision = nextRevision(this.consentRevision);
    this.consentSignature = this.readConsentSignature();
  }

  providerChanged(): void {
    this.providerRevision = nextRevision(this.providerRevision);
    this.providerSignature = this.readProviderSignature();
  }

  agentChanged(): void {
    this.agentRevision = nextRevision(this.agentRevision);
    this.agentSignature = this.readAgentSignature();
  }

  setAssistantOperation(revision: number, status: AssistantStatus): void {
    this.assistantResource = { operationRevision: revision, status };
  }

  setSpeechOperation(revision: number): void {
    this.speechOperationRevision = revision;
  }

  setMicrophoneOperation(
    revision: number,
    status: MicrophoneStatus,
    error?: SettingsFailureCategory,
  ): void {
    this.microphoneResource = error
      ? { operationRevision: revision, status, error }
      : { operationRevision: revision, status };
  }

  setDiagnosticsOperation(revision: number, status: DiagnosticsStatus): void {
    this.diagnosticsResource = { operationRevision: revision, status };
  }

  showNotice(kind: NonNullable<SettingsViewState['notice']>['kind'], code: SettingsNoticeCode): void {
    this.noticeSequence += 1;
    this.notice = { id: `settings-notice-${this.noticeSequence}`, kind, code };
  }

  async refresh(): Promise<void> {
    this.detectExternalConsentChange();
    this.detectExternalProviderChange();
    this.detectExternalAgentChange();
    const generation = ++this.publicationGeneration;
    const snapshot = this.options.settings.read();
    const credentialEntries = await Promise.all(PROVIDER_IDS.map(async (provider) => (
      [provider, await this.safeCredentialStatus(provider)] as const
    )));
    if (generation !== this.publicationGeneration) return;
    const configured = new Map(credentialEntries);

    const assistant = this.options.assistant.state;
    const metadata = this.options.metadata.state;
    const mappingState = projectMappingCollection(
      this.options.mappings.settingsSnapshot(),
      this.options.mappings,
    );
    const diagnostics = this.options.diagnostics.result;
    const assistantStatus = this.assistantResource.status === 'starting'
      || this.assistantResource.status === 'stopping'
      || this.assistantResource.status === 'error'
      ? this.assistantResource.status
      : assistant.listening ? 'listening' : 'stopped';
    const selection = projectMicrophoneSelection(this.options.devices.selectionStatus);
    let microphoneStatus = this.microphoneResource.status === 'idle'
      && this.options.devices.hasCachedResult
      ? 'ready'
      : this.microphoneResource.status;
    if (
      selection?.status === 'unavailable'
      && microphoneStatus !== 'scanning'
      && microphoneStatus !== 'error'
    ) {
      microphoneStatus = 'unavailable';
    }
    this.topRevision = nextRevision(this.topRevision);
    const state: SettingsViewState = {
      revision: this.topRevision,
      uiLang: snapshot.values.uiLanguage,
      setup: this.options.setup.state,
      general: {
        settingsRevision: this.settingsRevision,
        languageHint: snapshot.values.languageHint,
        sttModel: snapshot.values.sttModel,
        historyTtlDays: snapshot.values.historyTtlDays,
        injectionMode: snapshot.values.injectionMode,
        shortcut: { packageDefault: this.options.shortcut(), effectiveBindingKnown: false },
        languages: metadata.languages.map((language) => ({ ...language })),
        models: metadata.models.map((model) => ({ ...model })),
        metadataStatus: metadata.loading ? 'loading' : metadata.error ? 'error' : 'ready',
        workspaceOverrides: projectOverrides(snapshot),
      },
      assistant: {
        operationRevision: this.assistantResource.operationRevision,
        status: assistantStatus,
        wakePhrase: snapshot.values.assistantWakePhrase,
        persona: snapshot.values.assistantPersona,
        consentAcknowledged: this.options.consents.status('assistant-listening').acknowledged,
      },
      transcription: {
        configured: configured.get('soniox') === true,
        credential: this.options.credentialOperations.credentialState('soniox'),
        test: this.options.providerTests.soniox.state,
      },
      providers: projectProviderCollection(
        snapshot.values,
        this.providerRevision,
        configured as ReadonlyMap<PlannerProviderId, boolean>,
        this.options.credentialOperations,
        this.options.providerTests,
        this.options.consents,
      ),
      agents: projectAgentCollection(
        this.options.agents,
        this.agentRevision,
        snapshot.values.uiLanguage,
      ),
      speech: {
        operationRevision: this.speechOperationRevision,
        enabled: snapshot.values.assistantSpeechEnabled,
        voiceUri: snapshot.values.assistantSpeechVoiceUri,
        rate: snapshot.values.assistantSpeechRate,
        speaking: assistant.speaking,
      },
      microphone: {
        operationRevision: this.microphoneResource.operationRevision,
        deviceId: snapshot.values.audioDevice,
        devices: this.options.devices.cachedDevices.map((device) => ({ ...device })),
        status: microphoneStatus,
      },
      mappings: mappingState,
      privacy: {
        consentRevision: this.consentRevision,
        workspaceTrusted: this.options.isWorkspaceTrusted(),
      },
      diagnostics: {
        operationRevision: this.diagnosticsResource.operationRevision,
        status: diagnostics && this.diagnosticsResource.status !== 'running'
          && this.diagnosticsResource.status !== 'error'
          ? diagnostics.status
          : this.diagnosticsResource.status,
        extensionVersion: this.options.extensionVersion,
        platform: platformCategory(this.options.platform),
        checks: diagnostics?.checks.map((check) => ({ ...check })) ?? [],
        reportAvailable: Boolean(diagnostics),
      },
    };
    if (selection) state.microphone.selection = selection;
    if (metadata.error) state.general.metadataError = 'unavailable';
    if (this.assistantResource.status === 'error') state.assistant.error = 'unavailable';
    if (this.microphoneResource.error) state.microphone.error = this.microphoneResource.error;
    if (this.notice) state.notice = { ...this.notice };
    this.options.view.postState(projectSettingsViewState(state));
  }

  invalidate(): void {
    this.publicationGeneration += 1;
  }

  private detectExternalConsentChange(): void {
    const signature = this.readConsentSignature();
    if (signature === this.consentSignature) return;
    this.consentSignature = signature;
    this.consentRevision = nextRevision(this.consentRevision);
  }

  private detectExternalProviderChange(): void {
    const signature = this.readProviderSignature();
    if (signature === this.providerSignature) return;
    this.providerSignature = signature;
    this.providerRevision = nextRevision(this.providerRevision);
  }

  private detectExternalAgentChange(): void {
    const signature = this.readAgentSignature();
    if (signature === this.agentSignature) return;
    this.agentSignature = signature;
    this.agentRevision = nextRevision(this.agentRevision);
  }

  private readConsentSignature(): string {
    return [
      this.options.consents.status('assistant-listening').acknowledged,
      ...PROVIDER_IDS.filter((provider) => provider !== 'soniox').map((provider) => (
        this.options.consents.status(provider).acknowledged
      )),
    ].join(':');
  }

  private readProviderSignature(): string {
    const values = this.options.settings.read().values;
    return JSON.stringify([values.assistantProvider, values.providerProfiles]);
  }

  private readAgentSignature(): string {
    try {
      return JSON.stringify([
        this.options.agents.defaultId ?? null,
        this.options.agents.isCorrupted,
        this.options.agents.list(),
      ]);
    } catch {
      return 'agent-registry-error';
    }
  }

  private async safeCredentialStatus(provider: (typeof PROVIDER_IDS)[number]): Promise<boolean> {
    try {
      return (await this.options.credentials.status(provider)).configured;
    } catch {
      return false;
    }
  }
}

/** Reduce native reconciliation detail to presentation-safe recovery guidance. */
function projectMicrophoneSelection(
  selection: AudioDeviceSelectionStatus | undefined,
): SettingsViewState['microphone']['selection'] {
  if (!selection) return undefined;
  switch (selection.kind) {
    case 'default':
      return { kind: 'default', status: 'ready', recovery: 'none' };
    case 'available':
      return withSafeDeviceLabel(
        { kind: 'available', status: 'ready', recovery: 'none' },
        selection.label,
      );
    case 'repaired':
    case 'legacy-migrated':
      return withSafeDeviceLabel(
        { kind: 'repaired', status: 'ready', recovery: 'none' },
        selection.label,
      );
    case 'stale':
      return { kind: 'stale', status: 'unavailable', recovery: 'select-device' };
    case 'legacy-ambiguous':
      return { kind: 'legacy', status: 'unavailable', recovery: 'select-device' };
  }
}

function withSafeDeviceLabel(
  selection: NonNullable<SettingsViewState['microphone']['selection']>,
  label: string,
): NonNullable<SettingsViewState['microphone']['selection']> {
  const sanitized = sanitizeDeviceLabel(label);
  return sanitized ? { ...selection, label: sanitized } : selection;
}

function sanitizeDeviceLabel(label: string): string | undefined {
  const normalized = label.replace(/[\u0000-\u001F\u007F]/gu, ' ').trim().replace(/\s+/gu, ' ');
  if (!normalized || normalized.length > 120 || /[\\/]/u.test(normalized)) return undefined;
  return normalized;
}

function projectOverrides(snapshot: SettingsSnapshot): SettingsViewState['general']['workspaceOverrides'] {
  const supported = new Set<SettingsSettingName>(SETTINGS_SETTING_NAMES);
  return snapshot.workspaceOverrides
    .filter((override) => supported.has(override.name as SettingsSettingName))
    .map((override) => ({
      setting: override.name as SettingsSettingName,
      source: override.source,
      effectiveValue: override.effectiveValue,
      globalValue: override.globalValue,
    }));
}

function platformCategory(platform: NodeJS.Platform): SettingsViewState['diagnostics']['platform'] {
  return platform === 'darwin' || platform === 'linux' || platform === 'win32'
    ? platform
    : 'other';
}
