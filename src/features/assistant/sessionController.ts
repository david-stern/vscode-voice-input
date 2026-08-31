import type {
  ConsentInvalidation, ConsentService, CredentialInvalidation, CredentialService, SettingsRepository,
} from '../../config';
import {
  ASSISTANT_SAMPLE_RATE, DEFAULT_WAKE_PHRASES, VadSegmenter, parseAssistantText,
  type SegmentedUtterance,
} from '../../assistant';
import type { TargetSnapshot } from '../../assistant/context';
import { PlannerError } from '../../inference';
import { pcm16FramesToWav } from '../../recorder/wav';
import type { PcmStreamHandle, PcmStreamOptions } from '../../recorder/native';
import type { MappingFeature } from '../mappings';
import type { AudioDeviceService, PushToTalkController, TranscriptionService } from '../recording';
import type { AssistantActionController, AssistantTargetPort } from './actionController';
import type { AssistantFeedbackController } from './feedbackController';
import type { AssistantIdSequence } from './idSequence';
import type { AssistantPlanningService } from './planningService';

const CAPTURE_LIMIT_MS = 5 * 60 * 1_000;
const CAPTURE_RENEW_MS = 4 * 60 * 1_000 + 15 * 1_000;

class UnsupportedAssistantSampleRateError extends Error {}

interface CapturedAssistantUtterance {
  utterance: SegmentedUtterance;
  snapshot: TargetSnapshot;
  id: string;
}

export interface AssistantSessionStatusPort {
  idle(): void;
  listening(): void;
  transcribing(): void;
  stoppedWithError(message: string): void;
}

export interface AssistantSessionUiPort {
  confirmListeningDisclosure(): PromiseLike<boolean>;
  showMissingSonioxCredential(): PromiseLike<boolean>;
  showError(message: string): PromiseLike<unknown>;
  executeCommand(commandId: string): PromiseLike<unknown>;
}

export interface AssistantSessionControllerOptions {
  settings: Pick<SettingsRepository, 'read'>;
  credentials: Pick<CredentialService, 'status'>
    & Partial<Pick<CredentialService, 'onDidInvalidate'>>;
  consents: Pick<ConsentService, 'status' | 'revision' | 'acknowledgeIfCurrent'>
    & Partial<Pick<ConsentService, 'onDidRevoke'>>;
  devices: Pick<AudioDeviceService, 'get'>;
  recording: Pick<PushToTalkController, 'cancel'>;
  transcriptions: TranscriptionService;
  mappings: Pick<MappingFeature, 'routeVoiceRequest' | 'cancel'>;
  planning: AssistantPlanningService;
  actions: AssistantActionController;
  feedback: AssistantFeedbackController;
  sequence: AssistantIdSequence;
  target: AssistantTargetPort;
  status: AssistantSessionStatusPort;
  ui: AssistantSessionUiPort;
  startPcmStream(options: PcmStreamOptions): Promise<PcmStreamHandle>;
  publish(): Promise<void> | void;
  isDeactivating(): boolean;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

export interface AssistantSessionStartOptions {
  allowPrompts?: boolean;
}

/** Owns explicit assistant listening, bounded capture renewal and one-slot utterance backpressure. */
export class AssistantSessionController {
  private readonly setTimer: NonNullable<AssistantSessionControllerOptions['setTimer']>;
  private readonly clearTimer: NonNullable<AssistantSessionControllerOptions['clearTimer']>;
  private handle: PcmStreamHandle | null = null;
  private listeningActive = false;
  private generation = 0;
  private vad: VadSegmenter | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | undefined;
  private transcriptionActive = false;
  private queuedUtterance: CapturedAssistantUtterance | null = null;
  private readonly credentialSubscription: { dispose(): void } | undefined;
  private readonly consentSubscription: { dispose(): void } | undefined;

  constructor(private readonly options: AssistantSessionControllerOptions) {
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
    this.credentialSubscription = options.credentials.onDidInvalidate?.(
      (event) => this.credentialInvalidated(event),
    );
    this.consentSubscription = options.consents.onDidRevoke?.(
      (event) => this.consentRevoked(event),
    );
  }

  get isListening(): boolean {
    return this.listeningActive;
  }

  get hasCapture(): boolean {
    return this.handle !== null;
  }

  async toggle(): Promise<void> {
    if (this.listeningActive || this.handle) await this.stop();
    else await this.start();
  }

