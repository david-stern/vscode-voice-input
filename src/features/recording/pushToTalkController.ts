import type { SettingsRepository } from '../../config';
import type { HistoryStore } from '../../history';
import type { InjectionMode } from '../../inject';
import { isZeroSampleCaptureError } from '../../recorder/capture';
import { isNoUsableAudioInputError } from '../../recorder/devices';
import type { RecorderHandle } from '../../recorder/native';
import type { AudioDeviceService } from './deviceService';
import type { TranscriptionService } from './transcriptionService';

const RECORDING_STOP_DELAY_MS = 4 * 60 * 1_000 + 50 * 1_000;

export interface RecordingStatusPort {
  idle(): void;
  recording(): void;
  busy(label: string): void;
  captureError(message: string): void;
}

export interface RecordingUiPort {
  showError(message: string, action?: string): PromiseLike<string | undefined>;
  executeCommand(command: string): PromiseLike<unknown>;
}

export interface PushToTalkControllerOptions {
  devices: AudioDeviceService;
  transcriptions: TranscriptionService;
  settings: Pick<SettingsRepository, 'read'>;
  history: Pick<HistoryStore, 'add'>;
  status: RecordingStatusPort;
  ui: RecordingUiPort;
  publishHistory(): Promise<void> | void;
  stopAssistant(): Promise<void>;
  isAssistantActive(): boolean;
  isDeactivating(): boolean;
  localize(english: string, hebrew: string): string;
  startRecorder(): Promise<RecorderHandle>;
  injectText(text: string, mode: InjectionMode): Promise<void>;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

/** Owns one push-to-talk recorder handle from capture through injection and cleanup. */
export class PushToTalkController {
  private readonly setTimer: NonNullable<PushToTalkControllerOptions['setTimer']>;
  private readonly clearTimer: NonNullable<PushToTalkControllerOptions['clearTimer']>;
  private handle: RecorderHandle | null = null;
  private stoppingHandle: { handle: RecorderHandle; cancellationRequested: boolean } | undefined;
  private stopPipeline: Promise<void> | undefined;
  private stopTimer: ReturnType<typeof setTimeout> | undefined;
  private recordingActive = false;
  private disposed = false;
  private pipelineGeneration = 0;
  private startGeneration = 0;
  private pendingStartGeneration: number | undefined;

  constructor(private readonly options: PushToTalkControllerOptions) {
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
  }

  get isRecording(): boolean {
    return this.recordingActive;
  }

  get hasHandle(): boolean {
    return this.handle !== null;
  }

  async toggle(): Promise<void> {
    if (
      this.recordingActive
      || this.pendingStartGeneration !== undefined
      || this.stopPipeline !== undefined
    ) await this.stop();
    else await this.start();
  }

  async start(): Promise<void> {
    if (
      this.disposed
      || this.recordingActive
      || this.handle
      || this.stopPipeline
      || this.pendingStartGeneration !== undefined
    ) return;
    const generation = ++this.startGeneration;
    this.pendingStartGeneration = generation;
    try {
      if (this.options.isAssistantActive()) await this.options.stopAssistant();
      if (!this.ownsPendingStart(generation)) return;

      try {
        await this.options.devices.get();
      } catch {
        // The recorder start remains the authoritative failure below.
      }
      if (!this.ownsPendingStart(generation)) return;

      const selection = this.options.devices.selectionStatus;
      if (selection?.kind === 'stale') {
        const label = boundedDeviceLabel(selection.label);
        await this.showPendingStartDeviceError(
          generation,
          this.options.localize(
            `Voice Input: The saved microphone “${label}” is no longer available. Select another device or use the system default.`,
            `Voice Input: המיקרופון השמור „${label}” אינו זמין עוד. יש לבחור התקן אחר או להשתמש בברירת המחדל של המערכת.`,
          ),
        );
        return;
      }
      if (selection?.kind === 'legacy-ambiguous') {
        await this.showPendingStartDeviceError(
          generation,
          this.options.localize(
            'Voice Input: The saved microphone name matches more than one input. Select the intended device again.',
            'Voice Input: שם המיקרופון השמור מתאים ליותר מהתקן קלט אחד. יש לבחור שוב את ההתקן הרצוי.',
          ),
        );
        return;
      }

      const cachedDevices = this.options.devices.cachedDevices;
      if (
        this.options.devices.hasCachedResult
        && cachedDevices.length === 0
        && !this.options.devices.configuredDeviceId
      ) {
        const selectDevice = this.options.localize('Select Device', 'בחירת התקן');
        const selected = await this.options.ui.showError(
          this.options.localize(
            'Voice Input: No audio input source found. Connect a microphone and try again.',
            'Voice Input: לא נמצא מקור קלט שמע. יש לחבר מיקרופון ולנסות שוב.',
          ),
          selectDevice,
        );
        if (!this.ownsPendingStart(generation)) return;
        if (selected === selectDevice) {
          await this.options.ui.executeCommand('voiceInput.selectAudioDevice');
        }
        return;
      }

      const recordingHandle = await this.options.startRecorder();
      if (!this.ownsPendingStart(generation)) {
        this.cancelLateHandle(recordingHandle);
        return;
      }
      this.pendingStartGeneration = undefined;
      this.handle = recordingHandle;
      this.pipelineGeneration += 1;
      this.monitorCapture(recordingHandle);
      this.recordingActive = true;
      this.options.status.recording();
      this.stopTimer = this.setTimer(() => {
        this.stopTimer = undefined;
        void this.stop();
      }, RECORDING_STOP_DELAY_MS);
    } catch (error) {
      if (!this.ownsPendingStart(generation)) return;
      if ((error as Error).name !== 'AbortError') {
        if (isNoUsableAudioInputError(error)) {
          await this.showPendingStartDeviceError(
            generation,
            this.options.localize(
              'Voice Input: The system default is not a microphone input. Select a real microphone and try again.',
              'Voice Input: ברירת המחדל של המערכת אינה קלט מיקרופון. יש לבחור מיקרופון אמיתי ולנסות שוב.',
            ),
          );
        } else {
          await this.options.ui.showError(this.options.localize(
            'Voice Input could not start recording safely.',
            'Voice Input לא הצליח להתחיל להקליט באופן בטוח.',
          ));
        }
      }
      if (this.ownsPendingStart(generation)) this.options.status.idle();
    } finally {
      if (this.pendingStartGeneration === generation) this.pendingStartGeneration = undefined;
    }
  }

