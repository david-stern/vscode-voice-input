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
      if (!this.resumeReady(resume, deviceCount)) return;
      if (!await this.credentialReady(resume)) return;
      if (!this.resumeReady(resume, deviceCount)) return;
      if (!await this.credentialReady(resume)) return;
      if (!this.resumeReady(resume, deviceCount)) return;
      try {
        await resume.start();
      } catch {
        this.options.log('assistant startup resume failed safely: unavailable');
      }
      return;
    }
    await this.options.credentials.offerInitialSonioxSetup();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.options.setDeactivating();
    this.options.state.invalidate();
    this.options.settings.dispose();
    this.options.recording.dispose();
    this.options.assistant.dispose();
    this.options.mappings.dispose();
    this.options.transcriptions.abortAll();
  }

  private resumeReady(
    resume: NonNullable<HostRuntimeLifecycleOptions['startupResume']>,
    deviceCount: number | undefined,
  ): boolean {
    try {
      const selectionKind = resume.devices.selectionStatus?.kind;
      return !this.disposed
        && resume.settings.read().values.assistantResumeOnStartup
        && resume.workspaceTrusted()
        && resume.consents.status('assistant-listening').acknowledged
        && typeof deviceCount === 'number'
        && deviceCount > 0
        && selectionKind !== undefined
        && selectionKind !== 'stale'
        && selectionKind !== 'legacy-ambiguous';
    } catch {
      return false;
    }
  }

  private async credentialReady(
    resume: NonNullable<HostRuntimeLifecycleOptions['startupResume']>,
  ): Promise<boolean> {
    try {
      return (await resume.credentials.status('soniox')).configured;
    } catch {
      this.options.log('assistant startup resume check failed safely: credential unavailable');
      return false;
    }
  }
}
