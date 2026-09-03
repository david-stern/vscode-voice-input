import assert from 'node:assert/strict';
import test from 'node:test';

import { audioDevicesFromNames, NO_USABLE_AUDIO_INPUT_CODE } from '../../src/recorder/devices';
import type {
  RecorderOutcomeEvent,
  RecorderWorkerErrorReply,
  RecorderWorkerMessage,
  StartReply,
} from '../../src/recorder/workerProtocol';
import {
  createRecorderWorkerServer,
  type PvRecorderConstructor,
  type PvRecorderInstance,
} from '../../src/recorder/workerServer';

class FakeRecorder implements PvRecorderInstance {
  readonly frameLength = 512;
  readonly sampleRate = 16_000;
  starts = 0;
  stops = 0;
  releases = 0;

  private waiter: ((frame: Int16Array) => void) | null = null;

  constructor(readonly deviceIndex: number, private readonly device: string) {}

  getSelectedDevice(): string { return this.device; }
  start(): void { this.starts += 1; }
  stop(): void {
    this.stops += 1;
    this.waiter?.(new Int16Array());
    this.waiter = null;
  }
  release(): void { this.releases += 1; }
  read(): Promise<Int16Array> {
    return new Promise((resolve) => { this.waiter = resolve; });
  }
  emit(...samples: number[]): void {
    const waiter = this.waiter;
    this.waiter = null;
    if (!waiter) throw new Error('No pending read');
    waiter(Int16Array.from(samples));
  }
}

function fakeRecorderModule(names: string[], defaultIndex = 0) {
  const instances: FakeRecorder[] = [];
  class FakePvRecorder extends FakeRecorder {
    constructor(_frameLength: number, deviceIndex = -1) {
      super(deviceIndex, names[deviceIndex < 0 ? defaultIndex : deviceIndex] ?? '');
      instances.push(this);
    }

    static getAvailableDevices(): string[] { return [...names]; }
  }
  const constructor: PvRecorderConstructor = FakePvRecorder;
  return { constructor, instances };
}

interface PostedMessage {
  message: RecorderWorkerMessage;
  /** Byte length of every transferred buffer after the post; 0 proves detachment. */
  transferred?: number[];
}

function serverHarness(
  loadRecorder: () => PvRecorderConstructor,
  platform: NodeJS.Platform = 'linux',
) {
  const posted: PostedMessage[] = [];
  const server = createRecorderWorkerServer({
    loadRecorder,
    // Mirror worker_threads: a transferred buffer is detached from the sender.
    post: (message, transfer) => {
      if (!transfer || transfer.length === 0) {
        posted.push({ message });
        return;
      }
      const sources = [...transfer];
      const delivered = structuredClone(message, { transfer: sources });
      posted.push({ message: delivered, transferred: sources.map((buffer) => buffer.byteLength) });
    },
    platform,
  });
  const find = <T extends RecorderWorkerMessage>(
    predicate: (message: RecorderWorkerMessage) => boolean,
  ): T => {
    const entry = posted.find((item) => predicate(item.message));
    if (!entry) throw new Error(`No matching message in ${JSON.stringify(posted)}`);
    return entry.message as T;
  };
  return { server, posted, find };
}

const startRequest = {
  op: 'start' as const,
  id: 1,
  sessionId: 'capture-1',
  deviceId: '',
  frameLength: 512,
  bufferedFrames: 100,
  maxDurationMs: 5_000,
};

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test('enumerate answers with the native device order', () => {
  const module = fakeRecorderModule(['Mic A', 'Mic A', 'Mic B.monitor']);
  const { server, posted } = serverHarness(() => module.constructor);

  server.handle({ op: 'enumerate', id: 7 });

  assert.deepEqual(posted[0].message, {
    id: 7,
    ok: true,
    op: 'enumerate',
    names: ['Mic A', 'Mic A', 'Mic B.monitor'],
  });
});

test('a missing native addon fails only the requested call', () => {
  const { server, posted } = serverHarness(() => {
    throw new Error("Voice Input's bundled audio recorder could not be loaded on this system.");
  });

  server.handle({ op: 'enumerate', id: 3 });

  const reply = posted[0].message as RecorderWorkerErrorReply;
  assert.equal(reply.ok, false);
  assert.equal(reply.op, 'enumerate');
  assert.match(reply.error.message, /bundled audio recorder could not be loaded/);
});

