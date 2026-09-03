import assert from 'node:assert/strict';
import test from 'node:test';

import { SETTINGS_DEFAULTS } from '../src/config';
import type { TargetSnapshot } from '../src/assistant/context';
import type { AssistantActionController } from '../src/features/assistant/actionController';
import type { AssistantFeedbackController } from '../src/features/assistant/feedbackController';
import type { AssistantIdSequence } from '../src/features/assistant/idSequence';
import type { AssistantPlanningService } from '../src/features/assistant/planningService';
import { AssistantSessionController } from '../src/features/assistant/sessionController';
import { AssistantStreamingBuffer } from '../src/features/assistant/sessionStreaming';
import {
  STREAM_RENEW_DEADLINE_MS,
  STREAM_RENEW_MS,
} from '../src/features/assistant/sessionStreamingCoordinator';
import type { MappingFeature } from '../src/features/mappings';
import type { PushToTalkController, TranscriptionService } from '../src/features/recording';
import type {
  SpeechProviderCapabilities,
  StreamingTranscriptEvent,
  StreamingTranscriptionOptions,
  StreamingTranscriptionSession,
  StreamingTranscriptionState,
} from '../src/speech/contracts';
import type { SpeechProviderUnavailableStatus } from '../src/speech/providerRegistry';

const SNAPSHOT: TargetSnapshot = {
  requestedTarget: 'here',
  resolvedTarget: 'focused-control',
  focusedTarget: 'focused-control',
  vscodeFocused: true,
  activeTabIdentity: 'tab-1',
  activeEditorIdentity: null,
  activeTerminalIdentity: null,
};

const CAPABILITIES: SpeechProviderCapabilities = Object.freeze({
  provider: 'soniox',
  finalOnly: false,
  streamingPartials: true,
  remoteProcessing: true,
});

const SPEECH_FRAME_SAMPLES = 4_000;
const SILENCE_FRAME_SAMPLES = 14_400;

class FakeClock {
  now = 10_000;
  private sequence = 0;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  readonly setTimer = (callback: () => void, delayMs: number) => {
    const id = ++this.sequence;
    this.timers.set(id, { at: this.now + delayMs, callback });
    return id as unknown as ReturnType<typeof setTimeout>;
  };

  readonly clearTimer = (timer: ReturnType<typeof setTimeout>) => {
    this.timers.delete(timer as unknown as number);
  };

  get pending(): number { return this.timers.size; }

  async advance(milliseconds: number): Promise<void> {
    const target = this.now + milliseconds;
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.now = due[1].at;
      due[1].callback();
      await settle();
    }
    this.now = target;
    await settle();
  }
}

class FakeStreamingSession implements StreamingTranscriptionSession {
  state: StreamingTranscriptionState = 'streaming';
  readonly frames: number[] = [];
  finished = false;
  cancelled = false;
  finalText = '';
  holdFinalize = false;
  private pendingFinalize: { reject(error: unknown): void } | undefined;
  private readonly controller = new AbortController();

  constructor(
    readonly id: number,
    private readonly options: StreamingTranscriptionOptions,
  ) {}

  get signal(): AbortSignal { return this.controller.signal; }
  get reconnectAllowed(): boolean { return false; }

  async start(): Promise<void> {}

  sendPcm16(frame: Int16Array | Uint8Array): void {
    if (this.state !== 'streaming') throw new Error('fake session is not streaming');
    this.frames.push(frame.length);
  }

  finalize(): Promise<string> {
    if (this.state !== 'streaming') return Promise.reject(new Error('fake session is closed'));
    if (!this.holdFinalize) return Promise.resolve(this.finalText);
    // The real client stays in 'finalizing' until the provider answers or the session ends.
    this.state = 'finalizing';
    return new Promise<string>((_resolve, reject) => { this.pendingFinalize = { reject }; });
  }

  async finish(): Promise<void> {
    this.finished = true;
    this.state = 'closed';
  }

  markDispatched(): void {}

  cancel(): void {
    this.cancelled = true;
    this.state = 'closed';
    this.controller.abort();
    this.settlePending();
  }

  /** Mirrors a provider session that reached its own bound or lost the transport. */
  fail(): void {
    if (this.state === 'closed' || this.state === 'failed') return;
    this.state = 'failed';
    this.controller.abort();
    this.settlePending();
    this.options.onFailure?.({ category: 'timed-out' });
  }

  emit(event: StreamingTranscriptEvent): void {
    this.options.onTranscript(event);
  }

