import assert from 'node:assert/strict';
import test from 'node:test';

import { SETTINGS_DEFAULTS } from '../src/config';
import type { DiagnosticsResult } from '../src/features/diagnostics';
import { ControlCenterOperations } from '../src/platform/controlCenterOperations';

function baseOptions(overrides: Record<string, unknown> = {}) {
  const values = { ...SETTINGS_DEFAULTS };
  let ttsDecision: 'pending' | 'off' | 'system' = 'pending';
  let result: DiagnosticsResult | undefined;
  const copied: string[] = [];
  const opened: string[] = [];
  let publishes = 0;
  const options = {
    settings: {
      read: () => ({ values, workspaceOverrides: [] }),
      update: async (patch: Partial<typeof values>) => {
        Object.assign(values, patch);
      },
    },
    setupChoices: {
      snapshot: () => ({ schemaVersion: 1 as const, stt: 'pending' as const, tts: ttsDecision }),
      recordTts: async (decision: 'off' | 'system') => { ttsDecision = decision; },
    },
    devices: {
      get: async () => [{ id: 'mic-id', label: 'Desk microphone' }],
      selectionStatus: { kind: 'available', deviceId: 'mic-id', label: 'Desk microphone' },
      cachedDevices: [{ id: 'mic-id', label: 'Desk microphone' }],
    },
    diagnostics: {
      get result() { return result; },
      collect: async () => {
        result = {
          status: 'attention', report: 'safe-report',
          checks: [
            { id: 'microphone', status: 'ok' },
            { id: 'soniox', status: 'attention' },
            { id: 'deepseek', status: 'ok' },
            { id: 'workspace-trust', status: 'ok' },
          ],
        };
        return result;
      },
      open: () => { opened.push('open'); },
    },
    selectAudioDevice: async () => undefined,
    startPcmStream: async (request: { onFrame(frame: Int16Array): void }) => {
      request.onFrame(Int16Array.from([0, 4, -8]));
      return {
        sampleRate: 16_000, samplesCaptured: 3, selectedDevice: 'Desk microphone',
        outcome: Promise.resolve({ reason: 'limit' as const }),
        stop: async () => undefined, cancel: () => undefined,
      };
    },
    publish: () => { publishes += 1; },
    localize: (english: string) => english,
    copyText: async (text: string) => { copied.push(text); },
    ...overrides,
  };
  return { options, values, copied, opened, publishes: () => publishes };
}

test('microphone readiness requires non-zero PCM and stop invalidates an in-flight proof', async () => {
  const ready = baseOptions();
  const operations = new ControlCenterOperations(ready.options as never);
  assert.deepEqual(operations.setupState().stepStates, [
    'pending', 'pending', 'pending', 'pending',
  ]);
  assert.equal(operations.setupState().recommendedStep, 1);
  await operations.microphone({
    type: 'microphoneSetupIntent', revision: 1, operation: 'test-signal',
  });
  assert.equal(operations.setupState().microphoneState, 'signal-detected');
  assert.equal(operations.setupState().microphoneLabel, 'Desk microphone');
  assert.deepEqual(operations.setupState().stepStates, [
    'complete', 'pending', 'pending', 'pending',
  ]);
  assert.equal(operations.setupState().recommendedStep, 2);

  let settle!: (outcome: { reason: 'cancelled' }) => void;
  let cancellations = 0;
  const waiting = baseOptions({
    startPcmStream: async () => ({
      sampleRate: 16_000, samplesCaptured: 0, selectedDevice: 'Desk microphone',
      outcome: new Promise<{ reason: 'cancelled' }>((resolve) => { settle = resolve; }),
      stop: async () => undefined,
      cancel: () => { cancellations += 1; settle({ reason: 'cancelled' }); },
    }),
  });
  const active = new ControlCenterOperations(waiting.options as never);
  const testRun = active.microphone({
    type: 'microphoneSetupIntent', revision: 2, operation: 'test-signal',
  });
  await Promise.resolve();
  await active.microphone({
    type: 'microphoneSetupIntent', revision: 2, operation: 'stop-test',
  });
  await testRun;
  assert.equal(cancellations, 1);
  assert.equal(active.setupState().microphoneState, 'untested');

  const silent = baseOptions({
    startPcmStream: async (request: { onFrame(frame: Int16Array): void }) => {
      request.onFrame(Int16Array.from([0, 0, 0]));
      return {
        sampleRate: 16_000, samplesCaptured: 3, selectedDevice: 'Silent microphone',
        outcome: Promise.resolve({ reason: 'limit' as const }),
        stop: async () => undefined, cancel: () => undefined,
      };
    },
  });
  const silentOperations = new ControlCenterOperations(silent.options as never);
  await silentOperations.microphone({
    type: 'microphoneSetupIntent', revision: 3, operation: 'test-signal',
  });
  assert.equal(silentOperations.setupState().microphoneState, 'no-signal');
});

