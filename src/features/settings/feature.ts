import type {
  ConsentService,
  CredentialService,
  SettingsRepository,
} from '../../config';
import { PROVIDER_IDS } from '../../config';
import type { AgentRegistry } from '../../agents';
import type { ConnectionTestService } from '../../providers';
import type { PcmStreamHandle, PcmStreamOptions } from '../../recorder/native';
import type { AssistantFeature } from '../assistant';
import type { CredentialCommandController } from '../commands/credentialController';
import type { DiagnosticsService } from '../diagnostics';
import type {
  AudioDeviceService,
  TranscriptionMetadataService,
  TranscriptionService,
} from '../recording';
import { SettingsController } from './controller';
import type { SettingsMappingPort, SettingsNativeUi, SettingsViewPort } from './ports';
import { SettingsProviderTestController } from './providerTestController';
import { SetupWorkflowController } from './setupController';
import { SettingsStatePublisher } from './statePublisher';

export interface SettingsFeatureOptions {
  settings: SettingsRepository;
  credentials: CredentialService;
  consents: ConsentService;
  assistant: AssistantFeature;
  agents: AgentRegistry;
  devices: AudioDeviceService;
  metadata: TranscriptionMetadataService;
  transcriptions: TranscriptionService;
  mappings: SettingsMappingPort;
  credentialOperations: CredentialCommandController;
  connectionTests: ConnectionTestService;
  diagnostics: DiagnosticsService;
  view: SettingsViewPort;
  nativeUi: SettingsNativeUi;
  shortcut(): string;
  extensionVersion: string;
  platform?: NodeJS.Platform;
  isWorkspaceTrusted(): boolean;
  publishMic(): Promise<void> | void;
  startPcmStream(options: PcmStreamOptions): Promise<PcmStreamHandle>;
}

/** Cohesive Settings facade: validation, resource controllers and allowlisted publication. */
export class SettingsFeature {
  private readonly state: SettingsStatePublisher;
  private readonly controller: SettingsController;

  constructor(options: SettingsFeatureOptions) {
    const stateRef: { current?: SettingsStatePublisher } = {};
    const setup = new SetupWorkflowController({
      settings: options.settings,
      credentials: options.credentials,
      consents: options.consents,
      devices: options.devices,
      metadata: options.metadata,
      transcriptions: options.transcriptions,
      connectionTests: options.connectionTests,
      agents: options.agents,
      assistant: options.assistant,
      startPcmStream: options.startPcmStream,
      publish: () => stateRef.current?.refresh(),
    });
    const providerTests = Object.fromEntries(PROVIDER_IDS.map((provider) => [
      provider,
      new SettingsProviderTestController(
        provider,
        options.connectionTests,
        () => stateRef.current?.refresh(),
      ),
    ])) as Record<(typeof PROVIDER_IDS)[number], SettingsProviderTestController>;
    this.state = new SettingsStatePublisher({
      settings: options.settings,
      credentials: options.credentials,
      consents: options.consents,
      metadata: options.metadata,
      assistant: options.assistant,
      devices: options.devices,
      mappings: options.mappings,
      agents: options.agents,
      credentialOperations: options.credentialOperations,
      providerTests,
      diagnostics: options.diagnostics,
      view: options.view,
      shortcut: options.shortcut,
      extensionVersion: options.extensionVersion,
      platform: options.platform ?? process.platform,
      isWorkspaceTrusted: options.isWorkspaceTrusted,
      setup,
    });
    stateRef.current = this.state;
    this.controller = new SettingsController({
      settings: options.settings,
      consents: options.consents,
      assistant: options.assistant,
      devices: options.devices,
      mappings: options.mappings,
      agents: options.agents,
      credentials: options.credentialOperations,
      providerTests,
      diagnostics: options.diagnostics,
      nativeUi: options.nativeUi,
      state: this.state,
      publishMic: options.publishMic,
      setup,
    });
  }

  route(raw: unknown): Promise<void> {
    return this.controller.route(raw);
  }

  refresh(): Promise<void> {
    return this.controller.refresh();
  }

  externalConfigurationChanged(): void {
    this.controller.externalConfigurationChanged();
  }

  externalWorkspaceTrustChanged(): void {
    this.controller.externalWorkspaceTrustChanged();
  }

  dispose(): void {
    this.controller.dispose();
  }
}
