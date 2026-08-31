import assert from 'node:assert/strict';
import test from 'node:test';

import { mappingFingerprint, type CustomMapping } from '../src/assistant';
import {
  registerAgentMappingTools,
  type MappingAgentToolHost,
  type MappingDisposable,
  type MappingToolPreparation,
} from '../src/features/mappings';

const mapping: CustomMapping = {
  id: 'vm_abcdefghijklmnopqrstuv',
  kind: 'command',
  label: 'Format document',
  description: 'Formats the active document',
  phrases: ['format this'],
  commandId: 'editor.action.formatDocument',
  args: [{ private: 'value' }],
  enabled: true,
  agentEnabled: true,
};

class CapturingAgentHost implements MappingAgentToolHost {
  listName = '';
  runName = '';
  list?: Parameters<MappingAgentToolHost['registerListTool']>[1];
  run?: Parameters<MappingAgentToolHost['registerRunTool']>[1];

  registerListTool(
    name: string,
    invoke: NonNullable<CapturingAgentHost['list']>,
  ): MappingDisposable {
    this.listName = name;
    this.list = invoke;
    return { dispose() {} };
  }

  registerRunTool(
    name: string,
    handlers: NonNullable<CapturingAgentHost['run']>,
  ): MappingDisposable {
    this.runName = name;
    this.run = handlers;
    return { dispose() {} };
  }
}

test('Agent mapping registration remains fixed, bounded, and excludes static input', () => {
  const host = new CapturingAgentHost();
  registerAgentMappingTools({
    store: { list: () => [mapping], get: () => mapping },
    executor: { execute: async () => ({ ok: true, mappingId: mapping.id, kind: mapping.kind }) },
    localize: (english) => english,
    host,
  });

  assert.equal(host.listName, 'voice-input_listMappings');
  assert.equal(host.runName, 'voice-input_runMapping');
  const result = host.list?.({}, { isCancellationRequested: false });
  assert.match(result ?? '', /Format document/u);
  assert.doesNotMatch(result ?? '', /private|value|format this/u);
  assert.match(host.list?.({ extra: true }, { isCancellationRequested: false }) ?? '', /invalid-input/u);
  assert.match(host.list?.({}, { isCancellationRequested: true }) ?? '', /cancelled/u);
});

test('Agent run passes only opaque ID and host tokens to the shared executor', async () => {
  const host = new CapturingAgentHost();
  const calls: unknown[][] = [];
  registerAgentMappingTools({
    store: { list: () => [mapping], get: () => mapping },
    executor: {
      execute: async (...args) => {
        calls.push(args);
        return { ok: true, mappingId: mapping.id, kind: mapping.kind };
      },
    },
    localize: (english) => english,
    host,
  });

  const preparation = host.run?.prepare({ mappingId: mapping.id }) as MappingToolPreparation;
  assert.match(preparation.confirmationMessages.message, /editor\.action\.formatDocument/u);
  assert.doesNotMatch(preparation.confirmationMessages.message, /["']?private["']?\s*:/u);

  const cancellationToken = { isCancellationRequested: false };
  const toolInvocationToken = { opaque: true };
  assert.equal(
    await host.run?.invoke({ mappingId: mapping.id }, toolInvocationToken, cancellationToken),
    'success',
  );
  assert.deepEqual(calls, [[mapping.id, {
    source: 'agent',
    toolInvocationToken,
    cancellationToken,
    expectedFingerprint: mappingFingerprint(mapping),
  }]]);
  assert.equal(
    await host.run?.invoke({ mappingId: 'editor.action.formatDocument' }, {}, cancellationToken),
    'invalid-input',
  );
});

test('Agent run fails closed when the mapping changes or disappears after preview', async () => {
  const host = new CapturingAgentHost();
  let current: CustomMapping | undefined = mapping;
  let executions = 0;
  registerAgentMappingTools({
    store: { list: () => current ? [current] : [], get: () => current },
    executor: {
      execute: async () => {
        executions += 1;
        return { ok: true, mappingId: mapping.id, kind: mapping.kind };
      },
    },
    localize: (english) => english,
    host,
  });

  host.run?.prepare({ mappingId: mapping.id });
  current = { ...mapping, commandId: 'workbench.action.files.saveAll', args: [] };
  assert.equal(
    await host.run?.invoke(
      { mappingId: mapping.id },
      { opaque: true },
      { isCancellationRequested: false },
    ),
    'failed:mapping-changed',
  );

  host.run?.prepare({ mappingId: mapping.id });
  current = undefined;
  assert.equal(
    await host.run?.invoke(
      { mappingId: mapping.id },
      { opaque: true },
      { isCancellationRequested: false },
    ),
    'failed:mapping-not-found',
  );
  assert.equal(executions, 0);
});
