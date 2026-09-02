import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUILTIN_COMMAND_BY_ID,
  BuiltinActionController,
  BuiltinCommandExecutor,
  type BuiltinCommandHost,
  type BuiltinMatchResult,
} from '../src/commands';

function definition(id: string) {
  const value = BUILTIN_COMMAND_BY_ID.get(id);
  assert.ok(value);
  return value;
}

function match(id: string): Extract<BuiltinMatchResult, { status: 'matched' }> {
  return { status: 'matched', definition: definition(id), slots: {} };
}

test('risk actions require one payload-free native confirmation while automatic actions do not', async () => {
  const calls: string[] = [];
  let prompts = 0;
  const host: BuiltinCommandHost = {
    isAvailable: async () => true,
    captureTarget: async () => ({ fingerprint: 'target:1', workspaceTrusted: true }),
    execute: async (command) => { calls.push(command.id); },
  };
  const listeners = new Set<() => void>();
  const auto = {
    snapshot: () => ({ effective: false, epoch: 0, fingerprint: 'auto:off' }),
    onWillChange: (listener: () => void) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
  };
  const executor = new BuiltinCommandExecutor(host, host, auto);
  const controller = new BuiltinActionController(executor, auto, {
    confirm: async () => { prompts += 1; return true; },
  });
  assert.equal((await controller.request(match('voiceInput.builtin.edit.copy'))).status, 'executed');
  assert.equal(prompts, 0);
  const pending = await controller.request(match('voiceInput.builtin.file.save'));
  assert.equal(pending.status, 'confirmation-required');
  assert.deepEqual(Object.keys(controller.pendingSummary ?? {}).sort(), [
    'commandId',
    'label',
    'riskTier',
  ]);
  assert.doesNotMatch(
    JSON.stringify(pending),
    /nonce|epoch|expir|fingerprint|target|authority/iu,
  );
  assert.equal(prompts, 0);
  assert.equal((await controller.confirmPending()).status, 'executed');
  assert.equal(prompts, 1);
  assert.deepEqual(calls, ['voiceInput.builtin.edit.copy', 'voiceInput.builtin.file.save']);
});

test('Auto skips only the extension prompt and invalidation cancels stale authority', async () => {
  let authority = { effective: true, epoch: 3, fingerprint: 'auto:on:3' };
  const listeners = new Set<() => void>();
  let dispatches = 0;
  const host: BuiltinCommandHost = {
    isAvailable: async () => true,
    captureTarget: async () => ({ fingerprint: 'target:1', workspaceTrusted: true }),
    execute: async () => { dispatches += 1; },
  };
  const auto = {
    snapshot: () => authority,
    onWillChange: (listener: () => void) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
  };
  const controller = new BuiltinActionController(
    new BuiltinCommandExecutor(host, host, auto),
    auto,
    { confirm: async () => assert.fail('Auto must not prompt') },
  );
  assert.equal((await controller.request(match('voiceInput.builtin.file.save'))).status, 'executed');
  assert.equal(dispatches, 1);

  authority = { effective: false, epoch: 4, fingerprint: 'auto:off:4' };
  for (const listener of listeners) listener();
  assert.equal((await controller.request(match('voiceInput.builtin.file.save'))).status, 'confirmation-required');
  for (const listener of listeners) listener();
  assert.deepEqual(await controller.confirmPending(), { status: 'blocked', reason: 'cancelled' });
  assert.equal(dispatches, 1);
});

