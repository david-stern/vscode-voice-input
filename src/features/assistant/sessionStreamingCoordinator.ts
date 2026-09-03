import type {
  StreamingTranscriptEvent,
  StreamingTranscriptionOptions,
  StreamingTranscriptionSession,
} from '../../speech/contracts';
import type {
  SpeechProviderRegistry,
  SpeechProviderUnavailableStatus,
} from '../../speech/providerRegistry';
import { AssistantStreamingBuffer } from './sessionStreaming';

/** Proactive renewal is staggered ahead of the provider session bound and of capture renewal. */
export const STREAM_RENEW_MS = 4 * 60 * 1_000;
/** Latest point at which a session may still be swapped before the provider bound closes it. */
export const STREAM_RENEW_DEADLINE_MS = 4 * 60 * 1_000 + 45 * 1_000;
const SWAP_RETRY_MS = 250;
const REOPEN_BACKOFF_MS = Object.freeze([1_000, 2_000, 4_000]);

/** Authority losses are fail-closed: reopening cannot recover them, so listening ends. */
const AUTHORITY_LOST: ReadonlySet<SpeechProviderUnavailableStatus> = new Set([
  'not-configured',
  'legacy-pending',
  'consent-required',
  'missing-credential',
]);

type TimerHandle = ReturnType<typeof setTimeout>;

export type AssistantStreamingOpenResult =
  | { status: 'ready' }
  | { status: 'disabled' }
  | { status: 'stale' }
  | { status: 'unavailable'; reason: SpeechProviderUnavailableStatus };

export interface AssistantStreamingCoordinatorOptions {
  providers?: Pick<SpeechProviderRegistry, 'openStreaming'>;
  sampleRateHz: number;
  languageHint(): string | undefined;
  /** The controller still owns this generation and the host is not deactivating. */
  isCurrent(generation: number): boolean;
  /** True only at an utterance boundary: no active speech and no transcription in flight. */
  canSwap(): boolean;
  onTranscript?(event: StreamingTranscriptEvent): void;
  /** Every bounded reopen failed, so the caller must stop listening safely. */
  onLost(): void;
  setTimer(callback: () => void, delayMs: number): TimerHandle;
  clearTimer(timer: TimerHandle): void;
  now(): number;
}

type OpenedSession =
  | { status: 'ready'; session: StreamingTranscriptionSession; token: number }
  | { status: 'stale' }
  | { status: 'unavailable'; reason: SpeechProviderUnavailableStatus };

/**
 * Keeps one bounded provider session alive across the provider's own session bound.
 * Each reopen goes through the same provider gate, so consent and credentials are
 * revalidated per session; the underlying client never reconnects by itself.
 */
export class AssistantStreamingCoordinator {
  private readonly buffer = new AssistantStreamingBuffer();
  private generation = -1;
  private streamingEnabled = false;
  private openedAt = 0;
  private tokenSequence = 0;
  private activeToken = -1;
  private renewTimer: TimerHandle | undefined;
  private reopenTimer: TimerHandle | undefined;
  private renewAttempt = 0;
  private reopenAttempt = 0;
  private renewing = false;
  private recovering = false;

  constructor(private readonly options: AssistantStreamingCoordinatorOptions) {}

  get session(): StreamingTranscriptionSession | null { return this.buffer.session; }

  /** True once a provider session has been opened for the active listening generation. */
  get isStreaming(): boolean { return this.streamingEnabled; }

  /** True while capture is buffered because a replacement session is being opened. */
  get isRecovering(): boolean { return this.recovering; }

  get queuedBytes(): number { return this.buffer.queuedBytes; }

  async open(generation: number): Promise<AssistantStreamingOpenResult> {
    this.cancel();
    if (!this.options.providers) return { status: 'disabled' };
    this.generation = generation;
    const opened = await this.openSession(generation);
    if (opened.status !== 'ready') {
      if (this.generation === generation) this.generation = -1;
      return opened.status === 'stale'
        ? { status: 'stale' }
        : { status: 'unavailable', reason: opened.reason };
    }
    this.activeToken = opened.token;
    this.buffer.attach(opened.session);
    this.streamingEnabled = true;
    this.openedAt = this.options.now();
    this.scheduleRenewal(STREAM_RENEW_MS);
    return { status: 'ready' };
  }

  send(frame: Int16Array): void { this.buffer.send(frame); }

  flush(session: StreamingTranscriptionSession): void { this.buffer.flush(session); }

  /** Releases the coordinator only while the given listening generation still owns it. */
  cancelIfCurrent(generation: number): void {
    if (this.generation === generation) this.cancel();
  }

  cancel(): void {
    this.clearTimers();
    this.generation = -1;
    this.streamingEnabled = false;
    this.recovering = false;
    this.renewing = false;
    this.renewAttempt = 0;
    this.reopenAttempt = 0;
    this.activeToken = -1;
    this.buffer.cancel();
  }

  private async openSession(generation: number): Promise<OpenedSession> {
    const providers = this.options.providers;
    if (!providers) return { status: 'unavailable', reason: 'not-configured' };
    const token = ++this.tokenSequence;
    const request: StreamingTranscriptionOptions = {
      sampleRateHz: this.options.sampleRateHz,
      channels: 1,
      languageHint: this.options.languageHint(),
      onTranscript: (event) => {
        if (token === this.activeToken && this.options.isCurrent(generation)) {
          this.options.onTranscript?.(event);
        }
      },
      onFailure: () => this.sessionFailed(token, generation),
    };
    const result = await providers.openStreaming(request);
    if (result.status !== 'ready') return { status: 'unavailable', reason: result.status };
    if (generation !== this.generation || !this.options.isCurrent(generation)) {
      result.value.cancel();
      return { status: 'stale' };
    }
    return { status: 'ready', session: result.value, token };
  }

