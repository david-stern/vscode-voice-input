import {
  SpeechProviderError,
  type SpeechFailureCategory,
  type StreamingFinalizeOptions,
  type StreamingTranscriptEvent,
  type StreamingTranscriptionSession,
  type StreamingTranscriptionState,
} from '../contracts';
import {
  abortError,
  appendTranscript,
  assertTranscriptBound,
  boundedTimeout,
  categoryFrom,
  codePointLength,
  configurationMessage,
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_FINALIZE_TIMEOUT_MS,
  DEFAULT_FINISH_TIMEOUT_MS,
  DEFAULT_SESSION_TIMEOUT_MS,
  DEFAULT_TRAILING_SILENCE_MS,
  deferred,
  MAX_BUFFERED_AUDIO_BYTES,
  MAX_FRAME_BYTES,
  MAX_MESSAGES,
  MAX_TOTAL_AUDIO_BYTES,
  OPEN,
  parseResponse,
  pcm16LittleEndian,
  trailingSilenceByteLengths,
  validateConfiguration,
  type Deferred,
  type SonioxRealtimeClientOptions,
  type SonioxToken,
  type TimerHandle,
} from './realtimeSupport';
import {
  SONIOX_REALTIME_ENDPOINT,
  type SonioxTransportMessageEvent,
  type SonioxWebSocketTransport,
} from './transport';

const MAX_TOKENS_PER_MESSAGE = 512;
const MAX_TOKENS_PER_SESSION = 32_768;
const MAX_SESSION_TRANSCRIPT_CODE_POINTS = 16_000;

export type { SonioxRealtimeClientOptions } from './realtimeSupport';

/**
 * One bounded Soniox WebSocket session. It never reconnects by itself and never
 * projects provider response bodies or raw transport errors.
 */
export class SonioxRealtimeClient implements StreamingTranscriptionSession {
  private readonly controller = new AbortController();
  private readonly setTimer: NonNullable<SonioxRealtimeClientOptions['setTimer']>;
  private readonly clearTimer: NonNullable<SonioxRealtimeClientOptions['clearTimer']>;
  private readonly connectTimeoutMs: number;
  private readonly finalizeTimeoutMs: number;
  private readonly finishTimeoutMs: number;
  private readonly sessionTimeoutMs: number;
  private readonly channels: number;
  private currentState: StreamingTranscriptionState = 'idle';
  private transport: SonioxWebSocketTransport | undefined;
  private startResult: Deferred<void> | undefined;
  private finalizeResult: Deferred<string> | undefined;
  private finishResult: Deferred<void> | undefined;
  private connectTimer: TimerHandle | undefined;
  private finalizeTimer: TimerHandle | undefined;
  private finishTimer: TimerHandle | undefined;
  private sessionTimer: TimerHandle | undefined;
  private bufferedAudio: Uint8Array[] = [];
  private bufferedAudioBytes = 0;
  private totalAudioBytes = 0;
  private messageCount = 0;
  private tokenCount = 0;
  private sessionTranscriptCodePoints = 0;
  private finalizedText = '';
  private partialText = '';
  private lastDisplayedText = '';
  private terminal = false;
  private finishing = false;
  private finishedSeen = false;
  private audioSent = false;
  private finalizationSent = false;
  private dispatched = false;
  private terminalFailure: SpeechProviderError | undefined;

  constructor(private readonly options: SonioxRealtimeClientOptions) {
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
    this.connectTimeoutMs = boundedTimeout(options.connectTimeoutMs, DEFAULT_CONNECT_TIMEOUT_MS);
    this.finalizeTimeoutMs = boundedTimeout(options.finalizeTimeoutMs, DEFAULT_FINALIZE_TIMEOUT_MS);
    this.finishTimeoutMs = boundedTimeout(options.finishTimeoutMs, DEFAULT_FINISH_TIMEOUT_MS);
    this.sessionTimeoutMs = boundedTimeout(options.sessionTimeoutMs, DEFAULT_SESSION_TIMEOUT_MS);
    this.channels = options.channels ?? 1;
    validateConfiguration(options, this.channels);
  }

