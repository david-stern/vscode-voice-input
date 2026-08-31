import {
  providerDisclosure,
  type ConsentId,
  type ConsentService,
  type ProviderId,
  type SettingsRepository,
  type VoiceInputSettings,
} from '../../config';
import { parseSettingsWebviewMessage, type SettingsWebviewMessage } from '../../webview/settings/protocol';
import type { AssistantFeature } from '../assistant';
import type { DiagnosticsService } from '../diagnostics';
import type { AudioDeviceService } from '../recording';
import type {
  SettingsAgentPort,
  SettingsCredentialPort,
  SettingsMappingMutationResult,
  SettingsMappingPort,
  SettingsNativeUi,
} from './ports';
import { SettingsAgentController } from './agentController';
import { SettingsProviderProfileController } from './providerProfileController';
import type { SettingsProviderTestController } from './providerTestController';
import type { SetupWorkflowController } from './setupController';
import type { SettingsStatePublisher } from './statePublisher';

export interface SettingsControllerOptions {
  settings: Pick<SettingsRepository, 'read' | 'update'>;
  consents: Pick<ConsentService, 'revision' | 'acknowledgeIfCurrent' | 'revoke'>;
  assistant: Pick<
    AssistantFeature,
    | 'start'
    | 'stop'
    | 'cancelSpeaking'
    | 'clearProviderError'
    | 'invalidateActions'
    | 'invalidatePlanning'
    | 'beginIntelligenceChange'
    | 'finishIntelligenceChange'
  >;
  devices: Pick<AudioDeviceService, 'get' | 'select'>;
  mappings: SettingsMappingPort;
  agents?: SettingsAgentPort;
  credentials: SettingsCredentialPort;
  providerTests: Readonly<Record<ProviderId, SettingsProviderTestController>>;
  diagnostics: Pick<DiagnosticsService, 'collect' | 'open' | 'result'>;
  nativeUi: SettingsNativeUi;
  state: SettingsStatePublisher;
  publishMic(): Promise<void> | void;
  setup: SetupWorkflowController;
}

/** Runtime-validates and dispatches the dedicated Settings capability surface only. */
export class SettingsController {
  private settingsWriteTail: Promise<void> = Promise.resolve();
  private consentTail: Promise<void> = Promise.resolve();
  private readonly agentController: SettingsAgentController | undefined;
  private readonly profileController: SettingsProviderProfileController;

  constructor(private readonly options: SettingsControllerOptions) {
    this.agentController = options.agents
      ? new SettingsAgentController({
          agents: options.agents,
          state: options.state,
          publishMic: options.publishMic,
        })
      : undefined;
    this.profileController = new SettingsProviderProfileController({
      settings: options.settings,
      state: options.state,
      beginIntelligenceChange: () => options.assistant.beginIntelligenceChange(),
      finishIntelligenceChange: (token) => options.assistant.finishIntelligenceChange(token),
      publishMic: options.publishMic,
    });
  }

  async route(raw: unknown): Promise<void> {
    const message = parseSettingsWebviewMessage(raw);
    if (!message) return;
    try {
      await this.dispatch(message);
    } catch {
      this.options.state.showNotice('error', 'operation-failed');
      await this.options.state.refresh();
    }
  }

  externalConfigurationChanged(): void {
    this.options.setup.invalidateFrom('microphone');
    this.options.state.settingsChanged();
    this.options.state.providerChanged();
    void this.options.state.refresh();
  }

  externalWorkspaceTrustChanged(): void {
    void this.options.state.refresh();
  }

  refresh(): Promise<void> {
    return this.options.state.refresh();
  }

  dispose(): void {
    for (const providerTest of Object.values(this.options.providerTests)) providerTest.dispose();
    this.options.setup.dispose();
    this.options.state.invalidate();
  }

