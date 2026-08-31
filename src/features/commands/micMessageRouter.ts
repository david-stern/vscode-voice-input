import { normalizePersonaId } from '../../assistant/personas';
import type { ConsentService, SettingsRepository } from '../../config';
import type { HistoryStore } from '../../history';
import type { WebviewMessage } from '../../webview/protocol';
import type { AssistantFeature } from '../assistant';
import type { MappingFeature } from '../mappings';
import type {
  AudioDeviceService,
  PushToTalkController,
  TranscriptionMetadataService,
} from '../recording';
import type { HostStatePublisher } from '../state';

export interface MicMessageUiPort {
  writeClipboard(text: string): PromiseLike<void>;
  executeCommand(commandId: string, ...args: unknown[]): PromiseLike<unknown>;
  confirmHistoryClear(): PromiseLike<boolean>;
  confirmAssistantDisclosure(): PromiseLike<boolean>;
}

export interface MicMessageRouterOptions {
  settings: Pick<SettingsRepository, 'read' | 'update'>;
  consents: Pick<ConsentService, 'status' | 'revision' | 'acknowledgeIfCurrent'>;
  history: Pick<HistoryStore, 'list' | 'remove' | 'clear'>;
  recording: Pick<PushToTalkController, 'toggle' | 'start' | 'stop'>;
  devices: Pick<AudioDeviceService, 'get' | 'select'>;
  metadata: Pick<TranscriptionMetadataService, 'refresh'>;
  assistant: Pick<
    AssistantFeature,
    | 'start'
    | 'stop'
    | 'state'
    | 'cancelSpeaking'
    | 'speechStarted'
    | 'speechFinished'
    | 'confirmPendingSend'
    | 'clearPendingSend'
    | 'nextId'
  >;
  mappings: Pick<
    MappingFeature,
    'manage' | 'confirmIfPending' | 'cancelIfPending'
  >;
  state: Pick<HostStatePublisher, 'pushFull' | 'pushHistory'>;
  ui: MicMessageUiPort;
  openSettingsCenter(): PromiseLike<void>;
}

/** Routes validated microphone-view messages to narrow host capabilities. */
export class MicMessageRouter {
  constructor(private readonly options: MicMessageRouterOptions) {}

  async route(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.options.state.pushFull();
        return;
      case 'toggle':
        await this.options.recording.toggle();
        return;
      case 'start':
        await this.options.recording.start();
        return;
      case 'stop':
        await this.options.recording.stop();
        return;
      case 'history-copy': {
        const settings = this.options.settings.read().values;
        const entries = await this.options.history.list(settings.historyTtlDays);
        const entry = entries.find((candidate) => candidate.id === message.id);
        if (entry) await this.options.ui.writeClipboard(entry.text);
        return;
      }
      case 'history-remove':
        await this.options.history.remove(message.id);
        await this.options.state.pushHistory();
        return;
      case 'history-clear-request':
        if (await this.options.ui.confirmHistoryClear()) {
          await this.options.history.clear();
          await this.options.state.pushHistory();
        }
        return;
      case 'open-keybindings':
        await this.options.ui.executeCommand(
          'workbench.action.openGlobalKeybindings',
          'voiceInput.toggleRecording',
        );
        return;
      case 'refresh-meta':
        await this.options.metadata.refresh();
        return;
      case 'audio-device-change':
        await this.options.devices.select(message.deviceId);
        return;
      case 'audio-device-scan':
        await this.options.devices.get(true);
        await this.options.state.pushFull();
        return;
      case 'assistant-enabled-change':
        if (message.enabled) await this.options.assistant.start();
        else await this.options.assistant.stop();
        return;
      case 'assistant-wake-phrase-change':
        await this.options.settings.update({ assistantWakePhrase: message.wakePhrase });
        await this.options.state.pushFull();
        return;
      case 'assistant-disclosure-acknowledged':
        await this.acknowledgeAssistantDisclosure();
        await this.options.state.pushFull();
        return;
      case 'assistant-persona-change':
        await this.options.settings.update({
          assistantPersona: normalizePersonaId(message.persona),
        });
        await this.options.state.pushFull();
        return;
      case 'assistant-provider-manage':
        await this.options.ui.executeCommand('voiceInput.manageAssistantProvider');
        return;
      case 'assistant-speech-settings-change':
        await this.options.settings.update({
          assistantSpeechEnabled: message.enabled,
          assistantSpeechVoiceUri: message.voiceUri,
          assistantSpeechRate: message.rate,
        });
        if (!message.enabled) this.options.assistant.cancelSpeaking();
        await this.options.state.pushFull();
        return;
      case 'assistant-stop-speaking':
        this.options.assistant.cancelSpeaking();
        await this.options.state.pushFull();
        return;
      case 'assistant-speech-started':
        this.options.assistant.speechStarted(message.id);
        return;
      case 'assistant-speech-finished':
        this.options.assistant.speechFinished(message.id, message.outcome);
        return;
      case 'assistant-pending-send-confirm':
        await this.options.assistant.confirmPendingSend(message.id);
        return;
      case 'assistant-pending-send-cancel':
        if (this.options.assistant.state.pendingSend?.id === message.id) {
          this.options.assistant.clearPendingSend(true);
        }
        return;
      case 'assistant-mappings-manage':
        await this.options.mappings.manage();
        return;
      case 'assistant-pending-action-confirm':
        await this.options.mappings.confirmIfPending(
          message.id,
          this.options.assistant.nextId('ui-action-confirm'),
        );
        return;
      case 'assistant-pending-action-cancel':
        this.options.mappings.cancelIfPending(message.id, true);
        return;
      case 'set-api-key':
        await this.options.ui.executeCommand('voiceInput.setApiKey');
        return;
      case 'open-settings-center':
        await this.options.openSettingsCenter();
        return;
      case 'settings-update':
        await this.options.settings.update({
          languageHint: message.speechLang,
          uiLanguage: message.uiLang,
          historyTtlDays: message.ttlDays,
          sttModel: message.model,
        });
        await this.options.state.pushFull();
        return;
    }
  }

  private async acknowledgeAssistantDisclosure(): Promise<void> {
    if (this.options.consents.status('assistant-listening').acknowledged) return;
    const revision = this.options.consents.revision('assistant-listening');
    if (await this.options.ui.confirmAssistantDisclosure()) {
      await this.options.consents.acknowledgeIfCurrent('assistant-listening', revision);
    }
  }
}
