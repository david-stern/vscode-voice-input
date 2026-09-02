import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SONIOX_CONSENT_PROMPT_TTL_MS,
  ConsentService,
  CredentialService,
  SONIOX_REMOTE_CONSENT_RECEIPT_KEY,
  SONIOX_REMOTE_CONSENT_SECRET_KEY,
  SONIOX_SECRET_KEY,
  SonioxRemoteConsentService,
  requestSonioxConsentWithNativePrompt,
  type SecretStorageChange,
} from '../src/config';
import { ConnectionTestService } from '../src/providers/connection';
import type { StreamingTranscriptionOptions } from '../src/speech/contracts';
import { SpeechProviderRegistry } from '../src/speech/providerRegistry';
import type { SonioxWebSocketTransport } from '../src/speech/soniox/transport';

class State {
  readonly values = new Map<string, unknown>();
  gate: Promise<void> | undefined;
  updateStarted: (() => void) | undefined;
  get<T>(key: string, fallback: T): T {
    return (this.values.has(key) ? this.values.get(key) : fallback) as T;
  }
  async update(key: string, value: unknown): Promise<void> {
    this.updateStarted?.();
    await this.gate;
    if (value === undefined) this.values.delete(key);
    else this.values.set(key, value);
  }
}

class Secrets {
  readonly values = new Map<string, string>();
  private readonly listeners = new Set<(event: SecretStorageChange) => unknown>();
  getGateKey: string | undefined;
  getGate: Promise<void> | undefined;
  getStarted: (() => void) | undefined;
  storeGateKey: string | undefined;
  storeGate: Promise<void> | undefined;
  storeStarted: (() => void) | undefined;
  afterEmit: ((key: string) => void) | undefined;
  async get(key: string) {
    if (key === this.getGateKey) {
      this.getStarted?.();
      await this.getGate;
    }
    return this.values.get(key);
  }
  async store(key: string, value: string) {
    this.values.set(key, value);
    this.emit(key);
    if (key === this.storeGateKey) {
      this.storeStarted?.();
      await this.storeGate;
    }
  }
  async delete(key: string) {
    this.values.delete(key);
    this.emit(key);
  }
  onDidChange(listener: (event: SecretStorageChange) => unknown) {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }
  get listenerCount(): number { return this.listeners.size; }
  private emit(key: string): void {
    for (const listener of [...this.listeners]) listener({ key });
    this.afterEmit?.(key);
  }
}

class OpeningSocket implements SonioxWebSocketTransport {
  readyState = 0;
  readonly sent: unknown[] = [];
  readonly closes: Array<{ code?: number; reason?: string }> = [];
  private readonly listeners = new Map<string, Set<(event: never) => void>>();
  send(data: string | ArrayBuffer | ArrayBufferView): void { this.sent.push(data); }
  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.closes.push({ code, reason });
  }
  addEventListener(type: string, listener: (event: never) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: string, listener: (event: never) => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  open(): void {
    this.readyState = 1;
    for (const listener of [...(this.listeners.get('open') ?? [])]) {
      listener({ type: 'open' } as never);
    }
  }
}

const STREAMING_OPTIONS: StreamingTranscriptionOptions = {
  sampleRateHz: 16_000,
  channels: 1,
  onTranscript: () => {},
};

const baseContext = () => ({
  selection: 'soniox' as const,
  profileIdentity: 'profile-a',
  credentialRevision: 4,
  focused: true,
  panelGeneration: 2,
});

test('Soniox remote consent is native-prompt-only and reloads on the same installation', async () => {
  const state = new State();
  const secrets = new Secrets();
  await secrets.store(SONIOX_SECRET_KEY, 'private-key');
  const service = new SonioxRemoteConsentService(state, secrets, baseContext);
  assert.equal(await service.capture(), undefined);
  assert.equal(await requestSonioxConsentWithNativePrompt(service, {
    confirmRemoteProcessing: async () => false,
  }), false);
  assert.equal(state.values.has(SONIOX_REMOTE_CONSENT_RECEIPT_KEY), false);
  assert.equal(await requestSonioxConsentWithNativePrompt(service, {
    confirmRemoteProcessing: async () => true,
  }), true);
  const authority = await service.capture();
  assert.ok(authority);
  assert.equal(await service.revalidate(authority!), true);
  const reload = new SonioxRemoteConsentService(state, secrets, baseContext);
  assert.ok(await reload.capture());
  const otherInstallation = new SonioxRemoteConsentService(state, new Secrets(), baseContext);
  assert.equal(await otherInstallation.capture(), undefined);
});

