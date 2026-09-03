import type { SettingsRepository } from '../config';
import type { DiagnosticsResult, DiagnosticsService } from '../features/diagnostics';
import type { AudioDeviceService } from '../features/recording';
import type { PcmStreamHandle, PcmStreamOptions } from '../recorder/native';
import type {
  ControlCenterBrowserMessage,
  ControlCenterDiagnosticCheck,
  ControlCenterHostMessage,
  ControlCenterObservedSystemVoice,
  ControlCenterSetupStepState,
  ControlCenterSetupStepStates,
} from '../webview/controlCenter/contracts';
import {
  isSonioxTtsVoice,
  mergeSystemVoices,
  sonioxSystemVoices,
} from '../webview/controlCenter/hostVoices';
import type { NativeLocalize } from './nativeLocalization';
import type { ControlCenterSetupChoices } from './controlCenterSetupChoices';

const MICROPHONE_TEST_MS = 1_500;
type SetupState = Omit<Extract<ControlCenterHostMessage, { type: 'setupState' }>, 'type' | 'revision'>;
type DiagnosticsState = Omit<Extract<ControlCenterHostMessage, { type: 'diagnosticsState' }>, 'type' | 'revision'>;
type MicrophoneIntent = Extract<ControlCenterBrowserMessage, { type: 'microphoneSetupIntent' }>;
type SystemTtsIntent = Extract<ControlCenterBrowserMessage, { type: 'systemTtsIntent' }>;
type DiagnosticsIntent = Extract<ControlCenterBrowserMessage, { type: 'diagnosticsIntent' }>;

/** The bounded host speech fallback seen by the Control Center; absent on most platforms. */
export interface ControlCenterHostSpeech {
  voices(): readonly ControlCenterObservedSystemVoice[];
  speak(text: string, options: { language: 'he' | 'en'; rate: number }): boolean;
  stop(): void;
}

/**
 * The consent-gated Soniox voice path. Its roster is fetched lazily and detached, so this
 * port answers an empty list until the gate opens and the request settles.
 */
export interface ControlCenterSonioxTts {
  /** Bare provider voice ids; both sides expand them into the same voice records. */
  voiceIds(): readonly string[];
  state(): 'ready' | 'unavailable';
  ensureVoices(): void;
  speak(text: string, options: { language: 'he' | 'en'; rate: number }): boolean;
  stop(): void;
}

export interface ControlCenterOperationsOptions {
  settings: Pick<SettingsRepository, 'read' | 'update'>;
  hostSpeech?: ControlCenterHostSpeech;
  sonioxTts?: ControlCenterSonioxTts;
  setupChoices: Pick<ControlCenterSetupChoices, 'snapshot' | 'recordTts'>;
  devices: Pick<AudioDeviceService, 'get' | 'selectionStatus' | 'cachedDevices'>;
  diagnostics: Pick<DiagnosticsService, 'collect' | 'open' | 'result'>;
  selectAudioDevice(): PromiseLike<void>;
  startPcmStream(options: PcmStreamOptions): Promise<PcmStreamHandle>;
  publish(): Promise<void> | void;
  localize: NativeLocalize;
  copyText(text: string): PromiseLike<void>;
}

/** Owns bounded Control Center setup observations; browser state never grants authority. */
export class ControlCenterOperations {
  private microphoneState: SetupState['microphoneState'] = 'untested';
  private microphoneLabel = '';
  private microphoneGeneration = 0;
  private activeMicrophone: PcmStreamHandle | undefined;
  private observedVoices: ControlCenterObservedSystemVoice[] = [];
  private voicesObserved = false;
  private diagnosticsStatus: DiagnosticsState['status'] = 'idle';
  private disposed = false;

  constructor(private readonly options: ControlCenterOperationsOptions) {}

