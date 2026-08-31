import assert from 'node:assert/strict';
import test from 'node:test';

import { SETTINGS_DEFAULTS } from '../src/config';
import { SetupWorkflowController } from '../src/features/settings/setupController';
import type { PcmStreamHandle, PcmStreamOptions } from '../src/recorder/native';

function readyAgent() {
  return {
    id: 'agent_abcdefghijkl',
    name: 'Teacher',
    description: { en: 'Teacher', he: 'מורה' },
    provider: 'deepseek' as const,
    model: 'deepseek-chat',
    persona: 'teacher-lecturer' as const,
    instructions: { en: 'Help safely.', he: 'עזור בבטחה.' },
    speech: { enabled: true, voiceUri: '', rate: 1 },
    enabled: true,
  };
}

function completedStream(options: PcmStreamOptions): PcmStreamHandle {
  const frame = Int16Array.from([0, 17, -9]);
  options.onFrame(frame);
  return {
    sampleRate: 16_000,
    samplesCaptured: frame.length,
    selectedDevice: 'Built-in microphone',
    outcome: Promise.resolve({ reason: 'limit' }),
    cancel: () => undefined,
    stop: async () => undefined,
  };
}

test('setup is explicit, ordered, host-revision gated, and completes only after both speech outcomes', async () => {
  const values = {
    ...structuredClone(SETTINGS_DEFAULTS),
    assistantProvider: 'off' as const,
  };
  let captures = 0;
  let transcriptions = 0;
  let rehearsals = 0;
  let providerTests = 0;
  let speechIds = 0;
  const controller = new SetupWorkflowController({
    settings: { read: () => ({ values, workspaceOverrides: [] }) },
    credentials: { status: async (provider) => ({ provider, configured: true }) },
    consents: { status: (id) => ({ id, acknowledged: true }) },
    devices: {
      get: async () => [{ id: 'mic-1', label: 'Built-in microphone' }],
      selectionStatus: { kind: 'available', deviceId: 'mic-1', label: 'Built-in microphone' },
    } as never,
    metadata: {
      state: {
        models: [{ id: values.sttModel }],
        languages: [{ code: values.languageHint, name: 'Hebrew' }],
        loading: false,
      },
    } as never,
    transcriptions: {
      abort: () => undefined,
      open: () => {
        const current = ++transcriptions;
        return {
          signal: new AbortController().signal,
          transcribe: async () => ({
            status: 'completed' as const,
            text: current === 1 ? 'live transcription succeeded' : 'Hey Assistant explain this',
          }),
          dispose: () => undefined,
        };
      },
    },
    connectionTests: {
      test: async (provider) => {
        providerTests += 1;
        return { provider, category: 'connected' as const };
      },
      cancel: () => undefined,
    },
    agents: { getDefault: () => readyAgent() } as never,
    assistant: {
      rehearse: async (request: string, signal: AbortSignal) => {
        rehearsals += 1;
        assert.equal(request, 'explain this');
        assert.equal(signal.aborted, false);
        return 'Rehearsal reply';
      },
    } as never,
    startPcmStream: async (options) => {
      captures += 1;
      return completedStream(options);
    },
    publish: () => undefined,
    idFactory: () => `speech-${++speechIds}`,
  });

  assert.deepEqual({ captures, transcriptions, rehearsals, providerTests }, {
    captures: 0, transcriptions: 0, rehearsals: 0, providerTests: 0,
  });
  assert.equal(await controller.run('soniox', controller.state.revision), 'stale');
  assert.equal(captures, 0);

  assert.equal(await controller.run('microphone', controller.state.revision), 'accepted');
  assert.equal(controller.state.steps.microphone.status, 'ready');
  assert.equal(await controller.run('soniox', controller.state.revision), 'accepted');
  assert.equal(controller.state.steps.soniox.status, 'ready');
  assert.equal(await controller.run('transcription', controller.state.revision), 'accepted');
  assert.equal(await controller.run('speech', controller.state.revision), 'accepted');

  const preview = controller.state.speechRequest;
  assert.equal(preview?.kind, 'preview');
  assert.equal(controller.state.steps.speech.status, 'running');
  assert.equal(controller.state.complete, false);
  assert.equal(controller.speechFinished(
    preview?.id ?? '',
    'completed',
    controller.state.revision - 1,
  ), 'stale');
  assert.equal(controller.speechFinished(
    preview?.id ?? '',
    'completed',
    controller.state.revision,
  ), 'accepted');

  assert.equal(await controller.run('provider', controller.state.revision), 'accepted');
  assert.equal(await controller.run('agent', controller.state.revision), 'accepted');
  assert.equal(await controller.run('rehearsal', controller.state.revision), 'accepted');
  const rehearsal = controller.state.speechRequest;
  assert.equal(rehearsal?.kind, 'rehearsal');
  assert.equal(controller.state.complete, false);
  assert.equal(controller.speechFinished(
    rehearsal?.id ?? '',
    'completed',
    controller.state.revision,
  ), 'accepted');

  assert.equal(controller.state.complete, true);
  assert.equal(controller.state.steps.rehearsal.status, 'ready');
  assert.deepEqual({ captures, transcriptions, rehearsals, providerTests }, {
    captures: 3,
    transcriptions: 2,
    rehearsals: 1,
    providerTests: 0,
  });
  const projected = JSON.stringify(controller.state);
  assert.doesNotMatch(projected, /live transcription succeeded|Hey Assistant explain this/iu);
});

