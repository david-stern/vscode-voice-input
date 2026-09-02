import assert from 'node:assert/strict';
import test from 'node:test';

import { SpeechProviderError, type StreamingTranscriptEvent } from '../src/speech/contracts';
import { SonioxRealtimeClient } from '../src/speech/soniox/realtimeClient';
import {
  SONIOX_REALTIME_ENDPOINT,
  type SonioxWebSocketTransport,
} from '../src/speech/soniox/transport';

class FakeWebSocket implements SonioxWebSocketTransport {
  readyState = 0;
  readonly sent: Array<string | Uint8Array> = [];
  readonly closes: Array<{ code?: number; reason?: string }> = [];
  private readonly listeners = new Map<string, Set<(event: never) => void>>();

  send(data: string | ArrayBuffer | ArrayBufferView): void {
    if (typeof data === 'string') this.sent.push(data);
    else if (data instanceof ArrayBuffer) this.sent.push(new Uint8Array(data.slice(0)));
    else this.sent.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice());
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.closes.push({ code, reason });
  }

  addEventListener(type: string, listener: (event: never) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: never) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  open(): void {
    this.readyState = 1;
    this.emit('open', { type: 'open' });
  }

  message(value: unknown): void {
    this.emit('message', { type: 'message', data: value });
  }

  serverClose(): void {
    this.readyState = 3;
    this.emit('close', { type: 'close', code: 1006, wasClean: false });
  }

  private emit(type: string, event: unknown): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event as never);
  }
}

function clientFor(
  socket: FakeWebSocket,
  events: StreamingTranscriptEvent[] = [],
  overrides: Partial<ConstructorParameters<typeof SonioxRealtimeClient>[0]> = {},
): SonioxRealtimeClient {
  return new SonioxRealtimeClient({
    apiKey: 'private-key',
    model: 'stt-rt-v5',
    sampleRateHz: 16_000,
    channels: 1,
    languageHint: 'he',
    onTranscript: (event) => events.push(event),
    transportFactory: (endpoint) => {
      assert.equal(endpoint, SONIOX_REALTIME_ENDPOINT);
      return socket;
    },
    ...overrides,
  });
}

test('streams binary PCM, displays partials, dispatches only final-on-fin, and finishes by handshake', async () => {
  const socket = new FakeWebSocket();
  const events: StreamingTranscriptEvent[] = [];
  const client = clientFor(socket, events);

  const starting = client.start();
  assert.equal(client.state, 'connecting');
  socket.open();
  await starting;

  const configuration = JSON.parse(socket.sent[0] as string) as Record<string, unknown>;
  assert.deepEqual(configuration, {
    api_key: 'private-key',
    model: 'stt-rt-v5',
    audio_format: 'pcm_s16le',
    sample_rate: 16_000,
    num_channels: 1,
    enable_endpoint_detection: false,
    language_hints: ['he'],
  });

  client.sendPcm16(new Int16Array([0x1234, -2]));
  assert.deepEqual([...socket.sent[1] as Uint8Array], [0x34, 0x12, 0xfe, 0xff]);
  assert.equal(client.reconnectAllowed, false);

  socket.message(JSON.stringify({
    tokens: [{ text: 'Hel', is_final: false }],
    final_audio_proc_ms: 0,
    total_audio_proc_ms: 20,
  }));
  assert.deepEqual(events, [{ kind: 'partial', text: 'Hel' }]);

  socket.message(JSON.stringify({ tokens: [{ text: 'Hello', is_final: true }] }));
  assert.deepEqual(events, [
    { kind: 'partial', text: 'Hel' },
    { kind: 'partial', text: 'Hello' },
  ]);

  const finalizing = client.finalize({ trailingSilenceMs: 0 });
  assert.equal(client.state, 'finalizing');
  assert.deepEqual(JSON.parse(socket.sent.at(-1) as string), { type: 'finalize' });
  socket.message(JSON.stringify({ tokens: [{ text: '<fin>', is_final: true }] }));
  assert.equal(await finalizing, 'Hello');
  assert.deepEqual(events.at(-1), { kind: 'final', text: 'Hello' });
  assert.equal(client.state, 'streaming');

  client.markDispatched();
  assert.equal(client.reconnectAllowed, false);
  const finishing = client.finish();
  assert.deepEqual(socket.sent.at(-1), new Uint8Array(0));
  socket.message(JSON.stringify({ tokens: [], finished: true }));
  await finishing;
  assert.equal(client.state, 'closed');
  assert.deepEqual(socket.closes, [{ code: 1000, reason: 'finished' }]);
});

test('manual finalization sends bounded trailing PCM silence before the control frame', async () => {
  const socket = new FakeWebSocket();
  const client = clientFor(socket);
  const starting = client.start();
  socket.open();
  await starting;

  const finalizing = client.finalize();
  const silence = socket.sent[1];
  assert.ok(silence instanceof Uint8Array);
  assert.equal(silence.byteLength, 6_400);
  assert.equal(silence.every((byte) => byte === 0), true);
  assert.deepEqual(JSON.parse(socket.sent[2] as string), { type: 'finalize' });
  socket.message(JSON.stringify({ tokens: [{ text: '<fin>', is_final: true }] }));
  assert.equal(await finalizing, '');
  client.cancel();
});

