import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ASSISTANT_CONSENT_KEY,
  CONFIGURATION_KEYS,
  CONTROL_CENTER_SETUP_CHOICES_STORAGE_KEY,
  ConsentService,
  CredentialService,
  CUSTOM_MAPPING_ID_PATTERN,
  CUSTOM_MAPPING_SCHEMA_VERSION,
  CUSTOM_MAPPING_STORAGE_KEY,
  DEEPSEEK_CONSENT_KEY,
  DEEPSEEK_SECRET_KEY,
  HISTORY_STORAGE_KEY,
  PERSISTED_CONTRACT_INVENTORY,
  SETTINGS_DEFAULTS,
  SETTING_NAMES,
  SettingsRepository,
  SONIOX_CREDENTIAL_EPOCH_SECRET_KEY,
  SONIOX_SECRET_KEY,
  normalizeSettings,
  type ConfigurationInspection,
  type ConfigurationPort,
  type GlobalStatePort,
  type SecretStoragePort,
} from '../src/config';

class MemoryConfiguration implements ConfigurationPort {
  readonly writes: { name: string; value: unknown; scope: 'global' }[] = [];
  readonly values = new Map<string, unknown>();
  readonly inspections = new Map<string, ConfigurationInspection<unknown>>();
  onWrite: ((name: string, value: unknown) => Promise<void>) | undefined;

  get<T>(name: string, fallback: T): T {
    return (this.values.has(name) ? this.values.get(name) : fallback) as T;
  }

  inspect<T>(name: string): ConfigurationInspection<T> | undefined {
    return this.inspections.get(name) as ConfigurationInspection<T> | undefined;
  }

  async updateGlobal(name: string, value: unknown): Promise<void> {
    this.writes.push({ name, value, scope: 'global' });
    await this.onWrite?.(name, value);
    this.values.set(name, value);
  }
}

class MemorySecrets implements SecretStoragePort {
  readonly values = new Map<string, string>();

  async get(key: string): Promise<string | undefined> {
    return this.values.get(key);
  }

  async store(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

class MemoryGlobalState implements GlobalStatePort {
  readonly values = new Map<string, unknown>();
  readonly writes: [string, unknown][] = [];
  onUpdate: ((key: string, value: unknown) => Promise<void>) | undefined;

  get<T>(key: string, fallback: T): T {
    return (this.values.has(key) ? this.values.get(key) : fallback) as T;
  }

  async update(key: string, value: unknown): Promise<void> {
    this.writes.push([key, value]);
    await this.onUpdate?.(key, value);
    this.values.set(key, value);
  }
}

test('persisted contract inventory freezes every Wave 1 storage identity', () => {
  assert.deepEqual(PERSISTED_CONTRACT_INVENTORY.configuration, CONFIGURATION_KEYS);
  assert.deepEqual(PERSISTED_CONTRACT_INVENTORY.secrets, [
    SONIOX_SECRET_KEY,
    SONIOX_CREDENTIAL_EPOCH_SECRET_KEY,
    DEEPSEEK_SECRET_KEY,
    'voiceInput.autoModeInstallation.v1',
    'voiceInput.sonioxRemoteConsentInstallation.v1',
  ]);
  assert.deepEqual(PERSISTED_CONTRACT_INVENTORY.globalState, [
    ASSISTANT_CONSENT_KEY,
    DEEPSEEK_CONSENT_KEY,
    HISTORY_STORAGE_KEY,
    CUSTOM_MAPPING_STORAGE_KEY,
    'voiceInput.installMarker.v1',
    CONTROL_CENTER_SETUP_CHOICES_STORAGE_KEY,
    'voiceInput.autoModeReceipt.v1',
    'voiceInput.sonioxRemoteConsent.v1',
    'voiceInput.builtinCommandOverrides.v1',
  ]);
  assert.equal(PERSISTED_CONTRACT_INVENTORY.customMappings.schemaVersion, CUSTOM_MAPPING_SCHEMA_VERSION);
  assert.equal(PERSISTED_CONTRACT_INVENTORY.customMappings.opaqueIdPattern, CUSTOM_MAPPING_ID_PATTERN);
  assert.equal(PERSISTED_CONTRACT_INVENTORY.customMappings.storageScope, 'global');
  assert.equal(PERSISTED_CONTRACT_INVENTORY.migrations[0].remoteCalls, false);
});

test('typed defaults match the contributed package settings exactly', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
    contributes: { configuration: { properties: Record<string, { default: unknown }> } };
  };
  const contributed = packageJson.contributes.configuration.properties;
  assert.deepEqual(
    Object.keys(contributed).sort(),
    CONFIGURATION_KEYS.slice().sort(),
  );
  for (const name of SETTING_NAMES) {
    assert.deepEqual(contributed[`voiceInput.${name}`]?.default, SETTINGS_DEFAULTS[name], name);
  }
});

