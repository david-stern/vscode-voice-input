import type { ConsentService, CredentialService, SettingsRepository } from '../../config';
import {
  AgentAuthorityPolicy,
  type AgentRegistry,
  type AgentSpeechPreferences,
  type MappingApprovalStore,
} from '../../agents';
import type { PcmStreamHandle, PcmStreamOptions } from '../../recorder/native';
import type { PendingAssistantSend } from '../../webview/protocol';
import type { MappingFeature } from '../mappings';
import type { AudioDeviceService, PushToTalkController, TranscriptionService } from '../recording';
import {
  AssistantActionController,
  type AssistantActionHost,
  type AssistantTargetPort,
} from './actionController';
import {
  AssistantFeedbackController,
  type FeedbackStatusPort,
  type SpeechDeliveryPort,
} from './feedbackController';
import { AssistantIdSequence } from './idSequence';
import { AssistantPlanningService } from './planningService';
import {
  AssistantSessionController,
  type AssistantSessionStartOptions,
  type AssistantSessionStatusPort,
  type AssistantSessionUiPort,
} from './sessionController';

export interface AssistantFeatureOptions {
  settings: SettingsRepository;
  credentials: CredentialService;
  consents: ConsentService;
  agents: AgentRegistry;
  mappingApprovals: MappingApprovalStore;
  isWorkspaceTrusted(): boolean;
  devices: AudioDeviceService;
  recording: PushToTalkController;
  transcriptions: TranscriptionService;
  mappings: MappingFeature;
  target: AssistantTargetPort;
  actionHost: AssistantActionHost;
  speech: SpeechDeliveryPort;
  feedbackStatus: FeedbackStatusPort;
  sessionStatus: AssistantSessionStatusPort;
  sessionUi: AssistantSessionUiPort;
  startPcmStream(options: PcmStreamOptions): Promise<PcmStreamHandle>;
  publish(): Promise<void> | void;
  isDeactivating(): boolean;
  localize(english: string, hebrew: string): string;
  log(message: string): void;
}

export interface AssistantFeatureState {
  listening: boolean;
  speaking: boolean;
  feedback: string;
  targetLabel: string;
  planConfidence: number | undefined;
  pendingSend: PendingAssistantSend | undefined;
  speechPreferences?: Readonly<AgentSpeechPreferences>;
  providerBusy: boolean;
  providerError: string | undefined;
}

/** Stable facade for explicit listening, planning, target-safe actions and feedback. */
export class AssistantFeature {
  private readonly sequence = new AssistantIdSequence();
  private readonly feedback: AssistantFeedbackController;
  private readonly planning: AssistantPlanningService;
  private readonly authority: AgentAuthorityPolicy;
  private readonly actions: AssistantActionController;
  private readonly session: AssistantSessionController;

  constructor(private readonly options: AssistantFeatureOptions) {
    this.planning = new AssistantPlanningService({
      credentials: options.credentials,
      consents: options.consents,
      settings: options.settings,
      agents: options.agents,
      localize: options.localize,
      publish: options.publish,
      log: options.log,
    });
    this.feedback = new AssistantFeedbackController({
      settings: options.settings,
      sequence: this.sequence,
      speech: options.speech,
      status: options.feedbackStatus,
      agentSpeech: () => this.planning.agentForAuthority()?.speech,
      publish: options.publish,
      log: options.log,
    });
    this.authority = new AgentAuthorityPolicy({
      approvals: options.mappingApprovals,
      agents: options.agents,
    });
    this.actions = new AssistantActionController({
      host: options.actionHost,
      target: options.target,
      feedback: this.feedback,
      sequence: this.sequence,
      localize: options.localize,
      publish: options.publish,
      stopAssistant: () => this.session.stop(),
      authority: this.authority,
      activeAgent: () => this.planning.agentForAuthority(),
      isWorkspaceTrusted: options.isWorkspaceTrusted,
      resolveMapping: (mappingId) => options.mappings.resolveMapping(mappingId),
    });
    this.session = new AssistantSessionController({
      settings: options.settings,
      credentials: options.credentials,
      consents: options.consents,
      devices: options.devices,
      recording: options.recording,
      transcriptions: options.transcriptions,
      mappings: options.mappings,
      planning: this.planning,
      actions: this.actions,
      feedback: this.feedback,
      sequence: this.sequence,
      target: options.target,
      status: options.sessionStatus,
      ui: options.sessionUi,
      startPcmStream: options.startPcmStream,
      publish: options.publish,
      isDeactivating: options.isDeactivating,
    });
  }

