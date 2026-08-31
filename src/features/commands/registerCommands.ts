import type { AssistantFeature } from '../assistant';
import type { DiagnosticsService } from '../diagnostics';
import type { MappingFeature } from '../mappings';
import type { PushToTalkController } from '../recording';
import type { CredentialCommandController } from './credentialController';

export interface CommandRegistrationDisposable {
  dispose(): unknown;
}

export interface CommandRegistrationPort {
  registerCommand(
    commandId: string,
    callback: () => unknown,
  ): CommandRegistrationDisposable;
}

export interface VoiceInputCommandOptions {
  recording: Pick<PushToTalkController, 'toggle'>;
  assistant: Pick<AssistantFeature, 'toggle'>;
  mappings: Pick<MappingFeature, 'manage'>;
  credentials: Pick<
    CredentialCommandController,
    'setSoniox' | 'clearSoniox' | 'setDeepSeek' | 'clearDeepSeek'
  >;
  selectAudioDevice(): PromiseLike<void>;
  clearHistory(): PromiseLike<void>;
  manageAssistantProvider(): PromiseLike<void>;
  testAssistantProvider(): PromiseLike<void>;
  diagnostics: Pick<DiagnosticsService, 'run'>;
}

/** Declares the stable command IDs against host-neutral command actions. */
export function registerVoiceInputCommands(
  host: CommandRegistrationPort,
  options: VoiceInputCommandOptions,
): CommandRegistrationDisposable[] {
  return [
    host.registerCommand('voiceInput.toggleRecording', () => options.recording.toggle()),
    host.registerCommand('voiceInput.toggleAssistant', () => options.assistant.toggle()),
    host.registerCommand('voiceInput.manageCustomMappings', () => options.mappings.manage()),
    host.registerCommand('voiceInput.selectAudioDevice', options.selectAudioDevice),
    host.registerCommand('voiceInput.setApiKey', () => options.credentials.setSoniox()),
    host.registerCommand('voiceInput.clearApiKey', () => options.credentials.clearSoniox()),
    host.registerCommand('voiceInput.setDeepSeekApiKey', () => options.credentials.setDeepSeek()),
    host.registerCommand('voiceInput.clearDeepSeekApiKey', () => options.credentials.clearDeepSeek()),
    host.registerCommand('voiceInput.clearHistory', options.clearHistory),
    host.registerCommand('voiceInput.manageAssistantProvider', options.manageAssistantProvider),
    host.registerCommand('voiceInput.testAssistantProvider', options.testAssistantProvider),
    host.registerCommand('voiceInput.showDiagnostics', () => options.diagnostics.run()),
  ];
}