  get state(): StreamingTranscriptionState {
    return this.currentState;
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get reconnectAllowed(): boolean {
    return !this.audioSent && !this.finalizationSent && !this.dispatched;
  }

  start(): Promise<void> {
    if (this.startResult) return this.startResult.promise;
    if (this.currentState !== 'idle' || this.terminal) {
      return Promise.reject(this.terminalFailure ?? new SpeechProviderError('unavailable'));
    }

    const startResult = deferred<void>();
    this.startResult = startResult;
    this.currentState = 'connecting';
    this.connectTimer = this.setTimer(
      () => this.fail('timed-out'),
      this.connectTimeoutMs,
    );
    this.sessionTimer = this.setTimer(
      () => this.fail('timed-out'),
      this.sessionTimeoutMs,
    );
    try {
      const transport = this.options.transportFactory(SONIOX_REALTIME_ENDPOINT);
      this.transport = transport;
      this.attach(transport);
    } catch {
      this.fail('connection-failed');
    }
    return startResult.promise;
  }

  sendPcm16(frame: Int16Array | Uint8Array): void {
    if (this.terminal || (this.currentState !== 'connecting' && this.currentState !== 'streaming')) {
      throw new SpeechProviderError('unavailable');
    }
    const bytes = pcm16LittleEndian(frame);
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_FRAME_BYTES) {
      throw new SpeechProviderError('invalid-audio');
    }
    this.reserveAudio(bytes.byteLength);
    if (this.currentState === 'connecting') {
      if (this.bufferedAudioBytes + bytes.byteLength > MAX_BUFFERED_AUDIO_BYTES) {
        this.fail('bounds-exceeded');
        throw new SpeechProviderError('bounds-exceeded');
      }
      this.bufferedAudio.push(bytes);
      this.bufferedAudioBytes += bytes.byteLength;
      return;
    }
    this.sendAudio(bytes);
  }

  finalize(options: StreamingFinalizeOptions = {}): Promise<string> {
    if (this.finalizeResult) return this.finalizeResult.promise;
    if (this.terminal || this.finishing || this.currentState !== 'streaming') {
      return Promise.reject(this.terminalFailure ?? new SpeechProviderError('unavailable'));
    }
    const result = deferred<string>();
    this.finalizeResult = result;
    this.currentState = 'finalizing';
    this.finalizationSent = true;
    try {
      this.sendTrailingSilence(options.trailingSilenceMs ?? DEFAULT_TRAILING_SILENCE_MS);
      this.sendText(JSON.stringify({ type: 'finalize' }));
      this.finalizeTimer = this.setTimer(
        () => this.fail('timed-out'),
        this.finalizeTimeoutMs,
      );
    } catch (error) {
      if (!this.terminal) this.fail(categoryFrom(error));
    }
    return result.promise;
  }

  finish(): Promise<void> {
    if (this.finishResult) return this.finishResult.promise;
    if (this.currentState === 'closed' && this.finishedSeen) return Promise.resolve();
    if (this.terminal) {
      return Promise.reject(this.terminalFailure ?? abortError());
    }
    const result = deferred<void>();
    this.finishResult = result;
    void this.beginFinish(result);
    return result.promise;
  }

  markDispatched(): void {
    this.dispatched = true;
  }

  cancel(): void {
    if (this.terminal) return;
    this.terminal = true;
    this.currentState = 'closed';
    this.controller.abort();
    const error = abortError();
    this.rejectPending(error);
    this.clearAllTimers();
    this.clearBuffers();
    const transport = this.transport;
    if (transport) this.detach(transport);
    this.transport = undefined;
    try {
      transport?.close(1_000, 'cancelled');
    } catch {
      // Cancellation is already authoritative; transport cleanup is best effort.
    }
  }

  private async beginFinish(result: Deferred<void>): Promise<void> {
    try {
      if (this.currentState === 'connecting') await this.startResult?.promise;
      if (this.finalizeResult) await this.finalizeResult.promise;
      if (this.terminal || this.currentState !== 'streaming') {
        throw this.terminalFailure ?? new SpeechProviderError('unavailable');
      }
      this.finishing = true;
      this.currentState = 'finalizing';
      this.finalizationSent = true;
      const transport = this.requireOpenTransport();
      transport.send(new Uint8Array(0));
      this.finishTimer = this.setTimer(
        () => this.fail('timed-out'),
        this.finishTimeoutMs,
      );
    } catch (error) {
      if (!this.terminal) this.fail(categoryFrom(error));
      if (!this.terminalFailure && !this.controller.signal.aborted) result.reject(error);
    }
  }

