import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NO_SPEECH_CAPABILITIES,
  SONIOX_SPEECH_CAPABILITIES,
  type StreamingTranscriptionOptions,
  type TranscriptionProviderSelection,
} from '../src/speech/contracts';
import {
  SpeechProviderRegistry,
  type SonioxConnectionAuthority,
} from '../src/speech/providerRegistry';
import type { SonioxWebSocketTransport } from '../src/speech/soniox/transport';

class OpeningSocket implements SonioxWebSocketTransport {
  readyState = 0;
  readonly sent: unknown[] = [];
  readonly closes: Array<{ code?: number; reason?: string }> = [];
  private readonly listeners = new Map<string, Set<(event: never) => void>>();

  send(data: string | ArrayBuffer | ArrayBufferView): void { this.sent.push(data); }
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
    for (const listener of [...(this.listeners.get('open') ?? [])]) {
      listener({ type: 'open' } as never);
    }
  }
}

const STREAMING_OPTIONS: StreamingTranscriptionOptions = {
  sampleRateHz: 16_000,
  channels: 1,
  languageHint: 'he',
  onTranscript: () => {},
};

test('registry exposes only none and Soniox; none and legacy-pending perform zero authority, secret, or network work', async () => {
  assert.deepEqual(SpeechProviderRegistry.providerIds, ['none', 'soniox']);
  let selection: TranscriptionProviderSelection = 'none';
  let authorityChecks = 0;
  let secretReads = 0;
  let transports = 0;
  const registry = new SpeechProviderRegistry({
    selection: { read: () => selection },
    authority: {
      capture: () => { authorityChecks += 1; return Object.freeze({}); },
      revalidate: () => { authorityChecks += 1; return true; },
    },
    credentials: {
      use: async () => { secretReads += 1; return undefined; },
    },
    configuration: () => ({ model: 'stt-rt-v4', languageHint: 'he' }),
    transportFactory: () => { transports += 1; return new OpeningSocket(); },
  });

  assert.equal(registry.selectedProvider, 'none');
  assert.deepEqual(registry.capabilities, NO_SPEECH_CAPABILITIES);
  assert.deepEqual(await registry.openStreaming(STREAMING_OPTIONS), {
    status: 'not-configured',
    capabilities: NO_SPEECH_CAPABILITIES,
  });

  selection = 'legacy-soniox-pending';
  assert.equal(registry.selectedProvider, 'none');
  assert.deepEqual(await registry.openStreaming(STREAMING_OPTIONS), {
    status: 'legacy-pending',
    capabilities: NO_SPEECH_CAPABILITIES,
  });
  assert.deepEqual({ authorityChecks, secretReads, transports }, {
    authorityChecks: 0,
    secretReads: 0,
    transports: 0,
  });
});

test('registry checks selection and host authority before SecretStorage, then revalidates before transport', async () => {
  const calls: string[] = [];
  const authority: SonioxConnectionAuthority = Object.freeze({ generation: 7 });
  const socket = new OpeningSocket();
  const registry = new SpeechProviderRegistry({
    selection: { read: () => { calls.push('selection'); return 'soniox'; } },
    authority: {
      capture: () => { calls.push('authority-capture'); return authority; },
      revalidate: (candidate) => {
        assert.equal(candidate, authority);
        calls.push('authority-revalidate');
        return true;
      },
    },
    credentials: {
      use: async <T>(_provider: 'soniox' | 'deepseek', operation: (key: string) => Promise<T>) => {
        calls.push('secret-lookup');
        return operation('private-key');
      },
    },
    configuration: () => ({ model: 'stt-rt-v4', languageHint: 'he' }),
    transportFactory: () => {
      calls.push('transport');
      queueMicrotask(() => socket.open());
      return socket;
    },
  });

  const result = await registry.openStreaming(STREAMING_OPTIONS);
  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') return;
  assert.deepEqual(result.capabilities, SONIOX_SPEECH_CAPABILITIES);
  assert.deepEqual(calls, [
    'selection',
    'authority-capture',
    'authority-revalidate',
    'secret-lookup',
    'selection',
    'authority-revalidate',
    'transport',
    'selection',
    'authority-revalidate',
  ]);
  const configuration = JSON.parse(socket.sent[0] as string) as Record<string, unknown>;
  assert.equal(configuration.model, 'stt-rt-v5');
  assert.equal(configuration.api_key, 'private-key');

  registry.invalidate();
  assert.equal(result.value.state, 'closed');
  assert.deepEqual(socket.closes, [{ code: 1000, reason: 'cancelled' }]);
});

