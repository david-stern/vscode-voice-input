import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUILTIN_COMMAND_BY_ID,
  BUILTIN_OVERRIDE_STORAGE_KEY,
  BuiltinOverrideStore,
  applyBuiltinOverride,
  type BuiltinOverrideStorage,
} from '../src/commands';

class MemoryStorage implements BuiltinOverrideStorage {
  readonly values = new Map<string, unknown>();
  get<T>(key: string): T | undefined { return this.values.get(key) as T | undefined; }
  async update(key: string, value: unknown): Promise<void> { this.values.set(key, value); }
}

test('override storage persists bounded presentation diffs only', async () => {
  const storage = new MemoryStorage();
  const store = new BuiltinOverrideStore(storage);
  assert.deepEqual(store.load(), { corrupted: false, count: 0 });
  const id = 'voiceInput.builtin.edit.copy';
  await store.set(id, {
    enabled: false,
    label: { en: 'Copy selection', he: 'העתק בחירה' },
    phrases: { en: ['copy selection'], he: ['העתק בחירה'] },
  });
  const persisted = storage.values.get(BUILTIN_OVERRIDE_STORAGE_KEY) as Record<string, unknown>;
  assert.equal(JSON.stringify(persisted).includes('executor'), false);
  assert.equal(JSON.stringify(persisted).includes('slots'), false);

  const base = BUILTIN_COMMAND_BY_ID.get(id);
  assert.ok(base);
  const effective = applyBuiltinOverride(base, store.get(id));
  assert.equal(effective.enabledByDefault, false);
  assert.equal(effective.executorId, base.executorId);
  assert.deepEqual(effective.slots, base.slots);
});

test('unknown fields, unknown IDs, and oversized phrases fail closed', async () => {
  const store = new BuiltinOverrideStore(new MemoryStorage());
  await assert.rejects(store.set('voiceInput.builtin.unknown', { enabled: true }), /unknown/u);
  await assert.rejects(store.set('voiceInput.builtin.edit.copy', {
    executorId: 'workbench.action.closeWindow',
  }));
  await assert.rejects(store.set('voiceInput.builtin.edit.copy', {
    phrases: { en: ['x'.repeat(121)], he: ['תקין'] },
  }));
});