test('native confirmation is one-shot, consume-before-dispatch, and replay-safe', async () => {
  let dispatches = 0;
  let prompts = 0;
  let resolvePrompt: ((confirmed: boolean) => void) | undefined;
  let markPromptStarted: (() => void) | undefined;
  let controller: BuiltinActionController;
  const promptStarted = new Promise<void>((resolve) => { markPromptStarted = resolve; });
  const host: BuiltinCommandHost = {
    isAvailable: async () => true,
    captureTarget: async () => ({ fingerprint: 'target:1', workspaceTrusted: true }),
    execute: async () => {
      assert.equal(controller.pendingSummary, undefined, 'authority must be consumed before dispatch');
      dispatches += 1;
    },
  };
  const auto = fixedAutoAuthority();
  controller = new BuiltinActionController(
    new BuiltinCommandExecutor(host, host, auto),
    auto,
    {
      confirm: async () => {
        prompts += 1;
        markPromptStarted?.();
        return await new Promise<boolean>((resolve) => { resolvePrompt = resolve; });
      },
    },
    { nonceFactory: () => 'A'.repeat(43) },
  );

  assert.equal((await controller.request(match('voiceInput.builtin.file.save'))).status, 'confirmation-required');
  const firstCallback = controller.confirmPending();
  await promptStarted;
  assert.deepEqual(await controller.confirmPending(), { status: 'blocked', reason: 'cancelled' });
  resolvePrompt?.(true);
  assert.equal((await firstCallback).status, 'executed');
  assert.deepEqual(await controller.confirmPending(), { status: 'blocked', reason: 'cancelled' });
  assert.equal(prompts, 1);
  assert.equal(dispatches, 1);
});

test('selection mutation during the native callback cancels before consume and dispatch', async () => {
  let selection = 3;
  let targetCaptures = 0;
  let dispatches = 0;
  let resolvePrompt: ((confirmed: boolean) => void) | undefined;
  let markPromptStarted: (() => void) | undefined;
  let controller: BuiltinActionController;
  const promptStarted = new Promise<void>((resolve) => { markPromptStarted = resolve; });
  const host: BuiltinCommandHost = {
    isAvailable: async () => true,
    captureTarget: async () => {
      targetCaptures += 1;
      if (targetCaptures === 2) {
        assert.equal(
          controller.pendingSummary?.commandId,
          'voiceInput.builtin.file.save',
          'authority must remain unconsumed until live target capture completes',
        );
      }
      return {
        fingerprint: `workspace:one:document:file.ts:selection:${selection}`,
        workspaceTrusted: true,
      };
    },
    execute: async () => { dispatches += 1; },
  };
  const auto = fixedAutoAuthority();
  controller = new BuiltinActionController(
    new BuiltinCommandExecutor(host, host, auto),
    auto,
    {
      confirm: async () => {
        markPromptStarted?.();
        return await new Promise<boolean>((resolve) => { resolvePrompt = resolve; });
      },
    },
    { nonceFactory: () => 'A'.repeat(43) },
  );

  assert.equal((await controller.request(match('voiceInput.builtin.file.save'))).status, 'confirmation-required');
  const confirmation = controller.confirmPending();
  await promptStarted;
  selection = 9;
  resolvePrompt?.(true);

  assert.deepEqual(await confirmation, { status: 'blocked', reason: 'cancelled' });
  assert.equal(controller.pendingSummary, undefined);
  assert.equal(targetCaptures, 2, 'target must be re-captured before authority consumption');
  assert.equal(dispatches, 0);
});