test('settings normalization is bounded and falls back to preserved defaults', () => {
  const normalized = normalizeSettings({
    uiLanguage: 'fr',
    assistantPersona: 'invented',
    assistantIntelligence: 'local',
    historyTtlDays: 365,
    injectionMode: 'shell',
    assistantSpeechRate: 99,
    assistantWakePhrase: '  hello  ',
    deepSeekModel: '   ',
  });
  assert.deepEqual(normalized, {
    ...SETTINGS_DEFAULTS,
    assistantSpeechRate: 2,
    assistantWakePhrase: 'hello',
  });
  assert.equal(normalizeSettings({ assistantIntelligence: 'off' }).assistantIntelligence, 'off');
});

test('reads effective workspace overrides but every write remains global', async () => {
  const configuration = new MemoryConfiguration();
  configuration.values.set('uiLanguage', 'he');
  configuration.inspections.set('uiLanguage', {
    defaultValue: 'en',
    globalValue: 'en',
    workspaceValue: 'he',
  });
  const repository = new SettingsRepository(configuration);

  assert.deepEqual(repository.read().workspaceOverrides, [{
    name: 'uiLanguage',
    source: 'workspace',
    effectiveValue: 'he',
    globalValue: 'en',
  }]);

  await repository.update({ uiLanguage: 'he', assistantSpeechRate: 4 });
  assert.deepEqual(configuration.writes, [
    { name: 'uiLanguage', value: 'he', scope: 'global' },
    { name: 'assistantSpeechRate', value: 2, scope: 'global' },
  ]);
});

test('preserves explicit equal-valued workspace overrides as future write shadowing', () => {
  const configuration = new MemoryConfiguration();
  configuration.values.set('uiLanguage', 'en');
  configuration.inspections.set('uiLanguage', {
    defaultValue: 'en',
    globalValue: 'en',
    workspaceValue: 'en',
  });

  assert.deepEqual(new SettingsRepository(configuration).read().workspaceOverrides, [{
    name: 'uiLanguage',
    source: 'workspace',
    effectiveValue: 'en',
    globalValue: 'en',
  }]);
});

test('settings writes are serialized across concurrent callers and recover after failure', async () => {
  const configuration = new MemoryConfiguration();
  const releases: (() => void)[] = [];
  configuration.onWrite = () => new Promise<void>((resolve) => releases.push(resolve));
  const repository = new SettingsRepository(configuration);

  const first = repository.update({ uiLanguage: 'he' });
  const second = repository.update({ sttModel: 'next-model' });
  await waitFor(() => configuration.writes.length === 1);
  assert.equal(configuration.writes[0].name, 'uiLanguage');
  releases.shift()?.();
  await first;
  await waitFor(() => configuration.writes.length === 2);
  assert.equal(configuration.writes[1].name, 'sttModel');
  releases.shift()?.();
  await second;

  configuration.onWrite = async () => { throw new Error('private backend detail'); };
  await assert.rejects(repository.update({ uiLanguage: 'en' }));
  configuration.onWrite = undefined;
  await repository.update({ uiLanguage: 'he' });
  assert.equal(configuration.writes.at(-1)?.value, 'he');
});