  setupState(): SetupState {
    const settings = this.options.settings.read().values;
    // Visiting setup is what asks the provider for its roster; the request is detached.
    if (!this.disposed) this.options.sonioxTts?.ensureVoices();
    const hostVoices = this.options.hostSpeech?.voices() ?? [];
    const sonioxVoices = this.sonioxVoiceIds();
    const stepStates: ControlCenterSetupStepStates = [
      microphoneStepState(this.microphoneState),
      'pending',
      systemTtsStepState(
        this.systemTtsState(),
        settings.assistantSpeechEnabled,
        this.options.setupChoices.snapshot().tts,
      ),
      'pending',
    ];
    return {
      microphoneState: this.microphoneState,
      microphoneLabel: this.microphoneLabel || this.selectedMicrophoneLabel(),
      systemTtsEnabled: settings.assistantSpeechEnabled,
      systemTtsVoiceIndex: settings.assistantSpeechVoiceUri
        ? this.effectiveVoices().findIndex(({ voiceUri }) => voiceUri === settings.assistantSpeechVoiceUri)
        : -1,
      systemTtsRate: settings.assistantSpeechRate,
      stepStates,
      recommendedStep: recommendedSetupStep(stepStates),
      ...(hostVoices.length > 0 ? { hostVoices: hostVoices.map((voice) => ({ ...voice })) } : {}),
      ...(sonioxVoices.length > 0 ? { sonioxVoices: [...sonioxVoices] } : {}),
    };
  }

  diagnosticsState(): DiagnosticsState {
    const result = this.options.diagnostics.result;
    const status = this.diagnosticsStatus === 'running' || this.diagnosticsStatus === 'error'
      ? this.diagnosticsStatus
      : result ? 'ready' : this.diagnosticsStatus;
    return {
      status,
      summary: this.summary(status, result),
      checks: result ? this.diagnosticChecks(result) : [],
      canOpen: Boolean(result),
      canCopy: Boolean(result),
    };
  }

  systemTtsState(): 'off' | 'configured-unverified' | 'ready' | 'unavailable' {
    const settings = this.options.settings.read().values;
    if (!settings.assistantSpeechEnabled) return 'off';
    // A probed host fallback is itself an observation: the browser can report an empty
    // list forever on runtimes whose speechSynthesis exposes no voices.
    const voices = this.effectiveVoices();
    if (!this.voicesObserved && this.hostVoices().length === 0) return 'configured-unverified';
    if (voices.length === 0) return 'unavailable';
    if (settings.assistantSpeechVoiceUri
      && !voices.some(({ voiceUri }) => voiceUri === settings.assistantSpeechVoiceUri)) {
      return 'unavailable';
    }
    return 'ready';
  }

  async microphone(message: MicrophoneIntent): Promise<void> {
    if (message.operation === 'select-device') {
      this.stopMicrophoneTest('untested');
      await this.options.selectAudioDevice();
      try { await this.options.devices.get(true); } catch {
        this.microphoneState = 'unavailable';
      }
      this.microphoneLabel = this.selectedMicrophoneLabel();
      await this.options.publish();
      return;
    }
    if (message.operation === 'stop-test') {
      this.stopMicrophoneTest('untested');
      await this.options.publish();
      return;
    }
    await this.testMicrophoneSignal();
  }

  observeVoices(voices: readonly ControlCenterObservedSystemVoice[]): void {
    if (this.disposed || this.voicesObserved && sameVoices(this.observedVoices, voices)) return;
    this.voicesObserved = true;
    this.observedVoices = voices.map((voice) => ({ ...voice }));
    void this.options.publish();
  }

  async systemTts(message: SystemTtsIntent): Promise<void> {
    // Playback operations mutate no host state, so they neither publish nor await a child.
    if (message.operation === 'preview') {
      this.previewHostSpeech();
      return;
    }
    if (message.operation === 'preview-stop') {
      // Stopping is unconditional on every host path, whichever one is speaking.
      this.options.sonioxTts?.stop();
      this.options.hostSpeech?.stop();
      return;
    }
    if (message.operation === 'set-enabled') {
      await this.options.settings.update({ assistantSpeechEnabled: message.enabled });
      await this.options.setupChoices.recordTts(message.enabled ? 'system' : 'off');
    } else if (message.operation === 'set-rate') {
      await this.options.settings.update({ assistantSpeechRate: message.rate });
    } else {
      const voiceUri = message.voiceIndex === -1
        ? ''
        : this.effectiveVoices()[message.voiceIndex]?.voiceUri;
      if (voiceUri === undefined) return;
      await this.options.settings.update({ assistantSpeechVoiceUri: voiceUri });
    }
    await this.options.publish();
  }

