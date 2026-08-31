import type { CredentialService, SettingsRepository } from '../../config';
import { transcribe as transcribeWithSoniox } from '../../stt/soniox';

export type TranscriptionLane = 'assistant' | 'push-to-talk' | 'setup';

export interface TranscriptionInput {
  audio: Uint8Array;
  mime: string;
}

export type TranscriptionResult =
  | { status: 'missing-credential' }
  | { status: 'completed'; text: string };

export interface TranscriptionOperation {
  readonly signal: AbortSignal;
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
  dispose(): void;
}

export interface TranscriptionServiceOptions {
  credentials: Pick<CredentialService, 'use'>;
  settings: Pick<SettingsRepository, 'read'>;
  transcribe?: typeof transcribeWithSoniox;
}

/** Tracks abortable Soniox work by lifecycle lane and keeps the key inside CredentialService. */
export class TranscriptionService {
  private readonly transcribeAudio: typeof transcribeWithSoniox;
  private readonly operations: Record<TranscriptionLane, Set<AbortController>> = {
    assistant: new Set(),
    'push-to-talk': new Set(),
    setup: new Set(),
  };

  constructor(private readonly options: TranscriptionServiceOptions) {
    this.transcribeAudio = options.transcribe ?? transcribeWithSoniox;
  }

  open(lane: TranscriptionLane): TranscriptionOperation {
    const controller = new AbortController();
    const laneOperations = this.operations[lane];
    laneOperations.add(controller);
    let disposed = false;
    return {
      signal: controller.signal,
      transcribe: async (input) => {
        const settings = this.options.settings.read().values;
        const text = await this.options.credentials.use('soniox', (apiKey) =>
          this.transcribeAudio({
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
