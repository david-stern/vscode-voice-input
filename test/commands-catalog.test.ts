import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUILTIN_COMMAND_CATALOG,
  BUILTIN_COMMAND_CATEGORIES,
  EXECUTOR_MATRIX,
} from '../src/commands';

const expectedCounts = {
  editing: 18,
  'cursor-selection': 14,
  'files-tabs-groups': 18,
  'search-navigation': 15,
  'code-refactor': 10,
  'panels-debug-tests': 13,
  git: 12,
} as const;

test('catalog freezes exactly 100 stable bilingual command definitions and category counts', () => {
  assert.equal(BUILTIN_COMMAND_CATALOG.length, 100);
  assert.equal(new Set(BUILTIN_COMMAND_CATALOG.map(({ id }) => id)).size, 100);
  assert.deepEqual(
    Object.fromEntries(BUILTIN_COMMAND_CATEGORIES.map((category) => [
      category,
      BUILTIN_COMMAND_CATALOG.filter((definition) => definition.category === category).length,
    ])),
    expectedCounts,
  );
  for (const definition of BUILTIN_COMMAND_CATALOG) {
    assert.match(definition.id, /^voiceInput\.builtin\.[A-Za-z0-9.]+$/u);
    assert.ok(definition.label.en && definition.label.he);
    assert.ok(definition.description.en && definition.description.he);
    assert.ok(definition.phrases.en.length > 0 && definition.phrases.he.length > 0);
    assert.equal(definition.enabledByDefault, true);
    assert.equal(definition.fallback, 'none');
    assert.equal(definition.availability.localTrustedOnly, true);
    assert.equal(definition.availability.minimumVscodeVersion, '1.99.0');
  }
});

test('risk freeze requires confirmation only for named disk/process actions and all Git', () => {
  const confirmation = BUILTIN_COMMAND_CATALOG
    .filter(({ riskTier }) => riskTier === 'confirmation-required')
    .map(({ id }) => id);
  assert.deepEqual(confirmation, [
    'voiceInput.builtin.file.new',
    'voiceInput.builtin.file.save',
    'voiceInput.builtin.file.saveAll',
    'voiceInput.builtin.panel.newTerminal',
    'voiceInput.builtin.debug.start',
    'voiceInput.builtin.debug.stop',
    'voiceInput.builtin.debug.restart',
    'voiceInput.builtin.test.runAll',
    ...BUILTIN_COMMAND_CATALOG.filter(({ category }) => category === 'git').map(({ id }) => id),
  ]);
});

test('executor matrix has exact catalog parity and Git is local API-only', () => {
  assert.equal(EXECUTOR_MATRIX.length, 100);
  assert.deepEqual(
    EXECUTOR_MATRIX.map(({ commandId }) => commandId),
    BUILTIN_COMMAND_CATALOG.map(({ id }) => id),
  );
  const git = EXECUTOR_MATRIX.filter(({ kind }) => kind === 'git-api');
  assert.equal(git.length, 12);
  for (const entry of git) {
    assert.equal(entry.remote, false);
    assert.equal(entry.shellFallback, 'none');
    assert.equal(entry.rejectionAfterDispatch, 'unknown-do-not-retry');
  }
});
