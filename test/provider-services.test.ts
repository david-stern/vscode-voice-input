import assert from 'node:assert/strict';
import test from 'node:test';

import { ConsentService, CredentialService, type GlobalStatePort, type SecretStoragePort } from '../src/config';
import {
  ConnectionTestController,
  ConnectionTestService,
  HttpConnectionProbe,
  createDeepSeekConnectionProbe,
  createPlannerConnectionProbe,
  createSonioxConnectionProbe,
  type ConnectionTestResult,
  type ProviderFetch,
} from '../src/providers';

class MemorySecrets implements SecretStoragePort {
  readonly values = new Map<string, string>();
  onGet: ((key: string) => Promise<string | undefined>) | undefined;
  async get(key: string): Promise<string | undefined> {
    return this.onGet ? this.onGet(key) : this.values.get(key);
  }
  async store(key: string, value: string): Promise<void> { this.values.set(key, value); }
  async delete(key: string): Promise<void> { this.values.delete(key); }
}

class MemoryState implements GlobalStatePort {
  readonly values = new Map<string, unknown>();
  onUpdate: ((key: string, value: unknown) => Promise<void>) | undefined;
  get<T>(key: string, fallback: T): T {
    return (this.values.has(key) ? this.values.get(key) : fallback) as T;
  }
  async update(key: string, value: unknown): Promise<void> {
    await this.onUpdate?.(key, value);
    this.values.set(key, value);
  }
}

test('provider barrel preserves the callable DeepSeek probe factory', async () => {
  const calls: Array<{ input: string; authorization: string | undefined }> = [];
  const probe = createDeepSeekConnectionProbe({
    fetch: async (input, init) => {
      calls.push({ input, authorization: init.headers.Authorization });
      return { ok: true, status: 200 };
    },
  });

  assert.equal(await probe.probe('compatibility-secret'), 'connected');
  assert.deepEqual(calls, [{
    input: 'https://api.deepseek.com/models',
    authorization: 'Bearer compatibility-secret',
  }]);
});

test('provider adapters discard bodies and return a fixed secret-free result', async () => {
  const secret = 'secret-never-project';
  let discarded = false;
  const fetch: ProviderFetch = async (_input, init) => {
    assert.equal(init.headers.Authorization, `Bearer ${secret}`);
    return {
      ok: true,
      status: 200,
      body: { cancel: () => { discarded = true; } },
    };
  };
  const secrets = new MemorySecrets();
  const credentials = new CredentialService(secrets);
  await credentials.set('soniox', secret);
  const consent = new ConsentService(new MemoryState());
  const service = new ConnectionTestService({
    credentials,
    consent,
    probes: {
      soniox: createSonioxConnectionProbe({ fetch }),
      deepseek: createPlannerConnectionProbe('deepseek', { fetch }),
    },
  });

  const result = await service.test('soniox');
  assert.deepEqual(result, { provider: 'soniox', category: 'connected' });
  assert.equal(discarded, true);
  const projection = JSON.stringify(result);
  assert.doesNotMatch(projection, /secret-never-project|api\.soniox|models|Bearer|200/u);
});

test('HTTP status, raw errors, cancellation and timeout are sanitized', async () => {
  const responseProbe = (status: number) => new HttpConnectionProbe({
    endpoint: 'https://private.invalid/private/path',
    authorization: (credential) => `Private ${credential}`,
    fetch: async () => ({ ok: false, status }),
  });
  assert.equal(await responseProbe(401).probe('secret'), 'unauthorized');
  assert.equal(await responseProbe(429).probe('secret'), 'rate-limited');
  assert.equal(await responseProbe(422).probe('secret'), 'rejected');
  assert.equal(await responseProbe(503).probe('secret'), 'unavailable');

  const rawFailure = new HttpConnectionProbe({
    endpoint: 'https://private.invalid/private/path',
    authorization: (credential) => `Private ${credential}`,
    fetch: async () => { throw new Error('secret /home/david/private response-body'); },
  });
  assert.equal(await rawFailure.probe('secret'), 'unavailable');

  const never = new HttpConnectionProbe({
    endpoint: 'https://private.invalid/private/path',
    authorization: (credential) => `Private ${credential}`,
    timeoutMs: 5,
    fetch: () => new Promise(() => undefined),
  });
  assert.equal(await never.probe('secret'), 'timed-out');

  const cancel = new AbortController();
  const cancelled = new HttpConnectionProbe({
    endpoint: 'https://private.invalid/private/path',
    authorization: (credential) => `Private ${credential}`,
    fetch: () => new Promise(() => undefined),
  });
  const pending = cancelled.probe('secret', cancel.signal);
  cancel.abort();
  assert.equal(await pending, 'cancelled');
});

