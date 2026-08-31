import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ConsentService,
  CredentialService,
  DEFAULT_PROVIDER_PROFILES,
  PROVIDER_CONSENT_KEYS,
  PROVIDER_IDS,
  PROVIDER_SECRET_KEYS,
  SETTINGS_DEFAULTS,
  SettingsRepository,
  normalizeProviderProfiles,
  type ConfigurationInspection,
  type ConfigurationPort,
  type GlobalStatePort,
  type SecretStoragePort,
  type VoiceInputSettings,
} from '../src/config';
import type { TargetSnapshot } from '../src/assistant/context';
import { AssistantPlanningService } from '../src/features/assistant/planningService';
import {
  ConnectionTestService,
  createPlannerConnectionProbes,
  type ProviderFetch,
} from '../src/providers';
import type { AssistantPlan, PlannerClient, ProviderId } from '../src/inference';

class MemorySecrets implements SecretStoragePort {
  readonly values = new Map<string, string>();
  storeGate: Promise<void> | undefined;

  async get(key: string): Promise<string | undefined> {
    return this.values.get(key);
  }

  async store(key: string, value: string): Promise<void> {
    await this.storeGate;
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

class MemoryState implements GlobalStatePort {
  readonly values = new Map<string, unknown>();
  updateGate: Promise<void> | undefined;

  get<T>(key: string, fallback: T): T {
    return (this.values.get(key) ?? fallback) as T;
  }

  async update(key: string, value: unknown): Promise<void> {
    await this.updateGate;
    this.values.set(key, value);
  }
}

class MemoryConfiguration implements ConfigurationPort {
  readonly globals = new Map<string, unknown>();
  readonly workspace = new Map<string, unknown>();
  readonly updates: string[] = [];
  failOnce: string | undefined;

  get<T>(name: string, fallback: T): T {
    return (this.workspace.get(name) ?? this.globals.get(name) ?? fallback) as T;
  }

  inspect<T>(name: string): ConfigurationInspection<T> {
    return {
      defaultValue: SETTINGS_DEFAULTS[name as keyof VoiceInputSettings] as T,
      globalValue: this.globals.get(name) as T | undefined,
      workspaceValue: this.workspace.get(name) as T | undefined,
    };
  }

  async updateGlobal(name: string, value: unknown): Promise<void> {
    this.updates.push(name);
    if (this.failOnce === name) {
      this.failOnce = undefined;
      throw new Error('simulated configuration write failure');
    }
    this.globals.set(name, structuredClone(value));
  }
}

test('provider profiles preserve strict remote endpoints while Ollama loopback remains credential-free', async () => {
  const profiles = normalizeProviderProfiles({
    openai: { endpoint: 'http://example.test/v1', model: 'chosen-model', enabled: true },
    ollama: { endpoint: 'http://127.0.0.1:11434/api/chat', model: 'llama3.2', enabled: true },
  });
  assert.equal(profiles.openai.endpoint, DEFAULT_PROVIDER_PROFILES.openai.endpoint);
  assert.equal(profiles.ollama.endpoint, 'http://127.0.0.1:11434/api/chat');
  assert.equal(profiles.ollama.model, 'llama3.2');

  const service = new ConnectionTestService({
    credentials: {
      use: async () => undefined,
      useOptional: async (_provider, operation) => operation(undefined),
    },
    consent: {
      status: () => {
        throw new Error('a loopback Ollama probe must not ask for remote consent');
      },
    },
    settings: {
      read: () => ({
        values: settingsWith({ assistantProvider: 'ollama', providerProfiles: profiles }),
        workspaceOverrides: [],
      }),
    },
    probes: {
      ollama: {
        probe: async (credential, _signal, profile) => {
          assert.equal(credential, undefined);
          assert.equal(profile?.endpoint, profiles.ollama.endpoint);
          return 'connected';
        },
      },
    },
  });
  assert.deepEqual(await service.test('ollama'), { provider: 'ollama', category: 'connected' });
});

test('legacy DeepSeek migration is one-time, preserves selection/model, and resumes a partial write', async () => {
  const configuration = new MemoryConfiguration();
  configuration.globals.set('assistantIntelligence', 'off');
  configuration.globals.set('deepSeekModel', 'deepseek-legacy-model');
  configuration.workspace.set('assistantProvider', 'openai');
  configuration.workspace.set('providerProfiles', {
    openai: { endpoint: 'https://attacker.invalid/v1', model: 'workspace-model', enabled: true },
  });
  configuration.failOnce = 'assistantProvider';
  const repository = new SettingsRepository(configuration);

  await assert.rejects(repository.migrateLegacyDeepSeekProvider(), /simulated/u);
  assert.equal(configuration.globals.has('providerProfiles'), true);
  assert.equal(configuration.globals.has('assistantProvider'), false);
  assert.equal(repository.read().values.providerProfiles.deepseek.model, 'deepseek-legacy-model');

  assert.deepEqual(await repository.migrateLegacyDeepSeekProvider(), {
    status: 'migrated', provider: 'off', model: 'deepseek-legacy-model',
  });
  assert.equal(repository.read().values.assistantProvider, 'off');
  assert.equal(repository.read().values.providerProfiles.openai.endpoint, DEFAULT_PROVIDER_PROFILES.openai.endpoint);
  const writes = configuration.updates.length;
  assert.deepEqual(await repository.migrateLegacyDeepSeekProvider(), { status: 'not-needed' });
  assert.equal(configuration.updates.length, writes);
});

test('provider-neutral selection stays authoritative while legacy mode writes remain compatible', async () => {
  const configuration = new MemoryConfiguration();
  configuration.globals.set('assistantProvider', 'openai');
  configuration.globals.set('assistantIntelligence', 'off');
  const repository = new SettingsRepository(configuration);
  assert.equal(repository.read().values.assistantProvider, 'openai');
  assert.equal(repository.read().values.assistantIntelligence, 'deepseek');

  await repository.update({ assistantProvider: 'off' });
  assert.equal(configuration.globals.get('assistantIntelligence'), 'off');
  await repository.update({ assistantIntelligence: 'deepseek' });
  assert.equal(configuration.globals.get('assistantProvider'), 'deepseek');
});

test('provider credentials expose only status and a clear synchronously defeats an in-flight set', async () => {
  const secrets = new MemorySecrets();
  const stored = deferred<void>();
  secrets.storeGate = stored.promise;
  const credentials = new CredentialService(secrets);
  const invalidations: string[] = [];
  credentials.onDidInvalidate((event) => invalidations.push(`${event.provider}:${event.revision}`));

  const setting = credentials.set('anthropic', ' secret-value ');
  await Promise.resolve();
  const clearing = credentials.clear('anthropic');
  assert.deepEqual(await credentials.use('anthropic', async () => 'must-not-run'), undefined);
  assert.deepEqual(invalidations, ['anthropic:1']);
  stored.resolve();
  assert.deepEqual(await setting, { provider: 'anthropic', configured: false });
  await clearing;
  assert.deepEqual(await credentials.status('anthropic'), { provider: 'anthropic', configured: false });
  assert.equal(secrets.values.has(PROVIDER_SECRET_KEYS.anthropic), false);

  await credentials.set('openai', 'private-openai-token');
  const projected = JSON.stringify(await credentials.statuses());
  assert.doesNotMatch(projected, /private-openai-token|OPENAI_API_KEY/u);
  assert.deepEqual(await credentials.useOptional('ollama', async (credential) => credential), undefined);
  assert.equal(new Set(Object.values(PROVIDER_SECRET_KEYS)).size, PROVIDER_IDS.length);
  assert.equal(PROVIDER_SECRET_KEYS.bedrock, 'AWS_BEARER_TOKEN_BEDROCK');
  assert.equal(PROVIDER_SECRET_KEYS.ollama, 'OLLAMA_API_KEY');
});

test('provider consent revocation wins an in-flight acknowledgement and stays provider-scoped', async () => {
  const state = new MemoryState();
  const update = deferred<void>();
  state.updateGate = update.promise;
  const consents = new ConsentService(state);
  const events: string[] = [];
  consents.onDidRevoke((event) => events.push(`${event.id}:${event.revision}`));

  const acknowledgement = consents.acknowledge('openai');
  await Promise.resolve();
  const revocation = consents.revoke('openai');
  assert.equal(consents.status('openai').acknowledged, false);
  assert.equal(consents.status('anthropic').acknowledged, false);
  assert.deepEqual(events, ['openai:1']);
  update.resolve();
  assert.deepEqual(await acknowledgement, { id: 'openai', acknowledged: false });
  await revocation;
  assert.equal(state.values.get(PROVIDER_CONSENT_KEYS.openai), false);
});

test('generalized planner probes use provider-native GET paths and never include a request body', async () => {
  const calls: Array<{ provider: ProviderId; endpoint: string; init: Parameters<ProviderFetch>[1] }> = [];
  for (const provider of PROVIDER_IDS.filter((id) => id !== 'soniox')) {
    const fetch: ProviderFetch = async (endpoint, init) => {
      calls.push({ provider, endpoint, init });
      return { ok: true, status: 200 };
    };
    const probes = createPlannerConnectionProbes({ [provider]: { fetch } });
    const result = await probes[provider].probe(
      provider === 'ollama' ? undefined : 'probe-credential',
      undefined,
      { ...DEFAULT_PROVIDER_PROFILES[provider] },
    );
    assert.equal(result, 'connected', provider);
  }

  assert.equal(calls.length, 8);
  for (const call of calls) {
    assert.equal(call.init.method, 'GET', call.provider);
    assert.equal('body' in call.init, false, call.provider);
    assert.doesNotMatch(call.endpoint, /probe-credential/u, call.provider);
  }
  assert.match(callFor(calls, 'anthropic').endpoint, /\/v1\/models$/u);
  assert.equal(callFor(calls, 'anthropic').init.headers['x-api-key'], 'probe-credential');
  assert.match(callFor(calls, 'gemini').endpoint, /\/v1beta\/models$/u);
  assert.equal(callFor(calls, 'gemini').init.headers['x-goog-api-key'], 'probe-credential');
  assert.match(callFor(calls, 'ollama').endpoint, /\/api\/tags$/u);
  assert.deepEqual(callFor(calls, 'ollama').init.headers, {});
  assert.match(callFor(calls, 'bedrock').endpoint, /\/foundation-models$/u);
});

test('planning selects the configured provider profile and model without exposing the credential', async () => {
  const profiles = normalizeProviderProfiles({
    openai: { endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-test', enabled: true },
  });
  const seen: Array<{ provider: ProviderId; model: string; endpoint: string; apiKey?: string }> = [];
  const plan = assistantPlan('provider-selected');
  const planning = new AssistantPlanningService({
    credentials: {
      status: async () => ({ provider: 'openai', configured: true }),
      use: async (_provider, operation) => operation('non-projectable-token'),
    },
    consents: { status: () => ({ id: 'openai', acknowledged: true }) },
    settings: {
      read: () => ({
        values: settingsWith({ assistantProvider: 'openai', providerProfiles: profiles }),
        workspaceOverrides: [],
      }),
    },
    createClient: (options) => {
      seen.push(options);
      return { provider: options.provider, plan: async () => plan } as PlannerClient;
    },
    localize: (english) => english,
    publish: () => undefined,
    log: () => undefined,
  });

  const actual = await planning.create(
    'summarize this',
    target(),
    new AbortController().signal,
    assistantPlan('fallback'),
  );
  assert.equal(actual.reason, 'provider-selected');
  assert.deepEqual(seen, [{
    provider: 'openai',
    model: 'gpt-test',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    apiKey: 'non-projectable-token',
    logger: seen[0]?.logger,
  }]);
  assert.doesNotMatch(JSON.stringify({ provider: planning.provider, error: planning.error }), /non-projectable-token/u);
});

function settingsWith(patch: Partial<VoiceInputSettings>): VoiceInputSettings {
  return {
    ...SETTINGS_DEFAULTS,
    ...patch,
  };
}

function assistantPlan(reason: string): AssistantPlan {
  return {
    action: 'answer-only',
    target: 'none',
    content: null,
    spokenReply: '',
    reason,
    confidence: 1,
    requiresConfirmation: false,
  };
}

function target(): TargetSnapshot {
  return {
    requestedTarget: 'here',
    resolvedTarget: 'focused-control',
    vscodeFocused: true,
    activeTabIdentity: 'tab',
    activeEditorIdentity: null,
    activeTerminalIdentity: null,
  };
}

function callFor<T extends { provider: ProviderId }>(calls: readonly T[], provider: ProviderId): T {
  const call = calls.find((entry) => entry.provider === provider);
  assert.ok(call, `expected a ${provider} probe call`);
  return call;
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((done) => { resolve = done; }),
    resolve,
  };
}