test('credential binding survives reload and a replacement invalidates the prior receipt', async () => {
  const state = new State();
  const secrets = new Secrets();
  const credentials = new CredentialService(secrets);
  await credentials.set('soniox', 'first-key');
  let credentialRevision = await credentials.persistentRevision('soniox');
  const context = () => ({ ...baseContext(), credentialRevision });
  const service = new SonioxRemoteConsentService(state, secrets, context);
  assert.equal(await requestSonioxConsentWithNativePrompt(service, {
    confirmRemoteProcessing: async () => true,
  }), true);

  const reloadedCredentials = new CredentialService(secrets);
  credentialRevision = await reloadedCredentials.persistentRevision('soniox');
  assert.ok(await new SonioxRemoteConsentService(state, secrets, context).capture());

  await reloadedCredentials.set('soniox', 'replacement-key');
  credentialRevision = await reloadedCredentials.persistentRevision('soniox');
  assert.equal(await new SonioxRemoteConsentService(state, secrets, context).capture(), undefined);
});

test('focus, panel, selection and credential changes invalidate a pending prompt', async () => {
  for (const mutate of [
    (value: ReturnType<typeof baseContext>) => { value.focused = false; },
    (value: ReturnType<typeof baseContext>) => { value.panelGeneration += 1; },
    (value: ReturnType<typeof baseContext>) => { value.credentialRevision += 1; },
    (value: ReturnType<typeof baseContext>) => { value.selection = 'none' as never; },
  ]) {
    const state = new State();
    const secrets = new Secrets();
    await secrets.store(SONIOX_SECRET_KEY, 'private-key');
    const context = baseContext();
    const service = new SonioxRemoteConsentService(state, secrets, () => context);
    const request = await service.beginPrompt();
    assert.ok(request);
    mutate(context);
    assert.equal(await service.completePrompt(request!, true), false);
    assert.equal(await service.capture(), undefined);
  }
});

test('a prompt expiring after an awaited credential read writes no consent authority', async () => {
  const state = new State();
  const secrets = new Secrets();
  await secrets.store(SONIOX_SECRET_KEY, 'private-key');
  let now = 1_000;
  const service = new SonioxRemoteConsentService(state, secrets, baseContext, () => now);
  const request = await service.beginPrompt();
  assert.ok(request);
  const installationBefore = secrets.values.get('voiceInput.sonioxRemoteConsentInstallation.v1');
  const readStarted = deferred<void>();
  const releaseRead = deferred<void>();
  secrets.getGateKey = SONIOX_SECRET_KEY;
  secrets.getGate = releaseRead.promise;
  secrets.getStarted = () => readStarted.resolve(undefined);

  const completing = service.completePrompt(request!, true);
  await readStarted.promise;
  now += SONIOX_CONSENT_PROMPT_TTL_MS;
  releaseRead.resolve(undefined);

  assert.equal(await completing, false);
  assert.equal(state.values.has(SONIOX_REMOTE_CONSENT_RECEIPT_KEY), false);
  assert.equal(
    secrets.values.get('voiceInput.sonioxRemoteConsentInstallation.v1'),
    installationBefore,
  );
  service.dispose();
});

test('a prompt expiring in the serialized queue mints no authority', async () => {
  const state = new State();
  const secrets = new Secrets();
  await secrets.store(SONIOX_SECRET_KEY, 'private-key');
  let now = 10_000;
  const service = new SonioxRemoteConsentService(state, secrets, baseContext, () => now);
  const initialRequest = await service.beginPrompt();
  assert.ok(initialRequest);
  const releaseState = deferred<void>();
  const updateStarted = deferred<void>();
  state.gate = releaseState.promise;
  state.updateStarted = () => updateStarted.resolve(undefined);
  const revoking = service.revoke();
  await updateStarted.promise;
  const request = await service.beginPrompt();
  assert.ok(request);
  const installationBefore = secrets.values.get('voiceInput.sonioxRemoteConsentInstallation.v1');
  const completing = service.completePrompt(request!, true);
  now += SONIOX_CONSENT_PROMPT_TTL_MS;
  releaseState.resolve(undefined);
  await revoking;

  assert.equal(await completing, false);
  assert.equal(state.values.has(SONIOX_REMOTE_CONSENT_RECEIPT_KEY), false);
  assert.equal(
    secrets.values.get('voiceInput.sonioxRemoteConsentInstallation.v1'),
    installationBefore,
  );
  assert.equal(await service.capture(), undefined);
  service.dispose();
});

