import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INSTALL_MARKER_STORAGE_KEY,
  TranscriptionProviderMigration,
} from '../src/config';
import type { TranscriptionProviderSelection } from '../src/speech/contracts';

class MemoryState {
  readonly values = new Map<string, unknown>();
  get<T>(key: string, fallback: T): T {
    return (this.values.has(key) ? this.values.get(key) : fallback) as T;
  }
  async update(key: string, value: unknown): Promise<void> { this.values.set(key, value); }
}

class ProviderSettings {
  provider: TranscriptionProviderSelection = 'none';
  explicit = false;
  speechEnabled = true;
  speechVoiceUri = '';
  readonly writes: TranscriptionProviderSelection[] = [];

  read() {
    return {
      values: {
        transcriptionProvider: this.provider,
        assistantSpeechEnabled: this.speechEnabled,
        assistantSpeechVoiceUri: this.speechVoiceUri,
      },
      workspaceOverrides: [],
    } as never;
  }
  hasExplicitGlobal(): boolean { return this.explicit; }
  async update(patch: { transcriptionProvider?: TranscriptionProviderSelection }): Promise<void> {
    if (patch.transcriptionProvider) {
      this.provider = patch.transcriptionProvider;
      this.explicit = true;
      this.writes.push(patch.transcriptionProvider);
    }
  }
}

function migration(options: {
  state?: MemoryState;
  settings?: ProviderSettings;
  legacy?: boolean;
  credential: boolean | 'unknown';
}) {
  const state = options.state ?? new MemoryState();
  const settings = options.settings ?? new ProviderSettings();
  const service = new TranscriptionProviderMigration({
    state,
    settings,
    currentVersion: '2.0.0',
    legacyInstallEvidence: () => options.legacy ?? false,
    credentials: {
      status: async () => {
        if (options.credential === 'unknown') throw new Error('local storage unavailable');
        return { provider: 'soniox', configured: options.credential };
      },
    },
  });
  return { service, state, settings };
}

test('fresh install persists none without changing preserved system TTS fields', async () => {
  const fixture = migration({ credential: false });
  const result = await fixture.service.migrate();
  assert.deepEqual(result, { status: 'fresh-none', provider: 'none' });
  assert.equal(fixture.settings.provider, 'none');
  assert.equal(fixture.settings.speechEnabled, true);
  assert.equal(fixture.settings.speechVoiceUri, '');
  assert.deepEqual(fixture.state.values.get(INSTALL_MARKER_STORAGE_KEY), {
    schemaVersion: 1,
    firstVersion: '2.0.0',
    lastVersion: '2.0.0',
  });
});

test('an upgrade with only a legacy Soniox secret preserves Soniox locally', async () => {
  const fixture = migration({ credential: true });
  assert.deepEqual(await fixture.service.migrate(), {
    status: 'upgrade-soniox', provider: 'soniox',
  });
  assert.equal(fixture.settings.provider, 'soniox');
  assert.deepEqual(fixture.settings.writes, ['legacy-soniox-pending', 'soniox']);
});

test('known legacy install with absent or unknown credential stays repairable pending', async () => {
  for (const credential of [false, 'unknown'] as const) {
    const fixture = migration({ legacy: true, credential });
    assert.deepEqual(await fixture.service.migrate(), {
      status: 'upgrade-pending', provider: 'legacy-soniox-pending',
    });
    assert.equal(fixture.settings.provider, 'legacy-soniox-pending');
  }
});

test('pending migration resolves later from SecretStorage only and repeat is idempotent', async () => {
  const state = new MemoryState();
  const settings = new ProviderSettings();
  const pending = migration({ state, settings, legacy: true, credential: false });
  await pending.service.migrate();
  const resolved = migration({ state, settings, legacy: true, credential: true });
  assert.deepEqual(await resolved.service.resolvePendingLocally(), {
    status: 'upgrade-soniox', provider: 'soniox',
  });
  const writes = settings.writes.length;
  assert.deepEqual(await resolved.service.migrate(), { status: 'retained', provider: 'soniox' });
  assert.equal(settings.writes.length, writes);
});
