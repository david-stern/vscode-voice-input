import assert from 'node:assert/strict';
import test from 'node:test';

import { isNoUsableAudioInputError, NO_USABLE_AUDIO_INPUT_CODE } from '../../src/recorder/devices';
import {
  RecorderWorkerClient,
  type RecorderWorkerPort,
  type StartStreamRequest,
} from '../../src/recorder/workerClient';
import type {
  RecorderWorkerMessage,
  RecorderWorkerRequest,
  StartRequest,
} from '../../src/recorder/workerProtocol';

class FakeWorkerPort implements RecorderWorkerPort {
  readonly requests: RecorderWorkerRequest[] = [];
  terminations = 0;
  refs = 0;
  unrefs = 0;

  private readonly messageListeners: ((message: RecorderWorkerMessage) => void)[] = [];
  private readonly errorListeners: ((error: Error) => void)[] = [];
  private readonly exitListeners: ((code: number) => void)[] = [];

  postMessage(message: RecorderWorkerRequest): void {
    this.requests.push(message);
  }

  on(event: 'message', listener: (message: RecorderWorkerMessage) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  on(event: 'message' | 'error' | 'exit', listener: unknown): unknown {
    if (event === 'message') {
      this.messageListeners.push(listener as (message: RecorderWorkerMessage) => void);
    } else if (event === 'error') {
      this.errorListeners.push(listener as (error: Error) => void);
    } else {
      this.exitListeners.push(listener as (code: number) => void);
    }
    return this;
  }

  terminate(): void {
    this.terminations += 1;
  }

  ref(): void { this.refs += 1; }
  unref(): void { this.unrefs += 1; }

  emit(message: RecorderWorkerMessage): void {
    for (const listener of [...this.messageListeners]) listener(message);
  }

  emitError(error: Error): void {
    for (const listener of [...this.errorListeners]) listener(error);
  }

  emitExit(code: number): void {
    for (const listener of [...this.exitListeners]) listener(code);
  }

  request(op: RecorderWorkerRequest['op']): RecorderWorkerRequest {
    const found = [...this.requests].reverse().find((request) => request.op === op);
    if (!found) throw new Error(`No ${op} request was posted`);
    return found;
  }
}

function harness(timeouts?: { enumerateMs?: number; startMs?: number; drainMs?: number }) {
  const ports: FakeWorkerPort[] = [];
  const client = new RecorderWorkerClient({
    createWorker: () => {
      const port = new FakeWorkerPort();
      ports.push(port);
      return port;
    },
    ...(timeouts ? { timeouts } : {}),
  });
  return { client, ports };
}

function streamRequest(overrides: Partial<StartStreamRequest> = {}): StartStreamRequest {
  return {
    deviceId: '',
    frameLength: 512,
    bufferedFrames: 100,
    maxDurationMs: 1_000,
    onFrame: () => {},
    ...overrides,
  };
}

function frameEvent(sessionId: string, samples: number[]): RecorderWorkerMessage {
  const buffer = new ArrayBuffer(samples.length * 2);
  new Int16Array(buffer).set(samples);
  return { ev: 'frame', sessionId, buffer };
}

async function startStream(
  client: RecorderWorkerClient,
  ports: FakeWorkerPort[],
  request: StartStreamRequest,
  device = 'Mic A',
) {
  const pending = client.start(request);
  const port = ports[ports.length - 1];
  const started = port.request('start') as StartRequest;
  port.emit({
    id: started.id,
    ok: true,
    op: 'start',
    sessionId: started.sessionId,
    sampleRate: 16_000,
    selectedDevice: device,
  });
  return { stream: await pending, sessionId: started.sessionId };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test('enumerate resolves with the raw worker device names', async () => {
  const { client, ports } = harness();
  const pending = client.enumerate();
  const request = ports[0].request('enumerate');

  ports[0].emit({ id: request.id, ok: true, op: 'enumerate', names: ['Mic A', 'Mic B.monitor'] });

  assert.deepEqual(await pending, ['Mic A', 'Mic B.monitor']);
  assert.equal(ports.length, 1);
  assert.equal(ports[0].terminations, 0);
});

test('a stalled enumerate rejects, terminates the worker, and the next call respawns', async () => {
  const { client, ports } = harness({ enumerateMs: 20 });

  await assert.rejects(client.enumerate(), /timed out after 20 ms trying to enumerate audio devices/);
  assert.equal(ports[0].terminations, 1);

  const pending = client.enumerate();
  assert.equal(ports.length, 2, 'the dead worker must not be reused');
  const request = ports[1].request('enumerate');
  ports[1].emit({ id: request.id, ok: true, op: 'enumerate', names: ['Mic A'] });
  assert.deepEqual(await pending, ['Mic A']);
});

test('a start failure revives the typed no-usable-input error', async () => {
  const { client, ports } = harness();
  const pending = client.start(streamRequest());
  const request = ports[0].request('start');

  ports[0].emit({
    id: request.id,
    ok: false,
    op: 'start',
    error: {
      name: 'NoUsableAudioInputError',
      message: 'No usable microphone input is available.',
      code: NO_USABLE_AUDIO_INPUT_CODE,
    },
  });

  await assert.rejects(pending, (error: unknown) => isNoUsableAudioInputError(error));
});

test('frames arrive in capture order and stop settles the outcome', async () => {
  const { client, ports } = harness();
  const frames: number[][] = [];
  const { stream, sessionId } = await startStream(
    client,
    ports,
    streamRequest({ onFrame: (frame) => frames.push([...frame]) }),
  );

  assert.equal(stream.sampleRate, 16_000);
  assert.equal(stream.selectedDevice, 'Mic A');

  ports[0].emit(frameEvent(sessionId, [1, 2, 3]));
  ports[0].emit(frameEvent(sessionId, [4, 5]));
  assert.deepEqual(frames, [[1, 2, 3], [4, 5]]);
  assert.equal(stream.samplesCaptured, 5);

  const stopped = stream.stop();
  assert.equal(stopped, stream.stop(), 'stop must stay single-shot');
  const stopRequest = ports[0].request('stop');
  ports[0].emit({
    ev: 'outcome',
    sessionId,
    reason: 'stopped',
    sampleRate: 16_000,
    samplesCaptured: 5,
    selectedDevice: 'Mic A',
  });
  ports[0].emit({ id: stopRequest.id, ok: true, op: 'stop', sessionId, samplesCaptured: 5 });

  await stopped;
  assert.deepEqual(await stream.outcome, { reason: 'stopped' });
  assert.equal(stream.samplesCaptured, 5);
});

test('a failed capture reports the error outcome and rethrows it from stop', async () => {
  const { client, ports } = harness();
  const { stream, sessionId } = await startStream(client, ports, streamRequest());

  ports[0].emit({
    ev: 'outcome',
    sessionId,
    reason: 'error',
    error: { name: 'Error', message: 'microphone unplugged' },
    sampleRate: 16_000,
    samplesCaptured: 0,
    selectedDevice: 'Mic A',
  });

  const outcome = await stream.outcome;
  assert.equal(outcome.reason, 'error');
  assert.match(String((outcome as { error: Error }).error.message), /microphone unplugged/);

  const stopped = stream.stop();
  const stopRequest = ports[0].request('stop');
  ports[0].emit({
    id: stopRequest.id,
    ok: false,
    op: 'stop',
    error: { name: 'Error', message: 'microphone unplugged' },
  });
  await assert.rejects(stopped, /microphone unplugged/);
});

test('cancel reaches the worker and keeps the following stop quiet', async () => {
  const { client, ports } = harness();
  const { stream, sessionId } = await startStream(client, ports, streamRequest());

  stream.cancel();
  stream.cancel();
  const cancelRequests = ports[0].requests.filter((request) => request.op === 'cancel');
  assert.equal(cancelRequests.length, 1, 'cancel must stay single-shot');

  ports[0].emit({
    ev: 'outcome',
    sessionId,
    reason: 'cancelled',
    sampleRate: 16_000,
    samplesCaptured: 0,
    selectedDevice: 'Mic A',
  });
  ports[0].emit({
    id: cancelRequests[0].id,
    ok: true,
    op: 'cancel',
    sessionId,
    samplesCaptured: 0,
  });

  const stopped = stream.stop();
  const stopRequest = ports[0].request('stop');
  ports[0].emit({ id: stopRequest.id, ok: true, op: 'stop', sessionId, samplesCaptured: 0 });
  await stopped;
  assert.deepEqual(await stream.outcome, { reason: 'cancelled' });
});

test('a worker that exits mid-capture fails the stream instead of hanging', async () => {
  const { client, ports } = harness();
  const { stream } = await startStream(client, ports, streamRequest());
  const inFlightStop = stream.stop();

  ports[0].emitExit(1);

  const outcome = await stream.outcome;
  assert.equal(outcome.reason, 'error');
  assert.match(String((outcome as { error: Error }).error.message), /stopped unexpectedly/);
  await assert.rejects(inFlightStop, /stopped unexpectedly/);
  await assert.rejects(stream.stop(), /stopped unexpectedly/);

  const pending = client.enumerate();
  assert.equal(ports.length, 2, 'a dead worker must be replaced');
  const request = ports[1].request('enumerate');
  ports[1].emit({ id: request.id, ok: true, op: 'enumerate', names: [] });
  assert.deepEqual(await pending, []);
});

test('a worker that dies after a clean outcome still completes the recording', async () => {
  const { client, ports } = harness();
  const { stream, sessionId } = await startStream(client, ports, streamRequest());

  ports[0].emit(frameEvent(sessionId, [1, 2, 3]));
  ports[0].emit({
    ev: 'outcome',
    sessionId,
    reason: 'limit',
    sampleRate: 16_000,
    samplesCaptured: 3,
    selectedDevice: 'Mic A',
  });
  assert.deepEqual(await stream.outcome, { reason: 'limit' });

  ports[0].emitExit(0);
  await stream.stop();
  assert.equal(stream.samplesCaptured, 3, 'delivered frames survive a late worker failure');
});

test('a worker error event fails every in-flight call once', async () => {
  const { client, ports } = harness();
  const enumerating = client.enumerate();
  const starting = client.start(streamRequest());

  ports[0].emitError(new Error('worker crashed'));

  await assert.rejects(enumerating, /worker crashed/);
  await assert.rejects(starting, /worker crashed/);
  assert.equal(ports[0].terminations, 1);
});

test('a worker wedged after a successful start fails the capture at the session watchdog', async () => {
  const { client, ports } = harness({ drainMs: 20 });
  const { stream } = await startStream(client, ports, streamRequest({ maxDurationMs: 10 }));

  const outcome = await stream.outcome;
  assert.equal(outcome.reason, 'error');
  assert.match(
    String((outcome as { error: Error }).error.message),
    /did not finish a capture within 30 ms/,
  );
  assert.equal(ports[0].terminations, 1, 'the wedged worker must be dropped');
  await assert.rejects(stream.stop(), /did not finish a capture within 30 ms/);
});

test('a capture that delivers its outcome disarms the session watchdog', async () => {
  const { client, ports } = harness({ drainMs: 20 });
  const { stream, sessionId } = await startStream(client, ports, streamRequest({ maxDurationMs: 10 }));

  ports[0].emit({
    ev: 'outcome',
    sessionId,
    reason: 'limit',
    sampleRate: 16_000,
    samplesCaptured: 0,
    selectedDevice: 'Mic A',
  });
  assert.deepEqual(await stream.outcome, { reason: 'limit' });

  await new Promise<void>((resolve) => setTimeout(resolve, 60));
  assert.equal(ports[0].terminations, 0, 'a finished capture must not trip the watchdog');
});

test('the worker thread stays unreferenced while no call or capture is active', async () => {
  const { client, ports } = harness();
  const pending = client.enumerate();
  const request = ports[0].request('enumerate');
  ports[0].emit({ id: request.id, ok: true, op: 'enumerate', names: [] });
  await pending;
  await tick();

  assert.ok(ports[0].refs >= 1, 'an in-flight call must keep the worker referenced');
  assert.ok(ports[0].unrefs >= 1, 'an idle worker must not hold the host process open');
});
