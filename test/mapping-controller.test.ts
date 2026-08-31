import assert from 'node:assert/strict';
import test from 'node:test';

import type { CustomMapping } from '../src/assistant/mappings';
import type { MappingExecutionResult } from '../src/assistant/mappingExecutor';
import type { TargetSnapshot } from '../src/assistant/context';
import { PendingActionController } from '../src/features/mappings/pendingActionController';

const snapshot: TargetSnapshot = {
  requestedTarget: 'here',
  resolvedTarget: 'focused-control',
  vscodeFocused: true,
  activeTabIdentity: 'tab-1',
  activeEditorIdentity: null,
  activeTerminalIdentity: null,
};

function commandMapping(
  overrides: Partial<CustomMapping> = {},
): CustomMapping {
  return {
    id: 'vm_abcdefghijklmnopqrstuv',
    kind: 'command',
    label: 'Format document',
    description: 'Formats the active document',
    phrases: ['format this'],
    commandId: 'editor.action.formatDocument',
    args: [],
    enabled: true,
    agentEnabled: true,
    ...overrides,
  } as CustomMapping;
}

test('lifecycle cancellation consumes pending mapping authority before execution', async () => {
  let current = commandMapping();
  let now = 1_000;
  let executions = 0;
  const spoken: string[] = [];
  const controller = new PendingActionController({
    store: { get: () => current },
    executor: {
      execute: async (): Promise<MappingExecutionResult> => {
        executions += 1;
        return { ok: true, mappingId: current.id, kind: current.kind };
      },
    },
    isWorkspaceTrusted: () => true,
    captureTarget: () => snapshot,
    clearPendingSend: () => {},
    speak: (message) => spoken.push(message),
    publish: () => {},
    localize: (english) => english,
    now: () => now,
    setTimer: () => 1 as unknown as ReturnType<typeof setTimeout>,
    clearTimer: () => {},
  });

  controller.request(current, snapshot, 'utterance-1');
  assert.equal(controller.state?.id, current.id);
  controller.cancel(false);
  now += 1;
  await controller.confirm('utterance-2');

  assert.equal(controller.state, undefined);
  assert.equal(executions, 0);
  assert.match(spoken.at(-1) ?? '', /no-pending-action/u);
});

test('mapping changes between request and confirmation never reach the executor', async () => {
  let current = commandMapping();
  let now = 5_000;
  let executions = 0;
  const controller = new PendingActionController({
    store: { get: () => current },
    executor: {
      execute: async (): Promise<MappingExecutionResult> => {
        executions += 1;
        return { ok: true, mappingId: current.id, kind: current.kind };
      },
    },
    isWorkspaceTrusted: () => true,
    captureTarget: () => snapshot,
    clearPendingSend: () => {},
    speak: () => {},
    publish: () => {},
    localize: (english) => english,
    now: () => now,
    setTimer: () => 1 as unknown as ReturnType<typeof setTimeout>,
    clearTimer: () => {},
  });

  controller.request(current, snapshot, 'utterance-1');
  current = commandMapping({ label: 'Changed after request' });
  now += 1;
  await controller.confirm('utterance-2');

  assert.equal(controller.state, undefined);
  assert.equal(executions, 0);
});

test('lifecycle cancellation reaches a confirmed mapping before delayed dispatch', async () => {
  const current = commandMapping();
  let now = 10_000;
  let release!: () => void;
  const paused = new Promise<void>((resolve) => { release = resolve; });
  let observedCancelled = false;
  const spoken: string[] = [];
  const controller = new PendingActionController({
    store: { get: () => current },
    executor: {
      execute: async (_mappingId, options): Promise<MappingExecutionResult> => {
        await paused;
        observedCancelled = options.cancellationToken?.isCancellationRequested === true;
        return observedCancelled
          ? { ok: false, reason: 'cancelled' }
          : { ok: true, mappingId: current.id, kind: current.kind };
      },
    },
    isWorkspaceTrusted: () => true,
    captureTarget: () => snapshot,
    clearPendingSend: () => {},
    speak: (message) => { spoken.push(message); },
    publish: () => {},
    localize: (english) => english,
    now: () => now,
    setTimer: () => 1 as unknown as ReturnType<typeof setTimeout>,
    clearTimer: () => {},
  });

  controller.request(current, snapshot, 'utterance-1');
  now += 1;
  const confirmation = controller.confirm('utterance-2');
  controller.cancel(false);
  release();
  await confirmation;

  assert.equal(observedCancelled, true);
  assert.equal(spoken.length, 1);
});

test('untrusted workspaces never mint pending voice authority', () => {
  const current = commandMapping();
  let executions = 0;
  const spoken: string[] = [];
  const controller = new PendingActionController({
    store: { get: () => current },
    executor: {
      execute: async (): Promise<MappingExecutionResult> => {
        executions += 1;
        return { ok: true, mappingId: current.id, kind: current.kind };
      },
    },
    isWorkspaceTrusted: () => false,
    captureTarget: () => snapshot,
    clearPendingSend: () => {},
    speak: (message) => spoken.push(message),
    publish: () => {},
    localize: (english) => english,
  });

  controller.request(current, snapshot, 'utterance-1');

  assert.equal(controller.state, undefined);
  assert.equal(executions, 0);
  assert.match(spoken[0] ?? '', /not trusted/u);
});
