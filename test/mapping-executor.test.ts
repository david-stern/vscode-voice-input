import assert from 'node:assert/strict';
import test from 'node:test';

import { captureTargetSnapshot, type TargetProbe } from '../src/assistant/context';
import {
  CustomMappingExecutor,
  type MappingCancellationToken,
  type MappingExecutionHost,
} from '../src/assistant/mappingExecutor';
import { mappingFingerprint, type CustomMapping, type JsonValue } from '../src/assistant/mappings';
import { autoDispatchTargetFingerprint } from '../src/platform/promptBinding';

const command: CustomMapping = {
  id: `vm_${'a'.repeat(22)}`,
  kind: 'command',
  label: 'Format',
  description: '',
  phrases: ['format file'],
  enabled: true,
  agentEnabled: true,
  commandId: 'editor.action.formatDocument',
  args: [],
};

const tool: CustomMapping = {
  id: `vm_${'b'.repeat(22)}`,
  kind: 'language-model-tool',
  label: 'Lookup',
  description: '',
  phrases: ['look up'],
  enabled: true,
  agentEnabled: true,
  toolName: 'public_lookup',
  input: { topic: 'fixed' },
};

interface Calls {
  commands: Array<{ id: string; args: JsonValue[] }>;
  tools: Array<{ name: string; options: unknown; token: unknown }>;
}

function host(overrides: Partial<MappingExecutionHost> = {}): MappingExecutionHost & { calls: Calls } {
  const calls: Calls = { commands: [], tools: [] };
  return {
    calls,
    isWorkspaceTrusted: () => true,
    getCommandIds: async () => ['editor.action.formatDocument'],
    getToolNames: () => ['public_lookup'],
    executeCommand: async (id, ...args) => {
      calls.commands.push({ id, args });
      return { secret: 'discard me' };
    },
    invokeTool: async (name, options, token) => {
      calls.tools.push({ name, options, token });
      return { secret: 'discard me' };
    },
    ...overrides,
  };
}

test('command execution expands zero and multiple static arguments', async () => {
  const mappings = new Map<string, CustomMapping>([
    [command.id, command],
    [`vm_${'c'.repeat(22)}`, { ...command, id: `vm_${'c'.repeat(22)}`, args: [1, 'two', { three: true }] }],
  ]);
  const executionHost = host();
  const executor = new CustomMappingExecutor((id) => mappings.get(id), executionHost);
  assert.deepEqual(await executor.execute(command.id, { source: 'voice' }), {
    ok: true,
    mappingId: command.id,
    kind: 'command',
  });
  const multiple = [...mappings.values()][1];
  assert.equal((await executor.execute(multiple.id, { source: 'agent' })).ok, true);
  assert.deepEqual(executionHost.calls.commands, [
    { id: command.commandId, args: [] },
    { id: command.commandId, args: [1, 'two', { three: true }] },
  ]);
});

test('nested tool execution forwards Agent token and cancellation but voice has no token', async () => {
  const executionHost = host();
  const executor = new CustomMappingExecutor((id) => id === tool.id ? tool : undefined, executionHost);
  const token = { isCancellationRequested: false } satisfies MappingCancellationToken;
  const hostToken = { opaque: true };
  assert.equal((await executor.execute(tool.id, {
    source: 'agent',
    toolInvocationToken: hostToken,
    cancellationToken: token,
  })).ok, true);
  assert.deepEqual(executionHost.calls.tools[0], {
    name: tool.toolName,
    options: { input: tool.input, toolInvocationToken: hostToken },
    token,
  });

  assert.equal((await executor.execute(tool.id, { source: 'voice' })).ok, true);
  assert.deepEqual(executionHost.calls.tools[1], {
    name: tool.toolName,
    options: { input: tool.input, toolInvocationToken: undefined },
    token: undefined,
  });
  assert.deepEqual(await executor.execute(tool.id, {
    source: 'voice',
    toolInvocationToken: hostToken,
  }), { ok: false, reason: 'invalid-voice-token' });
});

