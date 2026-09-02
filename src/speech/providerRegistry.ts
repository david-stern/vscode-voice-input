import type { CredentialInvalidation, CredentialService } from '../config';
import { resolveSonioxModel } from '../sonioxMeta';
import { transcribe as transcribeWithSoniox } from '../stt/soniox';
import {
  NO_SPEECH_CAPABILITIES,
  SONIOX_SPEECH_CAPABILITIES,
  SpeechProviderError,
  type SpeechProviderCapabilities,
  type SpeechTranscriptionInput,
  type StreamingTranscriptionOptions,
  type StreamingTranscriptionSession,
  type TranscriptionProviderSelection,
} from './contracts';
import { SonioxRealtimeClient } from './soniox/realtimeClient';
import type { SonioxWebSocketTransportFactory } from './soniox/transport';

export interface SpeechProviderSelectionPort {
  read(): TranscriptionProviderSelection;
  onDidChange?(listener: () => void): RegistrySubscription;
}

/** Opaque host-only generation. Its receipt/profile/policy fields never cross this seam. */
export type SonioxConnectionAuthority = Readonly<object>;

export interface SonioxConnectionAuthorityPort {
  capture(): PromiseLike<SonioxConnectionAuthority | undefined> | SonioxConnectionAuthority | undefined;
  revalidate(
    authority: SonioxConnectionAuthority,
  ): PromiseLike<boolean> | boolean;
  onDidInvalidate?(listener: () => void): RegistrySubscription;
}

export interface RegistrySubscription {
  dispose(): void;
}

export interface SonioxSpeechConfiguration {
  readonly model?: string;
  readonly languageHint?: string;
}

export interface SpeechProviderRegistryOptions {
  selection: SpeechProviderSelectionPort;
  authority: SonioxConnectionAuthorityPort;
  credentials: Pick<CredentialService, 'use'>
    & Partial<Pick<CredentialService, 'onDidInvalidate'>>;
  configuration(): SonioxSpeechConfiguration;
  transportFactory?: SonioxWebSocketTransportFactory;
  transcribeFinal?: typeof transcribeWithSoniox;
}

export type SpeechProviderUnavailableStatus =
  | 'not-configured'
  | 'legacy-pending'
  | 'consent-required'
  | 'missing-credential'
  | 'authority-changed';

export type SpeechProviderRegistryResult<T> =
  | Readonly<{
    status: 'ready';
    capabilities: SpeechProviderCapabilities;
    value: T;
  }>
  | Readonly<{
    status: SpeechProviderUnavailableStatus;
    capabilities: SpeechProviderCapabilities;
  }>;

/**
 * The only Wave 1 provider gate. Selection and host consent are checked before
 * SecretStorage, then all authority is revalidated immediately before transport.
 */
export class SpeechProviderRegistry {
  static readonly providerIds = Object.freeze(['none', 'soniox'] as const);

  private readonly transcribeAudio: typeof transcribeWithSoniox;
  private readonly activeSessions = new Set<StreamingTranscriptionSession>();
  private readonly activeFinalRequests = new Set<AbortController>();
  private readonly subscriptions: RegistrySubscription[] = [];
  private invalidationGeneration = 0;

  constructor(private readonly options: SpeechProviderRegistryOptions) {
    this.transcribeAudio = options.transcribeFinal ?? transcribeWithSoniox;
    const selectionSubscription = options.selection.onDidChange?.(() => this.invalidate());
    if (selectionSubscription) this.subscriptions.push(selectionSubscription);
    const authoritySubscription = options.authority.onDidInvalidate?.(() => this.invalidate());
    if (authoritySubscription) this.subscriptions.push(authoritySubscription);
    const credentialSubscription = options.credentials.onDidInvalidate?.(
      (event: CredentialInvalidation) => {
        if (event.provider === 'soniox') this.invalidate();
      },
    );
    if (credentialSubscription) this.subscriptions.push(credentialSubscription);
  }

  get selectedProvider(): 'none' | 'soniox' {
    return this.options.selection.read() === 'soniox' ? 'soniox' : 'none';
  }

  get capabilities(): SpeechProviderCapabilities {
    return this.selectedProvider === 'soniox'
      ? SONIOX_SPEECH_CAPABILITIES
      : NO_SPEECH_CAPABILITIES;
  }

  async transcribeFinal(
    input: SpeechTranscriptionInput,
    callerSignal?: AbortSignal,
  ): Promise<SpeechProviderRegistryResult<string>> {
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    if (callerSignal?.aborted) controller.abort();
    else callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
    this.activeFinalRequests.add(controller);
    try {
      return await this.withAuthorizedSoniox(async (apiKey) => {
        const configuration = this.options.configuration();
        const value = await this.transcribeAudio({
          audio: input.audio,
          mime: input.mime,
          apiKey,
          model: resolveSonioxModel(configuration.model, 'async'),
          languageHint: input.languageHint ?? configuration.languageHint,
          signal: controller.signal,
        });
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        return value;
      });
    } finally {
      callerSignal?.removeEventListener('abort', abortFromCaller);
      this.activeFinalRequests.delete(controller);
    }
  }

