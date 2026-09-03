import assert from 'node:assert/strict';
import test from 'node:test';

import { SETTINGS_DEFAULTS } from '../src/config';
import { SonioxTtsCoordinator } from '../src/platform/sonioxTtsCoordinator';
import {
  SONIOX_TTS_ENDPOINT,
  SONIOX_TTS_MODELS_ENDPOINT,
  SonioxTtsService,
  boundedUtterance,
  fallbackVoices,
  isSonioxTtsVoice,
  parseVoiceRoster,
  sonioxSpeechSpeed,
  sonioxVoiceId,
  synthesisFailure,
  type SonioxPlaybackProcess,
  type SonioxPlaybackSpawn,
  type SonioxTtsFetch,
  type SonioxTtsResponse,
} from '../src/platform/sonioxTtsService';
import { HostSpeechDelivery } from '../src/platform/systemSpeechDelivery';

interface FakeChild extends SonioxPlaybackProcess {
  command: string;
  args: string[];
  kills: string[];
  written: number[];
  ended: boolean;
  emit(event: 'error' | 'exit', value?: unknown): void;
}

/**
 * The player is the only process this feature starts. A missing binary reports its error
 * asynchronously in production, so the fake reports it on listener registration: that is
 * strictly earlier than the service's own turn-of-the-loop check, which is what the
 * fallback to the second command depends on.
 */
function createSpawner(behaviour: { failing?: readonly string[]; throwing?: readonly string[] } = {}) {
  const children: FakeChild[] = [];
  const spawn: SonioxPlaybackSpawn = (command, args) => {
    if (behaviour.throwing?.includes(command)) throw new Error('spawn refused');
    const listeners = new Map<string, ((value: unknown) => void)[]>();
    const fails = behaviour.failing?.includes(command) ?? false;
    const child: FakeChild = {
      command,
      args: [...args],
      kills: [],
      written: [],
      ended: false,
      stdin: {
        write(chunk: Uint8Array) { child.written.push(...chunk); return true; },
        end() { child.ended = true; },
        on() { return child.stdin; },
      },
      on(event: string, listener: (value: never) => void) {
        listeners.set(event, [...(listeners.get(event) ?? []), listener as (value: unknown) => void]);
        if (event === 'error' && fails) queueMicrotask(() => child.emit('error', new Error('ENOENT')));
        return child;
      },
      kill(signal?: string) {
        child.kills.push(signal ?? 'SIGTERM');
        // A signalled player exits, exactly as the real one does.
        child.emit('exit', null);
        return true;
      },
      emit(event, value) { for (const listener of listeners.get(event) ?? []) listener(value); },
    };
    children.push(child);
    return child;
  };
  return { spawn, children };
}

function audioResponse(chunks: readonly number[][] = [[1, 2, 3]]): SonioxTtsResponse {
  return {
    ok: true,
    status: 200,
    json: async () => ({}),
    body: (async function* stream() {
      for (const chunk of chunks) yield Uint8Array.from(chunk);
    })(),
  };
}

function errorResponse(status: number): SonioxTtsResponse {
  return {
    ok: false,
    status,
    json: async () => ({ error_code: status, error_type: 'test', error_message: 'private detail' }),
  };
}

function rosterResponse(voiceIds: readonly string[]): SonioxTtsResponse {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      models: [
        { id: 'stt-rt-v5', voices: [{ id: 'NotATtsVoice' }] },
        {
          id: 'tts-rt-v2',
          languages: ['he', 'en'],
          voices: voiceIds.map((id) => ({ id, description: 'a voice', gender: 'female' })),
        },
      ],
    }),
  };
}

function createService(overrides: {
  responses?: SonioxTtsResponse[];
  authority?: () => Readonly<object> | undefined;
  credential?: string | undefined;
  failing?: readonly string[];
  throwing?: readonly string[];
} = {}) {
  const requests: { url: string; init: Parameters<SonioxTtsFetch>[1] }[] = [];
  const logs: string[] = [];
  const spawner = createSpawner({ failing: overrides.failing, throwing: overrides.throwing });
  const responses = [...overrides.responses ?? [audioResponse()]];
  const service = new SonioxTtsService({
    fetch: async (url, init) => {
      requests.push({ url, init });
      const next = responses.shift();
      if (!next) throw new Error('network unavailable');
      return next;
    },
    spawn: spawner.spawn,
    credentials: {
      use: async (_provider, operation) => (
        'credential' in overrides && overrides.credential === undefined
          ? undefined
          : operation(overrides.credential ?? 'private-key')
      ),
    },
    authority: { capture: () => (overrides.authority ?? (() => ({ epoch: 1 })))() },
    log: (message) => { logs.push(message); },
    synthesisTimeoutMs: 50,
    voiceListTimeoutMs: 50,
  });
  return { service, requests, logs, children: spawner.children };
}

