import type { SettingsVoice } from './view';

/** Browser-local speech preview. Test text never crosses into the extension host. */
export class SettingsSpeechPreview {
  private generation = 0;
  private speaking = false;
  private voiceList: SettingsVoice[] = [];
  private completion: ((outcome: 'completed' | 'cancelled' | 'error') => void) | undefined;

  constructor(private readonly onChange: () => void) {}

  get active(): boolean {
    return this.speaking;
  }

  get voices(): readonly SettingsVoice[] {
    return this.voiceList;
  }

  refreshVoices(): void {
    if (!supportsSpeech()) return;
    this.voiceList = window.speechSynthesis.getVoices().map((voice) => ({
      voiceURI: voice.voiceURI,
      name: voice.name,
      lang: voice.lang,
      default: voice.default,
    }));
    this.onChange();
  }

  speak(
    text: string,
    voiceUri: string,
    rate: number,
    lang: string,
    completion?: (outcome: 'completed' | 'cancelled' | 'error') => void,
  ): boolean {
    if (!supportsSpeech() || !text.trim()) {
      completion?.('error');
      return false;
    }
    this.stop();
    const generation = ++this.generation;
    this.completion = completion;
    const utterance = new SpeechSynthesisUtterance(text.trim());
    const voice = window.speechSynthesis.getVoices().find((candidate) => candidate.voiceURI === voiceUri);
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang || lang;
    utterance.rate = Math.min(2, Math.max(0.5, rate));
    const finish = (outcome: 'completed' | 'error') => {
      if (generation !== this.generation) return;
      this.speaking = false;
      const callback = this.completion;
      this.completion = undefined;
      this.onChange();
      callback?.(outcome);
    };
    utterance.onend = () => finish('completed');
    utterance.onerror = () => finish('error');
    this.speaking = true;
    this.onChange();
    try {
      window.speechSynthesis.speak(utterance);
      return true;
    } catch {
      finish('error');
      return false;
    }
  }

  stop(): void {
    this.generation += 1;
    if (supportsSpeech()) window.speechSynthesis.cancel();
    const callback = this.completion;
    this.completion = undefined;
    if (!this.speaking) {
      callback?.('cancelled');
      return;
    }
    this.speaking = false;
    this.onChange();
    callback?.('cancelled');
  }
}

function supportsSpeech(): boolean {
  return typeof window.speechSynthesis !== 'undefined'
    && typeof SpeechSynthesisUtterance !== 'undefined';
}
