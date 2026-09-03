import { spawn } from 'node:child_process';

import type { SettingsRepository } from '../config';
import type { SpeechDeliveryPort } from '../features/assistant';
import { isHostChannelVoice, isSonioxTtsVoice } from '../webview/controlCenter/hostVoices';
import type { NativeLocalize } from './nativeLocalization';
import { SystemSpeechHost, type HostSpeechSpawn } from './systemSpeechHost';

export interface HostSpeechService {
  readonly isAvailable: boolean;
  speak(text: string, options: {
    language: 'he' | 'en';
    rate: number;
    onFinished?(outcome: 'completed' | 'error'): void;
  }): boolean;
  stop(): void;
}

/** The optional remote voice path; absent until Soniox output is composed and gated. */
export interface SonioxSpeechService {
  state(): 'ready' | 'unavailable';
  speak(text: string, options: {
    language: 'he' | 'en';
    rate: number;
    onFinished?(outcome: 'completed' | 'error' | 'cancelled'): void;
  }): boolean;
  stop(): void;
}

export interface HostSpeechDeliveryOptions {
  /** The browser sidebar delivery that stays authoritative for every browser voice. */
  browser: SpeechDeliveryPort;
  host: HostSpeechService;
  soniox?: SonioxSpeechService;
  settings: Pick<SettingsRepository, 'read'>;
  /** Reports the host utterance lifecycle back through the assistant's speech ids. */
  onFinished(id: string, outcome: string): void;
  /** Content-free: spoken text is never logged. */
  log?(message: string): void;
}

/**
 * Routes assistant speech by the selected voice: a Soniox voice goes to the gated remote
 * path, the synthetic host voice goes to speech-dispatcher, and everything else stays
 * with the browser delivery. Every host-side path that cannot start — or that fails after
 * it started, including a refused consent receipt — falls back to speech-dispatcher and
 * then to the browser, so a selected voice can never turn the assistant silent.
 */
export class HostSpeechDelivery implements SpeechDeliveryPort {
  constructor(private readonly options: HostSpeechDeliveryOptions) {}

  postSpeak(id: string, text: string, lang?: string): 'sent' | 'queued' | 'unavailable' {
    const voiceUri = this.options.settings.read().values.assistantSpeechVoiceUri;
    if (!isHostChannelVoice(voiceUri)) return this.options.browser.postSpeak(id, text, lang);
    if (isSonioxTtsVoice(voiceUri) && this.options.soniox?.state() === 'ready') {
      const started = this.options.soniox.speak(text, {
        ...this.playbackOptions(lang),
        onFinished: (outcome) => this.sonioxFinished(id, text, lang, outcome),
      });
      if (started) return 'sent';
      this.options.log?.('soniox speech did not start; using the host or sidebar voice');
    }
    return this.fallbackSpeak(id, text, lang);
  }

  cancelSpeaking(): boolean {
    // Whichever path is speaking, stopping is unconditional on all of them.
    this.options.soniox?.stop();
    this.options.host.stop();
    return this.options.browser.cancelSpeaking();
  }

  /** A soniox failure re-delivers the same utterance id exactly once. */
  private sonioxFinished(
    id: string,
    text: string,
    lang: string | undefined,
    outcome: 'completed' | 'error' | 'cancelled',
  ): void {
    if (outcome !== 'error') {
      this.options.onFinished(id, `soniox-${outcome}`);
      return;
    }
    this.options.log?.('soniox speech failed; using the host or sidebar voice');
    if (this.fallbackSpeak(id, text, lang) === 'unavailable') {
      this.options.onFinished(id, 'soniox-error');
    }
  }

  private fallbackSpeak(
    id: string,
    text: string,
    lang?: string,
  ): 'sent' | 'queued' | 'unavailable' {
    const started = this.options.host.isAvailable && this.options.host.speak(text, {
      ...this.playbackOptions(lang),
      onFinished: (outcome) => this.options.onFinished(id, `host-${outcome}`),
    });
    return started ? 'sent' : this.options.browser.postSpeak(id, text, lang);
  }

  private playbackOptions(lang?: string): { language: 'he' | 'en'; rate: number } {
    return {
      language: lang === 'he' ? 'he' : 'en',
      rate: this.options.settings.read().values.assistantSpeechRate,
    };
  }
}

export interface HostSpeechWiringOptions {
  browser: SpeechDeliveryPort;
  settings: Pick<SettingsRepository, 'read'>;
  localize: NativeLocalize;
  log(message: string): void;
  /** Re-publishes once the one-shot availability probe settles. */
  publish(): void;
  onFinished(id: string, outcome: string): void;
  spawn?: HostSpeechSpawn;
  /** The gated remote path, when Soniox speech output is composed for this session. */
  soniox?: SonioxSpeechService;
}

/** Composes the probed host speech service with the browser-first delivery routing. */
export function createHostSpeechWiring(options: HostSpeechWiringOptions): {
  host: SystemSpeechHost;
  delivery: HostSpeechDelivery;
} {
  const host = new SystemSpeechHost({
    // An argv array with no shell, so no spoken text can ever become a command.
    spawn: options.spawn ?? ((command, args) => spawn(command, [...args], { stdio: 'ignore' })),
    localize: options.localize,
    log: options.log,
    onAvailabilityChanged: options.publish,
  });
  const delivery = new HostSpeechDelivery({
    browser: options.browser,
    host,
    soniox: options.soniox,
    settings: options.settings,
    onFinished: options.onFinished,
    log: options.log,
  });
  return { host, delivery };
}