test('a soniox voice URI is parsed defensively because settings are user-editable', () => {
  assert.equal(isSonioxTtsVoice('voice-input-soniox:Maya'), true);
  assert.equal(sonioxVoiceId('voice-input-soniox:Maya'), 'Maya');
  assert.equal(sonioxVoiceId('voice-input-soniox:tts_voice-2'), 'tts_voice-2');
  for (const rejected of [
    'voice-input-soniox:',
    'voice-input-soniox:0Maya',
    'voice-input-soniox:Maya voice',
    'voice-input-soniox:Maya/../etc',
    `voice-input-soniox:${'M'.repeat(65)}`,
    'voice-input-host:speech-dispatcher',
    'os:he-IL',
    '',
    42,
    undefined,
  ]) {
    assert.equal(sonioxVoiceId(rejected), undefined, JSON.stringify(rejected));
    assert.equal(isSonioxTtsVoice(rejected), false, JSON.stringify(rejected));
  }
});

test('text is truncated on a word boundary and the rate maps into the provider window', () => {
  assert.equal(boundedUtterance('  שלום  '), 'שלום');
  const long = `${'word '.repeat(1_200)}tail`;
  const bounded = boundedUtterance(long);
  assert.ok(bounded.length <= 5_000);
  assert.equal(bounded.endsWith('word'), true, 'truncation never cuts a word in half');
  assert.equal(boundedUtterance('x'.repeat(6_000)).length, 5_000, 'one long token still fits the cap');
  assert.equal(boundedUtterance(42), '');

  assert.equal(sonioxSpeechSpeed(0.5), 0.7);
  assert.equal(sonioxSpeechSpeed(1), 1);
  assert.equal(sonioxSpeechSpeed(1.2), 1.2);
  assert.equal(sonioxSpeechSpeed(2), 1.3);
  assert.equal(sonioxSpeechSpeed('fast'), 1);
  assert.equal(sonioxSpeechSpeed(Number.NaN), 1);

  assert.equal(synthesisFailure(401), 'unauthenticated');
  assert.equal(synthesisFailure(402), 'budget-exhausted');
  assert.equal(synthesisFailure(413), 'utterance-too-long');
  assert.equal(synthesisFailure(429), 'rate-limited');
  assert.equal(synthesisFailure(500), 'unavailable');
});

test('a missing remote-processing receipt refuses speech before any network request', async () => {
  const refused = createService({ authority: () => undefined });
  assert.equal(await refused.service.synthesizeAndPlay('שלום', {
    language: 'he', rate: 1, voice: 'Maya',
  }).done, 'error');
  assert.deepEqual(refused.requests, [], 'no consent receipt means no request at all');
  assert.deepEqual(refused.children, [], 'and no audio player either');
  assert.deepEqual(refused.logs, [
    'soniox speech refused: remote processing consent is unavailable',
  ]);

  const keyless = createService({ credential: undefined });
  assert.equal(await keyless.service.synthesizeAndPlay('שלום', {
    language: 'he', rate: 1, voice: 'Maya',
  }).done, 'error');
  assert.deepEqual(keyless.requests, []);
  assert.deepEqual(keyless.logs, ['soniox speech refused: no credential is configured']);

  const forged = createService();
  assert.equal(await forged.service.synthesizeAndPlay('שלום', {
    language: 'he', rate: 1, voice: 'not a voice',
  }).done, 'error');
  assert.deepEqual(forged.requests, [], 'an unusable voice id never reaches the provider');
});

