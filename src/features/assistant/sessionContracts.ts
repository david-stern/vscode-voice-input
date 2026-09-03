import type { ConsentService, CredentialService, SettingsRepository } from '../../config';
import type { PcmStreamHandle, PcmStreamOptions } from '../../recorder/native';
import type { StreamingTranscriptEvent } from '../../speech/contracts';
import type { SpeechProviderRegistry } from '../../speech/providerRegistry';
import type { MappingFeature } from '../mappings';
import type { AudioDeviceService, PushToTalkController, TranscriptionService } from '../recording';
import type { AssistantActionController, AssistantTargetPort } from './actionController';
import type { AssistantFeedbackController } from './feedbackController';
import type { AssistantIdSequence } from './idSequence';
import type { AssistantPlanningService } from './planningService';

export interface AssistantSessionStatusPort {
  idle(): void;
  listening(): void;
  transcribing(): void;
  stoppedWithError(message: string): void;
}

/** 'ignored' means the notification closed itself, so no preference was expressed. */
export type AssistantResumeSuggestionChoice = 'enable' | 'dismiss' | 'ignored';

export interface AssistantSessionUiPort {
  confirmListeningDisclosure(): PromiseLike<boolean>;
  showMissingSonioxCredential(): PromiseLike<boolean>;
  showError(message: string): PromiseLike<unknown>;
  executeCommand(commandId: string): PromiseLike<unknown>;
  /** Non-modal, one-time discovery of startup resume after an explicit manual start. */
  suggestStartupResume?(): PromiseLike<AssistantResumeSuggestionChoice>;
}

export type AssistantSettingsPort = Pick<SettingsRepository, 'read'>
  & Partial<Pick<SettingsRepository, 'update' | 'hasExplicitGlobal'>>;

export interface AssistantSessionControllerOptions {
  settings: AssistantSettingsPort;
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
  now?: () => number;
  speechProviders?: Pick<SpeechProviderRegistry, 'openStreaming'>;
  onTranscript?(event: StreamingTranscriptEvent): void;
}

export interface AssistantSessionStartOptions { allowPrompts?: boolean }
