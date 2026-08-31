import type { ViewState, WebviewMessage } from '../protocol';
import {
  SpeechLifecycle,
  SpeechQueue,
  continuesSpeakingAfterFinish,
  normalizeSpeechRate,
  selectSpeechVoice,
} from '../speech';

type SpeechOutcome = Extract<WebviewMessage, { type: 'assistant-speech-finished' }>['outcome'];

export interface MicSpeechDependencies {
  state: () => ViewState;
  post: (message: WebviewMessage) => void;
  render: () => void;
}

/** Owns the browser speech queue and guards callbacks from stale utterances. */
export class MicSpeechClient {
  private readonly queue = new SpeechQueue();
  private readonly lifecycle = new SpeechLifecycle();
  private voices: SpeechSynthesisVoice[] = [];
  private hostStateInitialized = false;

  constructor(private readonly dependencies: MicSpeechDependencies) {}

  get availableVoices(): readonly SpeechSynthesisVoice[] { return this.voices; }
  get activeId(): string | undefined { return this.lifecycle.activeId; }
  get isHostStateInitialized(): boolean { return this.hostStateInitialized; }

  markHostStateInitialized(): void { this.hostStateInitialized = true; }

  syncEnabled(previouslyEnabled: boolean): void {
    const enabled = Boolean(this.dependencies.state().assistantSpeechEnabled);
    if (previouslyEnabled && !enabled) this.cancel();
    else if (!previouslyEnabled && enabled) this.drain();
  }

  enqueue(id: string, text: string, lang?: string): void {
    if (!this.hostStateInitialized || !this.dependencies.state().assistantSpeechEnabled) {
      this.finishWithoutStarting(id, 'unavailable');
      return;
    }
    if (!this.queue.enqueue({ id, text, lang })) {
      this.finishWithoutStarting(id, 'queue-full');
      return;
    }
    this.drain();
  }

  cancel(): void {
    for (const item of this.queue.cancel()) this.finishWithoutStarting(item.id, 'cancelled');
    const current = this.lifecycle.cancel();
    this.dependencies.state().assistantSpeaking = false;
    window.speechSynthesis?.cancel();
    if (current) this.finishWithoutStarting(current, 'cancelled');
    this.dependencies.render();
  }

  refreshVoices(): void {
    if (typeof window.speechSynthesis === 'undefined') return;
    this.voices = window.speechSynthesis.getVoices();
    this.dependencies.render();
  }

  private drain(): void {
    const state = this.dependencies.state();
    if (!this.hostStateInitialized || this.lifecycle.activeId || !state.assistantSpeechEnabled) return;
    const item = this.queue.take();
    if (!item) { state.assistantSpeaking = false; this.dependencies.render(); return; }
    if (typeof window.speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') {
      this.finishWithoutStarting(item.id, 'unavailable');
      this.drain();
      return;
    }
    let generation: number | undefined;
    try {
      const utterance = new SpeechSynthesisUtterance(item.text);
      const voice = selectSpeechVoice(this.voices, state.assistantSpeechVoiceUri, item.lang || (state.speechLang === 'auto' ? state.uiLang : state.speechLang));
      if (voice) { utterance.voice = voice; utterance.lang = voice.lang; } else if (item.lang) utterance.lang = item.lang;
      utterance.rate = normalizeSpeechRate(state.assistantSpeechRate);
      generation = this.lifecycle.start(item.id);
      if (generation === undefined) { this.finishWithoutStarting(item.id, 'error'); return; }
      state.assistantSpeaking = true;
      this.dependencies.post({ type: 'assistant-speech-started', id: item.id });
      utterance.onend = () => this.finish(item.id, 'completed', generation!);
      utterance.onerror = () => this.finish(item.id, 'error', generation!);
      this.dependencies.render();
      window.speechSynthesis.speak(utterance);
    } catch {
      if (generation !== undefined) this.lifecycle.finish(item.id, generation);
      state.assistantSpeaking = false;
      this.finishWithoutStarting(item.id, 'error');
      this.drain();
    }
  }

  private finish(id: string, outcome: SpeechOutcome, generation: number): void {
    if (!this.lifecycle.finish(id, generation)) return;
    const state = this.dependencies.state();
    const continues = continuesSpeakingAfterFinish(state.assistantSpeechEnabled, this.queue.length);
    state.assistantSpeaking = continues;
    this.finishWithoutStarting(id, outcome);
    if (continues) this.drain(); else this.dependencies.render();
  }

  private finishWithoutStarting(id: string, outcome: SpeechOutcome): void {
    this.dependencies.post({ type: 'assistant-speech-finished', id, outcome });
  }
}
