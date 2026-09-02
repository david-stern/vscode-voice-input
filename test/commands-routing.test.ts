import assert from 'node:assert/strict';
import test from 'node:test';

import { BUILTIN_COMMAND_BY_ID, type BuiltinMatchResult } from '../src/commands';
import { routeVoiceMappingRequest } from '../src/features/mappings/voiceRequestRouter';
import type { TargetSnapshot } from '../src/assistant/context';

const snapshot: TargetSnapshot = {
  requestedTarget: 'editor', resolvedTarget: 'editor', focusedTarget: 'editor',
  vscodeFocused: true, activeTabIdentity: 'tab', activeEditorIdentity: 'editor',
  activeTerminalIdentity: null, capturedAt: 1,
};

test('async built-in matching runs before exact custom matching', async () => {
  const definition = BUILTIN_COMMAND_BY_ID.get('voiceInput.builtin.edit.copy');
  assert.ok(definition);
  let builtinRequests = 0;
  let customMatches = 0;
  const result = await routeVoiceMappingRequest('copy', snapshot, 'utterance', {
    matchPhrase: () => { customMatches += 1; return undefined; },
    request: () => assert.fail('custom must not run'),
    confirm: async () => undefined,
    cancel: () => undefined,
  }, {
    matchPhrase: async () => ({ status: 'matched', definition, slots: {} }),
    request: async () => { builtinRequests += 1; },
  });
  assert.deepEqual(result, { handled: true, kind: 'mapping' });
  assert.equal(builtinRequests, 1);
  assert.equal(customMatches, 0);
});

test('ambiguous or invalid built-in blocks custom and planner dispatch', async () => {
  let cancelled = 0;
  for (const status of ['ambiguous', 'invalid-slot', 'unavailable'] as const) {
    const result = await routeVoiceMappingRequest('recognized but unsafe', snapshot, status, {
      matchPhrase: () => assert.fail('custom matching must be blocked'),
      request: () => assert.fail('custom request must be blocked'),
      confirm: async () => undefined,
      cancel: () => { cancelled += 1; },
    }, {
      matchPhrase: () => ({ status } satisfies BuiltinMatchResult),
      request: () => assert.fail('blocked built-in must not dispatch'),
    });
    assert.equal(result.handled, true);
  }
  assert.equal(cancelled, 3);
});