  /** Only the session that currently owns capture may start a recovery. */
  private sessionFailed(token: number, generation: number): void {
    if (token !== this.activeToken || generation !== this.generation) return;
    if (!this.streamingEnabled || this.recovering) return;
    if (!this.options.isCurrent(generation)) return;
    this.clearRenewTimer();
    this.recovering = true;
    this.reopenAttempt = 0;
    this.activeToken = -1;
    const previous = this.buffer.beginRecovery();
    try { previous?.cancel(); } catch { /* The lost session is already terminal. */ }
    this.scheduleReopen();
  }

  private scheduleReopen(): void {
    const delay = REOPEN_BACKOFF_MS[this.reopenAttempt];
    if (delay === undefined) {
      this.lose();
      return;
    }
    this.reopenAttempt += 1;
    this.clearReopenTimer();
    this.reopenTimer = this.options.setTimer(() => {
      this.reopenTimer = undefined;
      void this.reopen();
    }, delay);
  }

  private async reopen(): Promise<void> {
    const generation = this.generation;
    if (!this.recovering || !this.options.isCurrent(generation)) return;
    let opened: OpenedSession;
    try {
      opened = await this.openSession(generation);
    } catch {
      opened = { status: 'unavailable', reason: 'authority-changed' };
    }
    if (!this.recovering || generation !== this.generation) {
      if (opened.status === 'ready') opened.session.cancel();
      return;
    }
    if (opened.status === 'ready') {
      if (!this.adoptSession(opened)) this.scheduleReopen();
      return;
    }
    if (opened.status === 'stale') return;
    if (AUTHORITY_LOST.has(opened.reason)) {
      this.lose();
      return;
    }
    this.scheduleReopen();
  }

  private scheduleRenewal(delayMs: number): void {
    this.clearRenewTimer();
    const generation = this.generation;
    this.renewTimer = this.options.setTimer(() => {
      this.renewTimer = undefined;
      void this.renew(generation);
    }, delayMs);
  }

  private async renew(generation: number): Promise<void> {
    if (this.renewing || this.recovering || !this.streamingEnabled) return;
    if (generation !== this.generation || !this.options.isCurrent(generation)) return;
    if (!this.options.canSwap()
      && this.options.now() - this.openedAt < STREAM_RENEW_DEADLINE_MS) {
      this.scheduleRenewal(SWAP_RETRY_MS);
      return;
    }
    this.renewing = true;
    try {
      const opened = await this.openSession(generation);
      if (this.recovering || generation !== this.generation
        || !this.options.isCurrent(generation)) {
        if (opened.status === 'ready') opened.session.cancel();
        return;
      }
      if (opened.status === 'ready' && this.adoptSession(opened)) return;
      if (opened.status === 'unavailable' && AUTHORITY_LOST.has(opened.reason)) {
        // The live session still holds authority for now; its own bound ends it.
        return;
      }
      this.retryRenewal();
    } catch {
      this.retryRenewal();
    } finally {
      this.renewing = false;
    }
  }

  private adoptSession(opened: Extract<OpenedSession, { status: 'ready' }>): boolean {
    if (opened.session.state !== 'streaming') {
      try { opened.session.cancel(); } catch { /* Discarding a dead session is best effort. */ }
      return false;
    }
    this.activeToken = opened.token;
    const previous = this.buffer.adopt(opened.session);
    this.recovering = false;
    this.reopenAttempt = 0;
    this.renewAttempt = 0;
    this.openedAt = this.options.now();
    this.retire(previous);
    this.scheduleRenewal(STREAM_RENEW_MS);
    return true;
  }

  /** The replaced session finishes its own handshake and never carries new audio. */
  private retire(previous: StreamingTranscriptionSession | null): void {
    if (!previous) return;
    if (previous.state !== 'streaming') {
      try { previous.cancel(); } catch { /* Retiring a closed session is best effort. */ }
      return;
    }
    try {
      void Promise.resolve(previous.finish()).catch(() => {
        try { previous.cancel(); } catch { /* Retirement stays best effort. */ }
      });
    } catch {
      try { previous.cancel(); } catch { /* Retirement stays best effort. */ }
    }
  }

  private retryRenewal(): void {
    const delay = REOPEN_BACKOFF_MS[this.renewAttempt];
    if (delay === undefined) return;
    this.renewAttempt += 1;
    this.scheduleRenewal(delay);
  }

  private lose(): void {
    this.recovering = false;
    this.streamingEnabled = false;
    this.clearTimers();
    this.options.onLost();
  }

  private clearTimers(): void {
    this.clearRenewTimer();
    this.clearReopenTimer();
  }

  private clearRenewTimer(): void {
    if (this.renewTimer === undefined) return;
    this.options.clearTimer(this.renewTimer);
    this.renewTimer = undefined;
  }

  private clearReopenTimer(): void {
    if (this.reopenTimer === undefined) return;
    this.options.clearTimer(this.reopenTimer);
    this.reopenTimer = undefined;
  }
}
