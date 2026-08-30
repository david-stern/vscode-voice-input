import assert from 'node:assert/strict';
import test from 'node:test';
import { PcmSource, startPcmCapture } from '../../src/recorder/capture';

class FakeSource implements PcmSource {
  readonly sampleRate = 16_000;
  starts = 0;
  stops = 0;
  releases = 0;
  private waiter: ((frame: Int16Array) => void) | null = null;

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

class RejectingSource implements PcmSource {
  readonly sampleRate = 16_000;
  starts = 0;
  stops = 0;
  releases = 0;
  private rejectRead: ((error: Error) => void) | null = null;

  start(): void { this.starts += 1; }
  stop(): void { this.stops += 1; }
  release(): void { this.releases += 1; }
  read(): Promise<Int16Array> {
    return new Promise((_, reject) => { this.rejectRead = reject; });
  }
  fail(error: Error): void {
    const rejectRead = this.rejectRead;
    this.rejectRead = null;
    if (!rejectRead) throw new Error('No pending read');
    rejectRead(error);
  }
}

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

test('stop is idempotent and releases native resources exactly once', async () => {
  const source = new FakeSource();
  const frames: Int16Array[] = [];
  const capture = startPcmCapture(source, {
    maxSamples: 100,
    maxDurationMs: 5_000,
    onFrame: (frame) => frames.push(frame),
  });

  source.emit(1, 2, 3);
  await nextTurn();
  const firstStop = capture.stop();
  const secondStop = capture.stop();
  assert.equal(firstStop, secondStop);
  await Promise.all([firstStop, secondStop]);
  assert.deepEqual(await capture.outcome, { reason: 'stopped' });

  assert.equal(source.starts, 1);
  assert.equal(source.stops, 1);
  assert.equal(source.releases, 1);
  assert.deepEqual(Array.from(frames[0]), [1, 2, 3]);
});

test('cancel is idempotent and a later stop remains safe', async () => {
  const source = new FakeSource();
  const capture = startPcmCapture(source, {
    maxSamples: 100,
    maxDurationMs: 5_000,
    onFrame: () => {},
  });

  capture.cancel();
  capture.cancel();
  await capture.stop();
  assert.deepEqual(await capture.outcome, { reason: 'cancelled' });

  assert.equal(source.stops, 1);
  assert.equal(source.releases, 1);
});

test('read failure is observable immediately before stop and cleanup stays idempotent', async () => {
  const source = new RejectingSource();
  const capture = startPcmCapture(source, {
    maxSamples: 100,
    maxDurationMs: 5_000,
    onFrame: () => {},
  });
  const readError = new Error('microphone unplugged');
  let observedOutcome: Awaited<typeof capture.outcome> | undefined;
  void capture.outcome.then((outcome) => { observedOutcome = outcome; });

  source.fail(readError);
  await nextTurn();

  assert.deepEqual(observedOutcome, { reason: 'error', error: readError });
  assert.equal(source.stops, 1);
  await assert.rejects(capture.stop(), (error: unknown) => error === readError);
  await assert.rejects(capture.stop(), (error: unknown) => error === readError);
  assert.equal(source.stops, 1);
  assert.equal(source.releases, 1);
});

test('sample bound truncates the final frame and shuts down automatically', async () => {
  const source = new FakeSource();
  const frames: Int16Array[] = [];
  const capture = startPcmCapture(source, {
    maxSamples: 3,
    maxDurationMs: 5_000,
    onFrame: (frame) => frames.push(frame),
  });

  source.emit(10, 20, 30, 40, 50);
  await nextTurn();
  await capture.stop();

  assert.deepEqual(Array.from(frames[0]), [10, 20, 30]);
  assert.deepEqual(await capture.outcome, { reason: 'limit' });
  assert.equal(source.stops, 1);
  assert.equal(source.releases, 1);
});

test('duration bound stops an otherwise idle source', async () => {
  const source = new FakeSource();
  const capture = startPcmCapture(source, {
    maxSamples: 100,
    maxDurationMs: 5,
    onFrame: () => {},
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  await capture.stop();
  assert.equal(source.stops, 1);
  assert.equal(source.releases, 1);
});
