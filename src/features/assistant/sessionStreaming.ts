import type { PcmStreamHandle } from '../../recorder/native';
import type { StreamingTranscriptionSession } from '../../speech/contracts';
import type { SpeechProviderUnavailableStatus } from '../../speech/providerRegistry';

const MAX_STREAMING_FRAME_QUEUE_BYTES = 512 * 1_024;

/** Bounded bridge between uninterrupted PCM capture and Soniox finalization pauses. */
export class AssistantStreamingBuffer {
  private current: StreamingTranscriptionSession | null = null;
  private frames: Int16Array[] = [];
  private frameBytes = 0;

  get session(): StreamingTranscriptionSession | null { return this.current; }

  attach(session: StreamingTranscriptionSession): void {
    this.cancel();
    this.current = session;
  }

  send(frame: Int16Array): void {
    const session = this.current;
    if (!session) return;
    if (session.state === 'streaming') {
      session.sendPcm16(frame);
      return;
    }
    if (session.state !== 'connecting' && session.state !== 'finalizing') {
      throw new Error('streaming transcription is unavailable');
    }
    if (this.frameBytes + frame.byteLength > MAX_STREAMING_FRAME_QUEUE_BYTES) {
      throw new Error('streaming transcription frame queue exceeded');
    }
    const copy = frame.slice();
    this.frames.push(copy);
    this.frameBytes += copy.byteLength;
  }

  flush(session: StreamingTranscriptionSession): void {
    if (this.current !== session || session.state !== 'streaming') {
      throw new Error('streaming transcription did not resume');
    }
    const queued = this.frames.splice(0);
    this.frameBytes = 0;
    for (const frame of queued) session.sendPcm16(frame);
  }

  cancel(): void {
    const session = this.current;
    this.current = null;
    this.frames = [];
    this.frameBytes = 0;
    try { session?.cancel(); } catch { /* Cancellation remains authoritative. */ }
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