  async start(startOptions: AssistantSessionStartOptions = {}): Promise<void> {
    if (this.listeningActive || this.options.isDeactivating()) return;
    const generation = ++this.generation;
    const allowPrompts = startOptions.allowPrompts !== false;

    if (!this.options.consents.status('assistant-listening').acknowledged) {
      if (!allowPrompts) return;
      const consentRevision = this.options.consents.revision('assistant-listening');
      const accepted = await this.options.ui.confirmListeningDisclosure();
      if (!accepted || generation !== this.generation) {
        void this.options.publish();
        return;
      }
      const acknowledged = await this.options.consents.acknowledgeIfCurrent(
        'assistant-listening',
        consentRevision,
      );
      if (
        generation !== this.generation
        || (!acknowledged
          && !this.options.consents.status('assistant-listening').acknowledged)
      ) {
        void this.options.publish();
        return;
      }
    }

    const sonioxConfigured = (await this.options.credentials.status('soniox')).configured;
    if (generation !== this.generation) return;
    if (!sonioxConfigured) {
      if (allowPrompts && await this.options.ui.showMissingSonioxCredential()) {
        await this.options.ui.executeCommand('voiceInput.setApiKey');
      }
      await this.options.publish();
      return;
    }

    try {
      await this.options.devices.get();
    } catch {
      // Native capture below remains the authoritative recorder error.
    }
    await this.options.recording.cancel();
    if (generation !== this.generation) return;

    const vad = new VadSegmenter();
    const configuredDevice = this.options.settings.read().values.audioDevice;
    try {
      const stream = await this.options.startPcmStream({
        deviceId: configuredDevice,
        maxDurationMs: CAPTURE_LIMIT_MS,
        onFrame: (frame) => this.handleFrame(frame, generation, vad),
      });
      if (generation !== this.generation || this.options.isDeactivating()) {
        stream.cancel();
        await stream.stop().catch(() => {});
        return;
      }
      if (stream.sampleRate !== ASSISTANT_SAMPLE_RATE) {
        stream.cancel();
        await stream.stop().catch(() => {});
        throw new UnsupportedAssistantSampleRateError();
      }
      this.vad = vad;
      this.handle = stream;
      this.monitorCapture(stream, generation);
      this.queuedUtterance = null;
      this.transcriptionActive = false;
      this.setListening();
      this.scheduleRenewal(generation, vad, CAPTURE_RENEW_MS);
    } catch (error) {
      if (generation === this.generation) {
        this.listeningActive = false;
        this.options.status.stoppedWithError(
          error instanceof UnsupportedAssistantSampleRateError
            ? this.localize(
              `Voice Input assistant requires ${ASSISTANT_SAMPLE_RATE} Hz audio.`,
              `Voice Input: העוזר דורש שמע בקצב ${ASSISTANT_SAMPLE_RATE} הרץ.`,
            )
            : this.localize(
              'Voice Input assistant could not start safely.',
              'Voice Input: לא ניתן היה להפעיל את העוזר באופן בטוח.',
            ),
        );
        void this.options.publish();
      }
    }
  }

  async stop(errorMessage?: string): Promise<void> {
    this.generation += 1;
    this.listeningActive = false;
    this.vad?.reset();
    this.vad = null;
    this.queuedUtterance = null;
    this.transcriptionActive = false;
    this.options.actions.clearPending(false);
    this.options.mappings.cancel(false);
    this.options.planning.invalidate();
    this.options.feedback.cancelSpeaking();
    this.clearRestartTimer();
    this.options.transcriptions.abort('assistant');

    const activeHandle = this.handle;
    this.handle = null;
    if (activeHandle) {
      activeHandle.cancel();
      try {
        await activeHandle.stop();
      } catch {
        // Preserve the explicit stop/error state rather than surfacing a second failure.
      }
    }

    if (errorMessage) {
      this.options.status.stoppedWithError(errorMessage);
      void this.options.publish();
      if (!this.options.isDeactivating()) void this.options.ui.showError(errorMessage);
    } else {
      this.options.status.idle();
      void this.options.publish();
    }
  }

  dispose(): void {
    this.generation += 1;
    this.listeningActive = false;
    this.clearRestartTimer();
    this.handle?.cancel();
    this.handle = null;
    this.vad?.reset();
    this.vad = null;
    this.queuedUtterance = null;
    this.transcriptionActive = false;
    this.options.transcriptions.abort('assistant');
    this.credentialSubscription?.dispose();
    this.consentSubscription?.dispose();
  }

