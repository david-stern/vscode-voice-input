import { normalizeSpeechRate, selectSpeechVoice } from '../speech';
import type { ControlCenterObservedSystemVoice } from './contracts';

export type SystemSpeechPreviewState = 'idle' | 'speaking' | 'completed' | 'cancelled' | 'error';

export interface SystemSpeechPresentation {
  voices: readonly ControlCenterObservedSystemVoice[];
  previewState: SystemSpeechPreviewState;
}

/** Browser-local system voice observation and preview. It never grants host authority. */
export class ControlCenterSystemSpeech {
  private voiceList: ControlCenterObservedSystemVoice[] = [];
  private generation = 0;
  private state: SystemSpeechPreviewState = 'idle';

  constructor(private readonly onChange: () => void) {}

  presentation(): SystemSpeechPresentation {
    return { voices: this.voiceList, previewState: this.state };
  }

  refreshVoices(): boolean {
    const next = supportsSystemSpeech()
      ? boundedVoices(window.speechSynthesis.getVoices())
      : [];
    if (JSON.stringify(next) === JSON.stringify(this.voiceList)) return false;
    this.voiceList = next;
    this.onChange();
    return true;
  }

  preview(
    text: string,
    voiceIndex: number,
    rate: number,
    language: 'he' | 'en',
  ): boolean {
    if (!supportsSystemSpeech() || !text.trim() || this.voiceList.length === 0) {
      this.setState('error');
      return false;
    }
    this.stop(false);
    const generation = ++this.generation;
    const nativeVoices = window.speechSynthesis.getVoices();
    const observed = voiceIndex >= 0 ? this.voiceList[voiceIndex] : undefined;
    const selected = voiceIndex >= 0
      ? observed
        ? nativeVoices.find((voice) => voice.voiceURI === observed.voiceUri)
        : undefined
      : selectSpeechVoice(nativeVoices, undefined, language);
    if (!selected) {
      this.setState('error');
      return false;
    }
    const utterance = new SpeechSynthesisUtterance(text.trim());
    utterance.voice = selected;
    utterance.lang = selected.lang || language;
    utterance.rate = normalizeSpeechRate(rate);
    utterance.onend = () => this.finish(generation, 'completed');
    utterance.onerror = () => this.finish(generation, 'error');
    this.setState('speaking');
    try {
      window.speechSynthesis.speak(utterance);
      return true;
    } catch {
      this.finish(generation, 'error');
      return false;
    }
  }

  stop(announce = true): void {
    this.generation += 1;
    if (supportsSystemSpeech()) window.speechSynthesis.cancel();
    if (announce && this.state === 'speaking') this.setState('cancelled');
    else if (!announce && this.state === 'speaking') this.state = 'idle';
  }

  dispose(): void {
    this.stop(false);
    this.voiceList = [];
  }

  private finish(generation: number, state: 'completed' | 'error'): void {
    if (generation !== this.generation) return;
    this.setState(state);
  }

  private setState(state: SystemSpeechPreviewState): void {
    if (this.state === state) return;
    this.state = state;
    this.onChange();
  }
}

function boundedVoices(voices: readonly SpeechSynthesisVoice[]): ControlCenterObservedSystemVoice[] {
  const result: ControlCenterObservedSystemVoice[] = [];
  const identifiers = new Set<string>();
  for (const voice of voices) {
    if (result.length >= 20) break;
    const voiceUri = boundedText(voice.voiceURI, 512);
    const name = boundedText(voice.name, 120);
    const language = boundedText(voice.lang, 40);
    if (!voiceUri || !name || identifiers.has(voiceUri)) continue;
    identifiers.add(voiceUri);
    result.push({ voiceUri, name, language, isDefault: voice.default });
  }
  return result;
}

function boundedText(value: string, maximum: number): string {
  return Array.from(value).slice(0, maximum).join('');
}

function supportsSystemSpeech(): boolean {
  return typeof window.speechSynthesis !== 'undefined'
    && typeof SpeechSynthesisUtterance !== 'undefined';
}
