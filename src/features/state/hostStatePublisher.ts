import {
  providerConsentRequired,
  providerRequiresCredential,
  type ConsentService,
  type CredentialService,
  type SettingsRepository,
} from '../../config';
import type { HistoryStore } from '../../history';
import { getProviderDescriptor } from '../../inference';
import {
  projectViewState,
  type ViewState,
} from '../../webview/protocol';
import type { AssistantFeature } from '../assistant';
import type { MappingFeature } from '../mappings';
import type {
  AudioDeviceService,
  PushToTalkController,
  TranscriptionMetadataService,
} from '../recording';

export interface HostStateViewPort {
  postState(state: ViewState): void;
}

export interface HostStatePublisherOptions {
  settings: Pick<SettingsRepository, 'read'>;
  credentials: Pick<CredentialService, 'status'>;
  consents: Pick<ConsentService, 'status'>;
  history: Pick<HistoryStore, 'list'>;
  recording: Pick<PushToTalkController, 'isRecording'>;
  devices: Pick<AudioDeviceService, 'cachedDevices'>;
  metadata: Pick<TranscriptionMetadataService, 'state'>;
  assistant: Pick<AssistantFeature, 'state'>;
  mappings: Pick<MappingFeature, 'summary' | 'pendingAction'>;
  view: HostStateViewPort;
  keybinding(): string;
}

/** Builds a fresh allowlisted projection and suppresses stale asynchronous publication. */
export class HostStatePublisher {
  private revision = 0;

  constructor(private readonly options: HostStatePublisherOptions) {}

  async pushFull(): Promise<void> {
    const revision = ++this.revision;
    const settings = this.options.settings.read().values;
    const selectedProvider = settings.assistantProvider;
    const [history, providerCredential] = await Promise.all([
      this.options.history.list(settings.historyTtlDays),
      selectedProvider === 'off'
        ? Promise.resolve(undefined)
        : this.options.credentials.status(selectedProvider),
    ]);
    if (revision !== this.revision) return;

    const metadata = this.options.metadata.state;
    const assistant = this.options.assistant.state;
    const state: ViewState = {
      uiLang: settings.uiLanguage,
      speechLang: settings.languageHint,
      ttlDays: settings.historyTtlDays,
      model: settings.sttModel,
      history,
      recording: this.options.recording.isRecording,
      keybinding: this.options.keybinding(),
      models: metadata.models,
      languages: metadata.languages,
      metaLoading: metadata.loading,
      metaError: metadata.error,
      audioDevice: settings.audioDevice,
      audioDevices: [...this.options.devices.cachedDevices],
      assistantEnabled: assistant.listening,
      assistantListening: assistant.listening,
      assistantWakePhrase: settings.assistantWakePhrase,
      assistantDisclosureAcknowledged:
        this.options.consents.status('assistant-listening').acknowledged,
      assistantPersona: settings.assistantPersona,
      assistantProviderId: selectedProvider,
      assistantProviderName: selectedProvider === 'off'
        ? ''
        : getProviderDescriptor(selectedProvider).name,
      assistantProviderStatus: this.providerStatus(
        selectedProvider,
        providerCredential?.configured ?? false,
        assistant.providerBusy,
        assistant.providerError,
      ),
      assistantProviderError: assistant.providerError,
      assistantSpeechEnabled:
        settings.assistantSpeechEnabled && assistant.speechPreferences?.enabled !== false,
      assistantSpeechVoiceUri:
        assistant.speechPreferences?.voiceUri || settings.assistantSpeechVoiceUri,
      assistantSpeechRate:
        assistant.speechPreferences?.rate ?? settings.assistantSpeechRate,
      assistantSpeaking: assistant.speaking,
      assistantTargetLabel: assistant.targetLabel,
      assistantPlanConfidence: assistant.planConfidence,
      assistantPendingSend: assistant.pendingSend,
      assistantMappingSummary: this.options.mappings.summary(),
      assistantPendingAction: this.options.mappings.pendingAction,
      assistantFeedback: assistant.feedback,
    };
    this.options.view.postState(projectViewState(state));
  }

  async pushHistory(): Promise<void> {
    // A full state also carries history. Sharing one revision prevents a late
    // full-state read from restoring entries after a newer history mutation.
    await this.pushFull();
  }

  invalidate(): void {
    this.revision += 1;
  }

  private providerStatus(
    provider: ReturnType<SettingsRepository['read']>['values']['assistantProvider'],
    credentialConfigured: boolean,
    busy: boolean,
    error: string | undefined,
  ): NonNullable<ViewState['assistantProviderStatus']> {
    if (provider === 'off') return 'off';
    if (busy) return 'checking';
    if (error) return 'error';
    const profile = this.options.settings.read().values.providerProfiles[provider];
    if (!profile.enabled) return 'not-configured';
    if (
      providerConsentRequired(provider, profile.endpoint)
      && !this.options.consents.status(provider).acknowledged
    ) return 'consent-required';
    if (
      (providerRequiresCredential(provider)
        || providerConsentRequired(provider, profile.endpoint))
      && !credentialConfigured
    ) return 'not-configured';
    return 'ready';
  }
}
