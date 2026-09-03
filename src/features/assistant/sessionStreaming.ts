import type { PcmStreamHandle } from '../../recorder/native';
import type { StreamingTranscriptionSession } from '../../speech/contracts';
import type { SpeechProviderUnavailableStatus } from '../../speech/providerRegistry';

const MAX_STREAMING_FRAME_QUEUE_BYTES = 512 * 1_024;

/** Bounded bridge between uninterrupted PCM capture and Soniox finalization pauses. */
export class AssistantStreamingBuffer {
  private current: StreamingTranscriptionSession | null = null;
  private frames: Int16Array[] = [];
  private frameBytes = 0;
  private recovering = false;

  get session(): StreamingTranscriptionSession | null { return this.current; }

  /** True only while a replacement session is being opened for a lost one. */
  get isRecovering(): boolean { return this.recovering; }

  get queuedBytes(): number { return this.frameBytes; }

  attach(session: StreamingTranscriptionSession): void {
    this.cancel();
    this.current = session;
  }

  /**
   * Detaches a lost session and keeps capture flowing into the bounded queue.
   * A gap in background transcription is safer than ending the listening session.
   */
  beginRecovery(): StreamingTranscriptionSession | null {
    const previous = this.current;
    this.current = null;
    this.recovering = true;
    return previous;
  }

  /** Adopts a replacement session, replays queued audio in order and yields the old one. */
  adopt(session: StreamingTranscriptionSession): StreamingTranscriptionSession | null {
    const previous = this.current;
    this.current = session;
    this.recovering = false;
    if (session.state === 'streaming') this.drain(session);
    return previous;
  }

  send(frame: Int16Array): void {
    const session = this.current;
    if (!session) {
      if (this.recovering) this.queue(frame, true);
      return;
    }
    if (session.state === 'streaming') {
      session.sendPcm16(frame);
      return;
    }
    if (session.state !== 'connecting' && session.state !== 'finalizing') {
      throw new Error('streaming transcription is unavailable');
    }
    this.queue(frame, false);
  }

  flush(session: StreamingTranscriptionSession): void {
    if (this.current !== session) {
      // A renewal or recovery already adopted a newer session, which now owns the queue.
      if (this.current?.state === 'streaming') this.drain(this.current);
      return;
    }
    if (session.state !== 'streaming') {
      throw new Error('streaming transcription did not resume');
    }
    this.drain(session);
  }

  cancel(): void {
    const session = this.current;
    this.current = null;
    this.frames = [];
    this.frameBytes = 0;
    this.recovering = false;
    try { session?.cancel(); } catch { /* Cancellation remains authoritative. */ }
  }

  private queue(frame: Int16Array, dropOldest: boolean): void {
    const copy = frame.slice();
    if (this.frameBytes + copy.byteLength > MAX_STREAMING_FRAME_QUEUE_BYTES) {
      if (!dropOldest) throw new Error('streaming transcription frame queue exceeded');
      while (
        this.frames.length > 0
        && this.frameBytes + copy.byteLength > MAX_STREAMING_FRAME_QUEUE_BYTES
      ) {
        const oldest = this.frames.shift();
        if (oldest) this.frameBytes -= oldest.byteLength;
      }
      if (copy.byteLength > MAX_STREAMING_FRAME_QUEUE_BYTES) return;
    }
    this.frames.push(copy);
    this.frameBytes += copy.byteLength;
  }

  private drain(session: StreamingTranscriptionSession): void {
    const queued = this.frames.splice(0);
    this.frameBytes = 0;
    for (const frame of queued) session.sendPcm16(frame);
  }
}

export function monitorAssistantCapture(options: {
  stream: PcmStreamHandle;
  isCurrent(): boolean;
  fail(kind: 'error' | 'limit'): void;
}): void {
  void options.stream.outcome.then((outcome) => {
    if (!options.isCurrent()) return;
    if (outcome.reason === 'error' || outcome.reason === 'limit') options.fail(outcome.reason);
  });
}

export async function handleSpeechUnavailable(options: {
  status: SpeechProviderUnavailableStatus;
  allowPrompts: boolean;
  showMissingSonioxCredential(): PromiseLike<boolean>;
  executeCommand(commandId: string): PromiseLike<unknown>;
  publish(): Promise<void> | void;
}): Promise<void> {
  if (options.status === 'missing-credential' && options.allowPrompts) {
    if (await options.showMissingSonioxCredential()) {
      await options.executeCommand('voiceInput.setApiKey');
    }
  } else if (options.allowPrompts) {
    await options.executeCommand('voiceInput.openControlCenter');
  }
  await options.publish();
}