test('a capture streams transferable frames and drains on stop', async () => {
  const module = fakeRecorderModule(['Mic A']);
  const { server, posted, find } = serverHarness(() => module.constructor, 'darwin');

  server.handle(startRequest);
  const started = find<StartReply>((message) => 'op' in message && message.op === 'start');
  assert.deepEqual(started, {
    id: 1,
    ok: true,
    op: 'start',
    sessionId: 'capture-1',
    sampleRate: 16_000,
    selectedDevice: 'Mic A',
  });
  assert.equal(module.instances.length, 1);
  assert.equal(module.instances[0].starts, 1);

  module.instances[0].emit(1, 2, 3);
  await tick();
  const frame = posted.find((item) => 'ev' in item.message && item.message.ev === 'frame');
  assert.ok(frame, 'the capture must post a frame');
  if (!('ev' in frame.message) || frame.message.ev !== 'frame') throw new Error('unreachable');
  assert.deepEqual([...new Int16Array(frame.message.buffer)], [1, 2, 3]);
  assert.deepEqual(frame.transferred, [0], 'the frame buffer must move without a copy');

  server.handle({ op: 'stop', id: 2, sessionId: 'capture-1' });
  await tick();

  const outcome = find<RecorderOutcomeEvent>((message) => 'ev' in message && message.ev === 'outcome');
  assert.deepEqual(outcome, {
    ev: 'outcome',
    sessionId: 'capture-1',
    reason: 'stopped',
    sampleRate: 16_000,
    samplesCaptured: 3,
    selectedDevice: 'Mic A',
  });
  assert.deepEqual(posted[posted.length - 1].message, {
    id: 2,
    ok: true,
    op: 'stop',
    sessionId: 'capture-1',
    samplesCaptured: 3,
  });
  assert.equal(module.instances[0].stops, 1);
  assert.equal(module.instances[0].releases, 1);
});

test('a Linux loopback default is replaced by the first real input', async () => {
  const module = fakeRecorderModule(['Monitor of Speakers', 'Mic A']);
  const { server, find } = serverHarness(() => module.constructor, 'linux');

  server.handle(startRequest);

  const started = find<StartReply>((message) => 'op' in message && message.op === 'start');
  assert.equal(started.selectedDevice, 'Mic A');
  assert.equal(module.instances.length, 2);
  assert.equal(module.instances[0].deviceIndex, -1);
  assert.equal(module.instances[0].releases, 1, 'the loopback recorder must be released');
  assert.equal(module.instances[1].deviceIndex, 1);
  assert.equal(module.instances[1].starts, 1);

  server.handle({ op: 'stop', id: 2, sessionId: 'capture-1' });
  await tick();
  assert.equal(module.instances[1].releases, 1);
});

test('a Linux system with only loopback sources fails with the typed code', () => {
  const module = fakeRecorderModule(['Monitor of Speakers', 'Other.monitor']);
  const { server, posted } = serverHarness(() => module.constructor, 'linux');

  server.handle(startRequest);

  const reply = posted[0].message as RecorderWorkerErrorReply;
  assert.equal(reply.ok, false);
  assert.equal(reply.error.code, NO_USABLE_AUDIO_INPUT_CODE);
  assert.equal(module.instances.length, 1);
  assert.equal(module.instances[0].releases, 1);
  assert.equal(module.instances[0].starts, 0);
});

test('a saved device id selects the matching duplicate occurrence', async () => {
  const module = fakeRecorderModule(['Mic A', 'Mic A', 'Mic B']);
  const { server, find } = serverHarness(() => module.constructor, 'linux');
  const devices = audioDevicesFromNames(['Mic A', 'Mic A', 'Mic B']);

  server.handle({ ...startRequest, deviceId: devices[1].id });

  const started = find<StartReply>((message) => 'op' in message && message.op === 'start');
  assert.equal(started.selectedDevice, 'Mic A');
  assert.equal(module.instances.length, 1, 'an explicit device never takes the loopback fallback');
  assert.equal(module.instances[0].deviceIndex, 1);

  server.handle({ op: 'stop', id: 2, sessionId: 'capture-1' });
  await tick();
});

test('an unavailable saved device fails the start without opening a recorder', () => {
  const module = fakeRecorderModule(['Mic A']);
  const { server, posted } = serverHarness(() => module.constructor, 'linux');
  const [missing] = audioDevicesFromNames(['Mic Gone']);

  server.handle({ ...startRequest, deviceId: missing.id });

  const reply = posted[0].message as RecorderWorkerErrorReply;
  assert.equal(reply.ok, false);
  assert.match(reply.error.message, /Selected audio device is unavailable: Mic Gone/);
  assert.equal(module.instances.length, 0);
});

