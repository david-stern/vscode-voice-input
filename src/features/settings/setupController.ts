import { ASSISTANT_SAMPLE_RATE, DEFAULT_WAKE_PHRASES, parseAssistantText } from '../../assistant';
import type { AgentRegistry } from '../../agents';
import type {
  ConsentService,
  CredentialService,
  SettingsRepository,
} from '../../config';
import type { ProviderId } from '../../inference';
import type { PcmStreamHandle, PcmStreamOptions } from '../../recorder/native';
import { pcm16FramesToWav } from '../../recorder/wav';
import type { ConnectionTestService } from '../../providers';
import {
  SETUP_STEP_IDS,
  type SettingsSetupState,
  type SetupResultCode,
  type SetupStepId,
} from '../../webview/settings/protocol';
import type { AssistantFeature } from '../assistant';
import type {
  AudioDeviceService,
  TranscriptionMetadataService,
  TranscriptionService,
} from '../recording';

const MICROPHONE_TEST_MS = 1_500;
const SPEECH_TEST_MS = 4_500;

type SetupRunResult =
  | { status: 'ready' }
  | { status: 'attention' | 'error'; result: SetupResultCode }
  | { status: 'speech'; kind: 'preview' | 'rehearsal'; text: string };

export interface SetupWorkflowControllerOptions {
  settings: Pick<SettingsRepository, 'read'>;
  credentials: Pick<CredentialService, 'status'>
    & Partial<Pick<CredentialService, 'onDidInvalidate'>>;
  consents: Pick<ConsentService, 'status'>
    & Partial<Pick<ConsentService, 'onDidRevoke'>>;
  devices: Pick<AudioDeviceService, 'get' | 'selectionStatus'>;
  metadata: Pick<TranscriptionMetadataService, 'state'>;
  transcriptions: Pick<TranscriptionService, 'open' | 'abort'>;
  connectionTests: Pick<ConnectionTestService, 'test' | 'cancel'>;
  agents: Pick<AgentRegistry, 'getDefault'>;
  assistant: Pick<AssistantFeature, 'rehearse'>;
  startPcmStream(options: PcmStreamOptions): Promise<PcmStreamHandle>;
  publish(): Promise<void> | void;
  idFactory?(): string;
}

/** Host-owned, ordered setup checks. No check starts until its explicit run message. */
export class SetupWorkflowController {
  private revision = 0;
  private generation = 0;
  private activeHandle: PcmStreamHandle | undefined;
  private activeProvider: ProviderId | undefined;
  private activeAbort: AbortController | undefined;
  private readonly completed = new Set<SetupStepId>();
  private readonly failures = new Map<SetupStepId, {
    status: 'attention' | 'error';
    result: SetupResultCode;
  }>();
  private running: SetupStepId | undefined;
  private speechRequest: SettingsSetupState['speechRequest'];
  private readonly idFactory: () => string;
  private readonly subscriptions: Array<{ dispose(): void }> = [];

  constructor(private readonly options: SetupWorkflowControllerOptions) {
    this.idFactory = options.idFactory ?? (() => `setup-speech-${Date.now()}-${this.revision + 1}`);
    const credentialSubscription = options.credentials.onDidInvalidate?.((event) => {
      this.invalidateFrom(event.provider === 'soniox' ? 'soniox' : 'provider');
    });
    if (credentialSubscription) this.subscriptions.push(credentialSubscription);
    const consentSubscription = options.consents.onDidRevoke?.((event) => {
      this.invalidateFrom(event.id === 'assistant-listening' ? 'soniox' : 'provider');
    });
    if (consentSubscription) this.subscriptions.push(consentSubscription);
  }

  get state(): SettingsSetupState {
    const speechStep = this.speechRequest
      ? this.speechRequest.kind === 'preview' ? 'speech' : 'rehearsal'
      : undefined;
    const steps = Object.fromEntries(SETUP_STEP_IDS.map((step) => {
      const failure = this.failures.get(step);
      const value = this.running === step || speechStep === step
        ? { status: 'running' as const }
        : this.completed.has(step)
          ? { status: 'ready' as const }
          : failure ?? { status: 'pending' as const };
      return [step, value];
    })) as SettingsSetupState['steps'];
    const currentStep = SETUP_STEP_IDS.find((step) => !this.completed.has(step)) ?? 'rehearsal';
    return {
      revision: this.revision,
      currentStep,
      complete: SETUP_STEP_IDS.every((step) => this.completed.has(step)),
      steps,
      ...(this.speechRequest ? { speechRequest: { ...this.speechRequest } } : {}),
    };
  }

