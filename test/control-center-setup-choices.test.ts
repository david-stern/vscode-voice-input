import assert from 'node:assert/strict';
import test from 'node:test';

import { CONTROL_CENTER_SETUP_CHOICES_STORAGE_KEY } from '../src/config';
import { ControlCenterSetupChoices } from '../src/platform/controlCenterSetupChoices';

class MemoryState {
  readonly values = new Map<string, unknown>();
  get<T>(key: string, fallback: T): T {
    return (this.values.has(key) ? this.values.get(key) : fallback) as T;
  }
  async update(key: string, value: unknown): Promise<void> { this.values.set(key, value); }
}

test('setup choices persist only closed non-authorizing STT and TTS decisions across reload', async () => {
  const state = new MemoryState();
  const choices = new ControlCenterSetupChoices(state);
  assert.deepEqual(choices.snapshot(), { schemaVersion: 1, stt: 'pending', tts: 'pending' });
  await Promise.all([choices.recordStt('none'), choices.recordTts('off')]);
  assert.deepEqual(state.values.get(CONTROL_CENTER_SETUP_CHOICES_STORAGE_KEY), {
    schemaVersion: 1, stt: 'none', tts: 'off',
  });
  assert.deepEqual(new ControlCenterSetupChoices(state).snapshot(), {
    schemaVersion: 1, stt: 'none', tts: 'off',
  });
  const serialized = JSON.stringify(state.values.get(CONTROL_CENTER_SETUP_CHOICES_STORAGE_KEY));
  for (const forbidden of ['authority', 'receipt', 'secret', 'token', 'approved']) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test('setup choices reject corrupt, over-posted, and prototype-bearing persisted state', () => {
  const symbolOverpost = { schemaVersion: 1, stt: 'none', tts: 'off' };
  Object.defineProperty(symbolOverpost, Symbol('authority'), { value: true, enumerable: true });
  for (const invalid of [
    { schemaVersion: 1, stt: 'none', tts: 'off', authority: true },
    { schemaVersion: 2, stt: 'none', tts: 'off' },
    { schemaVersion: 1, stt: 'ready', tts: 'system' },
    Object.assign(Object.create({ authority: true }), { schemaVersion: 1, stt: 'none', tts: 'off' }),
    Object.defineProperty({ schemaVersion: 1, tts: 'off' }, 'stt', {
      enumerable: true, get: () => { throw new Error('must not execute'); },
    }),
    new Proxy({}, { getPrototypeOf: () => { throw new Error('must not escape'); } }),
    symbolOverpost,
  ]) {
    const state = new MemoryState();
    state.values.set(CONTROL_CENTER_SETUP_CHOICES_STORAGE_KEY, invalid);
    assert.deepEqual(new ControlCenterSetupChoices(state).snapshot(), {
      schemaVersion: 1, stt: 'pending', tts: 'pending',
    });
  }
});