  private async dispatch(message: SettingsWebviewMessage): Promise<void> {
    switch (message.type) {
      case 'settings-ready':
        await this.options.state.refresh();
        return;
      case 'settings-setup-run':
        await this.options.setup.run(message.step, message.setupRevision);
        return;
      case 'settings-setup-cancel':
        this.options.setup.cancel(message.setupRevision);
        return;
      case 'settings-setup-speech-result':
        this.options.setup.speechFinished(
          message.requestId,
          message.outcome,
          message.setupRevision,
        );
        return;
      case 'settings-change':
        await this.writeSetting(message);
        return;
      case 'settings-open-keybindings':
        await this.options.nativeUi.openKeybindings();
        return;
      case 'settings-open-native':
        await this.options.nativeUi.openNativeSettings(message.setting);
        return;
      case 'settings-assistant-action':
        await this.handleAssistant(message.operationRevision, message.action);
        return;
      case 'settings-consent-action':
        await this.handleConsent(
          message.consentRevision,
          message.consent,
          message.action,
        );
        return;
      case 'settings-provider-credential':
        await this.handleCredential(message.provider, message.action, message.operationRevision);
        return;
      case 'settings-provider-test':
        await this.handleProviderTest(message.provider, message.action, message.operationRevision);
        return;
      case 'settings-provider-select':
      case 'settings-provider-profile':
        this.options.assistant.invalidateActions();
        await this.profileController.handle(message);
        this.options.setup.invalidateFrom('provider');
        return;
      case 'settings-agent-create':
      case 'settings-agent-update-profile':
      case 'settings-agent-duplicate':
      case 'settings-agent-set-enabled':
      case 'settings-agent-set-default':
      case 'settings-agent-delete':
        if (this.agentController) {
          await this.agentController.handle(message);
          this.options.setup.invalidateFrom('agent');
        }
        else {
          this.options.state.showNotice('error', 'operation-failed');
          await this.options.state.refresh();
        }
        return;
      case 'settings-speech-stop':
        await this.handleSpeechStop(message.operationRevision);
        return;
      case 'settings-microphone-scan':
        await this.handleMicrophoneScan(message.operationRevision);
        return;
      case 'settings-mapping-add':
        await this.handleMapping(this.options.mappings.settingsAdd(message.mappingsRevision));
        return;
      case 'settings-mapping-edit':
        await this.handleMapping(this.options.mappings.settingsEdit(message.id, message.mappingsRevision));
        return;
      case 'settings-mapping-toggle-enabled':
        await this.handleMapping(
          this.options.mappings.settingsToggleEnabled(message.id, message.mappingsRevision),
        );
        return;
      case 'settings-mapping-toggle-agent':
        await this.handleMapping(
          this.options.mappings.settingsToggleAgentEnabled(message.id, message.mappingsRevision),
        );
        return;
      case 'settings-mapping-delete':
        await this.handleMapping(this.options.mappings.settingsDelete(message.id, message.mappingsRevision));
        return;
      case 'settings-mapping-approval':
        await this.handleMapping(this.options.mappings.settingsSetAlwaysApproved(
          message.id,
          message.action === 'grant',
          message.mappingsRevision,
        ));
        return;
      case 'settings-diagnostics-action':
        await this.handleDiagnostics(message.operationRevision, message.action);
    }
  }

