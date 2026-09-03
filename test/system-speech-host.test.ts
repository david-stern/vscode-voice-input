import assert from 'node:assert/strict';
import test from 'node:test';

import { SETTINGS_DEFAULTS } from '../src/config';
import { HostSpeechDelivery } from '../src/platform/systemSpeechDelivery';
import {
  SystemSpeechHost,
  hostSpeechRate,
  type HostSpeechProcess,
  type HostSpeechSpawn,
} from '../src/platform/systemSpeechHost';
import { HOST_SPEECH_VOICE_URI } from '../src/webview/controlCenter/hostVoices';

interface FakeChild extends HostSpeechProcess {
  command: string;
  args: string[];
  kills: string[];
  emit(event: 'error' | 'exit', value?: unknown): void;
}

function createSpawner(behaviour: { throws?: boolean } = {}) {
  const children: FakeChild[] = [];
  const spawn: HostSpeechSpawn = (command, args) => {
    if (behaviour.throws) throw new Error('spawn refused');
    const listeners = new Map<string, ((value: unknown) => void)[]>();
    const child: FakeChild = {
      command,
      args: [...args],
      kills: [],
      on(event: string, listener: (value: never) => void) {
        listeners.set(event, [...(listeners.get(event) ?? []), listener as (value: unknown) => void]);
        return child;
      },
      kill(signal?: string) { child.kills.push(signal ?? 'SIGTERM'); return true; },
      emit(event, value) { for (const listener of listeners.get(event) ?? []) listener(value); },
    };
    children.push(child);
    return child;
  };
  return { spawn, children };
}

function settle(ms = 0): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function createHost(overrides: Record<string, unknown> = {}) {
  const spawner = createSpawner((overrides.behaviour ?? {}) as { throws?: boolean });
  const logs: string[] = [];
  const host = new SystemSpeechHost({
    spawn: spawner.spawn,
    localize: (english: string) => english,
    log: (message) => { logs.push(message); },
    platform: 'linux',
    probeTimeoutMs: 20,
    ...overrides,
  });
  return { host, logs, children: spawner.children };
}

test('the host speech probe grants availability only on a clean spd-say exit', async () => {
  const ready = createHost();
  assert.equal(ready.children.length, 1);
  assert.equal(ready.children[0].command, 'spd-say');
  assert.deepEqual(ready.children[0].args, ['--version']);
  assert.equal(ready.host.isAvailable, false, 'availability is never assumed before the probe');
  ready.children[0].emit('exit', 0);
  await settle();
  assert.equal(ready.host.isAvailable, true);
  assert.deepEqual(ready.host.voices(), [{
    voiceUri: HOST_SPEECH_VOICE_URI,
    name: 'System speech (speech-dispatcher)',
    language: 'he',
    isDefault: false,
  }]);

  const failed = createHost();
  failed.children[0].emit('exit', 127);
  await settle();
  assert.equal(failed.host.isAvailable, false);
  assert.deepEqual(failed.host.voices(), []);

  const errored = createHost();
  errored.children[0].emit('error', new Error('ENOENT'));
  await settle();
  assert.equal(errored.host.isAvailable, false);

  const refused = createHost({ behaviour: { throws: true } });
  await settle();
  assert.equal(refused.host.isAvailable, false);
  assert.deepEqual(refused.logs, ['host system speech could not start a process']);
});

test('the probe is bounded by a timeout and never runs off Linux', async () => {
  const stuck = createHost({ probeTimeoutMs: 1 });
  assert.equal(stuck.children.length, 1);
  await settle(20);
  assert.equal(stuck.host.isAvailable, false);
  assert.deepEqual(stuck.children[0].kills, ['SIGTERM']);
  assert.deepEqual(stuck.logs, ['host system speech probe timed out']);

  const windows = createHost({ platform: 'win32' });
  await settle();
  assert.deepEqual(windows.children, [], 'no spawn is worth its cost off Linux');
  assert.equal(windows.host.isAvailable, false);
  assert.equal(windows.host.speak('ignored', { language: 'he', rate: 1 }), false);
});

test('the extension speech rate maps monotonically onto the spd-say scale', () => {
  assert.equal(hostSpeechRate(0.5), -50);
  assert.equal(hostSpeechRate(1), 0);
  assert.equal(hostSpeechRate(1.4), 40);
  assert.equal(hostSpeechRate(2), 100);
  assert.equal(hostSpeechRate(0.1), -50, 'below-range rates clamp to the minimum');
  assert.equal(hostSpeechRate(9), 100, 'above-range rates clamp to the maximum');
  assert.equal(hostSpeechRate('fast'), 0);
  assert.equal(hostSpeechRate(Number.NaN), 0);
});