  get state(): AssistantFeatureState {
    return {
      listening: this.session.isListening,
      speaking: this.feedback.isSpeaking,
      feedback: this.feedback.message,
      targetLabel: this.actions.targetLabel,
      planConfidence: this.actions.planConfidence,
      pendingSend: this.actions.pending,
      speechPreferences: this.planning.agentForAuthority()?.speech,
      providerBusy: this.planning.isBusy,
      providerError: this.planning.error,
    };
  }

  get isActive(): boolean {
    return this.session.isListening || this.session.hasCapture;
  }

  start(options?: AssistantSessionStartOptions): Promise<void> {
    return this.session.start(options);
  }

  stop(errorMessage?: string): Promise<void> {
    return this.session.stop(errorMessage);
  }

  toggle(): Promise<void> {
    return this.session.toggle();
  }

  clearPendingSend(announce = false): void {
    this.actions.clearPending(announce);
  }

  confirmPendingSend(id: string): Promise<void> {
    return this.actions.confirmIfPending(id);
  }

  speak(message: string): void {
    this.feedback.speak(message);
  }

  cancelSpeaking(): void {
    this.feedback.cancelSpeaking();
  }

  speechStarted(id: string): void {
    this.feedback.speechStarted(id);
  }

  speechFinished(id: string, outcome: string): void {
    this.feedback.speechFinished(id, outcome);
  }

  clearProviderError(): void {
    this.planning.clearError();
  }

  invalidateActions(): void {
    this.actions.clearPending(false);
  }

  invalidatePlanning(): void {
    this.invalidateActions();
    this.planning.invalidate();
  }

  beginIntelligenceChange(): number {
    this.invalidateActions();
    return this.planning.beginIntelligenceChange();
  }

  finishIntelligenceChange(token: number): void {
    this.planning.finishIntelligenceChange(token);
  }

  nextId(prefix: string): string {
    return this.sequence.next(prefix);
  }

  /** Plans a bounded answer-only setup rehearsal without dispatching any host action. */
  async rehearse(postWakeRequest: string, signal: AbortSignal): Promise<string> {
    const fallback = this.options.localize(
      'The local rehearsal reached transcription and speech safely.',
      'החזרה המקומית הגיעה בבטחה לתמלול ולדיבור.',
    );
    const plan = await this.planning.create(
      postWakeRequest.trim().slice(0, 1_000),
      this.options.target.capture(),
      signal,
      {
        action: 'answer-only',
        target: 'none',
        content: null,
        spokenReply: fallback,
        reason: this.options.localize(
          'This is an explicit setup rehearsal and cannot mutate the host.',
          'זוהי חזרת הקמה מפורשת שאינה יכולה לשנות את המארח.',
        ),
        confidence: 1,
        requiresConfirmation: false,
      },
    );
    if (signal.aborted || plan.action !== 'answer-only' || plan.target !== 'none') {
      throw new Error('setup-rehearsal-rejected');
    }
    return (plan.spokenReply.trim() || fallback).slice(0, 1_000);
  }

  dispose(): void {
    this.session.dispose();
    this.planning.dispose();
    this.authority.dispose();
    this.actions.dispose();
    this.feedback.dispose();
  }
}