test('a successful synthesis pipes audio to the player stdin and never to argv or disk', async () => {
  const harness = createService({ responses: [audioResponse([[1, 2], [3, 4]])] });
  const playback = harness.service.synthesizeAndPlay('שלום עולם', {
    language: 'he', rate: 1.4, voice: 'Maya',
  });
  await waitFor(() => harness.children.length === 1);
  const child = harness.children[0];
  assert.equal(child.command, 'paplay');
  assert.deepEqual(child.args, [], 'the player reads stdin, so no operand carries text');
  await waitFor(() => child.ended);
  assert.deepEqual(child.written, [1, 2, 3, 4]);
  child.emit('exit', 0);
  assert.equal(await playback.done, 'completed');

  const [request] = harness.requests;
  assert.equal(request.url, SONIOX_TTS_ENDPOINT);
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.headers.Authorization, 'Bearer private-key');
  assert.equal(request.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(request.init.body ?? '{}'), {
    model: 'tts-rt-v2', language: 'he', voice: 'Maya', audio_format: 'wav',
    sample_rate: 24_000, speed: 1.3, text: 'שלום עולם',
  });
  assert.equal(
    harness.logs.some((entry) => entry.includes('שלום')),
    false,
    'spoken text is never logged',
  );
});

test('provider rejections map to fixed categories and never leak the response body', async () => {
  for (const [status, category] of [
    [401, 'unauthenticated'], [402, 'budget-exhausted'],
    [413, 'utterance-too-long'], [429, 'rate-limited'], [503, 'unavailable'],
  ] as const) {
    const harness = createService({ responses: [errorResponse(status)] });
    assert.equal(await harness.service.synthesizeAndPlay('hello', {
      language: 'en', rate: 1, voice: 'Maya',
    }).done, 'error');
    assert.deepEqual(harness.logs, [`soniox speech rejected: ${category}`]);
    assert.deepEqual(harness.children, [], 'a rejected request never starts a player');
    assert.equal(harness.logs.join(' ').includes('private detail'), false);
  }

  const offline = createService({ responses: [] });
  assert.equal(await offline.service.synthesizeAndPlay('hello', {
    language: 'en', rate: 1, voice: 'Maya',
  }).done, 'error');
  assert.deepEqual(offline.logs, ['soniox speech request failed: unavailable']);
});

test('cancelling aborts the request and stops the player, and a new utterance replaces the old', async () => {
  const harness = createService({ responses: [audioResponse(), audioResponse()] });
  const first = harness.service.synthesizeAndPlay('one', { language: 'en', rate: 1, voice: 'Maya' });
  await waitFor(() => harness.children.length === 1);
  first.cancel();
  assert.equal(harness.requests[0].init.signal.aborted, true);
  assert.equal(await first.done, 'cancelled');
  await waitFor(() => harness.children[0].kills.length > 0);
  assert.deepEqual(harness.children[0].kills, ['SIGTERM']);

  const second = harness.service.synthesizeAndPlay('two', { language: 'en', rate: 1, voice: 'Maya' });
  await waitFor(() => harness.children.length === 2);
  harness.service.synthesizeAndPlay('three', { language: 'en', rate: 1, voice: 'Maya' });
  assert.equal(await second.done, 'cancelled', 'one utterance at a time');
  await waitFor(() => harness.children[1].kills.length > 0);
});

test('a missing player falls back to the second command and then fails safely', async () => {
  const fallback = createService({ responses: [audioResponse()], failing: ['paplay'] });
  const playback = fallback.service.synthesizeAndPlay('hello', {
    language: 'en', rate: 1, voice: 'Maya',
  });
  await waitFor(() => fallback.children.length === 2);
  assert.equal(fallback.children[0].command, 'paplay');
  assert.equal(fallback.children[1].command, 'aplay');
  assert.deepEqual(fallback.children[1].args, ['-q', '-']);
  await waitFor(() => fallback.children[1].ended);
  fallback.children[1].emit('exit', 0);
  assert.equal(await playback.done, 'completed');

  const silent = createService({ responses: [audioResponse()], throwing: ['paplay', 'aplay'] });
  assert.equal(await silent.service.synthesizeAndPlay('hello', {
    language: 'en', rate: 1, voice: 'Maya',
  }).done, 'error');
  assert.deepEqual(silent.logs, [
    'soniox speech could not start an audio player',
    'soniox speech could not start an audio player',
  ]);

  const crashed = createService({ responses: [audioResponse()] });
  const running = crashed.service.synthesizeAndPlay('hello', {
    language: 'en', rate: 1, voice: 'Maya',
  });
  await waitFor(() => crashed.children.length === 1);
  crashed.children[0].emit('exit', 1);
  assert.equal(await running.done, 'error');
});