  private readonly onOpen = (): void => {
    if (this.terminal || this.currentState !== 'connecting') return;
    try {
      this.clearConnectTimer();
      this.sendText(JSON.stringify(configurationMessage(this.options, this.channels)));
      this.currentState = 'streaming';
      for (const frame of this.bufferedAudio) this.sendAudio(frame);
      this.bufferedAudio = [];
      this.bufferedAudioBytes = 0;
      this.startResult?.resolve(undefined);
    } catch (error) {
      this.fail(categoryFrom(error));
    }
  };

  private readonly onMessage = (event: SonioxTransportMessageEvent): void => {
    if (this.terminal) return;
    try {
      if (this.currentState !== 'streaming' && this.currentState !== 'finalizing') {
        throw new SpeechProviderError('malformed-response');
      }
      const response = parseResponse(event.data);
      this.messageCount += 1;
      if (this.messageCount > MAX_MESSAGES) throw new SpeechProviderError('bounds-exceeded');
      if (response.rejected) throw new SpeechProviderError('provider-rejected');
      this.consumeTokens(response.tokens);
      if (response.finished) this.completeFinish();
    } catch (error) {
      this.fail(categoryFrom(error));
    }
  };

  private readonly onError = (): void => {
    if (!this.terminal) this.fail('connection-failed');
  };

  private readonly onClose = (): void => {
    if (!this.terminal) this.fail('connection-closed');
  };

