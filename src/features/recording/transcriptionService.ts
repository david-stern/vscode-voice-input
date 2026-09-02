import type { CredentialService, SettingsRepository } from '../../config';
import {
  SONIOX_SPEECH_CAPABILITIES,
  type SpeechProviderCapabilities,
} from '../../speech/contracts';
import type { SpeechProviderRegistry } from '../../speech/providerRegistry';
import { transcribe as transcribeWithSoniox } from '../../stt/soniox';

export type TranscriptionLane = 'assistant' | 'push-to-talk' | 'setup';

export interface TranscriptionInput {
  audio: Uint8Array;
  mime: string;
}

export type TranscriptionResult =
  | { status: 'missing-credential' }
  | { status: 'completed'; text: string }
  | {
    status:
      | 'not-configured'
      | 'legacy-pending'
      | 'consent-required'
      | 'authority-changed';
    text: '';
  };

export interface TranscriptionOperation {
  readonly signal: AbortSignal;
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
  dispose(): void;
}

export interface ProviderNeutralTranscriptionServiceOptions {
  registry: Pick<SpeechProviderRegistry, 'capabilities' | 'transcribeFinal'>;
}

/** Temporary constructor compatibility until coordinator integration supplies the registry. */
export interface LegacySonioxTranscriptionServiceOptions {
  credentials: Pick<CredentialService, 'use'>;
  settings: Pick<SettingsRepository, 'read'>;
  transcribe?: typeof transcribeWithSoniox;
}

export type TranscriptionServiceOptions =
  | ProviderNeutralTranscriptionServiceOptions
  | LegacySonioxTranscriptionServiceOptions;

/** Tracks provider-neutral abortable work by lifecycle lane. */
export class TranscriptionService {
  private readonly transcribeAudio: typeof transcribeWithSoniox | undefined;
  private readonly operations: Record<TranscriptionLane, Set<AbortController>> = {
    assistant: new Set(),
    'push-to-talk': new Set(),
    setup: new Set(),
  };

  constructor(private readonly options: TranscriptionServiceOptions) {
    this.transcribeAudio = 'registry' in options
      ? undefined
      : options.transcribe ?? transcribeWithSoniox;
  }

  get capabilities(): SpeechProviderCapabilities {
    return 'registry' in this.options
      ? this.options.registry.capabilities
      : SONIOX_SPEECH_CAPABILITIES;
  }

  open(lane: TranscriptionLane): TranscriptionOperation {
    const controller = new AbortController();
    const laneOperations = this.operations[lane];
    laneOperations.add(controller);
    let disposed = false;
    return {
      signal: controller.signal,
      transcribe: async (input) => {
        if ('registry' in this.options) {
          const result = await this.options.registry.transcribeFinal(input, controller.signal);
          if (result.status === 'ready') {
            return { status: 'completed', text: result.value };
          }
          if (result.status === 'missing-credential') return { status: 'missing-credential' };
          return { status: result.status, text: '' };
        }
        const settings = this.options.settings.read().values;
        const text = await this.options.credentials.use('soniox', (apiKey) =>
          this.transcribeAudio!({
            audio: input.audio,
            mime: input.mime,
            apiKey,
            model: settings.sttModel,
            languageHint: settings.languageHint,
            signal: controller.signal,
          }),
        );
        return text === undefined
          ? { status: 'missing-credential' }
          : { status: 'completed', text };
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        laneOperations.delete(controller);
      },
    };
  }

  abort(lane: TranscriptionLane): void {
    for (const controller of this.operations[lane]) controller.abort();
    this.operations[lane].clear();
  }

  abortAll(): void {
    this.abort('assistant');
    this.abort('push-to-talk');
    this.abort('setup');
  }
}