test('the voice roster is bounded, cached for the session, and has a packaged fallback', async () => {
  const harness = createService({ responses: [rosterResponse(['Maya', 'Maya', '0bad', 'Adrian'])] });
  assert.deepEqual(await harness.service.listVoices(), [
    { id: 'Maya', name: 'Maya' }, { id: 'Adrian', name: 'Adrian' },
  ]);
  assert.equal(harness.requests[0].url, SONIOX_TTS_MODELS_ENDPOINT);
  assert.equal(harness.requests[0].init.method, 'GET');
  assert.equal(harness.requests[0].init.headers.Authorization, 'Bearer private-key');
  await harness.service.listVoices();
  assert.equal(harness.requests.length, 1, 'the roster is fetched once per session');
  harness.service.invalidateVoices();
  await harness.service.listVoices();
  assert.equal(harness.requests.length, 2, 'a closed authority drops the cache');

  const packaged = createService({ responses: [errorResponse(500)] });
  assert.deepEqual(await packaged.service.listVoices(), fallbackVoices());
  assert.deepEqual(packaged.logs, ['soniox voice list unavailable: using the packaged roster']);

  const refused = createService({ authority: () => undefined });
  assert.deepEqual(await refused.service.listVoices(), []);
  assert.deepEqual(refused.requests, []);

  assert.deepEqual(parseVoiceRoster({ models: [] }), []);
  assert.deepEqual(parseVoiceRoster(undefined), []);
  assert.equal(parseVoiceRoster({
    models: [{ id: 'tts-rt-v2', voices: Array.from({ length: 40 }, (_, index) => ({ id: `Voice${index}` })) }],
  }).length, 28, 'the roster is bounded before it reaches the protocol');
});

test('the coordinator publishes a bounded roster only while the gate stays open', async () => {
  const harness = createService({
    responses: [rosterResponse(['Maya', 'Adrian']), audioResponse()],
  });
  const values = { ...SETTINGS_DEFAULTS, transcriptionProvider: 'soniox' as const };
  let publishes = 0;
  const coordinator = new SonioxTtsCoordinator({
    service: harness.service,
    settings: { read: () => ({ values, workspaceOverrides: [] }) } as never,
    publish: () => { publishes += 1; },
  });
  assert.equal(coordinator.state(), 'unavailable');
  assert.deepEqual(coordinator.voiceIds(), []);
  coordinator.ensureVoices();
  coordinator.ensureVoices();
  await waitFor(() => publishes === 1);
  assert.equal(harness.requests.length, 1, 'a second visit never starts a second request');
  assert.equal(coordinator.state(), 'ready');
  assert.deepEqual(coordinator.voiceIds(), ['Maya', 'Adrian']);

  values.transcriptionProvider = 'none';
  assert.equal(coordinator.state(), 'unavailable', 'deselecting Soniox hides its voices at once');
  assert.deepEqual(coordinator.voiceIds(), []);
  values.transcriptionProvider = 'soniox';

  values.assistantSpeechVoiceUri = 'voice-input-soniox:Unlisted';
  assert.equal(coordinator.speak('hello', { language: 'en', rate: 1 }), false);
  values.assistantSpeechVoiceUri = 'voice-input-soniox:Maya';
  assert.equal(coordinator.speak('hello', { language: 'en', rate: 1 }), true);
  await waitFor(() => harness.children.length === 1);
  coordinator.stop();
  await waitFor(() => harness.children[0].kills.length > 0);
  assert.deepEqual(harness.children[0].kills, ['SIGTERM']);

  coordinator.invalidate();
  assert.equal(coordinator.state(), 'unavailable');
  assert.equal(publishes, 2, 'a revoked authority republishes the panel without the voices');
});

test('a refused roster is retried only after a cooldown, never on every publish', async () => {
  const harness = createService({ authority: () => undefined });
  const values = { ...SETTINGS_DEFAULTS, transcriptionProvider: 'soniox' as const };
  let clock = 1_000;
  const coordinator = new SonioxTtsCoordinator({
    service: harness.service,
    settings: { read: () => ({ values, workspaceOverrides: [] }) } as never,
    publish: () => {},
    now: () => clock,
  });
  coordinator.ensureVoices();
  await waitFor(() => harness.logs.length === 1);
  coordinator.ensureVoices();
  await settle();
  assert.equal(harness.logs.length, 1, 'the closed gate is not re-probed on the next publish');
  clock += 20_000;
  coordinator.ensureVoices();
  await waitFor(() => harness.logs.length === 2);
});

