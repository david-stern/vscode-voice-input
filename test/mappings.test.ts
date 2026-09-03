import assert from 'node:assert/strict';
import test from 'node:test';

import { captureTargetSnapshot, type TargetSnapshot } from '../src/assistant/context';
import {
  CUSTOM_MAPPING_SCHEMA_VERSION,
  CUSTOM_MAPPING_STORAGE_KEY,
  MAX_AGENT_MAPPING_RESULT_CHARS,
  CustomMappingRegistry,
  MappingCapabilityPolicy,
  MappingError,
  createSelectableMappingTargetCatalog,
  findMappingByPhrase,
  isAllowedMappingTargetId,
  isReservedMappingPhrase,
  mappingFingerprint,
  normalizeMappingPhrase,
  paginateAgentMappings,
  serializeAgentMappingPage,
  validateCustomMappingDraft,
  validateCustomMappingPayload,
  type CommandMappingDraft,
  type CustomMapping,
  type LanguageModelToolMappingDraft,
  type MappingStorage,
  type MappingTargetCatalog,
} from '../src/assistant/mappings';
import { isConfirmCustomActionPhrase } from '../src/assistant/intents';

class MemoryStorage implements MappingStorage {
  value: unknown;
  failUpdate = false;

  get<T>(key: string): T | undefined {
    assert.equal(key, CUSTOM_MAPPING_STORAGE_KEY);
    return this.value as T | undefined;
  }

  async update(key: string, value: unknown): Promise<void> {
    assert.equal(key, CUSTOM_MAPPING_STORAGE_KEY);
    if (this.failUpdate) throw new Error('disk full');
    this.value = structuredClone(value);
  }
}

const catalog: MappingTargetCatalog = {
  commands: new Set(['workbench.action.files.save', 'editor.action.formatDocument']),
  tools: new Set(['public_lookup', 'public_math']),
};

function commandDraft(overrides: Partial<CommandMappingDraft> = {}): CommandMappingDraft {
  return {
    kind: 'command',
    label: 'Save file',
    description: 'Save the current file',
    phrases: ['save my file'],
    enabled: true,
    agentEnabled: true,
    commandId: 'workbench.action.files.save',
    args: [],
    ...overrides,
  };
}

function toolDraft(
  overrides: Partial<LanguageModelToolMappingDraft> = {},
): LanguageModelToolMappingDraft {
  return {
    kind: 'language-model-tool',
    label: 'Lookup',
    description: 'Look up a fixed topic',
    phrases: ['look up the topic'],
    enabled: true,
    agentEnabled: true,
    toolName: 'public_lookup',
    input: { topic: 'safe', count: 2 },
    ...overrides,
  };
}

function ids(): () => string {
  let counter = 0;
  return () => `vm_${String(counter += 1).padStart(22, 'a')}`;
}

function snapshot(overrides: Partial<TargetSnapshot> = {}): TargetSnapshot {
  return {
    ...captureTargetSnapshot({
      requestedTarget: 'here',
      focusedTarget: 'editor',
      vscodeFocused: true,
      activeTabIdentity: 'tab-1',
      activeEditorIdentity: 'editor-1',
      activeTerminalIdentity: null,
    }, 1_000),
    ...overrides,
  };
}

test('custom voice matching is exact after local NFKC/case/space normalization', () => {
  const mapping: CustomMapping = {
    id: `vm_${'a'.repeat(22)}`,
    ...commandDraft({ phrases: ['ＳＡＶＥ   My File'] }),
  };
  assert.equal(normalizeMappingPhrase('  save my FILE  '), 'save my file');
  assert.equal(findMappingByPhrase([mapping], 'save my file')?.id, mapping.id);
  assert.equal(findMappingByPhrase([mapping], 'save my file!'), undefined);
  assert.equal(findMappingByPhrase([{ ...mapping, enabled: false }], 'save my file'), undefined);
});

test('built-in and local-only confirmation phrases cannot be shadowed', () => {
  for (const phrase of ['confirm send', 'confirm send!', 'שלח עכשיו', 'confirm action', 'אשר פעולה']) {
    assert.equal(isReservedMappingPhrase(phrase), true);
    assert.throws(
      () => validateCustomMappingDraft(commandDraft({ phrases: [phrase] }), catalog),
      (error) => error instanceof MappingError && error.code === 'reserved-phrase',
    );
  }
  assert.equal(isConfirmCustomActionPhrase('CONFIRM ACTION!'), true);
  assert.equal(isConfirmCustomActionPhrase('אשר פעולה'), true);
});