test('legacy audio labels migrate once only when the match is unique', async () => {
  const configuration = new MemoryConfiguration();
  configuration.values.set('audioDevice', '  USB Mic  ');
  const repository = new SettingsRepository(configuration);
  const migrated = await repository.migrateLegacyAudioDevice([
    { id: 'stable-usb', label: 'USB Mic' },
    { id: 'stable-webcam', label: 'Webcam' },
  ]);
  assert.deepEqual(migrated, { status: 'migrated', deviceId: 'stable-usb' });
  assert.deepEqual(configuration.writes, [
    { name: 'audioDevice', value: 'stable-usb', scope: 'global' },
  ]);

  configuration.values.set('audioDevice', 'Duplicate');
  const ambiguous = await repository.migrateLegacyAudioDevice([
    { id: 'one', label: 'Duplicate' },
    { id: 'two', label: 'Duplicate' },
  ]);
  assert.deepEqual(ambiguous, { status: 'ambiguous' });
  assert.equal(configuration.writes.length, 1);
});

test('credential and consent facades preserve keys while projections contain no secrets', async () => {
  const secrets = new MemorySecrets();
  const credentials = new CredentialService(secrets);
  const secret = 'sk-highly-sensitive';
  assert.deepEqual(await credentials.set('soniox', ` ${secret} `), {
    provider: 'soniox',
    configured: true,
  });
  assert.equal(secrets.values.get(SONIOX_SECRET_KEY), secret);
  assert.doesNotMatch(JSON.stringify(await credentials.statuses()), /highly-sensitive|SONIOX_API_KEY/u);
  assert.deepEqual(await credentials.set('soniox', '   '), {
    provider: 'soniox',
    configured: true,
  });

  const state = new MemoryGlobalState();
  const consent = new ConsentService(state);
  assert.deepEqual(consent.statuses(), [
    { id: 'assistant-listening', acknowledged: false },
    { id: 'deepseek', acknowledged: false },
  ]);
  await consent.acknowledge('deepseek');
  assert.deepEqual(state.writes, [[DEEPSEEK_CONSENT_KEY, true]]);
  assert.deepEqual(consent.status('deepseek'), { id: 'deepseek', acknowledged: true });
});

test('a consent modal revision cannot regrant after a newer revoke', async () => {
  const state = new MemoryGlobalState();
  const consent = new ConsentService(state);
  const staleModalRevision = consent.revision('deepseek');

  await consent.revoke('deepseek');
  assert.equal(
    await consent.acknowledgeIfCurrent('deepseek', staleModalRevision),
    false,
  );

  assert.deepEqual(consent.status('deepseek'), {
    id: 'deepseek',
    acknowledged: false,
  });
  assert.deepEqual(state.writes, [[DEEPSEEK_CONSENT_KEY, false]]);
});

test('a requested revoke closes consent before persistence and remains fail-closed on failure', async () => {
  const state = new MemoryGlobalState();
  const consent = new ConsentService(state);
  await consent.acknowledge('deepseek');
  const release = deferred<void>();
  state.onUpdate = async () => release.promise;

  const pending = consent.revoke('deepseek');
  assert.deepEqual(consent.status('deepseek'), { id: 'deepseek', acknowledged: false });
  release.resolve(undefined);
  await pending;

  await consent.acknowledge('deepseek');
  state.onUpdate = async () => { throw new Error('private persistence detail'); };
  const staleRevision = consent.revision('deepseek');
  await assert.rejects(consent.revoke('deepseek'));
  assert.deepEqual(consent.status('deepseek'), { id: 'deepseek', acknowledged: false });
  assert.equal(await consent.acknowledgeIfCurrent('deepseek', staleRevision), false);
});

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail('condition was not reached');
}
