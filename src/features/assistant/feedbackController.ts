import type { SettingsRepository } from '../../config';
import type { AgentSpeechPreferences } from '../../agents';
import { feedbackSpeechLanguage } from '../../webview/speech';
import type { AssistantIdSequence } from './idSequence';

export interface SpeechDeliveryPort {
  postSpeak(id: string, text: string, lang?: string): 'sent' | 'queued' | 'unavailable';
  cancelSpeaking(): boolean;
}

export interface FeedbackStatusPort {
  showFeedback(message: string): void;
}

export interface FeedbackControllerOptions {
  settings: Pick<SettingsRepository, 'read'>;
  sequence: AssistantIdSequence;
  speech: SpeechDeliveryPort;
  status: FeedbackStatusPort;
  agentSpeech?(): Readonly<AgentSpeechPreferences> | undefined;
  publish(): Promise<void> | void;
  log(message: string): void;
}

/** Owns bounded feedback and the host side of the webview speech lifecycle. */
export class AssistantFeedbackController {
  private currentFeedback = '';
  private speaking = false;
  private activeSpeechId: string | undefined;

  constructor(private readonly options: FeedbackControllerOptions) {}

  get message(): string {
    return this.currentFeedback;
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }

  speak(text: string): void {
    const bounded = text.trim().slice(0, 1_000);
    if (!bounded) return;
    this.currentFeedback = bounded;
    this.options.status.showFeedback(bounded);
    const settings = this.options.settings.read().values;
    const agentSpeech = this.options.agentSpeech?.();
    void this.options.publish();
    if (!settings.assistantSpeechEnabled || agentSpeech?.enabled === false) return;

    const id = this.options.sequence.next('speech');
    const delivery = this.options.speech.postSpeak(
      id,
      bounded,
      feedbackSpeechLanguage(settings.uiLanguage),
    );
    if (delivery === 'unavailable') {
      this.options.log('assistant speech unavailable: sidebar view queue is full or disposed');
    } else {
      this.activeSpeechId = id;
      this.speaking = true;
    }
    void this.options.publish();
  }

  cancelSpeaking(): void {
    this.options.speech.cancelSpeaking();
    this.activeSpeechId = undefined;
    this.speaking = false;
    void this.options.publish();
  }

  speechStarted(id: string): void {
    if (id !== this.activeSpeechId) return;
    this.speaking = true;
    void this.options.publish();
  }

  speechFinished(id: string, outcome: string): void {
    if (id !== this.activeSpeechId) return;
    this.activeSpeechId = undefined;
    this.speaking = false;
    this.options.log(`assistant speech finished: ${outcome}`);
    void this.options.publish();
  }

  dispose(): void {
    this.options.speech.cancelSpeaking();
    this.activeSpeechId = undefined;
    this.speaking = false;
  }
}
