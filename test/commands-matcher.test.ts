import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUILTIN_COMMAND_CATALOG,
  matchBuiltinCommand,
  parseCommitMessage,
  parseNewRef,
  parseQuery,
  type BuiltinCommandDefinition,
  type BuiltinMatchContext,
} from '../src/commands';

const context: BuiltinMatchContext = {
  isAvailable: () => true,
  documentLineCount: 80,
  workspaceFiles: [
    { id: 'file:///workspace/src/main.ts', label: 'main.ts', relativePath: 'src/main.ts' },
    { id: 'file:///workspace/test/main.test.ts', label: 'main.test.ts', relativePath: 'test/main.test.ts' },
  ],
  existingRefs: ['main', 'feature/safe'],
};

test('matcher resolves exact HE/EN phrases before most-specific typed templates', () => {
  const exact = matchBuiltinCommand('  COPY ', context);
  assert.equal(exact.status, 'matched');
  if (exact.status === 'matched') assert.equal(exact.definition.id, 'voiceInput.builtin.edit.copy');

  const line = matchBuiltinCommand('go to line 17', context);
  assert.equal(line.status, 'matched');
  if (line.status === 'matched') assert.deepEqual(line.slots, { line: 17 });

  const file = matchBuiltinCommand('פתח קובץ src/main.ts', context);
  assert.equal(file.status, 'matched');
  if (file.status === 'matched') {
    assert.deepEqual(file.slots.file, context.workspaceFiles?.[0]);
  }

  const commit = matchBuiltinCommand('commit staged Preserve API Case', context);
  assert.equal(commit.status, 'matched');
  if (commit.status === 'matched') assert.equal(commit.slots.message, 'Preserve API Case');
});

test('invalid, unavailable, and ambiguous built-ins fail closed without a match', () => {
  assert.deepEqual(matchBuiltinCommand('go to line 81', context), { status: 'invalid-slot' });
  assert.deepEqual(matchBuiltinCommand('create branch bad..ref', context), { status: 'invalid-slot' });
  assert.deepEqual(matchBuiltinCommand('push', { ...context, isAvailable: () => false }), {
    status: 'unavailable',
  });

  const copy = BUILTIN_COMMAND_CATALOG.find(({ id }) => id === 'voiceInput.builtin.edit.copy');
  assert.ok(copy);
  const collision = {
    ...copy,
    id: 'voiceInput.builtin.edit.collision',
  } as BuiltinCommandDefinition;
  assert.deepEqual(matchBuiltinCommand('copy', context, [copy, collision]), { status: 'ambiguous' });
});

test('slot parsers enforce code-point and Git-safe bounds', () => {
  assert.equal(parseQuery('א'.repeat(256)).ok, true);
  assert.equal(parseQuery('א'.repeat(257)).ok, false);
  assert.equal(parseCommitMessage('one line commit').ok, true);
  assert.equal(parseCommitMessage('line one\nline two').ok, false);
  assert.equal(parseCommitMessage(`safe\u202Ehidden`).ok, false);
  assert.equal(parseCommitMessage('x'.repeat(501)).ok, false);
  assert.equal(parseNewRef('feature/safe-123').ok, true);
  for (const unsafe of ['bad..ref', 'bad//ref', '.hidden', 'bad.lock', 'bad@{ref}', 'ends/']) {
    assert.equal(parseNewRef(unsafe).ok, false, unsafe);
  }
});