  private settlePending(): void {
    const pending = this.pendingFinalize;
    this.pendingFinalize = undefined;
    pending?.reject(new DOMException('Aborted', 'AbortError'));
  }
}

interface Harness {
  clock: FakeClock;
  controller: AssistantSessionController;
  sessions: FakeStreamingSession[];
  outcomes: (SpeechProviderUnavailableStatus | 'ready')[];
  errors: string[];
  transcripts: string[];
  statuses: string[];
  openCount(): number;
  frame(samples: number, amplitude?: number): void;
  speak(): void;
  endUtterance(): Promise<void>;
  captures(): number;
}

function createHarness(options: {
  deactivating?: () => boolean;
  finalText?: string;
  holdFinalize?: boolean;
} = {}): Harness {
  const clock = new FakeClock();
  const sessions: FakeStreamingSession[] = [];
  const outcomes: (SpeechProviderUnavailableStatus | 'ready')[] = [];
  const errors: string[] = [];
  const transcripts: string[] = [];
  const statuses: string[] = [];
  let opened = 0;
  let captures = 0;
  let sink: ((frame: Int16Array) => void) | undefined;

  const controller = new AssistantSessionController({
    settings: { read: () => ({ values: { ...SETTINGS_DEFAULTS }, workspaceOverrides: [] }) },
    credentials: { status: async () => ({ provider: 'soniox', configured: true }) },
    consents: {
      status: () => ({ id: 'assistant-listening', acknowledged: true }),
      revision: () => 0,
      acknowledgeIfCurrent: async () => true,
    },
    devices: { get: async () => [] },
    recording: { cancel: async () => undefined } as unknown as PushToTalkController,
    transcriptions: { abort: () => undefined } as unknown as TranscriptionService,
    mappings: {
      cancel: () => undefined,
      routeVoiceRequest: async () => ({ handled: true, kind: 'mapping' as const }),
    } as unknown as MappingFeature,
    planning: { invalidate: () => undefined } as unknown as AssistantPlanningService,
    actions: { clearPending: () => undefined } as unknown as AssistantActionController,
    feedback: { cancelSpeaking: () => undefined } as unknown as AssistantFeedbackController,
    sequence: { next: (prefix: string) => `${prefix}-1` } as AssistantIdSequence,
    target: { capture: () => SNAPSHOT, forRequestedTarget: (value) => value },
    status: {
      idle: () => statuses.push('idle'),
      listening: () => statuses.push('listening'),
      transcribing: () => statuses.push('transcribing'),
      stoppedWithError: (message) => { statuses.push('stopped'); errors.push(message); },
    },
    ui: {
      confirmListeningDisclosure: async () => true,
      showMissingSonioxCredential: async () => false,
      showError: async () => undefined,
      executeCommand: async () => undefined,
    },
    speechProviders: {
      openStreaming: async (request) => {
        const index = opened++;
        const outcome = outcomes[index] ?? 'ready';
        if (outcome !== 'ready') return { status: outcome, capabilities: CAPABILITIES };
        const session = new FakeStreamingSession(index, request);
        session.finalText = options.finalText ?? '';
        session.holdFinalize = options.holdFinalize === true;
        sessions.push(session);
        return { status: 'ready', capabilities: CAPABILITIES, value: session };
      },
    },
    onTranscript: (event) => transcripts.push(`${event.kind}:${event.text}`),
    startPcmStream: async (streamOptions) => {
      captures += 1;
      sink = streamOptions.onFrame;
      return {
        sampleRate: 16_000,
        selectedDevice: 'mic-1',
        outcome: new Promise(() => undefined),
        cancel: () => undefined,
        stop: async () => ({ reason: 'cancelled' as const }),
      };
    },
    publish: () => undefined,
    isDeactivating: options.deactivating ?? (() => false),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    now: () => clock.now,
  });

  const frame = (samples: number, amplitude = 0) => {
    sink?.(new Int16Array(samples).fill(amplitude));
  };
  return {
    clock,
    controller,
    sessions,
    outcomes,
    errors,
    transcripts,
    statuses,
    openCount: () => opened,
    frame,
    speak: () => frame(SPEECH_FRAME_SAMPLES, 12_000),
    endUtterance: async () => {
      frame(SILENCE_FRAME_SAMPLES, 0);
      await settle();
    },
    captures: () => captures,
  };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 12; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

test('an idle streaming session is renewed before the provider bound and the old one is closed', async () => {
  const harness = createHarness();
  await harness.controller.start();
  assert.equal(harness.sessions.length, 1);

  await harness.clock.advance(STREAM_RENEW_MS);

  assert.equal(harness.sessions.length, 2, 'a replacement session must be opened proactively');
  assert.equal(harness.sessions[0].finished, true, 'the replaced session is closed cleanly');
  harness.frame(320);
  assert.equal(harness.sessions[1].frames.length, 1, 'capture now flows into the new session');
  assert.equal(harness.sessions[0].frames.length, 0);
  assert.equal(harness.controller.isListening, true);
  assert.deepEqual(harness.errors, []);

  // Renewal keeps repeating for as long as listening continues.
  await harness.clock.advance(STREAM_RENEW_MS);
  assert.equal(harness.sessions.length, 3);
  await harness.controller.stop();
});

test('renewal waits for the utterance boundary and never outlives the session deadline', async () => {
  const harness = createHarness();
  await harness.controller.start();
  harness.speak();

  await harness.clock.advance(STREAM_RENEW_MS);
  assert.equal(harness.sessions.length, 1, 'a session is never swapped mid-utterance');
  await harness.clock.advance(1_000);
  assert.equal(harness.sessions.length, 1);

  await harness.endUtterance();
  await harness.clock.advance(250);
  assert.equal(harness.sessions.length, 2, 'the deferred renewal runs at the utterance boundary');
  assert.equal(harness.controller.isListening, true);
  await harness.controller.stop();

  // A transcription that never returns still gets a new session before the provider bound.
  const stuck = createHarness({ holdFinalize: true });
  await stuck.controller.start();
  stuck.speak();
  await stuck.endUtterance();
  assert.equal(stuck.sessions[0].state, 'finalizing');

  await stuck.clock.advance(STREAM_RENEW_MS);
  assert.equal(stuck.sessions.length, 1, 'the swap is deferred while the boundary is busy');
  await stuck.clock.advance(STREAM_RENEW_DEADLINE_MS - STREAM_RENEW_MS - 250);
  assert.equal(stuck.sessions.length, 1, 'deferral holds right up to the deadline');

  await stuck.clock.advance(250);
  assert.equal(stuck.sessions.length, 2, 'the hard deadline forces the swap');
  assert.equal(stuck.sessions[0].cancelled, true, 'the stuck session is released, not awaited');
  assert.equal(stuck.controller.isListening, true);
  assert.deepEqual(stuck.errors, []);
  await stuck.controller.stop();
});

test('a lost session is reopened with bounded backoff and listening survives silently', async () => {
  const harness = createHarness();
  await harness.controller.start();
  harness.outcomes[1] = 'authority-changed';

  harness.sessions[0].fail();
  await settle();
  assert.equal(harness.controller.isListening, true, 'a failed session never stops listening yet');

  harness.frame(320);
  harness.frame(640);
  assert.equal(harness.openCount(), 1, 'reopening waits for the first backoff step');

  await harness.clock.advance(1_000);
  assert.equal(harness.openCount(), 2);
  assert.equal(harness.sessions.length, 1, 'the first reopen was rejected by the provider gate');

  await harness.clock.advance(2_000);
  assert.equal(harness.sessions.length, 2, 'the second reopen succeeds');
  assert.deepEqual(harness.sessions[1].frames, [320, 640], 'buffered audio replays in order');
  assert.equal(harness.controller.isListening, true);
  assert.deepEqual(harness.errors, []);

  harness.frame(160);
  assert.deepEqual(harness.sessions[1].frames, [320, 640, 160]);
  await harness.controller.stop();
});

test('three failed reopens stop listening with the existing remote transcription message', async () => {
  const harness = createHarness();
  await harness.controller.start();
  harness.outcomes[1] = 'authority-changed';
  harness.outcomes[2] = 'authority-changed';
  harness.outcomes[3] = 'authority-changed';

  harness.sessions[0].fail();
  await settle();
  await harness.clock.advance(1_000);
  await harness.clock.advance(2_000);
  assert.equal(harness.controller.isListening, true, 'listening survives every bounded attempt');
  await harness.clock.advance(4_000);

  assert.equal(harness.controller.isListening, false);
  assert.equal(harness.openCount(), 4);
  assert.match(harness.errors[0] ?? '', /remote transcription failed safely/u);
});

test('authority lost during a reopen stops listening immediately and fails closed', async () => {
  for (const reason of ['consent-required', 'missing-credential', 'not-configured'] as const) {
    const harness = createHarness();
    await harness.controller.start();
    harness.outcomes[1] = reason;

    harness.sessions[0].fail();
    await settle();
    await harness.clock.advance(1_000);

    assert.equal(harness.controller.isListening, false, reason);
    assert.equal(harness.openCount(), 2, `${reason} must not be retried`);
    assert.match(harness.errors[0] ?? '', /remote transcription failed safely/u);
  }
});

test('a session lost during recovery keeps utterances and display text off the action path', async () => {
  const harness = createHarness({ finalText: 'assistant open terminal' });
  await harness.controller.start();
  harness.outcomes[1] = 'authority-changed';
  const lost = harness.sessions[0];

  lost.fail();
  await settle();
  harness.speak();
  await harness.endUtterance();

  assert.equal(harness.controller.isListening, true, 'an utterance during recovery is dropped');
  assert.deepEqual(harness.errors, []);
  lost.emit({ kind: 'partial', text: 'stale text' });
  assert.deepEqual(harness.transcripts, [], 'a retired session can no longer paint the display');

  await harness.clock.advance(1_000);
  await harness.clock.advance(2_000);
  assert.equal(harness.sessions.length, 2);
  harness.sessions[1].emit({ kind: 'partial', text: 'live text' });
  assert.deepEqual(harness.transcripts, ['partial:live text']);
  await harness.controller.stop();
});

test('stopping and deactivating during renewal leave no session or timer behind', async () => {
  const harness = createHarness();
  await harness.controller.start();
  await harness.controller.stop();

  const openedAtStop = harness.openCount();
  await harness.clock.advance(STREAM_RENEW_MS * 2);
  assert.equal(harness.openCount(), openedAtStop, 'a stopped session is never renewed');
  assert.equal(harness.sessions[0].cancelled, true);

  let deactivating = false;
  const shutdown = createHarness({ deactivating: () => deactivating });
  await shutdown.controller.start();
  deactivating = true;
  await shutdown.clock.advance(STREAM_RENEW_MS);
  assert.equal(shutdown.sessions.length, 1, 'deactivation cancels renewal');
  shutdown.controller.dispose();
  assert.equal(shutdown.sessions[0].cancelled, true);
  await shutdown.clock.advance(STREAM_RENEW_MS);
  assert.equal(shutdown.clock.pending, 0, 'no timer outlives disposal');
});

test('the streaming queue drops the oldest audio only while a replacement is opening', () => {
  const buffer = new AssistantStreamingBuffer();
  const request: StreamingTranscriptionOptions = {
    sampleRateHz: 16_000,
    onTranscript: () => undefined,
  };
  const first = new FakeStreamingSession(0, request);
  buffer.attach(first);

  first.state = 'finalizing';
  buffer.send(new Int16Array(8));
  assert.equal(buffer.queuedBytes, 16);
  assert.throws(
    () => buffer.send(new Int16Array(512 * 1_024)),
    /frame queue exceeded/u,
    'outside recovery an overflowing queue still fails closed',
  );

  first.state = 'streaming';
  buffer.flush(first);
  assert.deepEqual(first.frames, [8]);

  assert.equal(buffer.beginRecovery(), first);
  assert.equal(buffer.isRecovering, true);
  for (let index = 0; index < 40; index += 1) buffer.send(new Int16Array(8_192).fill(index));
  assert.ok(buffer.queuedBytes <= 512 * 1_024, 'the recovery queue stays bounded');

  const second = new FakeStreamingSession(1, request);
  assert.equal(buffer.adopt(second), null);
  assert.equal(buffer.isRecovering, false);
  const replayed = second.frames.length;
  assert.ok(replayed > 0 && replayed < 40, 'the oldest frames are dropped, the newest replay');
  assert.deepEqual(second.frames, Array.from({ length: replayed }, () => 8_192));
  assert.equal(buffer.queuedBytes, 0);

  buffer.cancel();
  assert.equal(second.cancelled, true);
});

test('a queue flush after a swap targets the adopted session instead of failing', () => {
  const buffer = new AssistantStreamingBuffer();
  const request: StreamingTranscriptionOptions = {
    sampleRateHz: 16_000,
    onTranscript: () => undefined,
  };
  const first = new FakeStreamingSession(0, request);
  const second = new FakeStreamingSession(1, request);
  buffer.attach(first);
  first.state = 'finalizing';
  buffer.send(new Int16Array(4));
  buffer.adopt(second);

  buffer.flush(first);
  assert.deepEqual(second.frames, [4]);
  assert.equal(first.frames.length, 0);

  buffer.attach(first);
  first.state = 'connecting';
  buffer.send(new Int16Array(4));
  assert.throws(() => buffer.flush(first), /did not resume/u);
});