test('speaking starts one argv-only child, caps text, and never lets text become a flag', async () => {
  const harness = createHost();
  harness.children[0].emit('exit', 0);
  await settle();

  const outcomes: string[] = [];
  assert.equal(harness.host.speak('  בדיקה  ', {
    language: 'he', rate: 1.4, onFinished: (outcome) => outcomes.push(outcome),
  }), true);
  const spoken = harness.children[1];
  assert.equal(spoken.command, 'spd-say');
  assert.deepEqual(spoken.args, ['-l', 'he', '-r', '40', '--', 'בדיקה']);

  harness.host.speak('--version', { language: 'en', rate: 1 });
  assert.deepEqual(harness.children[2].args, ['-l', 'en', '-r', '0', '--', '--version']);
  assert.deepEqual(spoken.kills, ['SIGTERM'], 'a new utterance kills the previous child');

  harness.host.speak('x'.repeat(5_000), { language: 'en', rate: 1 });
  assert.equal(harness.children[3].args[5].length, 4_000);
  assert.equal(harness.host.speak('   ', { language: 'en', rate: 1 }), false);
  assert.equal(harness.children.length, 4, 'empty text starts no process');

  harness.children[3].emit('exit', 0);
  harness.children[1].emit('exit', 0);
  assert.deepEqual(outcomes, ['completed'], 'each utterance finishes exactly once');

  const failing = createHost();
  failing.children[0].emit('exit', 0);
  await settle();
  const failures: string[] = [];
  failing.host.speak('hello', {
    language: 'en', rate: 1, onFinished: (outcome) => failures.push(outcome),
  });
  failing.children[1].emit('exit', 3);
  assert.deepEqual(failures, ['error']);
});

test('stopping kills the child and cancels queued speech exactly once per utterance', async () => {
  const harness = createHost();
  harness.children[0].emit('exit', 0);
  await settle();

  harness.host.stop();
  assert.equal(harness.children.length, 1, 'nothing was spoken, so nothing is cancelled');

  harness.host.speak('בדיקה', { language: 'he', rate: 1 });
  harness.host.stop();
  assert.deepEqual(harness.children[1].kills, ['SIGTERM']);
  assert.deepEqual(harness.children[2].args, ['--cancel']);
  harness.host.stop();
  assert.equal(harness.children.length, 3);

  harness.host.speak('בדיקה', { language: 'he', rate: 1 });
  harness.host.dispose();
  assert.deepEqual(harness.children[4].args, ['--cancel']);
  assert.equal(harness.host.isAvailable, false);
  assert.equal(harness.host.speak('ignored', { language: 'he', rate: 1 }), false);
  assert.deepEqual(harness.host.voices(), []);
});

test('a host voice routes assistant speech to the host and everything else to the sidebar', async () => {
  const harness = createHost();
  harness.children[0].emit('exit', 0);
  await settle();
  const values = { ...SETTINGS_DEFAULTS, assistantSpeechRate: 1.5 };
  const posted: { id: string; text: string; lang?: string }[] = [];
  let browserCancels = 0;
  const finished: string[] = [];
  const delivery = new HostSpeechDelivery({
    browser: {
      postSpeak: (id, text, lang) => { posted.push({ id, text, lang }); return 'sent'; },
      cancelSpeaking: () => { browserCancels += 1; return true; },
    },
    host: harness.host,
    settings: { read: () => ({ values, workspaceOverrides: [] }) } as never,
    onFinished: (id, outcome) => finished.push(`${id}:${outcome}`),
  });

  assert.equal(delivery.postSpeak('speech-1', 'browser voice', 'he'), 'sent');
  assert.deepEqual(posted, [{ id: 'speech-1', text: 'browser voice', lang: 'he' }]);
  assert.equal(harness.children.length, 1, 'an unselected host voice never spawns');

  values.assistantSpeechVoiceUri = HOST_SPEECH_VOICE_URI;
  assert.equal(delivery.postSpeak('speech-2', 'שלום', 'he'), 'sent');
  assert.equal(posted.length, 1, 'the host voice never double-speaks through the sidebar');
  assert.deepEqual(harness.children[1].args, ['-l', 'he', '-r', '50', '--', 'שלום']);
  harness.children[1].emit('exit', 0);
  assert.deepEqual(finished, ['speech-2:host-completed']);

  delivery.cancelSpeaking();
  assert.equal(browserCancels, 1);
  assert.deepEqual(harness.children[2].args, ['--cancel'], 'stopping also stops host speech');
});

test('an unavailable or failing host fallback keeps the sidebar delivery authoritative', async () => {
  const harness = createHost();
  harness.children[0].emit('exit', 1);
  await settle();
  const values = { ...SETTINGS_DEFAULTS, assistantSpeechVoiceUri: HOST_SPEECH_VOICE_URI };
  const posted: string[] = [];
  const delivery = new HostSpeechDelivery({
    browser: {
      postSpeak: (id) => { posted.push(id); return 'queued'; },
      cancelSpeaking: () => true,
    },
    host: harness.host,
    settings: { read: () => ({ values, workspaceOverrides: [] }) } as never,
    onFinished: () => { throw new Error('an unavailable host must not report speech'); },
  });
  assert.equal(delivery.postSpeak('speech-3', 'שלום', 'he'), 'queued');
  assert.deepEqual(posted, ['speech-3']);

  const refusing = createHost({ behaviour: { throws: false } });
  refusing.children[0].emit('exit', 0);
  await settle();
  const outcomes: string[] = [];
  const fallback = new HostSpeechDelivery({
    browser: { postSpeak: () => 'sent', cancelSpeaking: () => true },
    host: {
      isAvailable: true,
      speak: () => false,
      stop: () => undefined,
    },
    settings: { read: () => ({ values, workspaceOverrides: [] }) } as never,
    onFinished: (id, outcome) => outcomes.push(`${id}:${outcome}`),
  });
  assert.equal(fallback.postSpeak('speech-4', 'שלום', 'he'), 'sent');
  assert.deepEqual(outcomes, [], 'a refused host start reports nothing and falls back');
});