  private credentialInvalidated(event: CredentialInvalidation): void {
    if (event.provider !== 'soniox') return;
    this.generation += 1;
    if (!this.listeningActive && !this.handle) return;
    void this.stop(this.localize(
      'Voice Input assistant stopped because the Soniox API key is no longer available.',
      'Voice Input: העוזר הופסק מפני שמפתח ה-API של Soniox אינו זמין עוד.',
    ));
  }

  private consentRevoked(event: ConsentInvalidation): void {
    if (event.id !== 'assistant-listening') return;
    if (!this.listeningActive && !this.handle) {
      void this.stop();
      return;
    }
    void this.stop(this.localize(
      'Voice Input assistant stopped because listening consent was revoked.',
      'Voice Input: העוזר הופסק מפני שהסכמת ההאזנה בוטלה.',
    ));
  }

  private fail(message: string): void {
    if (this.listeningActive) void this.stop(message);
  }

  private monitorCapture(stream: PcmStreamHandle, generation: number): void {
    void stream.outcome.then((outcome) => {
      if (
        !this.listeningActive
        || generation !== this.generation
        || this.handle !== stream
      ) return;
      if (outcome.reason === 'error') {
        this.fail(this.localize(
          'Voice Input assistant stopped because microphone capture failed safely.',
          'Voice Input: ההאזנה של העוזר הופסקה בבטחה בגלל שגיאת מיקרופון.',
        ));
      } else if (outcome.reason === 'limit') {
        this.fail(this.localize(
          'Voice Input assistant stopped because microphone capture failed',
          'Voice Input: ההאזנה של העוזר הופסקה בגלל שגיאת מיקרופון',
        ));
      }
    });
  }

  private enqueue(item: CapturedAssistantUtterance, generation: number): void {
    if (!this.listeningActive || generation !== this.generation) return;
    if (!this.transcriptionActive) {
      this.transcriptionActive = true;
      void this.processUtterance(item, generation);
      return;
    }
    if (!this.queuedUtterance) {
      this.queuedUtterance = item;
      return;
    }
    this.fail(this.localize(
      'Voice Input assistant stopped: transcription queue overflow.',
      'Voice Input: העוזר הופסק מפני שתור התמלול התמלא.',
    ));
  }

  private handleFrame(frame: Int16Array, generation: number, vad: VadSegmenter): void {
    if (!this.listeningActive || generation !== this.generation) return;
    try {
      const result = vad.pushFrame(frame);
      if (!result.accepted) {
        this.fail(this.localize(
          'Voice Input assistant stopped: audio processing could not keep up.',
          'Voice Input: העוזר הופסק מפני שעיבוד השמע לא עמד בקצב.',
        ));
        return;
      }
      if (result.signals.some((signal) => signal.type === 'utterance-queued')) {
        const utterance = vad.takeUtterance();
        if (utterance) {
          this.enqueue({
            utterance,
            snapshot: this.options.target.capture(),
            id: this.options.sequence.next('utterance'),
          }, generation);
        }
      }
    } catch {
      this.fail(this.localize(
        'Voice Input assistant stopped because local audio processing failed safely.',
        'Voice Input: העוזר הופסק בבטחה בגלל שגיאה בעיבוד השמע המקומי.',
      ));
    }
  }