  async run(step: SetupStepId, requestedRevision: number): Promise<'accepted' | 'stale'> {
    if (requestedRevision !== this.revision || this.running || this.speechRequest) return 'stale';
    const expected = SETUP_STEP_IDS.find((candidate) => !this.completed.has(candidate));
    if (!expected || expected !== step) return 'stale';

    const generation = ++this.generation;
    this.running = step;
    this.failures.delete(step);
    this.advance();
    try {
      const result = await this.execute(step, generation);
      if (generation !== this.generation) return 'accepted';
      if (result.status === 'speech') {
        const settings = this.options.settings.read().values;
        this.speechRequest = {
          id: this.idFactory(),
          kind: result.kind,
          text: result.text.trim().slice(0, 1_000),
          voiceUri: settings.assistantSpeechVoiceUri,
          rate: settings.assistantSpeechRate,
          lang: settings.uiLanguage,
        };
      } else if (result.status === 'ready') {
        this.completed.add(step);
      } else {
        this.failures.set(step, result);
      }
      return 'accepted';
    } catch {
      if (generation === this.generation) {
        this.failures.set(step, { status: 'error', result: 'unavailable' });
      }
      return 'accepted';
    } finally {
      if (generation === this.generation) {
        this.running = undefined;
        this.activeHandle = undefined;
        this.activeProvider = undefined;
        this.activeAbort = undefined;
        this.advance();
      }
    }
  }

  speechFinished(
    requestId: string,
    outcome: 'completed' | 'cancelled' | 'error' | 'unavailable',
    requestedRevision: number,
  ): 'accepted' | 'stale' {
    const request = this.speechRequest;
    if (requestedRevision !== this.revision || !request || request.id !== requestId) return 'stale';
    this.speechRequest = undefined;
    const step: SetupStepId = request.kind === 'preview' ? 'speech' : 'rehearsal';
    if (outcome === 'completed') this.completed.add(step);
    else this.failures.set(step, {
      status: outcome === 'cancelled' ? 'attention' : 'error',
      result: outcome === 'cancelled' ? 'cancelled' : 'unavailable',
    });
    this.advance();
    return 'accepted';
  }

  cancel(requestedRevision: number): 'accepted' | 'stale' {
    if (requestedRevision !== this.revision || (!this.running && !this.speechRequest)) return 'stale';
    const step = this.running ?? (this.speechRequest?.kind === 'preview' ? 'speech' : 'rehearsal');
    this.generation += 1;
    this.activeHandle?.cancel();
    this.activeAbort?.abort();
    void this.activeHandle?.stop().catch(() => {});
    this.options.transcriptions.abort('setup');
    if (this.activeProvider) this.options.connectionTests.cancel(this.activeProvider);
    this.activeHandle = undefined;
    this.activeAbort = undefined;
    this.activeProvider = undefined;
    this.running = undefined;
    this.speechRequest = undefined;
    this.failures.set(step, { status: 'attention', result: 'cancelled' });
    this.advance();
    return 'accepted';
  }

  invalidateFrom(step: SetupStepId): void {
    const index = SETUP_STEP_IDS.indexOf(step);
    for (const candidate of SETUP_STEP_IDS.slice(index)) {
      this.completed.delete(candidate);
      this.failures.delete(candidate);
    }
    if (this.running && SETUP_STEP_IDS.indexOf(this.running) >= index) {
      this.generation += 1;
      this.activeHandle?.cancel();
      this.activeAbort?.abort();
      void this.activeHandle?.stop().catch(() => {});
      this.options.transcriptions.abort('setup');
      if (this.activeProvider) this.options.connectionTests.cancel(this.activeProvider);
      this.running = undefined;
      this.activeHandle = undefined;
      this.activeAbort = undefined;
      this.activeProvider = undefined;
    }
    const speechStep = this.speechRequest
      ? this.speechRequest.kind === 'preview' ? 'speech' : 'rehearsal'
      : undefined;
    if (speechStep && SETUP_STEP_IDS.indexOf(speechStep) >= index) {
      this.speechRequest = undefined;
    }
    this.advance();
  }

  dispose(): void {
    this.generation += 1;
    this.activeHandle?.cancel();
    this.activeAbort?.abort();
    void this.activeHandle?.stop().catch(() => {});
    this.options.transcriptions.abort('setup');
    if (this.activeProvider) this.options.connectionTests.cancel(this.activeProvider);
    this.activeHandle = undefined;
    this.activeAbort = undefined;
    this.activeProvider = undefined;
    this.running = undefined;
    this.speechRequest = undefined;
    for (const subscription of this.subscriptions.splice(0)) subscription.dispose();
  }