test('an Auto dispatch recheck survives the request-to-dispatch delay and still binds the target', async () => {
  // Both fingerprints are computed through the real helpers, exactly as the runtime wires
  // them: a constant stub here would hide a binding that can never compare equal.
  const probe: TargetProbe = {
    requestedTarget: 'here',
    focusedTarget: 'editor',
    vscodeFocused: true,
    activeTabIdentity: 'tab-1',
    activeEditorIdentity: 'editor-1',
    activeTerminalIdentity: null,
  };
  let clock = 1_000;
  let live: TargetProbe = probe;
  const expectedTargetFingerprint = autoDispatchTargetFingerprint(captureTargetSnapshot(probe, clock));
  const executionHost = host({
    getTargetFingerprint: () => autoDispatchTargetFingerprint(captureTargetSnapshot(live, clock)),
  });
  const executor = new CustomMappingExecutor(() => command, executionHost);

  clock += 4_000;
  assert.deepEqual(
    await executor.execute(command.id, { source: 'voice', expectedTargetFingerprint }),
    { ok: true, mappingId: command.id, kind: 'command' },
    'an unchanged target must dispatch even though every capture carries a fresh timestamp',
  );
  assert.equal(executionHost.calls.commands.length, 1);

  for (const moved of [
    { ...probe, activeEditorIdentity: 'editor-2' },
    { ...probe, activeTabIdentity: 'tab-2' },
    { ...probe, activeTerminalIdentity: 'terminal-1' },
    { ...probe, vscodeFocused: false },
  ]) {
    live = moved;
    clock += 1_000;
    assert.deepEqual(
      await executor.execute(command.id, { source: 'voice', expectedTargetFingerprint }),
      { ok: false, reason: 'target-changed' },
      `Auto dispatch must stop when the target moves: ${JSON.stringify(moved)}`,
    );
  }
  assert.equal(executionHost.calls.commands.length, 1, 'no dispatch after the target moved');
});

test('executor fails closed for trust, cancellation, disabled exposure, stale fingerprint, and disappearance', async () => {
  const cancelled = { isCancellationRequested: true };
  assert.deepEqual(
    await new CustomMappingExecutor(() => command, host({ isWorkspaceTrusted: () => false }))
      .execute(command.id, { source: 'voice' }),
    { ok: false, reason: 'workspace-untrusted' },
  );
  assert.deepEqual(
    await new CustomMappingExecutor(() => command, host())
      .execute(command.id, { source: 'voice', cancellationToken: cancelled }),
    { ok: false, reason: 'cancelled' },
  );
  assert.deepEqual(
    await new CustomMappingExecutor(() => ({ ...command, agentEnabled: false }), host())
      .execute(command.id, { source: 'agent' }),
    { ok: false, reason: 'mapping-not-agent-enabled' },
  );
  assert.deepEqual(
    await new CustomMappingExecutor(() => command, host())
      .execute(command.id, { source: 'voice', expectedFingerprint: 'stale' }),
    { ok: false, reason: 'mapping-changed' },
  );
  assert.equal(mappingFingerprint(command).length, 64);
  assert.deepEqual(
    await new CustomMappingExecutor(() => command, host({ getCommandIds: async () => [] }))
      .execute(command.id, { source: 'voice' }),
    { ok: false, reason: 'target-unavailable' },
  );
  assert.deepEqual(
    await new CustomMappingExecutor(() => tool, host({ getToolNames: () => [] }))
      .execute(tool.id, { source: 'agent' }),
    { ok: false, reason: 'target-unavailable' },
  );
});

test('one shared guard rejects concurrent voice and Agent execution', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const executionHost = host({ executeCommand: async () => gate });
  const executor = new CustomMappingExecutor(() => command, executionHost);
  const voice = executor.execute(command.id, { source: 'voice' });
  await Promise.resolve();
  assert.equal(executor.isRunning, true);
  assert.deepEqual(await executor.execute(command.id, { source: 'agent' }), {
    ok: false,
    reason: 'busy',
  });
  release();
  assert.equal((await voice).ok, true);
  assert.equal(executor.isRunning, false);
});

test('cancellation during a resolved command dispatch reports non-retryable success', async () => {
  let cancelled = false;
  let calls = 0;
  const token: MappingCancellationToken = {
    get isCancellationRequested() { return cancelled; },
  };
  const executor = new CustomMappingExecutor(
    () => command,
    host({
      executeCommand: async () => {
        calls += 1;
        cancelled = true;
      },
    }),
  );
  assert.deepEqual(await executor.execute(command.id, {
    source: 'agent',
    cancellationToken: token,
  }), { ok: true, mappingId: command.id, kind: 'command' });
  assert.equal(calls, 1);
});