  async stop(): Promise<void> {
    this.invalidatePendingStart();
    this.clearStopTimer();
    if (this.stopPipeline) {
      await this.stopPipeline;
      return;
    }
    if (!this.handle) {
      this.recordingActive = false;
      if (!this.disposed) this.options.status.idle();
      return;
    }

    const activeHandle = this.handle;
    this.handle = null;
    const stoppingHandle = { handle: activeHandle, cancellationRequested: false };
    this.stoppingHandle = stoppingHandle;
    const generation = this.pipelineGeneration;
    this.options.status.busy(this.options.localize('encoding', 'מקודד'));
    const pipeline = this.beginStopPipeline(() => this.finishStop(stoppingHandle, generation));
    await pipeline;
  }

  async cancel(): Promise<void> {
    this.invalidatePendingStart();
    this.invalidatePipeline();
    this.clearStopTimer();
    this.options.transcriptions.abort('push-to-talk');
    this.recordingActive = false;
    this.cancelStoppingHandle();

    if (this.stopPipeline) {
      await this.stopPipeline.catch(() => {});
      return;
    }

    const activeHandle = this.handle;
    this.handle = null;
    if (!activeHandle) return;
    await this.beginCancelledHandleCleanup(activeHandle);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.invalidatePendingStart();
    this.invalidatePipeline();
    this.clearStopTimer();
    this.options.transcriptions.abort('push-to-talk');
    this.recordingActive = false;
    this.cancelStoppingHandle();
    if (this.stopPipeline) return;

    const activeHandle = this.handle;
    this.handle = null;
    if (activeHandle) void this.beginCancelledHandleCleanup(activeHandle);
  }

  private async finishStop(
    stoppingHandle: { handle: RecorderHandle; cancellationRequested: boolean },
    generation: number,
  ): Promise<void> {
    try {
      let result: Awaited<ReturnType<RecorderHandle['stop']>>;
      try {
        result = await stoppingHandle.handle.stop();
      } finally {
        this.releaseStoppingHandle(stoppingHandle);
      }
      if (!this.ownsPipeline(generation)) return;
      if (!result) return;
      if (result.wav.length === 44) {
        await this.showZeroSampleError(generation);
        return;
      }
      if (result.wav.length < 1_024) return;
      await this.transcribeAndDispatch(result.wav, result.mime, generation);
    } catch (error) {
      if (this.ownsPipeline(generation) && (error as Error).name !== 'AbortError') {
        if (isZeroSampleCaptureError(error)) {
          await this.showZeroSampleError(generation);
        } else {
          await this.options.ui.showError(this.options.localize(
            'Voice Input could not finish recording safely.',
            'Voice Input לא הצליח לסיים את ההקלטה באופן בטוח.',
          ));
        }
      }
    } finally {
      this.releaseStoppingHandle(stoppingHandle);
      if (this.ownsPipeline(generation)) {
        this.recordingActive = false;
        this.options.status.idle();
      }
    }
  }

  private beginCancelledHandleCleanup(activeHandle: RecorderHandle): Promise<void> {
    const stoppingHandle = { handle: activeHandle, cancellationRequested: false };
    this.stoppingHandle = stoppingHandle;
    this.cancelStoppingHandle();
    return this.beginStopPipeline(async () => {
      try {
        await activeHandle.stop();
      } catch {
        // Best effort: assistant startup and extension disposal must not surface cleanup errors.
      } finally {
        this.releaseStoppingHandle(stoppingHandle);
      }
    });
  }

  private beginStopPipeline(operation: () => Promise<void>): Promise<void> {
    const pipeline = Promise.resolve().then(operation);
    this.stopPipeline = pipeline;
    const release = () => {
      if (this.stopPipeline === pipeline) this.stopPipeline = undefined;
    };
    void pipeline.then(release, release);
    return pipeline;
  }