  private async execute(step: SetupStepId, generation: number): Promise<SetupRunResult> {
    switch (step) {
      case 'microphone': return this.testMicrophone(generation);
      case 'soniox': return this.testSoniox(generation);
      case 'transcription': return this.verifyTranscription();
      case 'speech': return this.previewSpeech();
      case 'provider': return this.testProvider(generation);
      case 'agent': return this.verifyAgent();
      case 'rehearsal': return this.rehearse(generation);
    }
  }

  private async testMicrophone(generation: number): Promise<SetupRunResult> {
    const devices = await this.options.devices.get(true);
    const selection = this.options.devices.selectionStatus;
    if (
      devices.length === 0
      || selection?.kind === 'stale'
      || selection?.kind === 'legacy-ambiguous'
    ) return { status: 'attention', result: 'microphone-unavailable' };
    const capture = await this.capture(MICROPHONE_TEST_MS, generation, false);
    return capture.samples > 0 && capture.peak > 0
      ? { status: 'ready' }
      : { status: 'attention', result: 'no-audio' };
  }

  private async testSoniox(generation: number): Promise<SetupRunResult> {
    if (!(await this.options.credentials.status('soniox')).configured) {
      return { status: 'attention', result: 'credential-required' };
    }
    if (!this.options.consents.status('assistant-listening').acknowledged) {
      return { status: 'attention', result: 'consent-required' };
    }
    const capture = await this.capture(SPEECH_TEST_MS, generation, true);
    if (capture.samples === 0 || capture.peak === 0 || !capture.wav) {
      return { status: 'attention', result: 'no-audio' };
    }
    if (!(await this.options.credentials.status('soniox')).configured) {
      return { status: 'attention', result: 'credential-required' };
    }
    if (!this.options.consents.status('assistant-listening').acknowledged) {
      return { status: 'attention', result: 'consent-required' };
    }
    const operation = this.options.transcriptions.open('setup');
    try {
      const transcription = await operation.transcribe({ audio: capture.wav, mime: 'audio/wav' });
      return transcription.status === 'completed' && transcription.text.trim()
        ? { status: 'ready' }
        : { status: 'attention', result: 'transcription-unavailable' };
    } finally {
      operation.dispose();
    }
  }

  private verifyTranscription(): SetupRunResult {
    const settings = this.options.settings.read().values;
    const metadata = this.options.metadata.state;
    const languageReady = settings.languageHint === 'auto'
      || metadata.languages.some(({ code }) => code === settings.languageHint);
    const modelReady = metadata.models.some(({ id }) => id === settings.sttModel);
    return !metadata.loading && !metadata.error && languageReady && modelReady
      ? { status: 'ready' }
      : { status: 'attention', result: 'transcription-unavailable' };
  }

  private previewSpeech(): SetupRunResult {
    const settings = this.options.settings.read().values;
    if (!settings.assistantSpeechEnabled) return { status: 'attention', result: 'speech-disabled' };
    return {
      status: 'speech',
      kind: 'preview',
      text: settings.uiLanguage === 'he'
        ? 'זוהי תצוגה מקדימה של קול העוזר.'
        : 'This is a preview of the assistant voice.',
    };
  }

  private async testProvider(generation: number): Promise<SetupRunResult> {
    const settings = this.options.settings.read().values;
    const provider = settings.assistantProvider;
    if (provider === 'off') return { status: 'ready' };
    const profile = settings.providerProfiles[provider];
    if (!profile.enabled) return { status: 'attention', result: 'provider-disabled' };
    this.activeProvider = provider;
    const controller = new AbortController();
    this.activeAbort = controller;
    let result: Awaited<ReturnType<ConnectionTestService['test']>>;
    try {
      result = await this.options.connectionTests.test(provider, controller.signal);
    } finally {
      if (this.activeAbort === controller) this.activeAbort = undefined;
    }
    if (generation !== this.generation) return { status: 'attention', result: 'cancelled' };
    if (result.category === 'connected') return { status: 'ready' };
    if (result.category === 'not-configured') {
      return { status: 'attention', result: 'credential-required' };
    }
    if (result.category === 'consent-required') {
      return { status: 'attention', result: 'consent-required' };
    }
    return { status: 'attention', result: 'provider-unavailable' };
  }

  private verifyAgent(): SetupRunResult {
    const agent = this.options.agents.getDefault();
    if (!agent?.enabled || !agent.model.trim()) {
      return { status: 'attention', result: 'agent-unavailable' };
    }
    return { status: 'ready' };
  }