test('missing native consent, a missing secret, and stale authority all stop before transport creation', async (context) => {
  await context.test('missing consent does not read the secret', async () => {
    let secretReads = 0;
    let transports = 0;
    const registry = registryForGate({
      capture: undefined,
      use: async () => { secretReads += 1; return undefined; },
      transport: () => { transports += 1; return new OpeningSocket(); },
    });
    assert.deepEqual(await registry.openStreaming(STREAMING_OPTIONS), {
      status: 'consent-required', capabilities: NO_SPEECH_CAPABILITIES,
    });
    assert.deepEqual({ secretReads, transports }, { secretReads: 0, transports: 0 });
  });

  await context.test('missing secret never creates a transport', async () => {
    let transports = 0;
    const registry = registryForGate({
      capture: Object.freeze({}),
      use: async () => undefined,
      transport: () => { transports += 1; return new OpeningSocket(); },
    });
    assert.deepEqual(await registry.openStreaming(STREAMING_OPTIONS), {
      status: 'missing-credential', capabilities: NO_SPEECH_CAPABILITIES,
    });
    assert.equal(transports, 0);
  });

  await context.test('authority changed during secret lookup never creates a transport', async () => {
    let validations = 0;
    let transports = 0;
    const registry = registryForGate({
      capture: Object.freeze({}),
      revalidate: () => { validations += 1; return validations === 1; },
      use: async <T>(operation: (key: string) => Promise<T>) => operation('private-key'),
      transport: () => { transports += 1; return new OpeningSocket(); },
    });
    assert.deepEqual(await registry.openStreaming(STREAMING_OPTIONS), {
      status: 'authority-changed', capabilities: NO_SPEECH_CAPABILITIES,
    });
    assert.equal(transports, 0);
  });
});

test('credential removal during lookup wins and cannot race into a connection', async () => {
  const lookupStarted = deferred<void>();
  const releaseLookup = deferred<void>();
  let transports = 0;
  const registry = registryForGate({
    capture: Object.freeze({}),
    use: async () => {
      lookupStarted.resolve(undefined);
      await releaseLookup.promise;
      return undefined;
    },
    transport: () => { transports += 1; return new OpeningSocket(); },
  });

  const pending = registry.openStreaming(STREAMING_OPTIONS);
  await lookupStarted.promise;
  registry.invalidate();
  releaseLookup.resolve(undefined);

  assert.deepEqual(await pending, {
    status: 'missing-credential', capabilities: NO_SPEECH_CAPABILITIES,
  });
  assert.equal(transports, 0);
});

test('credential invalidation synchronously cancels an already-open Soniox session', async () => {
  let invalidateCredential: ((event: { provider: 'soniox'; revision: number }) => void) | undefined;
  const socket = new OpeningSocket();
  const registry = new SpeechProviderRegistry({
    selection: { read: () => 'soniox' },
    authority: { capture: () => Object.freeze({}), revalidate: () => true },
    credentials: {
      use: async <T>(_provider: 'soniox' | 'deepseek', operation: (key: string) => Promise<T>) =>
        operation('private-key'),
      onDidInvalidate: (listener) => {
        invalidateCredential = listener as typeof invalidateCredential;
        return { dispose: () => { invalidateCredential = undefined; } };
      },
    },
    configuration: () => ({ model: 'stt-rt-v5' }),
    transportFactory: () => {
      queueMicrotask(() => socket.open());
      return socket;
    },
  });
  const result = await registry.openStreaming(STREAMING_OPTIONS);
  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') return;

  invalidateCredential?.({ provider: 'soniox', revision: 1 });

  assert.equal(result.value.state, 'closed');
  assert.deepEqual(socket.closes, [{ code: 1000, reason: 'cancelled' }]);
  registry.dispose();
});

