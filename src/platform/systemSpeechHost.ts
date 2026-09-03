import type { ControlCenterObservedSystemVoice } from '../webview/controlCenter/contracts';
import { HOST_SPEECH_VOICE_URI } from '../webview/controlCenter/hostVoices';
import { MAX_SPEECH_TEXT_LENGTH } from '../webview/speech';
import type { NativeLocalize } from './nativeLocalization';

/** The only executable this service ever starts, always with an argv array and no shell. */
export const SPEECH_DISPATCHER_COMMAND = 'spd-say';
const PROBE_TIMEOUT_MS = 3_000;

/** Minimal structural view of a spawned child, so tests never start a real process. */
export interface HostSpeechProcess {
  on(event: 'error', listener: (error: unknown) => void): unknown;
  on(event: 'exit', listener: (code: number | null) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

export type HostSpeechSpawn = (command: string, args: readonly string[]) => HostSpeechProcess;

export interface SystemSpeechHostOptions {
  spawn: HostSpeechSpawn;
  localize: NativeLocalize;
  /** Content-free: spoken text may be sensitive and is never logged. */
  log(message: string): void;
  platform?: string;
  probeTimeoutMs?: number;
  onAvailabilityChanged?(): void;
}

export interface HostSpeakOptions {
  language: 'he' | 'en';
  rate: number;
  onFinished?(outcome: 'completed' | 'error'): void;
}

/**
 * Host-side system speech through speech-dispatcher.
 *
 * VS Code's Electron runtime reports no `speechSynthesis` voices on Linux, which leaves
 * the Control Center's system-voice step unfinishable and the assistant silent. This
 * service adds one bounded host fallback: it probes `spd-say` once, presents itself as a
 * single synthetic voice, and speaks by starting `spd-say` with an argv array only.
 * It is inert everywhere the probe does not succeed, so other platforms behave as before.
 */
export class SystemSpeechHost {
  private availability: 'unknown' | 'available' | 'unavailable' = 'unknown';
  private active: HostSpeechProcess | undefined;
  private spoke = false;
  private disposed = false;

  constructor(private readonly options: SystemSpeechHostOptions) {
    void this.probe();
  }

  get isAvailable(): boolean {
    return !this.disposed && this.availability === 'available';
  }

  /** The bounded UI projection: one synthetic voice, or nothing when unavailable. */
  voices(): ControlCenterObservedSystemVoice[] {
    if (!this.isAvailable) return [];
    return [{
      voiceUri: HOST_SPEECH_VOICE_URI,
      name: this.options.localize(
        'System speech (speech-dispatcher)',
        'דיבור מערכת (speech-dispatcher)',
      ),
      language: 'he',
      isDefault: false,
    }];
  }

  /** Returns whether a child was started; callers fall back to the browser when it is not. */
  speak(text: string, options: HostSpeakOptions): boolean {
    if (!this.isAvailable) return false;
    const bounded = text.trim().slice(0, MAX_SPEECH_TEXT_LENGTH);
    if (!bounded) return false;
    this.killActive();
    const argv = [
      '-l', options.language === 'he' ? 'he' : 'en',
      '-r', String(hostSpeechRate(options.rate)),
      // Everything after the separator is a positional argument, so text that starts
      // with a dash can never be read as a flag.
      '--', bounded,
    ];
    const child = this.start(argv);
    if (!child) {
      options.onFinished?.('error');
      return false;
    }
    this.active = child;
    this.spoke = true;
    let settled = false;
    const finish = (outcome: 'completed' | 'error') => {
      if (settled) return;
      settled = true;
      if (this.active === child) this.active = undefined;
      options.onFinished?.(outcome);
    };
    child.on('error', () => {
      this.options.log('host system speech failed to start');
      finish('error');
    });
    child.on('exit', (code) => finish(code === 0 ? 'completed' : 'error'));
    return true;
  }

  /**
   * Stops host speech. Killing the child alone cannot stop audio that speech-dispatcher
   * already owns, so an explicit bounded cancel is sent once per spoken utterance.
   */
  stop(): void {
    this.killActive();
    if (!this.spoke || !this.isAvailable) return;
    this.spoke = false;
    const child = this.start(['--cancel']);
    child?.on('error', () => { this.options.log('host system speech cancel failed'); });
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.killActive();
    this.disposed = true;
    this.availability = 'unavailable';
  }

  private async probe(): Promise<void> {
    const platform = this.options.platform ?? process.platform;
    // speech-dispatcher is a Linux facility: probing elsewhere would only cost a spawn.
    if (platform !== 'linux') {
      this.availability = 'unavailable';
      return;
    }
    const available = await this.runProbe();
    if (this.disposed) return;
    this.availability = available ? 'available' : 'unavailable';
    this.options.onAvailabilityChanged?.();
  }

  private runProbe(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const child = this.start(['--version']);
      if (!child) {
        resolve(false);
        return;
      }
      let settled = false;
      const finish = (available: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(available);
      };
      const timer = setTimeout(() => {
        this.killProcess(child);
        this.options.log('host system speech probe timed out');
        finish(false);
      }, this.options.probeTimeoutMs ?? PROBE_TIMEOUT_MS);
      child.on('error', () => finish(false));
      child.on('exit', (code) => finish(code === 0));
    });
  }

  private start(args: readonly string[]): HostSpeechProcess | undefined {
    try {
      return this.options.spawn(SPEECH_DISPATCHER_COMMAND, args);
    } catch {
      this.options.log('host system speech could not start a process');
      return undefined;
    }
  }

  private killActive(): void {
    const active = this.active;
    this.active = undefined;
    if (active) this.killProcess(active);
  }

  private killProcess(child: HostSpeechProcess): void {
    try { child.kill('SIGTERM'); } catch {
      this.options.log('host system speech could not stop a process');
    }
  }
}

/**
 * Maps the extension's 0.5..2 speech rate onto the spd-say -100..100 scale.
 *
 * The mapping is monotone and anchored at 1× → 0: 0.5× → -50, 1.4× → +40, 2× → +100.
 */
export function hostSpeechRate(rate: unknown): number {
  const value = typeof rate === 'number' && Number.isFinite(rate) ? rate : 1;
  const clamped = Math.min(2, Math.max(0.5, value));
  return Math.round((clamped - 1) * 100);
}
