import type { SettingsRepository } from '../config';
import { MAX_SONIOX_TTS_VOICES, sonioxVoiceUri } from '../webview/controlCenter/hostVoices';
import type {
  SonioxTtsOutcome,
  SonioxTtsPlayback,
  SonioxTtsService,
  SonioxTtsVoice,
} from './sonioxTtsService';

/** A refused roster request is retried, but never on every panel publish. */
const ROSTER_RETRY_COOLDOWN_MS = 15_000;

export interface SonioxTtsSpeakRequest {
  language: 'he' | 'en';
  rate: number;
  onFinished?(outcome: SonioxTtsOutcome): void;
}

export interface SonioxTtsCoordinatorOptions {
  service: Pick<SonioxTtsService, 'synthesizeAndPlay' | 'cancel' | 'listVoices' | 'invalidateVoices'>;
  settings: Pick<SettingsRepository, 'read'>;
  /** Re-publishes once the detached roster request settles. */
  publish(): void;
  now?(): number;
}

/**
 * Presents Soniox speech output to the Control Center and to the speech router.
 *
 * The roster is fetched lazily and detached, because the gate behind it (provider
 * selection, credential, machine-local remote-processing receipt) can open at any time
 * and the intent queue must never wait on a network request.
 */
export class SonioxTtsCoordinator {
  private roster: readonly SonioxTtsVoice[] = [];
  private loading = false;
  private nextAttemptAt = 0;
  private active: SonioxTtsPlayback | undefined;
  private disposed = false;

  constructor(private readonly options: SonioxTtsCoordinatorOptions) {}

  /** Ready means: Soniox is the selected provider and a bounded roster is known. */
  state(): 'ready' | 'unavailable' {
    return !this.disposed && this.selected() && this.roster.length > 0 ? 'ready' : 'unavailable';
  }

  get isReady(): boolean {
    return this.state() === 'ready';
  }

  /** Bare ids: the setup projection expands them, and so does the browser. */
  voiceIds(): readonly string[] {
    if (this.state() !== 'ready') return [];
    return this.roster.slice(0, MAX_SONIOX_TTS_VOICES).map((voice) => voice.id);
  }

  /** Idempotent, detached, and bounded by a cooldown while the gate stays closed. */
  ensureVoices(): void {
    if (this.disposed || this.loading || this.roster.length > 0 || !this.selected()) return;
    if (this.now() < this.nextAttemptAt) return;
    this.loading = true;
    void this.options.service.listVoices().then(
      (voices) => this.rosterSettled(voices),
      () => this.rosterSettled([]),
    );
  }

  /** Starts one utterance; `false` means the caller must fall back to another voice. */
  speak(text: string, options: SonioxTtsSpeakRequest): boolean {
    const voice = this.selectedVoice();
    if (this.disposed || !voice || !this.isReady) return false;
    const playback = this.options.service.synthesizeAndPlay(text, {
      language: options.language === 'he' ? 'he' : 'en',
      rate: options.rate,
      voice,
    });
    this.active = playback;
    void playback.done.then((outcome) => {
      if (this.active === playback) this.active = undefined;
      if (!this.disposed) options.onFinished?.(outcome);
    });
    return true;
  }

  stop(): void {
    this.active = undefined;
    this.options.service.cancel();
  }

  /** A revoked or rotated authority drops the roster, so the list cannot outlive consent. */
  invalidate(): void {
    if (this.disposed) return;
    const had = this.roster.length > 0;
    this.roster = [];
    this.nextAttemptAt = 0;
    this.options.service.invalidateVoices();
    this.stop();
    if (had) this.options.publish();
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.roster = [];
  }

  private rosterSettled(voices: readonly SonioxTtsVoice[]): void {
    this.loading = false;
    if (this.disposed) return;
    if (voices.length === 0) {
      this.nextAttemptAt = this.now() + ROSTER_RETRY_COOLDOWN_MS;
      return;
    }
    this.roster = voices;
    this.options.publish();
  }

  /** The selected voice must still be one the provider offered in this session. */
  private selectedVoice(): string | undefined {
    const selected = this.options.settings.read().values.assistantSpeechVoiceUri;
    return this.roster
      .find((voice) => sonioxVoiceUri(voice.id) === selected)
      ?.id;
  }

  private selected(): boolean {
    return this.options.settings.read().values.transcriptionProvider === 'soniox';
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}
