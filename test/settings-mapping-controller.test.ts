import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CUSTOM_MAPPING_SCHEMA_VERSION,
  CUSTOM_MAPPING_STORAGE_KEY,
  type CustomMapping,
  type MappingStorage,
  type MappingTargetCatalog,
} from '../src/assistant/mappings';
import {
  MappingFeature,
  MappingManagementController,
  MappingStore,
  type MappingManagementHost,
} from '../src/features/mappings';

const INITIAL_ID = `vm_${'a'.repeat(22)}`;
const ROTATED_ID = `vm_${'b'.repeat(22)}`;

function commandMapping(overrides: Partial<CustomMapping> = {}): CustomMapping {
  return {
    id: INITIAL_ID,
    kind: 'command',
    label: 'Format document',
    description: 'Formats the active document',
    phrases: ['format this'],
    commandId: 'editor.action.formatDocument',
    args: [{ private: 'never-cross-the-settings-boundary' }],
    enabled: true,
    agentEnabled: true,
    ...overrides,
  } as CustomMapping;
}

class MemoryStorage implements MappingStorage {
  value: unknown;
  updates = 0;

  constructor(mappings: readonly CustomMapping[]) {
    this.value = {
      schemaVersion: CUSTOM_MAPPING_SCHEMA_VERSION,
      mappings: structuredClone(mappings),
    };
  }

  get<T>(key: string): T | undefined {
    assert.equal(key, CUSTOM_MAPPING_STORAGE_KEY);
    return structuredClone(this.value) as T | undefined;
  }

  async update(key: string, value: unknown): Promise<void> {
    assert.equal(key, CUSTOM_MAPPING_STORAGE_KEY);
    this.updates += 1;
    this.value = structuredClone(value);
  }
}

class MappingHost implements MappingManagementHost {
  catalog: MappingTargetCatalog = {
    commands: new Set(['editor.action.formatDocument']),
    tools: new Set(['public_lookup']),
  };

  async pick<T>(): Promise<T | undefined> { return undefined; }
  async input(): Promise<string | undefined> { return undefined; }
  async discoverTargets(): Promise<MappingTargetCatalog> {
    return {
      commands: new Set(this.catalog.commands),
      tools: new Set(this.catalog.tools),
    };
  }
  async showError(): Promise<void> {}
  async showInformation(): Promise<void> {}
  async confirmWarning(): Promise<boolean> { return true; }
}

function setup(initial = commandMapping()) {
  const storage = new MemoryStorage([initial]);
  const store = new MappingStore(storage, { idFactory: () => ROTATED_ID });
  const host = new MappingHost();
  const publishedRevisions: number[] = [];
  let invalidations = 0;
  let controller!: MappingManagementController;
  controller = new MappingManagementController({
    store,
    host,
    localize: (english) => english,
    isWorkspaceTrusted: () => true,
    invalidatePending: () => { invalidations += 1; },
    publish: () => { publishedRevisions.push(controller.snapshot().revision); },
  });
  return {
    controller,
    host,
    storage,
    store,
    publishedRevisions,
    invalidations: () => invalidations,
  };
}

test('same-revision Settings mutations serialize so one wins and a replay is stale', async () => {
  const { controller, store, storage, publishedRevisions, invalidations } = setup();
  const revision = controller.snapshot().revision;

  const [first, replay] = await Promise.all([
    controller.toggleEnabled(INITIAL_ID, revision),
    controller.toggleEnabled(INITIAL_ID, revision),
  ]);

  assert.equal(first.status, 'accepted');
  assert.equal(replay.status, 'stale');
  assert.equal(first.snapshot.revision, revision + 1);
  assert.equal(replay.snapshot.revision, revision + 1);
  assert.equal(storage.updates, 1);
  assert.equal(invalidations(), 1);
  assert.deepEqual(publishedRevisions, [revision + 1]);
  assert.equal(store.get(INITIAL_ID), undefined);
  assert.equal(store.get(ROTATED_ID)?.enabled, false);
});

test('flag replacement rotates authority ID while idempotent setters do not persist again', async () => {
  const { controller, storage, store } = setup();
  const initial = controller.snapshot();

  const changed = await controller.setAgentEnabled(INITIAL_ID, false, initial.revision);
  assert.equal(changed.status, 'accepted');
  assert.equal(changed.snapshot.items[0]?.id, ROTATED_ID);
  assert.equal(store.get(INITIAL_ID), undefined);
  assert.equal(store.get(ROTATED_ID)?.agentEnabled, false);

  const unchanged = await controller.setAgentEnabled(
    ROTATED_ID,
    false,
    changed.snapshot.revision,
  );
  assert.equal(unchanged.status, 'unchanged');
  assert.equal(unchanged.snapshot.revision, changed.snapshot.revision);
  assert.equal(storage.updates, 1);
});