  private writeSetting(message: Extract<SettingsWebviewMessage, { type: 'settings-change' }>): Promise<void> {
    if (message.setting === 'assistantIntelligence') this.options.assistant.invalidateActions();
    const run = async () => {
      if (message.settingsRevision !== this.options.state.currentSettingsRevision) {
        await this.rejectStale();
        return;
      }
      if (message.setting === 'audioDevice') {
        await this.options.assistant.stop();
        await this.options.devices.select(message.value);
        this.options.state.setMicrophoneOperation(
          this.options.state.currentMicrophoneRevision + 1,
          'ready',
        );
      } else {
        const intelligenceToken = message.setting === 'assistantIntelligence'
          ? this.options.assistant.beginIntelligenceChange()
          : undefined;
        try {
          await this.options.settings.update({
            [message.setting]: message.value,
          } as Partial<VoiceInputSettings>);
        } finally {
          if (intelligenceToken !== undefined) {
            this.options.assistant.finishIntelligenceChange(intelligenceToken);
          }
        }
      }
      this.invalidateSetupForSetting(message.setting);
      this.options.state.settingsChanged();
      this.options.state.showNotice('success', 'settings-saved');
      await Promise.all([this.options.state.refresh(), this.options.publishMic()]);
    };
    const pending = this.settingsWriteTail.then(run, run);
    this.settingsWriteTail = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private async handleAssistant(
    requestedRevision: number,
    action: 'start' | 'stop',
  ): Promise<void> {
    if (requestedRevision !== this.options.state.currentAssistantRevision + 1) {
      await this.rejectStale();
      return;
    }
    this.options.state.setAssistantOperation(
      requestedRevision,
      action === 'start' ? 'starting' : 'stopping',
    );
    await this.options.state.refresh();
    try {
      if (action === 'start') await this.options.assistant.start();
      else await this.options.assistant.stop();
      if (requestedRevision !== this.options.state.currentAssistantRevision) return;
      this.options.state.setAssistantOperation(requestedRevision, 'stopped');
      await Promise.all([this.options.state.refresh(), this.options.publishMic()]);
    } catch {
      if (requestedRevision !== this.options.state.currentAssistantRevision) return;
      this.options.state.setAssistantOperation(requestedRevision, 'error');
      this.options.state.showNotice('error', 'operation-failed');
      await this.options.state.refresh();
    }
  }

  private handleConsent(
    requestedRevision: number,
    consent: ConsentId,
    action: 'acknowledge' | 'revoke',
  ): Promise<void> {
    if (action === 'revoke' && consent !== 'assistant-listening') {
      this.options.assistant.invalidatePlanning();
    }
    const run = async () => {
      if (requestedRevision !== this.options.state.currentConsentRevision) {
        await this.rejectStale();
        return;
      }
      if (action === 'acknowledge') {
        const consentRevision = this.options.consents.revision(consent);
        const disclosure = consent === 'assistant-listening'
          ? undefined
          : providerDisclosure(
            consent,
            this.options.settings.read().values.providerProfiles[consent].endpoint,
          );
        if (!await this.options.nativeUi.confirmConsent(consent, disclosure)) {
          this.options.state.showNotice('info', 'operation-cancelled');
          await this.options.state.refresh();
          return;
        }
        if (requestedRevision !== this.options.state.currentConsentRevision) {
          await this.rejectStale();
          return;
        }
        if (!await this.options.consents.acknowledgeIfCurrent(consent, consentRevision)) {
          await this.rejectStale();
          return;
        }
      } else {
        if (consent !== 'assistant-listening') {
          this.options.providerTests[consent].cancelIfRunning();
          this.options.assistant.clearProviderError();
        }
        await this.options.consents.revoke(consent);
        if (consent === 'assistant-listening') await this.options.assistant.stop();
      }
      this.options.state.consentChanged();
      this.options.setup.invalidateFrom(
        consent === 'assistant-listening' ? 'soniox' : 'provider',
      );
      await Promise.all([this.options.state.refresh(), this.options.publishMic()]);
    };
    const pending = this.consentTail.then(run, run);
    this.consentTail = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private async handleCredential(
    provider: ProviderId,
    action: 'set' | 'replace' | 'clear',
    requestedRevision: number,
  ): Promise<void> {
    this.options.providerTests[provider].cancelIfRunning();
    const result = await this.options.credentials.runSettingsOperation(
      provider,
      action,
      requestedRevision,
    );
    if (result === 'stale') {
      await this.rejectStale();
      return;
    }
    const credential = this.options.credentials.credentialState(provider);
    if (credential.phase === 'complete') {
      if (credential.result === 'saved') {
        this.options.state.showNotice('success', 'credential-updated');
      } else if (credential.result === 'cleared') {
        this.options.state.showNotice('success', 'credential-cleared');
      } else if (credential.result === 'cancelled') {
        this.options.state.showNotice('info', 'operation-cancelled');
      } else {
        this.options.state.showNotice('error', 'operation-failed');
      }
    }
    this.options.setup.invalidateFrom(provider === 'soniox' ? 'soniox' : 'provider');
    await Promise.all([this.options.state.refresh(), this.options.publishMic()]);
  }

  private async handleProviderTest(
    provider: ProviderId,
    action: 'start' | 'cancel',
    requestedRevision: number,
  ): Promise<void> {
    if (
      action === 'start'
      && this.options.credentials.credentialState(provider).phase === 'updating'
    ) {
      this.options.providerTests[provider].cancelIfRunning();
      this.options.state.showNotice('info', 'operation-cancelled');
      await this.options.state.refresh();
      return;
    }
    const result = await this.options.providerTests[provider].handle(requestedRevision, action);
    if (result === 'stale') await this.rejectStale();
  }

  private async handleSpeechStop(requestedRevision: number): Promise<void> {
    if (requestedRevision !== this.options.state.currentSpeechRevision + 1) {
      await this.rejectStale();
      return;
    }
    this.options.state.setSpeechOperation(requestedRevision);
    this.options.assistant.cancelSpeaking();
    await Promise.all([this.options.state.refresh(), this.options.publishMic()]);
  }

  private async handleMicrophoneScan(requestedRevision: number): Promise<void> {
    if (requestedRevision !== this.options.state.currentMicrophoneRevision + 1) {
      await this.rejectStale();
      return;
    }
    this.options.state.setMicrophoneOperation(requestedRevision, 'scanning');
    await this.options.state.refresh();
    try {
      const devices = await this.options.devices.get(true);
      if (requestedRevision !== this.options.state.currentMicrophoneRevision) return;
      this.options.state.setMicrophoneOperation(
        requestedRevision,
        devices.length > 0 ? 'ready' : 'unavailable',
      );
      this.options.setup.invalidateFrom('microphone');
    } catch {
      if (requestedRevision !== this.options.state.currentMicrophoneRevision) return;
      this.options.state.setMicrophoneOperation(requestedRevision, 'error', 'unavailable');
    }
    await Promise.all([this.options.state.refresh(), this.options.publishMic()]);
  }

  private async handleMapping(
    pending: Promise<SettingsMappingMutationResult>,
  ): Promise<void> {
    const result = await pending;
    if (result.status === 'stale') {
      await this.rejectStale();
      return;
    }
    if (result.status === 'accepted' || result.status === 'unchanged') {
      this.options.state.showNotice('success', 'mapping-updated');
      await Promise.all([this.options.state.refresh(), this.options.publishMic()]);
      return;
    }
    this.options.state.showNotice(
      result.status === 'cancelled' ? 'info' : 'error',
      result.status === 'cancelled' ? 'operation-cancelled' : 'operation-failed',
    );
    await this.options.state.refresh();
  }

  private async handleDiagnostics(
    requestedRevision: number,
    action: 'run' | 'open' | 'copy',
  ): Promise<void> {
    if (requestedRevision !== this.options.state.currentDiagnosticsRevision + 1) {
      await this.rejectStale();
      return;
    }
    if (action === 'run') {
      this.options.state.setDiagnosticsOperation(requestedRevision, 'running');
      await this.options.state.refresh();
      try {
        const result = await this.options.diagnostics.collect();
        if (requestedRevision !== this.options.state.currentDiagnosticsRevision) return;
        this.options.state.setDiagnosticsOperation(requestedRevision, result.status);
      } catch {
        if (requestedRevision !== this.options.state.currentDiagnosticsRevision) return;
        this.options.state.setDiagnosticsOperation(requestedRevision, 'error');
      }
      await this.options.state.refresh();
      return;
    }
    this.options.state.setDiagnosticsOperation(
      requestedRevision,
      this.options.diagnostics.result?.status ?? 'idle',
    );
    if (action === 'open') {
      this.options.diagnostics.open();
    } else {
      const report = this.options.diagnostics.result?.report;
      if (!report) {
        this.options.state.showNotice('error', 'operation-failed');
      } else {
        await this.options.nativeUi.copyText(report);
        this.options.state.showNotice('success', 'diagnostics-copied');
      }
    }
    await this.options.state.refresh();
  }

  private async rejectStale(): Promise<void> {
    this.options.state.showNotice('warning', 'stale-state');
    await this.options.state.refresh();
  }

  private invalidateSetupForSetting(setting: keyof VoiceInputSettings): void {
    if (setting === 'audioDevice') this.options.setup.invalidateFrom('microphone');
    else if (setting === 'languageHint' || setting === 'sttModel') {
      this.options.setup.invalidateFrom('transcription');
    } else if (
      setting === 'assistantSpeechEnabled'
      || setting === 'assistantSpeechVoiceUri'
      || setting === 'assistantSpeechRate'
      || setting === 'uiLanguage'
    ) {
      this.options.setup.invalidateFrom('speech');
    } else if (
      setting === 'assistantIntelligence'
      || setting === 'deepSeekModel'
    ) {
      this.options.setup.invalidateFrom('provider');
    } else if (setting === 'assistantPersona' || setting === 'assistantWakePhrase') {
      this.options.setup.invalidateFrom('agent');
    }
  }
}