  openStreaming(
    options: StreamingTranscriptionOptions,
  ): Promise<SpeechProviderRegistryResult<StreamingTranscriptionSession>> {
    return this.withAuthorizedSoniox(async (apiKey) => {
      const transportFactory = this.options.transportFactory;
      if (!transportFactory) throw new SpeechProviderError('unavailable');
      const configuration = this.options.configuration();
      const client = new SonioxRealtimeClient({
        ...options,
        apiKey,
        model: resolveSonioxModel(configuration.model, 'realtime'),
        languageHint: options.languageHint ?? configuration.languageHint,
        transportFactory,
        onFailure: (failure) => {
          this.activeSessions.delete(client);
          options.onFailure?.(failure);
        },
      });
      this.activeSessions.add(client);
      const tracked = new TrackedStreamingSession(client, () => this.activeSessions.delete(client));
      try {
        await client.start();
        return tracked;
      } catch (error) {
        this.activeSessions.delete(client);
        throw error;
      }
    }, (session) => session.cancel());
  }

  /** Coordinator calls this synchronously on selection/credential/consent authority changes. */
  invalidate(): void {
    if (this.invalidationGeneration >= Number.MAX_SAFE_INTEGER) {
      throw new RangeError('speech provider generation cannot advance');
    }
    this.invalidationGeneration += 1;
    for (const controller of this.activeFinalRequests) controller.abort();
    this.activeFinalRequests.clear();
    for (const session of this.activeSessions) session.cancel();
    this.activeSessions.clear();
  }

  dispose(): void {
    for (const subscription of this.subscriptions.splice(0)) subscription.dispose();
    this.invalidate();
  }

  private async withAuthorizedSoniox<T>(
    operation: (apiKey: string) => Promise<T>,
    discardStale?: (value: T) => void,
  ): Promise<SpeechProviderRegistryResult<T>> {
    const selection = this.options.selection.read();
    if (selection === 'none') return unavailable('not-configured');
    if (selection === 'legacy-soniox-pending') return unavailable('legacy-pending');
    const generation = this.invalidationGeneration;

    try {
      const authority = await this.options.authority.capture();
      if (!authority || !(await this.options.authority.revalidate(authority))) {
        return unavailable('consent-required');
      }
      const result = await this.options.credentials.use('soniox', async (apiKey) => {
        if (
          generation !== this.invalidationGeneration
          || this.options.selection.read() !== 'soniox'
          || !(await this.options.authority.revalidate(authority))
        ) return { kind: 'stale' as const };
        const value = await operation(apiKey);
        if (
          generation !== this.invalidationGeneration
          || this.options.selection.read() !== 'soniox'
          || !(await this.options.authority.revalidate(authority))
        ) {
          discardStale?.(value);
          return { kind: 'stale' as const };
        }
        return { kind: 'ready' as const, value };
      });
      if (result === undefined) return unavailable('missing-credential');
      if (result.kind === 'stale') return unavailable('authority-changed');
      return Object.freeze({
        status: 'ready' as const,
        capabilities: SONIOX_SPEECH_CAPABILITIES,
        value: result.value,
      });
    } catch (error) {
      if (isAbortError(error) || error instanceof SpeechProviderError) throw error;
      throw new SpeechProviderError('unavailable');
    }
  }
}

class TrackedStreamingSession implements StreamingTranscriptionSession {
  private released = false;

  constructor(
    private readonly delegate: StreamingTranscriptionSession,
    private readonly release: () => void,
  ) {}

  get state() { return this.delegate.state; }
  get signal() { return this.delegate.signal; }
  get reconnectAllowed() { return this.delegate.reconnectAllowed; }
  start() { return this.delegate.start(); }
  sendPcm16(frame: Int16Array | Uint8Array) { this.delegate.sendPcm16(frame); }
  finalize(options?: Parameters<StreamingTranscriptionSession['finalize']>[0]) {
    return this.delegate.finalize(options);
  }
  markDispatched() { this.delegate.markDispatched(); }

  async finish(): Promise<void> {
    try {
      await this.delegate.finish();
    } finally {
      this.releaseOnce();
    }
  }

  cancel(): void {
    this.delegate.cancel();
    this.releaseOnce();
  }

  private releaseOnce(): void {
    if (this.released) return;
    this.released = true;
    this.release();
  }
}

function unavailable(status: SpeechProviderUnavailableStatus): SpeechProviderRegistryResult<never> {
  return Object.freeze({ status, capabilities: NO_SPEECH_CAPABILITIES });
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
