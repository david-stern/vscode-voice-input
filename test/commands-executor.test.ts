import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUILTIN_COMMAND_BY_ID,
  BuiltinCommandExecutor,
  type BuiltinCommandHost,
  type BuiltinMatchResult,
} from '../src/commands';

function command(id: string) {
  const found = BUILTIN_COMMAND_BY_ID.get(id);
  assert.ok(found);
  return found;
}

function host(overrides: Partial<BuiltinCommandHost> = {}): BuiltinCommandHost & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    captureTarget: async () => ({ fingerprint: 'target-1', workspaceTrusted: true }),
    isAvailable: async () => true,
    execute: async (definition) => { calls.push(definition.id); },
    ...overrides,
  };
}

test('prepared execution revalidates target and serializes dispatch', async () => {
  let fingerprint = 'target-1';
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const nonGit = host({
    captureTarget: async () => ({ fingerprint, workspaceTrusted: true }),
    execute: async () => gate,
  });
  const executor = new BuiltinCommandExecutor(nonGit, host());
  const definition = command('voiceInput.builtin.edit.copy');
  const match = { status: 'matched', definition, slots: {} } as const satisfies BuiltinMatchResult;
  const prepared = await executor.prepare(match);
  assert.ok(prepared);

  fingerprint = 'target-2';
  assert.deepEqual(await executor.execute(prepared), { ok: false, reason: 'target-changed' });
  fingerprint = 'target-1';
  const running = executor.execute(prepared);
  await Promise.resolve();
  assert.deepEqual(await executor.execute(prepared), { ok: false, reason: 'busy' });
  release();
  assert.deepEqual(await running, { ok: true, commandId: definition.id });
});

test('Git is blocked in every remote environment and rejection is never retryable', async () => {
  const gitRemote = host({
    captureTarget: async () => ({
      fingerprint: 'git-target',
      workspaceTrusted: true,
      remoteName: 'wsl',
    }),
  });
  const executor = new BuiltinCommandExecutor(host(), gitRemote);
  const definition = command('voiceInput.builtin.git.push');
  const match = { status: 'matched', definition, slots: {} } as const satisfies BuiltinMatchResult;
  assert.equal(await executor.prepare(match), undefined);

  const gitUnknown = host({ execute: async () => { throw new Error('private git error'); } });
  const unknownExecutor = new BuiltinCommandExecutor(host(), gitUnknown);
  const prepared = await unknownExecutor.prepare(match);
  assert.ok(prepared);
  assert.deepEqual(await unknownExecutor.execute(prepared), {
    ok: false,
    reason: 'outcome-unknown-do-not-retry',
  });
});