  private async processUtterance(
    item: CapturedAssistantUtterance,
    generation: number,
  ): Promise<void> {
    const operation = this.options.transcriptions.open('assistant');
    let phase: 'transcription' | 'planning' | 'action' = 'transcription';
    try {
      if (!this.listeningActive || generation !== this.generation) return;
      this.options.status.transcribing();
      const transcription = await operation.transcribe({
        audio: pcm16FramesToWav([item.utterance.audio], ASSISTANT_SAMPLE_RATE),
        mime: 'audio/wav',
      });
      if (transcription.status === 'missing-credential') {
        this.fail(this.localize(
          'Voice Input assistant stopped because the Soniox API key is no longer available.',
          'Voice Input: העוזר הופסק מפני שמפתח ה־API של Soniox אינו זמין עוד.',
        ));
        return;
      }
      if (!this.listeningActive || generation !== this.generation || !transcription.text) return;

      const settings = this.options.settings.read().values;
      const wakePhrases = settings.assistantWakePhrase
        ? [settings.assistantWakePhrase]
        : DEFAULT_WAKE_PHRASES;
      const parsed = parseAssistantText(transcription.text, { wakePhrases });
      if (!parsed.wakeDetected) return;
      phase = 'planning';

      const mappingRoute = await this.options.mappings.routeVoiceRequest(
        parsed.postWakeText,
        item.snapshot,
        item.id,
      );
      if (mappingRoute.handled) {
        phase = 'action';
        return;
      }

      const fallbackPlan = this.options.planning.deterministic(
        parsed.postWakeText,
        parsed.intent,
      );
      const plan = parsed.intent.kind === 'action' && parsed.intent.action === 'confirm-send'
        ? fallbackPlan
        : await this.options.planning.create(
          parsed.postWakeText,
          item.snapshot,
          operation.signal,
          fallbackPlan,
        );
      if (
        !this.listeningActive
        || generation !== this.generation
        || operation.signal.aborted
      ) return;
      phase = 'action';
      await this.options.actions.execute(plan, item.snapshot, item.id);
    } catch (error) {
      if (!operation.signal.aborted && this.listeningActive && generation === this.generation) {
        if (error instanceof PlannerError) {
          this.options.feedback.speak(
            this.localize(
              'The selected provider could not safely plan this request, so I made no change.',
              'הספק שנבחר לא הצליח לתכנן את הבקשה בבטחה, ולכן לא ביצעתי שינוי.',
            ),
          );
        } else if (phase === 'action') {
          this.options.feedback.speak(this.localize(
            'The action failed safely, so I made no further change.',
            'הפעולה נכשלה באופן בטוח, ולכן לא ביצעתי שינוי נוסף.',
          ));
        } else {
          this.fail(this.localize(
            phase === 'planning'
              ? 'Voice Input assistant stopped because planning failed safely.'
              : 'Voice Input assistant stopped because transcription failed safely.',
            phase === 'planning'
              ? 'Voice Input: העוזר הופסק בבטחה בגלל שגיאת תכנון.'
              : 'Voice Input: העוזר הופסק בבטחה בגלל שגיאת תמלול.',
          ));
        }
      }
    } finally {
      operation.dispose();
      if (!this.listeningActive || generation !== this.generation) return;
      const next = this.queuedUtterance;
      this.queuedUtterance = null;
      if (next) {
        void this.processUtterance(next, generation);
      } else {
        this.transcriptionActive = false;
        this.setListening();
      }
    }
  }

  private async renewCapture(generation: number, vad: VadSegmenter): Promise<void> {
    if (!this.listeningActive || generation !== this.generation || this.options.isDeactivating()) return;
    if (vad.isSpeaking) {
      this.scheduleRenewal(generation, vad, 250);
      return;
    }
    const previous = this.handle;
    this.handle = null;
    if (previous) {
      previous.cancel();
      await previous.stop().catch(() => {});
    }
    if (!this.listeningActive || generation !== this.generation || this.options.isDeactivating()) return;

    try {
      const next = await this.options.startPcmStream({
        deviceId: this.options.settings.read().values.audioDevice,
        maxDurationMs: CAPTURE_LIMIT_MS,
        onFrame: (frame) => this.handleFrame(frame, generation, vad),
      });
      if (!this.listeningActive || generation !== this.generation || this.options.isDeactivating()) {
        next.cancel();
        await next.stop().catch(() => {});
        return;
      }
      this.handle = next;
      this.monitorCapture(next, generation);
      this.scheduleRenewal(generation, vad, CAPTURE_RENEW_MS);
    } catch {
      this.fail(this.localize(
        'Voice Input assistant stopped because microphone capture could not restart safely.',
        'Voice Input: העוזר הופסק מפני שלא ניתן היה לחדש את קליטת המיקרופון בבטחה.',
      ));
    }
  }

  private scheduleRenewal(generation: number, vad: VadSegmenter, delayMs: number): void {
    this.clearRestartTimer();
    this.restartTimer = this.setTimer(() => {
      this.restartTimer = undefined;
      void this.renewCapture(generation, vad);
    }, delayMs);
  }

  private clearRestartTimer(): void {
    if (this.restartTimer === undefined) return;
    this.clearTimer(this.restartTimer);
    this.restartTimer = undefined;
  }

  private setListening(): void {
    this.listeningActive = true;
    this.options.status.listening();
    void this.options.publish();
  }

  private localize(english: string, hebrew: string): string {
    return this.options.settings.read().values.uiLanguage === 'he' ? hebrew : english;
  }
}