test('a soniox voice routes assistant speech remotely and falls back rather than going silent', async () => {
  const values = {
    ...SETTINGS_DEFAULTS,
    assistantSpeechRate: 1.5,
    assistantSpeechVoiceUri: 'voice-input-soniox:Maya',
  };
  const spoken: { text: string; language: string; rate: number }[] = [];
  const posted: string[] = [];
  const finished: string[] = [];
  const logs: string[] = [];
  let sonioxState: 'ready' | 'unavailable' = 'ready';
  let sonioxStarts = true;
  let hostAvailable = false;
  let stops = 0;
  let report: ((outcome: 'completed' | 'error' | 'cancelled') => void) | undefined;
  const delivery = new HostSpeechDelivery({
    browser: {
      postSpeak: (id) => { posted.push(id); return 'sent'; },
      cancelSpeaking: () => true,
    },
    host: {
      get isAvailable() { return hostAvailable; },
      speak: (text, options) => {
        spoken.push({ text, language: options.language, rate: options.rate });
        options.onFinished?.('completed');
        return true;
      },
      stop: () => { stops += 1; },
    },
    soniox: {
      state: () => sonioxState,
      speak: (text, options) => {
        if (!sonioxStarts) return false;
        spoken.push({ text: `soniox:${text}`, language: options.language, rate: options.rate });
        report = options.onFinished;
        return true;
      },
      stop: () => { stops += 1; },
    },
    settings: { read: () => ({ values, workspaceOverrides: [] }) } as never,
    onFinished: (id, outcome) => finished.push(`${id}:${outcome}`),
    log: (message) => { logs.push(message); },
  });

  assert.equal(delivery.postSpeak('speech-1', 'שלום', 'he'), 'sent');
  assert.deepEqual(spoken, [{ text: 'soniox:שלום', language: 'he', rate: 1.5 }]);
  assert.deepEqual(posted, [], 'the remote voice never double-speaks through the sidebar');
  report?.('completed');
  assert.deepEqual(finished, ['speech-1:soniox-completed']);

  // A failure after the utterance started still reaches the user through another path.
  hostAvailable = true;
  assert.equal(delivery.postSpeak('speech-2', 'שלום', 'he'), 'sent');
  report?.('error');
  assert.deepEqual(spoken.at(-1), { text: 'שלום', language: 'he', rate: 1.5 });
  assert.deepEqual(finished.at(-1), 'speech-2:host-completed');
  assert.deepEqual(logs, ['soniox speech failed; using the host or sidebar voice']);

  // A refused start falls back before anything is spoken remotely.
  sonioxStarts = false;
  hostAvailable = false;
  assert.equal(delivery.postSpeak('speech-3', 'שלום', 'he'), 'sent');
  assert.deepEqual(posted, ['speech-3']);
  assert.deepEqual(logs.at(-1), 'soniox speech did not start; using the host or sidebar voice');

  // An unavailable remote path is not even asked.
  sonioxState = 'unavailable';
  sonioxStarts = true;
  assert.equal(delivery.postSpeak('speech-4', 'שלום', 'he'), 'sent');
  assert.deepEqual(posted, ['speech-3', 'speech-4']);

  // A cancelled utterance reports itself and never re-delivers.
  sonioxState = 'ready';
  delivery.postSpeak('speech-5', 'שלום', 'he');
  report?.('cancelled');
  assert.deepEqual(finished.at(-1), 'speech-5:soniox-cancelled');

  delivery.cancelSpeaking();
  assert.equal(stops, 2, 'stopping stops every host path, whichever one is speaking');

  values.assistantSpeechVoiceUri = 'os:he-IL';
  assert.equal(delivery.postSpeak('speech-6', 'שלום', 'he'), 'sent');
  assert.deepEqual(posted.at(-1), 'speech-6', 'a browser voice stays with the sidebar');
});

function settle(ms = 0): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await settle(1);
  }
  assert.fail('condition was never reached');
}