test('the retained final-WAV adapter resolves v4 persistence to the active async v5 allowlist', async () => {
  const seen: Array<Record<string, unknown>> = [];
  const registry = new SpeechProviderRegistry({
    selection: { read: () => 'soniox' },
    authority: { capture: () => Object.freeze({}), revalidate: () => true },
    credentials: {
      use: async <T>(_provider: 'soniox' | 'deepseek', operation: (key: string) => Promise<T>) =>
        operation('private-key'),
    },
    configuration: () => ({ model: 'stt-async-v4', languageHint: 'he' }),
    transcribeFinal: async (options) => {
      seen.push({ model: options.model, languageHint: options.languageHint, mime: options.mime });
      return 'שלום';
    },
  });

  const result = await registry.transcribeFinal({
    audio: new Uint8Array([1, 2]),
    mime: 'audio/wav',
  });
  assert.deepEqual(result, {
    status: 'ready', capabilities: SONIOX_SPEECH_CAPABILITIES, value: 'שלום',
  });
  assert.deepEqual(seen, [{ model: 'stt-async-v5', languageHint: 'he', mime: 'audio/wav' }]);
});

test('credential invalidation synchronously aborts an active final-WAV Soniox request', async () => {
  let invalidateCredential: ((event: { provider: 'soniox'; revision: number }) => void) | undefined;
  const started = deferred<void>();
  let requestSignal: AbortSignal | undefined;
  const registry = new SpeechProviderRegistry({
    selection: { read: () => 'soniox' },
    authority: { capture: () => Object.freeze({}), revalidate: () => true },
    credentials: {
      use: async <T>(_provider: 'soniox' | 'deepseek', operation: (key: string) => Promise<T>) =>
        operation('private-key'),
      onDidInvalidate: (listener) => {
        invalidateCredential = listener as typeof invalidateCredential;
        return { dispose: () => { invalidateCredential = undefined; } };
      },
    },
    configuration: () => ({ model: 'stt-async-v5' }),
    transcribeFinal: async (options) => {
      requestSignal = options.signal;
      started.resolve(undefined);
      await new Promise<void>((_resolve, reject) => {
        options.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
      });
      return 'must-not-complete';
    },
  });

  const pending = registry.transcribeFinal({
    audio: new Uint8Array([1, 2]),
    mime: 'audio/wav',
  });
  await started.promise;
  invalidateCredential?.({ provider: 'soniox', revision: 1 });

  assert.equal(requestSignal?.aborted, true);
  await assert.rejects(
    pending,
    (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
  );
  registry.dispose();
});

function registryForGate(options: {
  capture: SonioxConnectionAuthority | undefined;
  revalidate?: () => boolean;
  use: (<T>(operation: (key: string) => Promise<T>) => Promise<T | undefined>);
  transport(): SonioxWebSocketTransport;
}): SpeechProviderRegistry {
  return new SpeechProviderRegistry({
    selection: { read: () => 'soniox' },
    authority: {
      capture: () => options.capture,
      revalidate: () => options.revalidate?.() ?? true,
    },
    credentials: {
      use: <T>(_provider: 'soniox' | 'deepseek', operation: (key: string) => Promise<T>) =>
        options.use(operation),
    },
    configuration: () => ({ model: 'stt-rt-v4', languageHint: 'he' }),
    transportFactory: options.transport,
  });
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