test('cancel drains the capture and reports the cancelled outcome', async () => {
  const module = fakeRecorderModule(['Mic A']);
  const { server, posted, find } = serverHarness(() => module.constructor, 'win32');

  server.handle(startRequest);
  server.handle({ op: 'cancel', id: 4, sessionId: 'capture-1' });
  await tick();

  const outcome = find<RecorderOutcomeEvent>((message) => 'ev' in message && message.ev === 'outcome');
  assert.equal(outcome.reason, 'cancelled');
  assert.deepEqual(posted[posted.length - 1].message, {
    id: 4,
    ok: true,
    op: 'cancel',
    sessionId: 'capture-1',
    samplesCaptured: 0,
  });
  assert.equal(module.instances[0].stops, 1);
  assert.equal(module.instances[0].releases, 1);

  // A late stop for the same session stays answerable and idempotent.
  server.handle({ op: 'stop', id: 5, sessionId: 'capture-1' });
  await tick();
  assert.deepEqual(posted[posted.length - 1].message, {
    id: 5,
    ok: true,
    op: 'stop',
    sessionId: 'capture-1',
    samplesCaptured: 0,
  });
  assert.equal(module.instances[0].releases, 1);
});

test('a read failure surfaces as an error outcome and a failed stop reply', async () => {
  const module = fakeRecorderModule(['Mic A']);
  const { server, posted, find } = serverHarness(() => module.constructor, 'darwin');
  server.handle(startRequest);

  const recorder = module.instances[0];
  const failing = new Error('microphone unplugged');
  recorder.read = () => Promise.reject(failing);
  recorder.emit(1, 2);
  await tick();
  await tick();

  const outcome = find<RecorderOutcomeEvent>((message) => 'ev' in message && message.ev === 'outcome');
  assert.equal(outcome.reason, 'error');
  assert.equal(outcome.error?.message, 'microphone unplugged');

  server.handle({ op: 'stop', id: 6, sessionId: 'capture-1' });
  await tick();
  const reply = posted[posted.length - 1].message as RecorderWorkerErrorReply;
  assert.equal(reply.ok, false);
  assert.equal(reply.error.message, 'microphone unplugged');
});

test('concurrent sessions stay isolated by session id', async () => {
  const module = fakeRecorderModule(['Mic A', 'Mic B']);
  const { server, posted } = serverHarness(() => module.constructor, 'darwin');

  server.handle(startRequest);
  server.handle({ ...startRequest, id: 10, sessionId: 'capture-2' });
  module.instances[0].emit(1, 1);
  module.instances[1].emit(2, 2, 2);
  await tick();

  const frames = posted
    .map((item) => item.message)
    .filter((message): message is Extract<RecorderWorkerMessage, { ev: 'frame' }> =>
      'ev' in message && message.ev === 'frame');
  assert.deepEqual(
    frames.map((frame) => [frame.sessionId, [...new Int16Array(frame.buffer)]]),
    [['capture-1', [1, 1]], ['capture-2', [2, 2, 2]]],
  );

  server.handle({ op: 'stop', id: 11, sessionId: 'capture-2' });
  await tick();
  assert.deepEqual(posted[posted.length - 1].message, {
    id: 11,
    ok: true,
    op: 'stop',
    sessionId: 'capture-2',
    samplesCaptured: 3,
  });
  assert.equal(module.instances[0].releases, 0, 'the first session must keep recording');
  assert.equal(module.instances[1].releases, 1);

  server.handle({ op: 'stop', id: 12, sessionId: 'capture-1' });
  await tick();
  assert.equal(module.instances[0].releases, 1);
});

test('a duplicate session id is rejected instead of replacing the capture', async () => {
  const module = fakeRecorderModule(['Mic A']);
  const { server, posted } = serverHarness(() => module.constructor, 'darwin');

  server.handle(startRequest);
  server.handle(startRequest);

  const reply = posted[posted.length - 1].message as RecorderWorkerErrorReply;
  assert.equal(reply.ok, false);
  assert.match(reply.error.message, /Duplicate capture session: capture-1/);
  assert.equal(module.instances.length, 1);

  server.handle({ op: 'stop', id: 2, sessionId: 'capture-1' });
  await tick();
  assert.equal(module.instances[0].releases, 1);
});
