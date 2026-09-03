import type { ConsentService, CredentialService, SettingsRepository } from '../../config';
import type { AssistantFeature } from '../assistant';
import type { MappingFeature } from '../mappings';
import type {
  AudioDeviceService,
  PushToTalkController,
  TranscriptionMetadataService,
  TranscriptionService,
} from '../recording';
import type { HostStatePublisher } from '../state';
import type { CredentialCommandController } from './credentialController';

export interface HostRuntimeLifecycleOptions {
  metadata: Pick<TranscriptionMetadataService, 'refresh'>;
  devices: Pick<AudioDeviceService, 'get'>;
  credentials: Pick<CredentialCommandController, 'offerInitialSonioxSetup'>;
  credentialStore: Pick<CredentialService, 'dispose'>;
  state: Pick<HostStatePublisher, 'invalidate'>;
  settings: { refresh(): Promise<void>; dispose(): void };
  recording: Pick<PushToTalkController, 'dispose'>;
  assistant: Pick<AssistantFeature, 'dispose'>;
  mappings: Pick<MappingFeature, 'dispose'>;
  transcriptions: Pick<TranscriptionService, 'abortAll'>;
  setDeactivating(): void;
  log(message: string): void;
  startupResume?: {
    settings: Pick<SettingsRepository, 'read'>;
    consents: Pick<ConsentService, 'status'>;
    credentials: Pick<CredentialService, 'status'>;
    devices: Pick<AudioDeviceService, 'selectionStatus'>;
    workspaceTrusted(): boolean;
    start(): PromiseLike<void>;
  };
}

/** Owns best-effort host startup and ordered shutdown around the composed services. */
export class HostRuntimeLifecycle {
  private started = false;
  private disposed = false;

  constructor(private readonly options: HostRuntimeLifecycleOptions) {}

  async start(): Promise<void> {
    if (this.started || this.disposed) return;
    this.started = true;
    void this.options.metadata.refresh();
    const deviceScan = this.options.devices.get().then((devices) => devices.length, () => {
      this.options.log('native audio enumeration failed: unavailable');
      return undefined;
    });
    void this.options.settings.refresh();
    const resume = this.options.startupResume;
    let resumeRequested = false;
    try {
      resumeRequested = resume?.settings.read().values.assistantResumeOnStartup ?? false;
    } catch {
      this.options.log('assistant startup resume check failed safely: settings unavailable');
      return;
    }
    if (resume && resumeRequested) {
      const deviceCount = await deviceScan;
      // Each gate is rechecked after every await, and the first missing one is named once
      // so a silent startup resume is diagnosable without leaking any credential state.
      for (const gate of [
        () => this.resumeGate(resume, deviceCount),
        async () => await this.credentialGate(resume),
        () => this.resumeGate(resume, deviceCount),
        async () => await this.credentialGate(resume),
        () => this.resumeGate(resume, deviceCount),
      ]) {
        const missing = await gate();
        if (missing) {
          this.options.log(`assistant startup resume skipped: ${missing}`);
          return;
        }
      }
      try {
        await resume.start();
      } catch {
        this.options.log('assistant startup resume failed safely: unavailable');
      }
      return;
    }
    // Fresh Wave 1 installs select no STT provider. Startup must not turn that
    // into a credential prompt or any Soniox work.
    if (!resume || resume.settings.read().values.transcriptionProvider !== 'none') {
      await this.options.credentials.offerInitialSonioxSetup();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.options.setDeactivating();
    this.options.state.invalidate();
    this.options.transcriptions.abortAll();
    this.options.credentialStore.dispose();
    this.options.settings.dispose();
    this.options.recording.dispose();
    this.options.assistant.dispose();
    this.options.mappings.dispose();
  }

  /** Returns the name of the first unmet resume precondition, or undefined when ready. */
  private resumeGate(
    resume: NonNullable<HostRuntimeLifecycleOptions['startupResume']>,
    deviceCount: number | undefined,
  ): string | undefined {
    try {
      if (this.disposed) return 'resumeReady/host-disposed';
      if (!resume.settings.read().values.assistantResumeOnStartup) {
        return 'resumeReady/setting-disabled';
      }
      if (!resume.workspaceTrusted()) return 'resumeReady/workspace-untrusted';
      if (!resume.consents.status('assistant-listening').acknowledged) {
        return 'resumeReady/listening-consent';
      }
      if (typeof deviceCount !== 'number' || deviceCount <= 0) {
        return 'resumeReady/no-microphone';
      }
      const selectionKind = resume.devices.selectionStatus?.kind;
      if (selectionKind === undefined) return 'resumeReady/device-selection-unknown';
      if (selectionKind === 'stale' || selectionKind === 'legacy-ambiguous') {
        return `resumeReady/device-selection-${selectionKind}`;
      }
      return undefined;
    } catch {
      return 'resumeReady/unavailable';
    }
  }

  private async credentialGate(
    resume: NonNullable<HostRuntimeLifecycleOptions['startupResume']>,
  ): Promise<string | undefined> {
    try {
      return (await resume.credentials.status('soniox')).configured
        ? undefined
        : 'credentialReady/soniox-not-configured';
    } catch {
      return 'credentialReady/unavailable';
    }
  }
}