test('credential revision binding and revoke close authority before persistence settles', async () => {
  const state = new State();
  const secrets = new Secrets();
  await secrets.store(SONIOX_SECRET_KEY, 'private-key');
  const context = baseContext();
  const service = new SonioxRemoteConsentService(state, secrets, () => context);
  const request = await service.beginPrompt();
  assert.equal(await service.completePrompt(request!, true), true);
  const granted = await service.capture();
  assert.ok(granted);
  context.credentialRevision += 1;
  assert.equal(await service.capture(), undefined);
  context.credentialRevision -= 1;
  let release = () => {};
  state.gate = new Promise<void>((resolve) => { release = resolve; });
  const revoking = service.revoke();
  assert.equal(await service.capture(), undefined);
  release();
  await revoking;
  assert.equal(state.values.has(SONIOX_REMOTE_CONSENT_RECEIPT_KEY), false);
});

test('dispose during a gated consent-secret commit cannot persist or restore authority', async () => {
  const state = new State();
  const secrets = new Secrets();
  await secrets.store(SONIOX_SECRET_KEY, 'private-key');
  const service = new SonioxRemoteConsentService(state, secrets, baseContext);
  const request = await service.beginPrompt();
  assert.ok(request);

  const storeStarted = deferred<void>();
  const releaseStore = deferred<void>();
  secrets.storeGateKey = SONIOX_REMOTE_CONSENT_SECRET_KEY;
  secrets.storeGate = releaseStore.promise;
  secrets.storeStarted = () => storeStarted.resolve(undefined);
  const completing = service.completePrompt(request!, true);
  await storeStarted.promise;

  service.dispose();
  service.dispose();
  assert.equal(secrets.listenerCount, 0);
  releaseStore.resolve(undefined);

  assert.equal(await completing, false);
  assert.equal(await service.capture(), undefined);
  assert.equal(state.values.has(SONIOX_REMOTE_CONSENT_RECEIPT_KEY), false);
  assert.equal(secrets.listenerCount, 0);
});

test('a second host replacement invalidates observers and cannot reuse the first host consent or prompt', async () => {
  const state = new State();
  const secrets = new Secrets();
  const firstHostCredentials = new CredentialService(secrets);
  const secondHostCredentials = new CredentialService(secrets);
  await firstHostCredentials.set('soniox', 'first-window-key');
  const credentialRevision = await firstHostCredentials.persistentRevision('soniox');
  const service = new SonioxRemoteConsentService(
    state,
    secrets,
    () => ({ ...baseContext(), credentialRevision }),
  );
  assert.equal(await requestSonioxConsentWithNativePrompt(service, {
    confirmRemoteProcessing: async () => true,
  }), true);
  const pendingPrompt = await service.beginPrompt();
  assert.ok(pendingPrompt);

  let synchronousInvalidations = 0;
  let replacingHostInvalidations = 0;
  firstHostCredentials.onDidInvalidate((event) => {
    if (event.provider === 'soniox') synchronousInvalidations += 1;
  });
  secondHostCredentials.onDidInvalidate((event) => {
    if (event.provider === 'soniox') replacingHostInvalidations += 1;
  });
  const replacing = secondHostCredentials.set('soniox', 'second-window-key');
  await replacing;
  assert.equal(synchronousInvalidations, 1, 'SecretStorage change reaches the other host once');
  assert.equal(
    replacingHostInvalidations,
    2,
    'the replacing host observes both its pre-write invalidation and SecretStorage event',
  );

  assert.equal(await service.capture(), undefined);
  assert.equal(await service.completePrompt(pendingPrompt!, true), false);
  assert.doesNotMatch(
    JSON.stringify(state.values.get(SONIOX_REMOTE_CONSENT_RECEIPT_KEY)),
    /first-window-key|second-window-key/u,
  );
  const listenersBeforeDispose = secrets.listenerCount;
  service.dispose();
  assert.equal(secrets.listenerCount, listenersBeforeDispose - 1);
  assert.equal(await service.beginPrompt(), undefined);
});

test('a second host API-key replacement synchronously cancels final, realtime, and probe operations', async () => {
  await assertCrossHostActiveCancellation('credential-replacement');
});

test('a second host consent revoke synchronously cancels final, realtime, and probe operations', async () => {
  await assertCrossHostActiveCancellation('consent-revoke');
});