test('cancellation during a resolved nested-tool dispatch reports non-retryable success', async () => {
  let cancelled = false;
  let calls = 0;
  const token: MappingCancellationToken = {
    get isCancellationRequested() { return cancelled; },
  };
  const executor = new CustomMappingExecutor(
    () => tool,
    host({
      invokeTool: async () => {
        calls += 1;
        cancelled = true;
      },
    }),
  );
  assert.deepEqual(await executor.execute(tool.id, {
    source: 'agent',
    cancellationToken: token,
  }), { ok: true, mappingId: tool.id, kind: 'language-model-tool' });
  assert.equal(calls, 1);
});

test('a command rejection after dispatch begins is indeterminate and must not be retried', async () => {
  let cancelled = false;
  let calls = 0;
  const token: MappingCancellationToken = {
    get isCancellationRequested() { return cancelled; },
  };
  const executor = new CustomMappingExecutor(
    () => command,
    host({
      executeCommand: async () => {
        calls += 1;
        cancelled = true;
        throw new Error('target error must stay private');
      },
    }),
  );
  assert.deepEqual(await executor.execute(command.id, {
    source: 'agent',
    cancellationToken: token,
  }), { ok: false, reason: 'outcome-unknown-do-not-retry' });
  assert.equal(calls, 1);
});

test('a nested-tool rejection after dispatch begins is indeterminate and must not be retried', async () => {
  let cancelled = false;
  let calls = 0;
  const token: MappingCancellationToken = {
    get isCancellationRequested() { return cancelled; },
  };
  const executor = new CustomMappingExecutor(
    () => tool,
    host({
      invokeTool: async () => {
        calls += 1;
        cancelled = true;
        throw new Error('nested tool error must stay private');
      },
    }),
  );
  assert.deepEqual(await executor.execute(tool.id, {
    source: 'agent',
    cancellationToken: token,
  }), { ok: false, reason: 'outcome-unknown-do-not-retry' });
  assert.equal(calls, 1);
});

test('post-dispatch rejection is indeterminate even without cancellation', async () => {
  let calls = 0;
  const executor = new CustomMappingExecutor(
    () => command,
    host({
      executeCommand: async () => {
        calls += 1;
        throw new Error('private target error');
      },
    }),
  );
  assert.deepEqual(await executor.execute(command.id, { source: 'voice' }), {
    ok: false,
    reason: 'outcome-unknown-do-not-retry',
  });
  assert.equal(calls, 1);
});

test('an edit or deletion during asynchronous discovery cancels before invocation', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let current: CustomMapping | undefined = command;
  const executionHost = host({
    getCommandIds: async () => {
      await gate;
      return ['editor.action.formatDocument'];
    },
  });
  const executor = new CustomMappingExecutor(() => current, executionHost);
  const pending = executor.execute(command.id, { source: 'agent' });
  current = { ...command, id: `vm_${'d'.repeat(22)}`, label: 'Edited' };
  release();
  assert.deepEqual(await pending, { ok: false, reason: 'mapping-changed' });
  assert.deepEqual(executionHost.calls.commands, []);
});

test('a workspace trust downgrade during asynchronous discovery cancels before dispatch', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let trusted = true;
  const executionHost = host({
    isWorkspaceTrusted: () => trusted,
    getCommandIds: async () => {
      await gate;
      return ['editor.action.formatDocument'];
    },
  });
  const executor = new CustomMappingExecutor(() => command, executionHost);
  const pending = executor.execute(command.id, { source: 'agent' });
  trusted = false;
  release();
  assert.deepEqual(await pending, { ok: false, reason: 'workspace-untrusted' });
  assert.deepEqual(executionHost.calls.commands, []);
});

test('corrupt resolver values never reach the execution host', async () => {
  const executionHost = host();
  const corrupt = { ...command, commandId: '_private' } as CustomMapping;
  assert.deepEqual(
    await new CustomMappingExecutor(() => corrupt, executionHost)
      .execute(corrupt.id, { source: 'voice' }),
    { ok: false, reason: 'execution-failed' },
  );
  assert.deepEqual(executionHost.calls.commands, []);
});