  private async rehearse(generation: number): Promise<SetupRunResult> {
    const readiness = await this.revalidateFinalReadiness();
    if (readiness) return readiness;
    const capture = await this.capture(SPEECH_TEST_MS, generation, true);
    if (capture.samples === 0 || capture.peak === 0 || !capture.wav) {
      return { status: 'attention', result: 'no-audio' };
    }
    if (!(await this.options.credentials.status('soniox')).configured) {
      return { status: 'attention', result: 'credential-required' };
    }
    if (!this.options.consents.status('assistant-listening').acknowledged) {
      return { status: 'attention', result: 'consent-required' };
    }
    const operation = this.options.transcriptions.open('setup');
    try {
      const transcription = await operation.transcribe({ audio: capture.wav, mime: 'audio/wav' });
      if (transcription.status !== 'completed' || !transcription.text.trim()) {
        return { status: 'attention', result: 'transcription-unavailable' };
      }
      const settings = this.options.settings.read().values;
      const parsed = parseAssistantText(transcription.text, {
        wakePhrases: settings.assistantWakePhrase
          ? [settings.assistantWakePhrase]
          : DEFAULT_WAKE_PHRASES,
      });
      if (!parsed.wakeDetected || !parsed.postWakeText.trim()) {
        return { status: 'attention', result: 'wake-phrase-required' };
      }
      const controller = new AbortController();
      this.activeAbort = controller;
      if (generation !== this.generation) controller.abort();
      try {
        const reply = await this.options.assistant.rehearse(parsed.postWakeText, controller.signal);
        return { status: 'speech', kind: 'rehearsal', text: reply };
      } finally {
        if (this.activeAbort === controller) this.activeAbort = undefined;
      }
    } finally {
      operation.dispose();
    }
  }

  private async revalidateFinalReadiness(): Promise<SetupRunResult | undefined> {
    if (!(await this.options.credentials.status('soniox')).configured) {
      return { status: 'attention', result: 'credential-required' };
    }
    if (!this.options.consents.status('assistant-listening').acknowledged) {
      return { status: 'attention', result: 'consent-required' };
    }
    const transcription = this.verifyTranscription();
    if (transcription.status !== 'ready') return transcription;
    const speech = this.options.settings.read().values.assistantSpeechEnabled;
    if (!speech) return { status: 'attention', result: 'speech-disabled' };
    const agent = this.verifyAgent();
    if (agent.status !== 'ready') return agent;
    const settings = this.options.settings.read().values;
    if (settings.assistantProvider !== 'off') {
      const provider = settings.assistantProvider;
      if (!settings.providerProfiles[provider].enabled) {
        return { status: 'attention', result: 'provider-disabled' };
      }
      if (!this.options.consents.status(provider).acknowledged) {
        return { status: 'attention', result: 'consent-required' };
      }
      if (provider !== 'ollama' && !(await this.options.credentials.status(provider)).configured) {
        return { status: 'attention', result: 'credential-required' };
      }
    }
    return undefined;
  }

  private async capture(
    maxDurationMs: number,
    generation: number,
    requireAssistantRate: boolean,
  ): Promise<{ samples: number; peak: number; wav?: Uint8Array }> {
    const frames: Int16Array[] = [];
    let samples = 0;
    let peak = 0;
    const handle = await this.options.startPcmStream({
      deviceId: this.options.settings.read().values.audioDevice,
      maxDurationMs,
      onFrame: (frame) => {
        if (generation !== this.generation) return;
        const copy = frame.slice();
        frames.push(copy);
        samples += copy.length;
        for (const value of copy) peak = Math.max(peak, Math.abs(value));
      },
    });
    if (generation !== this.generation) {
      handle.cancel();
      await handle.stop().catch(() => {});
      return { samples: 0, peak: 0 };
    }
    this.activeHandle = handle;
    if (requireAssistantRate && handle.sampleRate !== ASSISTANT_SAMPLE_RATE) {
      handle.cancel();
      await handle.stop().catch(() => {});
      return { samples: 0, peak: 0 };
    }
    const outcome = await handle.outcome;
    await handle.stop().catch(() => {});
    if (generation !== this.generation || outcome.reason === 'cancelled' || outcome.reason === 'error') {
      return { samples: 0, peak: 0 };
    }
    return {
      samples,
      peak,
      ...(frames.length > 0 ? { wav: pcm16FramesToWav(frames, handle.sampleRate) } : {}),
    };
  }

  private advance(): void {
    this.revision += 1;
    void this.options.publish();
  }
}