test('a newer action epoch rejects a late callback without consuming the new pending action', async () => {
  const dispatched: string[] = [];
  let prompts = 0;
  let resolveFirstPrompt: ((confirmed: boolean) => void) | undefined;
  let markFirstPromptStarted: (() => void) | undefined;
  const firstPromptStarted = new Promise<void>((resolve) => { markFirstPromptStarted = resolve; });
  const host: BuiltinCommandHost = {
    isAvailable: async () => true,
    captureTarget: async () => ({ fingerprint: 'target:1', workspaceTrusted: true }),
    execute: async (command) => { dispatched.push(command.id); },
  };
  const auto = fixedAutoAuthority();
  const nonces = ['A'.repeat(43), 'B'.repeat(43)];
  const controller = new BuiltinActionController(
    new BuiltinCommandExecutor(host, host, auto),
    auto,
    {
      confirm: async () => {
        prompts += 1;
        if (prompts > 1) return true;
        markFirstPromptStarted?.();
        return await new Promise<boolean>((resolve) => { resolveFirstPrompt = resolve; });
      },
    },
    { nonceFactory: () => nonces.shift() ?? '' },
  );

  assert.equal((await controller.request(match('voiceInput.builtin.file.save'))).status, 'confirmation-required');
  const staleCallback = controller.confirmPending();
  await firstPromptStarted;
  assert.equal((await controller.request(match('voiceInput.builtin.file.saveAll'))).status, 'confirmation-required');
  resolveFirstPrompt?.(true);
  assert.deepEqual(await staleCallback, { status: 'blocked', reason: 'cancelled' });
  assert.equal(controller.pendingSummary?.commandId, 'voiceInput.builtin.file.saveAll');
  assert.equal((await controller.confirmPending()).status, 'executed');
  assert.deepEqual(dispatched, ['voiceInput.builtin.file.saveAll']);
});

test('expired and late native confirmations fail closed with an injected clock', async () => {
  let now = 1_000;
  let dispatches = 0;
  let prompts = 0;
  let resolvePrompt: ((confirmed: boolean) => void) | undefined;
  const nonces = ['A'.repeat(43), 'B'.repeat(43)];
  const host: BuiltinCommandHost = {
    isAvailable: async () => true,
    captureTarget: async () => ({ fingerprint: 'target:1', workspaceTrusted: true }),
    execute: async () => { dispatches += 1; },
  };
  const auto = fixedAutoAuthority();
  const controller = new BuiltinActionController(
    new BuiltinCommandExecutor(host, host, auto),
    auto,
    {
      confirm: async () => {
        prompts += 1;
        return await new Promise<boolean>((resolve) => { resolvePrompt = resolve; });
      },
    },
    {
      pendingTtlMs: 50,
      now: () => now,
      nonceFactory: () => nonces.shift() ?? '',
    },
  );

  assert.equal((await controller.request(match('voiceInput.builtin.file.save'))).status, 'confirmation-required');
  now += 50;
  assert.deepEqual(await controller.confirmPending(), { status: 'blocked', reason: 'cancelled' });
  assert.equal(prompts, 0);

  now += 1;
  assert.equal((await controller.request(match('voiceInput.builtin.file.save'))).status, 'confirmation-required');
  const lateCallback = controller.confirmPending();
  await Promise.resolve();
  now += 50;
  resolvePrompt?.(true);
  assert.deepEqual(await lateCallback, { status: 'blocked', reason: 'cancelled' });
  assert.equal(prompts, 1);
  assert.equal(dispatches, 0);
});

test('host context changes invalidate pending authority without exposing a binding', async () => {
  let contextFingerprint = 'panel:1';
  let prompts = 0;
  let dispatches = 0;
  const host: BuiltinCommandHost = {
    isAvailable: async () => true,
    captureTarget: async () => ({ fingerprint: 'target:1', workspaceTrusted: true }),
    execute: async () => { dispatches += 1; },
  };
  const auto = fixedAutoAuthority();
  const controller = new BuiltinActionController(
    new BuiltinCommandExecutor(host, host, auto),
    auto,
    { confirm: async () => { prompts += 1; return true; } },
    {
      contextFingerprint: () => contextFingerprint,
      nonceFactory: () => 'A'.repeat(43),
    },
  );

  assert.equal((await controller.request(match('voiceInput.builtin.file.save'))).status, 'confirmation-required');
  contextFingerprint = 'panel:2';
  assert.deepEqual(await controller.confirmPending(), { status: 'blocked', reason: 'cancelled' });
  assert.equal(prompts, 0);
  assert.equal(dispatches, 0);
});

function fixedAutoAuthority() {
  return {
    snapshot: () => ({ effective: false, epoch: 0, fingerprint: 'auto:off' }),
    onWillChange: () => ({ dispose: () => undefined }),
  };
}