test('draft validation rejects unavailable, internal, recursive, and smuggled targets', () => {
  for (const draft of [
    commandDraft({ commandId: 'missing.command' }),
    commandDraft({ commandId: '_internal.command' }),
    commandDraft({ commandId: 'voiceInput.runCustomMapping' }),
    toolDraft({ toolName: 'voice-input_runMapping' }),
  ]) {
    assert.throws(() => validateCustomMappingDraft(draft, catalog), MappingError);
  }
  assert.throws(
    () => validateCustomMappingDraft({ ...commandDraft(), unexpected: 'authority' }, catalog),
    (error) => error instanceof MappingError && error.code === 'invalid-payload',
  );
});

test('picker eligibility excludes internal and recursive dispatcher targets', () => {
  assert.equal(isAllowedMappingTargetId('command', 'editor.action.formatDocument'), true);
  assert.equal(isAllowedMappingTargetId('language-model-tool', 'public_lookup'), true);
  for (const commandId of [
    '_internal.command',
    'voiceInput.manageCustomMappings',
    'voiceInput.runCustomMapping',
  ]) {
    assert.equal(isAllowedMappingTargetId('command', commandId), false);
  }
  for (const toolName of [
    'voice-input_listMappings',
    'voice-input_runMapping',
    'voice-input_anyDispatcher',
  ]) {
    assert.equal(isAllowedMappingTargetId('language-model-tool', toolName), false);
  }
  const selectable = createSelectableMappingTargetCatalog(
    [
      'editor.action.formatDocument',
      '_internal.command',
      'voiceInput.manageCustomMappings',
    ],
    ['public_lookup', 'voice-input_listMappings', 'voice-input_runMapping'],
  );
  assert.deepEqual([...selectable.commands], ['editor.action.formatDocument']);
  assert.deepEqual([...selectable.tools], ['public_lookup']);
});

test('static JSON rejects prototype keys, unsafe text, templates, command URIs, depth, and size', () => {
  const attacks: unknown[] = [
    JSON.parse('{"__proto__":{"polluted":true}}'),
    { nested: { constructor: 'bad' } },
    { text: 'safe\u202Eexe' },
    { text: '${workspaceFolder}' },
    { text: 'command:workbench.action.files.save' },
    { a: { b: { c: { d: { e: true } } } } },
    { text: 'x'.repeat(9_000) },
  ];
  for (const input of attacks) {
    assert.throws(
      () => validateCustomMappingDraft(toolDraft({ input: input as never }), catalog),
      (error) => error instanceof MappingError && error.code === 'invalid-json',
    );
  }
  assert.throws(
    () => validateCustomMappingDraft(commandDraft({ args: Array.from({ length: 17 }, () => 1) }), catalog),
    (error) => error instanceof MappingError && error.code === 'invalid-json',
  );
});

test('persisted payload is strict, bounded, and rejects duplicate IDs or phrases', () => {
  const first = { id: `vm_${'a'.repeat(22)}`, ...commandDraft() };
  const second = {
    id: `vm_${'b'.repeat(22)}`,
    ...toolDraft({ phrases: [' SAVE   MY FILE '] }),
  };
  assert.throws(
    () => validateCustomMappingPayload({
      schemaVersion: CUSTOM_MAPPING_SCHEMA_VERSION,
      mappings: [first, second],
    }),
    (error) => error instanceof MappingError && error.code === 'duplicate-phrase',
  );
  assert.throws(
    () => validateCustomMappingPayload({
      schemaVersion: CUSTOM_MAPPING_SCHEMA_VERSION,
      mappings: [{ ...first, injected: true }],
    }),
    (error) => error instanceof MappingError && error.code === 'invalid-payload',
  );
  assert.throws(
    () => validateCustomMappingPayload({
      schemaVersion: CUSTOM_MAPPING_SCHEMA_VERSION,
      mappings: [first],
      ignoredAuthority: true,
    }),
    (error) => error instanceof MappingError && error.code === 'invalid-payload',
  );
});

test('registry fails closed on corrupt storage and keeps persistence atomic', async () => {
  const storage = new MemoryStorage();
  storage.value = { schemaVersion: 99, mappings: [commandDraft()] };
  const registry = new CustomMappingRegistry(storage, { idFactory: ids() });
  const loaded = registry.load();
  assert.equal(loaded.corrupted, true);
  assert.deepEqual(registry.list(), []);

  storage.value = undefined;
  registry.load();
  const created = await registry.create(commandDraft(), catalog);
  storage.failUpdate = true;
  await assert.rejects(
    registry.replace(created.id, commandDraft({ label: 'New label' }), catalog),
    (error) => error instanceof MappingError && error.code === 'storage-failed',
  );
  assert.equal(registry.get(created.id)?.label, 'Save file');
});