test('system speech persists only a current observed voice index, rate, and off/system state', async () => {
  const harness = baseOptions();
  const operations = new ControlCenterOperations(harness.options as never);
  assert.equal(operations.systemTtsState(), 'configured-unverified');
  operations.observeVoices([
    { voiceUri: 'os:he', name: 'Hebrew OS voice', language: 'he-IL', isDefault: true },
  ]);
  assert.equal(operations.setupState().stepStates[2], 'pending');
  await operations.systemTts({
    type: 'systemTtsIntent', revision: 3, operation: 'set-enabled', enabled: true,
  });
  await operations.systemTts({
    type: 'systemTtsIntent', revision: 3, operation: 'set-voice', voiceIndex: 0,
  });
  await operations.systemTts({
    type: 'systemTtsIntent', revision: 3, operation: 'set-rate', rate: 1.4,
  });
  assert.equal(harness.values.assistantSpeechVoiceUri, 'os:he');
  assert.equal(harness.values.assistantSpeechRate, 1.4);
  assert.equal(operations.setupState().systemTtsVoiceIndex, 0);
  assert.equal(operations.systemTtsState(), 'ready');
  assert.equal(operations.setupState().stepStates[2], 'complete');
  await operations.systemTts({
    type: 'systemTtsIntent', revision: 3, operation: 'set-voice', voiceIndex: 20,
  } as never);
  assert.equal(harness.values.assistantSpeechVoiceUri, 'os:he');
  await operations.systemTts({
    type: 'systemTtsIntent', revision: 3, operation: 'set-enabled', enabled: false,
  });
  assert.equal(operations.systemTtsState(), 'off');
  assert.equal(operations.setupState().stepStates[2], 'complete');
});

test('system speech records an explicit setup decision only after the setting write succeeds', async () => {
  const harness = baseOptions();
  let records = 0;
  const operations = new ControlCenterOperations({
    ...harness.options,
    settings: {
      ...harness.options.settings,
      update: async () => { throw new Error('write failed'); },
    },
    setupChoices: {
      snapshot: () => ({ schemaVersion: 1, stt: 'pending', tts: 'pending' }),
      recordTts: async () => { records += 1; },
    },
  } as never);
  await assert.rejects(operations.systemTts({
    type: 'systemTtsIntent', revision: 4, operation: 'set-enabled', enabled: false,
  }));
  assert.equal(records, 0);
  assert.equal(operations.setupState().stepStates[2], 'pending');
});

test('diagnostics run, open, and copy expose only the bounded sanitized projection', async () => {
  const harness = baseOptions();
  const operations = new ControlCenterOperations(harness.options as never);
  await operations.diagnostics({
    type: 'diagnosticsIntent', revision: 4, operation: 'run', requestSequence: 1,
  });
  const state = operations.diagnosticsState();
  assert.equal(state.status, 'ready');
  assert.equal(state.checks.length, 6);
  assert.equal(state.canOpen, true);
  assert.equal(state.canCopy, true);
  assert.equal(JSON.stringify(state).includes('safe-report'), false);
  await operations.diagnostics({
    type: 'diagnosticsIntent', revision: 4, operation: 'open', requestSequence: 2,
  });
  await operations.diagnostics({
    type: 'diagnosticsIntent', revision: 4, operation: 'copy', requestSequence: 3,
  });
  assert.deepEqual(harness.opened, ['open']);
  assert.deepEqual(harness.copied, ['safe-report']);
});

test('a failed diagnostics rerun replaces a stale ready result with an error state', async () => {
  let fail = false;
  const harness = baseOptions();
  const collect = harness.options.diagnostics.collect;
  harness.options.diagnostics.collect = async () => {
    if (fail) throw new Error('diagnostic failure');
    return collect();
  };
  const operations = new ControlCenterOperations(harness.options as never);
  await operations.diagnostics({
    type: 'diagnosticsIntent', revision: 5, operation: 'run', requestSequence: 1,
  });
  assert.equal(operations.diagnosticsState().status, 'ready');
  fail = true;
  await operations.diagnostics({
    type: 'diagnosticsIntent', revision: 5, operation: 'run', requestSequence: 2,
  });
  assert.equal(operations.diagnosticsState().status, 'error');
});
