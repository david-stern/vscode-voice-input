import assert from 'node:assert/strict';
import test from 'node:test';

import { ControlCenterDetachedOperations } from '../src/platform/controlCenterCoordinatorSupport';

test('whenIdle resolves even when the failure log sink itself throws', async () => {
  const detached = new ControlCenterDetachedOperations(() => {
    throw new Error('log sink failed');
  });
  detached.run('op', () => Promise.reject(new Error('operation failed')));
  await detached.whenIdle();
});

test('a contained failure is logged once and frees the key for the next run', async () => {
  const logs: string[] = [];
  const detached = new ControlCenterDetachedOperations((message) => logs.push(message));
  detached.run('op', () => Promise.reject(new Error('first failed')));
  await detached.whenIdle();

  let ran = false;
  detached.run('op', () => { ran = true; });
  await detached.whenIdle();

  assert.ok(ran, 'a settled key must accept the next operation');
  assert.deepEqual(logs, ['Control Center contained a failed operation: op']);
});