test('a broken response-body cancellation cannot make a completed probe unbounded', async () => {
  const probe = new HttpConnectionProbe({
    endpoint: 'https://private.invalid/private/path',
    authorization: (credential) => `Private ${credential}`,
    timeoutMs: 5,
    fetch: async () => ({
      ok: true,
      status: 200,
      body: { cancel: () => new Promise<void>(() => undefined) },
    }),
  });
  const outcome = await Promise.race([
    probe.probe('secret'),
    new Promise<'test-deadline'>((resolve) => setTimeout(() => resolve('test-deadline'), 50)),
  ]);
  assert.equal(outcome, 'connected');
});

test('connection tests require configured credentials and DeepSeek consent', async () => {
  const secrets = new MemorySecrets();
  const credentials = new CredentialService(secrets);
  const state = new MemoryState();
  const consent = new ConsentService(state);
  let calls = 0;
  const probe = { probe: async () => { calls += 1; return 'connected' as const; } };
  const service = new ConnectionTestService({
    credentials,
    consent,
    probes: { soniox: probe, deepseek: probe },
  });

  assert.deepEqual(await service.test('soniox'), {
    provider: 'soniox', category: 'not-configured',
  });
  await credentials.set('deepseek', 'secret');
  assert.deepEqual(await service.test('deepseek'), {
    provider: 'deepseek', category: 'consent-required',
  });
  assert.equal(calls, 0);
  await consent.acknowledge('deepseek');
  assert.deepEqual(await service.test('deepseek'), {
    provider: 'deepseek', category: 'connected',
  });
  assert.equal(calls, 1);
});

test('DeepSeek consent is rechecked after credential retrieval and before probe dispatch', async () => {
  const secrets = new MemorySecrets();
  const credentials = new CredentialService(secrets);
  const consent = new ConsentService(new MemoryState());
  await credentials.set('deepseek', 'private-key');
  await consent.acknowledge('deepseek');
  const credentialRead = deferred<void>();
  const releaseCredential = deferred<void>();
  secrets.onGet = async () => {
    credentialRead.resolve(undefined);
    await releaseCredential.promise;
    return 'private-key';
  };
  let probes = 0;
  const service = new ConnectionTestService({
    credentials,
    consent,
    probes: {
      soniox: { probe: async () => 'connected' },
      deepseek: {
        probe: async () => {
          probes += 1;
          return 'connected';
        },
      },
    },
  });

  const pending = service.test('deepseek');
  await credentialRead.promise;
  await consent.revoke('deepseek');
  releaseCredential.resolve(undefined);

  assert.deepEqual(await pending, {
    provider: 'deepseek',
    category: 'consent-required',
  });
  assert.equal(probes, 0);
});

test('a pending persisted revoke blocks a new DeepSeek probe immediately', async () => {
  const secrets = new MemorySecrets();
  const credentials = new CredentialService(secrets);
  const state = new MemoryState();
  const consent = new ConsentService(state);
  await credentials.set('deepseek', 'private-key');
  await consent.acknowledge('deepseek');
  const release = deferred<void>();
  state.onUpdate = async () => release.promise;
  let probes = 0;
  const service = new ConnectionTestService({
    credentials,
    consent,
    probes: {
      soniox: { probe: async () => 'connected' },
      deepseek: { probe: async () => { probes += 1; return 'connected'; } },
    },
  });

  const revoke = consent.revoke('deepseek');
  assert.deepEqual(await service.test('deepseek'), {
    provider: 'deepseek',
    category: 'consent-required',
  });
  assert.equal(probes, 0);
  release.resolve(undefined);
  await revoke;
});

test('stale connection completions cannot publish over a newer revision', async () => {
  const pending: ((result: ConnectionTestResult) => void)[] = [];
  const controller = new ConnectionTestController({
    test: (provider) => new Promise<ConnectionTestResult>((resolve) => {
      pending.push((result) => resolve({ ...result, provider }));
    }),
  });

  const first = controller.run('soniox');
  const second = controller.run('deepseek');
  pending[1]({ provider: 'deepseek', category: 'connected' });
  assert.deepEqual(await second, {
    revision: 2,
    publish: true,
    result: { provider: 'deepseek', category: 'connected' },
  });
  pending[0]({ provider: 'soniox', category: 'unavailable' });
  assert.deepEqual(await first, { revision: 1, publish: false });
});

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