test('Settings mapping snapshot contains only the allowlisted presentation fields', () => {
  const { controller } = setup();
  const snapshot = controller.snapshot();
  const card = snapshot.items[0];

  assert.deepEqual(Object.keys(card ?? {}).sort(), [
    'agentEnabled',
    'description',
    'enabled',
    'id',
    'kind',
    'label',
    'phrases',
    'targetId',
  ]);
  assert.deepEqual(card, {
    id: INITIAL_ID,
    label: 'Format document',
    description: 'Formats the active document',
    phrases: ['format this'],
    kind: 'command',
    targetId: 'editor.action.formatDocument',
    enabled: true,
    agentEnabled: true,
  });
  assert.doesNotMatch(JSON.stringify(snapshot), /args|input|private|never-cross/u);
});

test('storage is reloaded before mutation and external changes invalidate the rendered revision', async () => {
  const { controller, storage } = setup();
  const rendered = controller.snapshot();
  storage.value = {
    schemaVersion: CUSTOM_MAPPING_SCHEMA_VERSION,
    mappings: [commandMapping({ label: 'Changed elsewhere' })],
  };

  const result = await controller.toggleEnabled(INITIAL_ID, rendered.revision);

  assert.equal(result.status, 'stale');
  assert.equal(result.snapshot.revision, rendered.revision + 1);
  assert.equal(result.snapshot.items[0]?.label, 'Changed elsewhere');
  assert.equal(storage.updates, 0);
});

test('visible-form edit revalidates the public target and preserves host-only args only for that exact target', async () => {
  const { controller, host, store, invalidations } = setup();
  host.catalog.commands.add('editor.action.copyLinesDownAction');
  const revision = controller.snapshot().revision;
  const edited = await controller.editVisible(INITIAL_ID, {
    label: 'Format safely', description: 'Updated', phrases: ['format safely'],
    kind: 'command', targetId: 'editor.action.formatDocument',
    enabled: true, agentEnabled: false,
  }, revision);
  assert.equal(edited.status, 'accepted');
  assert.deepEqual(store.get(ROTATED_ID)?.kind === 'command'
    ? store.get(ROTATED_ID)?.args : undefined,
  [{ private: 'never-cross-the-settings-boundary' }]);
  assert.equal(invalidations(), 1);

  const changed = setup();
  changed.host.catalog.commands.add('editor.action.copyLinesDownAction');
  const changedTarget = await changed.controller.editVisible(INITIAL_ID, {
    label: 'Copy line', description: '', phrases: ['copy line safely'],
    kind: 'command', targetId: 'editor.action.copyLinesDownAction',
    enabled: true, agentEnabled: false,
  }, changed.controller.snapshot().revision);
  assert.equal(changedTarget.status, 'accepted');
  const saved = changed.store.get(ROTATED_ID);
  assert.ok(saved?.kind === 'command');
  assert.deepEqual(saved.args, []);
});

test('visible-form add rejects unavailable targets without persisting or invalidating authority', async () => {
  const { controller, storage, invalidations } = setup();
  const result = await controller.addVisible({
    label: 'Unsafe target', description: '', phrases: ['unsafe target'],
    kind: 'command', targetId: 'workbench.action.notRegistered',
    enabled: true, agentEnabled: false,
  }, controller.snapshot().revision);
  assert.equal(result.status, 'failed');
  assert.equal(storage.updates, 0);
  assert.equal(invalidations(), 0);
});

test('mapping facade exposes only effective approval state and defaults to none', () => {
  const options = {
    storage: new MemoryStorage([commandMapping()]),
    executionHost: {} as never,
    managementHost: new MappingHost(),
    agentToolHost: {} as never,
    localize: (english: string) => english,
    isWorkspaceTrusted: () => true,
    captureTarget: () => ({} as never),
    clearPendingSend: () => undefined,
    speak: () => undefined,
    publish: () => undefined,
  };
  const approvals = {
    state: (id: string) => id === INITIAL_ID ? 'approved' as const : 'revoked' as const,
    grant: async () => undefined,
    revoke: async () => undefined,
    recordExecution: async () => undefined,
    history: () => [],
  };
  const feature = new MappingFeature({ ...options, approvals });
  const withoutApprovals = new MappingFeature(options);

  assert.equal(feature.settingsApprovalState(INITIAL_ID), 'approved');
  assert.equal(feature.settingsApprovalState(ROTATED_ID), 'revoked');
  assert.equal(withoutApprovals.settingsApprovalState(INITIAL_ID), 'none');
  feature.dispose();
  withoutApprovals.dispose();
});