  private consumeTokens(tokens: readonly SonioxToken[]): void {
    if (tokens.length > MAX_TOKENS_PER_MESSAGE) {
      throw new SpeechProviderError('bounds-exceeded');
    }
    this.tokenCount += tokens.length;
    if (this.tokenCount > MAX_TOKENS_PER_SESSION) {
      throw new SpeechProviderError('bounds-exceeded');
    }

    let nonFinal = '';
    let finalizeMarker = false;
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token.text === '<fin>') {
        if (!token.isFinal || index !== tokens.length - 1 || !this.finalizeResult) {
          throw new SpeechProviderError('malformed-response');
        }
        finalizeMarker = true;
        continue;
      }
      if (token.text === '<end>') {
        if (!token.isFinal) throw new SpeechProviderError('malformed-response');
        continue;
      }
      if (token.isFinal) this.finalizedText = appendTranscript(this.finalizedText, token.text);
      else nonFinal = appendTranscript(nonFinal, token.text);
    }
    this.partialText = nonFinal;
    if (finalizeMarker) {
      if (nonFinal) throw new SpeechProviderError('malformed-response');
      this.completeFinalize();
      return;
    }
    const display = `${this.finalizedText}${this.partialText}`.trim();
    assertTranscriptBound(display);
    if (display && display !== this.lastDisplayedText) {
      this.lastDisplayedText = display;
      this.emitTranscript({ kind: 'partial', text: display });
    }
  }

  private completeFinalize(): void {
    const result = this.finalizeResult;
    if (!result) throw new SpeechProviderError('malformed-response');
    this.clearFinalizeTimer();
    const text = this.finalizedText.trim();
    assertTranscriptBound(text);
    this.sessionTranscriptCodePoints += codePointLength(text);
    if (this.sessionTranscriptCodePoints > MAX_SESSION_TRANSCRIPT_CODE_POINTS) {
      throw new SpeechProviderError('bounds-exceeded');
    }
    this.finalizedText = '';
    this.partialText = '';
    this.lastDisplayedText = '';
    this.finalizeResult = undefined;
    this.currentState = 'streaming';
    this.emitTranscript({ kind: 'final', text });
    result.resolve(text);
  }

  private completeFinish(): void {
    if (!this.finishing || !this.finishResult) {
      throw new SpeechProviderError('malformed-response');
    }
    this.finishedSeen = true;
    this.terminal = true;
    this.currentState = 'closed';
    this.clearAllTimers();
    this.clearBuffers();
    const result = this.finishResult;
    this.finishResult = undefined;
    const transport = this.transport;
    if (transport) this.detach(transport);
    this.transport = undefined;
    result.resolve(undefined);
    try {
      transport?.close(1_000, 'finished');
    } catch {
      // The server handshake is already complete.
    }
  }

  private sendTrailingSilence(milliseconds: number): void {
    for (const byteLength of trailingSilenceByteLengths(
      milliseconds,
      this.options.sampleRateHz,
      this.channels,
    )) {
      this.reserveAudio(byteLength);
      this.sendAudio(new Uint8Array(byteLength));
    }
  }

  private reserveAudio(byteLength: number): void {
    if (this.totalAudioBytes + byteLength > MAX_TOTAL_AUDIO_BYTES) {
      this.fail('bounds-exceeded');
      throw new SpeechProviderError('bounds-exceeded');
    }
    this.totalAudioBytes += byteLength;
  }

  private sendAudio(frame: Uint8Array): void {
    const transport = this.requireOpenTransport();
    transport.send(frame);
    this.audioSent = true;
  }

  private sendText(message: string): void {
    this.requireOpenTransport().send(message);
  }

  private requireOpenTransport(): SonioxWebSocketTransport {
    const transport = this.transport;
    if (!transport || transport.readyState !== OPEN) {
      throw new SpeechProviderError('connection-failed');
    }
    return transport;
  }

  private emitTranscript(event: StreamingTranscriptEvent): void {
    if (this.terminal) return;
    try {
      this.options.onTranscript(Object.freeze({ ...event }));
    } catch {
      // Display listeners cannot mutate provider state or leak provider content through failures.
    }
  }

  private fail(category: SpeechFailureCategory): void {
    if (this.terminal) return;
    this.terminal = true;
    this.currentState = 'failed';
    const failure = new SpeechProviderError(category);
    this.terminalFailure = failure;
    this.controller.abort();
    this.rejectPending(failure);
    this.clearAllTimers();
    this.clearBuffers();
    const transport = this.transport;
    if (transport) this.detach(transport);
    this.transport = undefined;
    try {
      transport?.close(1_008, 'provider-failure');
    } catch {
      // Failure is already content-free and terminal.
    }
    try {
      this.options.onFailure?.(Object.freeze({ category }));
    } catch {
      // Observer failures remain outside the provider state machine.
    }
  }

  private rejectPending(error: unknown): void {
    this.startResult?.reject(error);
    this.finalizeResult?.reject(error);
    this.finishResult?.reject(error);
    this.finalizeResult = undefined;
    this.finishResult = undefined;
  }

  private clearBuffers(): void {
    this.bufferedAudio = [];
    this.bufferedAudioBytes = 0;
    this.finalizedText = '';
    this.partialText = '';
    this.lastDisplayedText = '';
  }

  private attach(transport: SonioxWebSocketTransport): void {
    transport.addEventListener('open', this.onOpen);
    transport.addEventListener('message', this.onMessage);
    transport.addEventListener('error', this.onError);
    transport.addEventListener('close', this.onClose);
  }

  private detach(transport: SonioxWebSocketTransport): void {
    transport.removeEventListener('open', this.onOpen);
    transport.removeEventListener('message', this.onMessage);
    transport.removeEventListener('error', this.onError);
    transport.removeEventListener('close', this.onClose);
  }

  private clearAllTimers(): void {
    this.clearConnectTimer();
    this.clearFinalizeTimer();
    if (this.finishTimer !== undefined) this.clearTimer(this.finishTimer);
    if (this.sessionTimer !== undefined) this.clearTimer(this.sessionTimer);
    this.finishTimer = undefined;
    this.sessionTimer = undefined;
  }

  private clearConnectTimer(): void {
    if (this.connectTimer !== undefined) this.clearTimer(this.connectTimer);
    this.connectTimer = undefined;
  }

  private clearFinalizeTimer(): void {
    if (this.finalizeTimer !== undefined) this.clearTimer(this.finalizeTimer);
    this.finalizeTimer = undefined;
  }
}