  private cancelStoppingHandle(): void {
    const stoppingHandle = this.stoppingHandle;
    if (!stoppingHandle || stoppingHandle.cancellationRequested) return;
    stoppingHandle.cancellationRequested = true;
    try {
      stoppingHandle.handle.cancel();
    } catch {
      // Cancellation remains authoritative even if native cleanup reports an error.
    }
  }

  private releaseStoppingHandle(
    stoppingHandle: { handle: RecorderHandle; cancellationRequested: boolean },
  ): void {
    if (this.stoppingHandle === stoppingHandle) this.stoppingHandle = undefined;
  }

  private monitorCapture(recordingHandle: RecorderHandle): void {
    void recordingHandle.outcome.then((outcome) => {
      if (this.handle !== recordingHandle || outcome.reason !== 'error') return;
      this.handle = null;
      this.recordingActive = false;
      this.clearStopTimer();
      const message = this.options.localize(
        'Voice Input recording stopped safely because microphone capture failed.',
        'Voice Input: ההקלטה הופסקה בבטחה בגלל שגיאת מיקרופון.',
      );
      this.options.status.captureError(message);
      void recordingHandle.stop().catch(() => {});
      if (!this.options.isDeactivating()) void this.options.ui.showError(message);
    });
  }

  private async showPendingStartDeviceError(generation: number, message: string): Promise<void> {
    const selectDevice = this.options.localize('Select Device', 'בחירת התקן');
    const selected = await this.options.ui.showError(message, selectDevice);
    if (!this.ownsPendingStart(generation) || selected !== selectDevice) return;
    await this.options.ui.executeCommand('voiceInput.selectAudioDevice');
  }

  private async showZeroSampleError(generation: number): Promise<void> {
    const selectDevice = this.options.localize('Select Device', 'בחירת התקן');
    const selected = await this.options.ui.showError(
      this.options.localize(
        'Voice Input received no audio samples. Check microphone permission and make sure the selected source is an input device, or choose another microphone.',
        'Voice Input לא קיבל דגימות שמע. יש לבדוק את הרשאת המיקרופון ולוודא שהמקור שנבחר הוא התקן קלט, או לבחור מיקרופון אחר.',
      ),
      selectDevice,
    );
    if (!this.ownsPipeline(generation) || selected !== selectDevice) return;
    await this.options.ui.executeCommand('voiceInput.selectAudioDevice');
  }

  private async transcribeAndDispatch(
    audio: Uint8Array,
    mime: string,
    generation: number,
  ): Promise<void> {
    if (!this.ownsPipeline(generation)) return;
    this.options.status.busy(this.options.localize('transcribing', 'מתמלל'));
    const operation = this.options.transcriptions.open('push-to-talk');
    try {
      if (!this.ownsPipeline(generation)) return;
      const result = await operation.transcribe({ audio, mime });
      if (!this.ownsPipeline(generation) || operation.signal.aborted) return;
      if (result.status === 'missing-credential') {
        const setNow = this.options.localize('Set now', 'הגדרה עכשיו');
        const selected = await this.options.ui.showError(
          this.options.localize(
            'Voice Input: The Soniox API key is not configured.',
            'Voice Input: מפתח ה־API של Soniox אינו מוגדר.',
          ),
          setNow,
        );
        if (this.ownsPipeline(generation) && selected === setNow) {
          await this.options.ui.executeCommand('voiceInput.setApiKey');
        }
        return;
      }
      if (!result.text) return;

      const settings = this.options.settings.read().values;
      if (!this.ownsPipeline(generation)) return;
      await this.options.history.add(result.text, settings.languageHint);
      if (!this.ownsPipeline(generation)) return;
      await this.options.publishHistory();
      if (!this.ownsPipeline(generation)) return;
      await this.options.injectText(result.text, settings.injectionMode);
      if (!this.ownsPipeline(generation)) return;
      await abortableDelay(150, operation.signal);
    } finally {
      operation.dispose();
    }
  }

  private clearStopTimer(): void {
    if (this.stopTimer === undefined) return;
    this.clearTimer(this.stopTimer);
    this.stopTimer = undefined;
  }

  private ownsPendingStart(generation: number): boolean {
    return this.pendingStartGeneration === generation && this.startGeneration === generation;
  }

  private invalidatePendingStart(): void {
    this.startGeneration += 1;
    this.pendingStartGeneration = undefined;
  }

  private invalidatePipeline(): void {
    this.pipelineGeneration += 1;
  }

  private ownsPipeline(generation: number): boolean {
    return !this.disposed && this.pipelineGeneration === generation;
  }

  private cancelLateHandle(handle: RecorderHandle): void {
    try {
      handle.cancel();
    } catch {
      // The start was already cancelled; late native cleanup is best effort.
    }
  }
}

function boundedDeviceLabel(label: string): string {
  const compact = label.replace(/[\r\n\t]+/gu, ' ').trim();
  return compact.length <= 96 ? compact : `${compact.slice(0, 95)}…`;
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