async function assertCrossHostActiveCancellation(
  mutation: 'credential-replacement' | 'consent-revoke',
): Promise<void> {
  const state = new State();
  const secrets = new Secrets();
  const firstHostCredentials = new CredentialService(secrets);
  const secondHostCredentials = new CredentialService(secrets);
  await firstHostCredentials.set('soniox', 'first-window-key');
  const credentialRevision = await firstHostCredentials.persistentRevision('soniox');
  const consent = new SonioxRemoteConsentService(
    state,
    secrets,
    () => ({ ...baseContext(), credentialRevision }),
  );
  assert.equal(await requestSonioxConsentWithNativePrompt(consent, {
    confirmRemoteProcessing: async () => true,
  }), true);
  const projectedAuthority = await consent.capture();
  assert.ok(projectedAuthority);
  assert.doesNotMatch(JSON.stringify(projectedAuthority), /first-window-key|api.?key|secret/iu);
  const secondConsent = mutation === 'consent-revoke'
    ? new SonioxRemoteConsentService(
      state,
      secrets,
      () => ({ ...baseContext(), credentialRevision }),
    )
    : undefined;
  let secondConsentInvalidations = 0;
  secondConsent?.onDidInvalidate(() => { secondConsentInvalidations += 1; });

  const socket = new OpeningSocket();
  const finalStarted = deferred<void>();
  let finalSignal: AbortSignal | undefined;
  const registry = new SpeechProviderRegistry({
    selection: { read: () => 'soniox' },
    authority: consent,
    credentials: {
      use: <T>(provider: 'soniox' | 'deepseek', operation: (key: string) => Promise<T>) =>
        firstHostCredentials.use(provider, operation),
    },
    configuration: () => ({ model: 'stt-rt-v5' }),
    transportFactory: () => {
      queueMicrotask(() => socket.open());
      return socket;
    },
    transcribeFinal: async (options) => {
      finalSignal = options.signal;
      finalStarted.resolve(undefined);
      await new Promise<void>((_resolve, reject) => {
        options.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
      });
      return 'must-not-complete';
    },
  });
  const streaming = await registry.openStreaming(STREAMING_OPTIONS);
  assert.equal(streaming.status, 'ready');
  const finalPending = registry.transcribeFinal({
    audio: new Uint8Array([1, 2]), mime: 'audio/wav',
  });
  await finalStarted.promise;

  const probeStarted = deferred<void>();
  let probeSignal: AbortSignal | undefined;
  const probes = new ConnectionTestService({
    credentials: {
      use: <T>(provider: Parameters<CredentialService['use']>[0], operation: (key: string) => Promise<T>) =>
        firstHostCredentials.use(provider, operation),
      useOptional: <T>(
        provider: Parameters<CredentialService['useOptional']>[0],
        operation: (key: string | undefined) => Promise<T>,
      ) => firstHostCredentials.useOptional(provider, operation),
    },
    consent: new ConsentService(state),
    probes: {
      soniox: {
        probe: async (_credential, signal) => {
          probeSignal = signal;
          probeStarted.resolve(undefined);
          await new Promise<void>((resolve) => {
            signal?.addEventListener('abort', () => resolve(), { once: true });
          });
          return 'connected';
        },
      },
    },
    sonioxAuthority: consent,
  });
  const probePending = probes.test('soniox');
  await probeStarted.promise;

  const expectedChangedKey = mutation === 'credential-replacement'
    ? SONIOX_SECRET_KEY
    : SONIOX_REMOTE_CONSENT_SECRET_KEY;
  let boundaryAssertions = 0;
  secrets.afterEmit = (key) => {
    if (key !== expectedChangedKey) return;
    boundaryAssertions += 1;
    assert.equal(finalSignal?.aborted, true);
    assert.equal(probeSignal?.aborted, true);
    assert.equal(streaming.status === 'ready' ? streaming.value.state : 'missing', 'closed');
  };
  if (mutation === 'credential-replacement') {
    await secondHostCredentials.set('soniox', 'second-window-key');
  } else {
    await secondConsent!.revoke();
  }

  assert.equal(boundaryAssertions, 1);
  if (secondConsent) assert.equal(secondConsentInvalidations, 1, 'self event is not emitted twice');
  assert.equal(await consent.capture(), undefined);
  await assert.rejects(
    finalPending,
    (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
  );
  assert.deepEqual(await probePending, { provider: 'soniox', category: 'cancelled' });
  assert.deepEqual(socket.closes, [{ code: 1000, reason: 'cancelled' }]);
  probes.dispose();
  registry.dispose();
  secondConsent?.dispose();
  consent.dispose();
  firstHostCredentials.dispose();
  secondHostCredentials.dispose();
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
