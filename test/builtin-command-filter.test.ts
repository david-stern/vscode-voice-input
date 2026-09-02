import assert from 'node:assert/strict';
import test from 'node:test';

import { BUILTIN_COMMAND_CATALOG } from '../src/commands';
import { filterBuiltinCommands } from '../src/platform/builtinCommandFilter';
import { serializeCommandFilterState } from '../src/webview/controlCenter/filters';

test('built-in command filters apply query, category, enabled, and changed as one AND expression', () => {
  const changed = new Set([
    'voiceInput.builtin.git.commitStaged',
    'voiceInput.builtin.git.push',
  ]);
  const token = serializeCommandFilterState({
    query: 'commit',
    category: 'git',
    enabledOnly: true,
    changedOnly: true,
  });
  const matches = filterBuiltinCommands(
    BUILTIN_COMMAND_CATALOG,
    token,
    'en',
    (id) => changed.has(id),
  );
  assert.deepEqual(matches.map(({ id }) => id), ['voiceInput.builtin.git.commitStaged']);
});

test('disabled built-ins remain discoverable unless enabled-only is selected', () => {
  const base = BUILTIN_COMMAND_CATALOG[0];
  const disabled = { ...base, enabledByDefault: false };
  const catalog = [disabled, ...BUILTIN_COMMAND_CATALOG.slice(1)];
  const query = disabled.label.en;
  const visible = filterBuiltinCommands(catalog, query, 'en', () => false);
  assert.ok(visible.some(({ id }) => id === disabled.id));
  const enabledOnly = serializeCommandFilterState({
    query,
    enabledOnly: true,
    changedOnly: false,
  });
  assert.equal(
    filterBuiltinCommands(catalog, enabledOnly, 'en', () => false)
      .some(({ id }) => id === disabled.id),
    false,
  );
});