test('setup cancellation closes a native stream that resolves after cancellation', async () => {
  const stream = deferred<PcmStreamHandle>();
  let cancelled = 0;
  let stopped = 0;
  const values = { ...structuredClone(SETTINGS_DEFAULTS), assistantProvider: 'off' as const };
  const controller = new SetupWorkflowController({
    settings: { read: () => ({ values, workspaceOverrides: [] }) },
    credentials: { status: async (provider) => ({ provider, configured: true }) },
    consents: { status: (id) => ({ id, acknowledged: true }) },
    devices: {
      get: async () => [{ id: 'mic-1', label: 'Microphone' }],
      selectionStatus: { kind: 'available' },
    } as never,
    metadata: { state: { models: [], languages: [], loading: false } } as never,
    transcriptions: { open: () => { throw new Error('unexpected'); }, abort: () => undefined } as never,
    connectionTests: { test: async () => { throw new Error('unexpected'); }, cancel: () => undefined } as never,
    agents: { getDefault: () => readyAgent() } as never,
    assistant: { rehearse: async () => 'unexpected' } as never,
    startPcmStream: () => stream.promise,
    publish: () => undefined,
  });

  const pending = controller.run('microphone', controller.state.revision);
  assert.equal(controller.cancel(controller.state.revision), 'accepted');
  stream.resolve({
    sampleRate: 16_000,
    samplesCaptured: 0,
    selectedDevice: 'Microphone',
    outcome: Promise.resolve({ reason: 'cancelled' }),
    cancel: () => { cancelled += 1; },
    stop: async () => { stopped += 1; },
  });
  await pending;

  assert.deepEqual({ cancelled, stopped }, { cancelled: 1, stopped: 1 });
  assert.deepEqual(controller.state.steps.microphone, {
    status: 'attention', result: 'cancelled',
  });
  assert.equal(controller.state.complete, false);
});

test('setup provider probe is abortable and cancellation cannot advance readiness', async () => {
  const values = {
    ...structuredClone(SETTINGS_DEFAULTS),
    assistantProvider: 'openai' as const,
  };
  let probeSignal: AbortSignal | undefined;
  let providerCancels = 0;
  const controller = new SetupWorkflowController({
    settings: { read: () => ({ values, workspaceOverrides: [] }) },
    credentials: { status: async (provider) => ({ provider, configured: true }) },
    consents: { status: (id) => ({ id, acknowledged: true }) },
    devices: {
      get: async () => [{ id: 'mic-1', label: 'Microphone' }],
      selectionStatus: { kind: 'available' },
    } as never,
    metadata: {
      state: {
        models: [{ id: values.sttModel }],
        languages: [{ code: values.languageHint, name: 'Hebrew' }],
        loading: false,
      },
    } as never,
    transcriptions: {
      abort: () => undefined,
      open: () => ({
        signal: new AbortController().signal,
        transcribe: async () => ({ status: 'completed' as const, text: 'live test' }),
        dispose: () => undefined,
      }),
    },
    connectionTests: {
      test: (provider, signal) => new Promise((resolve) => {
        probeSignal = signal;
        signal.addEventListener('abort', () => resolve({ provider, category: 'cancelled' }), { once: true });
      }),
      cancel: () => { providerCancels += 1; },
    },
    agents: { getDefault: () => readyAgent() } as never,
    assistant: { rehearse: async () => 'reply' } as never,
    startPcmStream: async (options) => completedStream(options),
    publish: () => undefined,
    idFactory: () => 'speech-preview',
  });

  for (const step of ['microphone', 'soniox', 'transcription', 'speech'] as const) {
    await controller.run(step, controller.state.revision);
    const request = controller.state.speechRequest;
    if (request) controller.speechFinished(request.id, 'completed', controller.state.revision);
  }
  const pending = controller.run('provider', controller.state.revision);
  await waitFor(() => probeSignal !== undefined);
  assert.equal(controller.cancel(controller.state.revision), 'accepted');
  await pending;

  assert.equal(probeSignal?.aborted, true);
  assert.equal(providerCancels, 1);
  assert.deepEqual(controller.state.steps.provider, {
    status: 'attention', result: 'cancelled',
  });
  assert.equal(controller.state.currentStep, 'provider');
});

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail('condition not reached');
}