test('all edits rotate opaque IDs and deleted IDs are never restored', async () => {
  const storage = new MemoryStorage();
  const registry = new CustomMappingRegistry(storage, { idFactory: ids() });
  registry.load();
  const created = await registry.create(commandDraft(), catalog);
  const replaced = await registry.replace(
    created.id,
    commandDraft({ label: 'Renamed', enabled: false }),
    catalog,
  );
  assert.notEqual(replaced.id, created.id);
  assert.equal(registry.get(created.id), undefined);
  await registry.delete(replaced.id);
  const recreated = await registry.create(commandDraft(), catalog);
  assert.notEqual(recreated.id, created.id);
  assert.notEqual(recreated.id, replaced.id);
});

test('unavailable targets allow only ID-rotating security reductions', async () => {
  const storage = new MemoryStorage();
  const registry = new CustomMappingRegistry(storage, { idFactory: ids() });
  registry.load();
  const original = await registry.create(commandDraft(), catalog);
  const unavailable: MappingTargetCatalog = { commands: new Set(), tools: new Set() };

  const disabled = await registry.replace(
    original.id,
    commandDraft({ enabled: false }),
    unavailable,
  );
  assert.notEqual(disabled.id, original.id);
  assert.equal(disabled.enabled, false);

  const hidden = await registry.replace(
    disabled.id,
    commandDraft({ enabled: false, agentEnabled: false }),
    unavailable,
  );
  assert.notEqual(hidden.id, disabled.id);
  assert.equal(hidden.agentEnabled, false);

  const exposedVoiceMapping = await registry.create(
    commandDraft({ label: 'Format', phrases: ['format now'], commandId: 'editor.action.formatDocument' }),
    catalog,
  );
  const agentHiddenOnly = await registry.replace(
    exposedVoiceMapping.id,
    commandDraft({
      label: 'Format',
      phrases: ['format now'],
      commandId: 'editor.action.formatDocument',
      agentEnabled: false,
    }),
    unavailable,
  );
  assert.equal(agentHiddenOnly.enabled, true);
  assert.equal(agentHiddenOnly.agentEnabled, false);

  await assert.rejects(
    registry.replace(hidden.id, commandDraft({ enabled: true, agentEnabled: false }), unavailable),
    (error) => error instanceof MappingError && error.code === 'target-unavailable',
  );
  await assert.rejects(
    registry.replace(hidden.id, commandDraft({ enabled: false, agentEnabled: true }), unavailable),
    (error) => error instanceof MappingError && error.code === 'target-unavailable',
  );
  await assert.rejects(
    registry.replace(
      hidden.id,
      commandDraft({ enabled: false, agentEnabled: false, args: ['changed'] }),
      unavailable,
    ),
    (error) => error instanceof MappingError && error.code === 'target-unavailable',
  );
  await assert.rejects(
    registry.replace(
      hidden.id,
      commandDraft({
        enabled: false,
        agentEnabled: false,
        commandId: 'editor.action.formatDocument',
      }),
      unavailable,
    ),
    (error) => error instanceof MappingError && error.code === 'target-unavailable',
  );

  const toolMapping = await registry.create(
    toolDraft({ phrases: ['lookup other topic'] }),
    catalog,
  );
  await assert.rejects(
    registry.replace(
      toolMapping.id,
      toolDraft({
        phrases: ['lookup other topic'],
        enabled: false,
        input: { topic: 'changed' },
      }),
      unavailable,
    ),
    (error) => error instanceof MappingError && error.code === 'target-unavailable',
  );
});

test('Agent mapping pagination returns all 50 mappings as bounded valid JSON without authority data', () => {
  const mappings = Array.from({ length: 50 }, (_, index): CustomMapping => ({
    id: `vm_${String(index).padStart(22, 'a')}`,
    ...commandDraft({
      label: `Label ${index} ${'"\\'.repeat(30)}`,
      description: `Description ${index} ${'"\\'.repeat(90)}`,
      phrases: [`phrase ${index}`],
    }),
  }));
  const collected: string[] = [];
  let cursor: number | null = 0;
  while (cursor !== null) {
    const page = paginateAgentMappings(mappings, cursor, 20);
    const serialized = serializeAgentMappingPage(page);
    assert.ok(serialized.length <= MAX_AGENT_MAPPING_RESULT_CHARS);
    const parsed = JSON.parse(serialized) as typeof page;
    assert.equal(parsed.mappings.length <= 20, true);
    assert.doesNotMatch(serialized, /commandId|args|toolName|input/u);
    collected.push(...parsed.mappings.map((mapping) => mapping.mappingId));
    cursor = parsed.nextCursor;
  }
  assert.equal(collected.length, 50);
  assert.equal(new Set(collected).size, 50);
});