  async diagnostics(message: DiagnosticsIntent): Promise<void> {
    if (message.operation === 'run') {
      this.diagnosticsStatus = 'running';
      await this.options.publish();
      try {
        await this.options.diagnostics.collect();
        this.diagnosticsStatus = 'ready';
      } catch {
        this.diagnosticsStatus = 'error';
      }
    } else if (message.operation === 'open') {
      this.options.diagnostics.open();
    } else {
      const report = this.options.diagnostics.result?.report;
      if (report) await this.options.copyText(report);
    }
    await this.options.publish();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopMicrophoneTest('untested');
    this.observedVoices = [];
    this.voicesObserved = false;
  }

  /**
   * The host-owned channel: the probed speech-dispatcher fallback first, then the gated
   * Soniox roster. Both are absent until their own gate opens. The browser expands the
   * same ids in the same order, so one index always means one voice on both sides.
   */
  private hostVoices(): readonly ControlCenterObservedSystemVoice[] {
    if (this.disposed) return [];
    return [
      ...this.options.hostSpeech?.voices() ?? [],
      ...sonioxSystemVoices(
        this.sonioxVoiceIds(),
        this.options.settings.read().values.uiLanguage,
      ),
    ];
  }

  private sonioxVoiceIds(): readonly string[] {
    return this.disposed ? [] : this.options.sonioxTts?.voiceIds() ?? [];
  }

  /** The single list the browser renders and every voice index refers to. */
  private effectiveVoices(): ControlCenterObservedSystemVoice[] {
    return mergeSystemVoices(this.observedVoices, this.hostVoices());
  }

  /** Host-composed preview text: the browser can neither author nor play this voice. */
  private previewHostSpeech(): void {
    if (this.hostVoices().length === 0) return;
    const settings = this.options.settings.read().values;
    const request = {
      language: settings.uiLanguage === 'he' ? 'he' as const : 'en' as const,
      rate: settings.assistantSpeechRate,
    };
    const text = this.options.localize(
      'Voice Input system speech preview.',
      'תצוגה מקדימה של דיבור המערכת עבור Voice Input.',
    );
    // The same host-composed sentence reaches whichever host path owns the selected voice.
    if (isSonioxTtsVoice(settings.assistantSpeechVoiceUri)
      && this.options.sonioxTts?.speak(text, request)) return;
    this.options.hostSpeech?.speak(text, request);
  }

  private async testMicrophoneSignal(): Promise<void> {
    this.stopMicrophoneTest('testing');
    const generation = this.microphoneGeneration;
    await this.options.publish();
    let samples = 0;
    let peak = 0;
    try {
      const devices = await this.options.devices.get(true);
      const kind = this.options.devices.selectionStatus?.kind;
      if (devices.length === 0 || kind === 'stale' || kind === 'legacy-ambiguous') {
        if (generation === this.microphoneGeneration) this.microphoneState = 'unavailable';
        return;
      }
      const handle = await this.options.startPcmStream({
        deviceId: this.options.settings.read().values.audioDevice,
        maxDurationMs: MICROPHONE_TEST_MS,
        onFrame: (frame) => {
          if (generation !== this.microphoneGeneration) return;
          samples += frame.length;
          for (const value of frame) peak = Math.max(peak, Math.abs(value));
        },
      });
      if (generation !== this.microphoneGeneration) {
        handle.cancel();
        await handle.stop().catch(() => {});
        return;
      }
      this.activeMicrophone = handle;
      this.microphoneLabel = handle.selectedDevice.slice(0, 120);
      const outcome = await handle.outcome;
      await handle.stop().catch(() => {});
      if (generation !== this.microphoneGeneration) return;
      this.microphoneState = outcome.reason === 'error'
        ? 'error'
        : samples > 0 && peak > 0 ? 'signal-detected' : 'no-signal';
    } catch {
      if (generation === this.microphoneGeneration) this.microphoneState = 'error';
    } finally {
      if (generation === this.microphoneGeneration) {
        this.activeMicrophone = undefined;
        await this.options.publish();
      }
    }
  }