test('cancel is idempotent and suppresses all late transport events', async () => {
  const socket = new FakeWebSocket();
  const events: StreamingTranscriptEvent[] = [];
  const failures: string[] = [];
  const client = clientFor(socket, events, {
    onFailure: ({ category }) => failures.push(category),
  });
  const starting = client.start();
  socket.open();
  await starting;
  socket.message(JSON.stringify({ tokens: [{ text: 'visible', is_final: false }] }));

  client.cancel();
  client.cancel();
  socket.message(JSON.stringify({
    tokens: [{ text: 'private late text', is_final: true }, { text: '<fin>', is_final: true }],
  }));
  socket.serverClose();

  assert.equal(client.state, 'closed');
  assert.deepEqual(events, [{ kind: 'partial', text: 'visible' }]);
  assert.deepEqual(failures, []);
  assert.deepEqual(socket.closes, [{ code: 1000, reason: 'cancelled' }]);
});

test('provider failures are fixed, content-free, and never expose response fields', async () => {
  const socket = new FakeWebSocket();
  const malicious = 'private-key /home/david/private provider-response';
  const failures: unknown[] = [];
  const client = clientFor(socket, [], {
    onFailure: (failure) => failures.push(failure),
  });
  const starting = client.start();
  socket.open();
  await starting;

  socket.message(JSON.stringify({
    tokens: [],
    error_code: 503,
    error_type: 'service_unavailable',
    error_message: malicious,
    request_id: malicious,
  }));

  assert.equal(client.state, 'failed');
  assert.deepEqual(failures, [{ category: 'provider-rejected' }]);
  assert.doesNotMatch(JSON.stringify({ failures, closes: socket.closes }), new RegExp(malicious, 'u'));
  assert.deepEqual(socket.closes, [{ code: 1008, reason: 'provider-failure' }]);
});

test('audio buffers, frames, token arrays, and connection time are bounded', async (context) => {
  await context.test('odd and oversized frames are rejected before transport', async () => {
    const socket = new FakeWebSocket();
    const client = clientFor(socket);
    const starting = client.start();
    socket.open();
    await starting;
    assert.throws(() => client.sendPcm16(new Uint8Array(3)), hasCategory('invalid-audio'));
    assert.throws(() => client.sendPcm16(new Uint8Array(64 * 1_024 + 2)), hasCategory('invalid-audio'));
    client.cancel();
  });

  await context.test('pre-open audio cannot exceed the bounded queue', async () => {
    const socket = new FakeWebSocket();
    const client = clientFor(socket);
    const starting = client.start();
    const rejected = assert.rejects(starting, hasCategory('bounds-exceeded'));
    for (let index = 0; index < 8; index += 1) {
      client.sendPcm16(new Uint8Array(64 * 1_024));
    }
    assert.throws(
      () => client.sendPcm16(new Uint8Array(2)),
      hasCategory('bounds-exceeded'),
    );
    await rejected;
    assert.equal(client.state, 'failed');
  });

  await context.test('oversized token arrays fail without projecting token text', async () => {
    const socket = new FakeWebSocket();
    const failures: unknown[] = [];
    const client = clientFor(socket, [], { onFailure: (failure) => failures.push(failure) });
    const starting = client.start();
    socket.open();
    await starting;
    socket.message(JSON.stringify({
      tokens: Array.from({ length: 513 }, () => ({ text: 'x', is_final: false })),
    }));
    assert.equal(client.state, 'failed');
    assert.deepEqual(failures, [{ category: 'malformed-response' }]);
  });

  await context.test('a response before the open/configuration boundary is rejected', async () => {
    const socket = new FakeWebSocket();
    const failures: unknown[] = [];
    const client = clientFor(socket, [], { onFailure: (failure) => failures.push(failure) });
    const starting = client.start();
    const rejected = assert.rejects(starting, hasCategory('malformed-response'));
    socket.message(JSON.stringify({ tokens: [{ text: 'too early', is_final: false }] }));
    await rejected;
    assert.deepEqual(failures, [{ category: 'malformed-response' }]);
  });

  await context.test('connection timeout is bounded and sanitized', async () => {
    const socket = new FakeWebSocket();
    const client = clientFor(socket, [], { connectTimeoutMs: 5, sessionTimeoutMs: 50 });
    await assert.rejects(client.start(), hasCategory('timed-out'));
    assert.equal(client.state, 'failed');
  });
});

function hasCategory(category: SpeechProviderError['category']): (error: unknown) => boolean {
  return (error: unknown) => {
    assert.ok(error instanceof SpeechProviderError);
    assert.equal(error.category, category);
    assert.equal(error.message, 'Speech transcription failed safely.');
    return true;
  };
}