test('capability requires a later distinct confirmation and cannot replay', async () => {
  const storage = new MemoryStorage();
  const registry = new CustomMappingRegistry(storage, { idFactory: ids() });
  registry.load();
  const mapping = await registry.create(commandDraft(), catalog);
  const policy = new MappingCapabilityPolicy({ ttlMs: 1_000 });
  const target = snapshot();

  policy.request(mapping, 'request-1', target, 10_000);
  assert.deepEqual(policy.confirm(registry.get.bind(registry), target, 'request-1', 10_001), {
    allowed: false,
    reason: 'same-utterance-confirmation',
  });
  policy.request(mapping, 'request-2', target, 20_000);
  assert.deepEqual(policy.confirm(registry.get.bind(registry), target, 'confirm-1', 20_000), {
    allowed: false,
    reason: 'confirmation-not-later',
  });
  policy.request(mapping, 'request-3', target, 30_000);
  assert.equal(policy.confirm(registry.get.bind(registry), target, 'confirm-1', 30_001).allowed, true);
  policy.request(mapping, 'request-4', target, 40_000);
  assert.deepEqual(policy.confirm(registry.get.bind(registry), target, 'confirm-1', 40_001), {
    allowed: false,
    reason: 'confirmation-replayed',
  });
  policy.request(mapping, 'request-5', target, 50_000);
  assert.deepEqual(policy.confirm(registry.get.bind(registry), target, 'confirm-5', 51_001), {
    allowed: false,
    reason: 'confirmation-expired',
  });
});

test('a confirmation whose window lost focus to the modal still dispatches the same target', async () => {
  const storage = new MemoryStorage();
  const registry = new CustomMappingRegistry(storage, { idFactory: ids() });
  registry.load();
  const mapping = await registry.create(commandDraft(), catalog);
  const policy = new MappingCapabilityPolicy();
  const target = snapshot();

  policy.request(mapping, 'request-1', target, 10_000);
  const blurred = snapshot({ vscodeFocused: false, capturedAt: 20_000 });
  assert.equal(
    policy.confirm(registry.get.bind(registry), blurred, 'confirm-1', 10_001).allowed,
    true,
    'a native modal blurs the window it belongs to; identity is what binds the dispatch',
  );

  for (const changed of [
    snapshot({ vscodeFocused: false, activeTabIdentity: 'tab-2' }),
    snapshot({ vscodeFocused: false, activeEditorIdentity: 'editor-2' }),
    snapshot({ vscodeFocused: false, resolvedTarget: 'terminal', activeTerminalIdentity: 'term-1' }),
  ]) {
    policy.request(mapping, `request-${changed.activeTabIdentity}-${changed.resolvedTarget}`, target, 20_000);
    assert.deepEqual(
      policy.confirm(registry.get.bind(registry), changed, `confirm-${changed.activeEditorIdentity}-${changed.resolvedTarget}`, 20_001),
      { allowed: false, reason: 'target-changed' },
      'target identity is still fully revalidated while blurred',
    );
  }

  assert.throws(
    () => policy.request(mapping, 'request-unfocused', snapshot({ vscodeFocused: false }), 30_000),
    { code: 'invalid-payload' },
    'the request path still refuses to arm a capability from an unfocused window',
  );
  assert.equal(policy.getPending(30_001), null);
});

test('capability is bound to fingerprint, rotated ID, target snapshot, and cancellation', async () => {
  const storage = new MemoryStorage();
  const registry = new CustomMappingRegistry(storage, { idFactory: ids() });
  registry.load();
  const original = await registry.create(commandDraft(), catalog);
  const policy = new MappingCapabilityPolicy();
  const target = snapshot();
  const requested = policy.request(original, 'request-1', target, 10_000);
  assert.equal(requested.fingerprint, mappingFingerprint(original));
  await registry.replace(original.id, commandDraft({ label: 'Changed' }), catalog);
  assert.deepEqual(policy.confirm(registry.get.bind(registry), target, 'confirm-1', 10_001), {
    allowed: false,
    reason: 'mapping-changed',
  });

  const current = registry.list()[0];
  policy.request(current, 'request-2', target, 20_000);
  assert.deepEqual(
    policy.confirm(
      registry.get.bind(registry),
      { ...target, activeTabIdentity: 'tab-2' },
      'confirm-2',
      20_001,
    ),
    { allowed: false, reason: 'target-changed' },
  );

  policy.request(current, 'request-3', target, 30_000);
  policy.cancel();
  assert.deepEqual(policy.confirm(registry.get.bind(registry), target, 'confirm-3', 30_001), {
    allowed: false,
    reason: 'no-pending-action',
  });

  policy.request(current, 'request-4', target, 40_000);
  await registry.delete(current.id);
  const recreated = await registry.create(commandDraft(), catalog);
  assert.notEqual(recreated.id, current.id);
  assert.deepEqual(policy.confirm(registry.get.bind(registry), target, 'confirm-4', 40_001), {
    allowed: false,
    reason: 'mapping-changed',
  });
});