  private stopMicrophoneTest(next: SetupState['microphoneState']): void {
    this.microphoneGeneration += 1;
    const active = this.activeMicrophone;
    this.activeMicrophone = undefined;
    active?.cancel();
    void active?.stop().catch(() => {});
    this.microphoneState = next;
  }

  private selectedMicrophoneLabel(): string {
    const selection = this.options.devices.selectionStatus;
    if (!selection || selection.kind === 'default') {
      return this.options.localize('System default', 'ברירת המחדל של המערכת');
    }
    if ('label' in selection) return selection.label.slice(0, 120);
    return this.options.localize('Microphone selection unavailable', 'בחירת המיקרופון אינה זמינה');
  }

  private summary(status: DiagnosticsState['status'], result?: DiagnosticsResult): string {
    if (status === 'running') return this.options.localize('Running local diagnostics…', 'מריץ בדיקות מקומיות…');
    if (status === 'error') return this.options.localize('Diagnostics stopped safely with an error.', 'הבדיקות נעצרו בבטחה עם שגיאה.');
    if (!result) return this.options.localize('Diagnostics have not been run.', 'הבדיקות עדיין לא הופעלו.');
    return result.status === 'ready'
      ? this.options.localize('All reported checks are ready.', 'כל הבדיקות המדווחות מוכנות.')
      : this.options.localize('Some checks need attention.', 'חלק מהבדיקות דורשות תשומת לב.');
  }

  private diagnosticChecks(result: DiagnosticsResult): ControlCenterDiagnosticCheck[] {
    const source = new Map(result.checks.map((check) => [check.id, check.status]));
    const check = (
      kind: ControlCenterDiagnosticCheck['kind'],
      id: 'microphone' | 'soniox' | 'deepseek' | 'workspace-trust',
    ): ControlCenterDiagnosticCheck => {
      const status = source.get(id) ?? 'unknown';
      return {
        kind,
        status: status === 'ok' ? 'ready' : status === 'unavailable' ? 'unavailable' : 'attention',
        message: status === 'ok'
          ? this.options.localize('Ready.', 'מוכן.')
          : this.options.localize('Needs attention or configuration.', 'נדרשת תשומת לב או הגדרה.'),
      };
    };
    return [
      check('microphone', 'microphone'),
      check('speech-to-text', 'soniox'),
      {
        kind: 'system-speech',
        status: this.systemTtsState() === 'ready' ? 'ready' : 'unavailable',
        message: this.systemTtsState() === 'ready'
          ? this.options.localize('An operating-system voice was observed.', 'זוהה קול של מערכת ההפעלה.')
          : this.options.localize('No usable operating-system voice was observed.', 'לא זוהה קול שמיש של מערכת ההפעלה.'),
      },
      { kind: 'commands', status: 'ready', message: this.options.localize('Built-in command catalog loaded.', 'קטלוג הפקודות המובנות נטען.') },
      check('authority', 'workspace-trust'),
      check('assistant', 'deepseek'),
    ];
  }
}

function microphoneStepState(
  state: SetupState['microphoneState'],
): ControlCenterSetupStepState {
  if (state === 'signal-detected') return 'complete';
  if (state === 'no-signal' || state === 'unavailable' || state === 'error') return 'attention';
  return 'pending';
}

function systemTtsStepState(
  state: ReturnType<ControlCenterOperations['systemTtsState']>,
  enabled: boolean,
  decision: ReturnType<ControlCenterSetupChoices['snapshot']>['tts'],
): ControlCenterSetupStepState {
  if (decision === 'off' && !enabled && state === 'off') return 'complete';
  if (decision !== 'system' || !enabled) return 'pending';
  return state === 'ready' ? 'complete' : 'attention';
}

export function recommendedSetupStep(
  states: ControlCenterSetupStepStates,
): 1 | 2 | 3 | 4 {
  const firstUnfinished = states.findIndex((state) => state !== 'complete');
  return firstUnfinished < 0 ? 4 : firstUnfinished + 1 as 1 | 2 | 3 | 4;
}

function sameVoices(
  left: readonly ControlCenterObservedSystemVoice[],
  right: readonly ControlCenterObservedSystemVoice[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
