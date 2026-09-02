import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTO_MODE_ENABLE_REQUEST_TTL_MS,
  AUTO_MODE_RECEIPT_KEY,
  AutoModeAuthorityCache,
  AutoModeService,
  enableAutoModeWithNativePrompt,
  type AutoModeContext,
} from '../src/config/autoMode';
import type { GlobalStatePort } from '../src/config/consent';
import type { SecretStoragePort } from '../src/config/credentials';

class MemoryState implements GlobalStatePort {
  readonly values = new Map<string, unknown>();
  get<T>(key: string, fallback: T): T { return (this.values.has(key) ? this.values.get(key) : fallback) as T; }
  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) this.values.delete(key);
    else this.values.set(key, value);
  }
}

class MemorySecrets implements SecretStoragePort {
  readonly values = new Map<string, string>();
  onGet: ((key: string) => Promise<string | undefined>) | undefined;
  async get(key: string): Promise<string | undefined> {
    return this.onGet ? this.onGet(key) : this.values.get(key);
  }
  async store(key: string, value: string): Promise<void> { this.values.set(key, value); }
  async delete(key: string): Promise<void> { this.values.delete(key); }
}

const context: AutoModeContext = {
  workspaceTrusted: true,
  consentVersion: 1,
  policyFingerprint: 'policy:1',
  targetFingerprint: 'target:1',
};

function service(
  state = new MemoryState(),
  secrets = new MemorySecrets(),
  now: () => number = () => 100,
) {
  return {
    state,
    secrets,
    value: new AutoModeService(state, secrets, now, () => 'n'.repeat(43), () => 'r'.repeat(32)),
  };
}

test('fresh/raw/synced/forged state is off and native confirmation is required', async () => {
  const first = service();
  assert.equal((await first.value.snapshot(context)).effective, false);
  first.state.values.set(AUTO_MODE_RECEIPT_KEY, true);
  assert.equal((await first.value.snapshot(context)).effective, false);

  const request = await first.value.beginEnable(context);
  assert.ok(request);
  assert.equal(await first.value.completeEnable(request.requestId, false, context), false);
  assert.equal((await first.value.snapshot(context)).effective, false);

  const enabled = await enableAutoModeWithNativePrompt(
    first.value,
    context,
    { confirmEnable: async () => true },
    () => context,
  );
  assert.equal(enabled, true);
  assert.equal((await first.value.snapshot(context)).effective, true);

  const synced = service();
  synced.state.values.set(AUTO_MODE_RECEIPT_KEY, first.state.values.get(AUTO_MODE_RECEIPT_KEY));
  assert.equal((await synced.value.snapshot(context)).effective, false, 'another installation nonce rejects import');
});

test('same-installation reload persists only authentic current receipt', async () => {
  const original = service();
  const request = await original.value.beginEnable(context);
  assert.ok(request);
  assert.equal(await original.value.completeEnable(request.requestId, true, context), true);
  const reloaded = new AutoModeService(original.state, original.secrets, () => 200);
  assert.equal((await reloaded.snapshot(context)).effective, true);

  const forged = { ...(original.state.values.get(AUTO_MODE_RECEIPT_KEY) as Record<string, unknown>), epoch: 999 };
  original.state.values.set(AUTO_MODE_RECEIPT_KEY, forged);
  assert.equal((await reloaded.snapshot(context)).effective, false);
});

test('disable is immediate and epoch makes replay, consent bump, and stale prompts fail closed', async () => {
  const current = service();
  const request = await current.value.beginEnable(context);
  assert.ok(request);
  assert.equal(await current.value.completeEnable(request.requestId, true, context), true);
  const receipt = current.state.values.get(AUTO_MODE_RECEIPT_KEY);

  const disabling = current.value.disable();
  assert.equal((await current.value.snapshot(context)).effective, false);
  await disabling;
  current.state.values.set(AUTO_MODE_RECEIPT_KEY, receipt);
  assert.equal((await current.value.snapshot(context)).effective, false, 'old epoch cannot replay');
  assert.equal((await current.value.snapshot({ ...context, consentVersion: 2 })).effective, false);

  const stale = await current.value.beginEnable(context);
  assert.ok(stale);
  assert.equal(await current.value.completeEnable(stale.requestId, true, {
    ...context,
    targetFingerprint: 'target:changed',
  }), false);
});

test('synchronous authority cache invalidates before asynchronous disable persistence', async () => {
  const current = service();
  const cache = new AutoModeAuthorityCache(current.value);
  await cache.refresh(context);
  const request = await current.value.beginEnable(context);
  assert.ok(request);
  assert.equal(await current.value.completeEnable(request.requestId, true, context), true);
  await cache.refresh(context);
  assert.equal(cache.snapshot().effective, true);
  const disabling = current.value.disable();
  assert.equal(cache.snapshot().effective, false);
  await disabling;
  cache.dispose();
});

test('native Auto confirmation expires before completion and while the serialized commit is waiting', async () => {
  let now = 1_000;
  const expiredBeforeCommit = service(new MemoryState(), new MemorySecrets(), () => now);
  const expiredRequest = await expiredBeforeCommit.value.beginEnable(context);
  assert.ok(expiredRequest);
  now += AUTO_MODE_ENABLE_REQUEST_TTL_MS + 1;
  assert.equal(
    await expiredBeforeCommit.value.completeEnable(expiredRequest.requestId, true, context),
    false,
  );
  assert.equal(expiredBeforeCommit.state.values.has(AUTO_MODE_RECEIPT_KEY), false);

  now = 2_000;
  const state = new MemoryState();
  const secrets = new MemorySecrets();
  const delayedCommit = service(state, secrets, () => now);
  const queuedRequest = await delayedCommit.value.beginEnable(context);
  assert.ok(queuedRequest);
  const readStarted = deferred<void>();
  const releaseRead = deferred<void>();
  secrets.onGet = async (key) => {
    readStarted.resolve(undefined);
    await releaseRead.promise;
    return secrets.values.get(key);
  };

  const completing = delayedCommit.value.completeEnable(queuedRequest.requestId, true, context);
  await readStarted.promise;
  now += AUTO_MODE_ENABLE_REQUEST_TTL_MS + 1;
  releaseRead.resolve(undefined);

  assert.equal(await completing, false);
  assert.equal(state.values.has(AUTO_MODE_RECEIPT_KEY), false);
  assert.equal((await delayedCommit.value.snapshot(context)).effective, false);
});

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
