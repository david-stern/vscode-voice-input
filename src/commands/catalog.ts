import type { BuiltinCommandDefinition } from './contracts';
import { CODE_COMMANDS } from './catalog/code';
import { CURSOR_SELECTION_COMMANDS } from './catalog/cursorSelection';
import { EDITING_COMMANDS } from './catalog/editing';
import { GIT_COMMANDS } from './catalog/git';
import { NAVIGATION_COMMANDS } from './catalog/navigation';
import { PANEL_COMMANDS } from './catalog/panels';
import { WORKBENCH_COMMANDS } from './catalog/workbench';

export const BUILTIN_COMMAND_CATALOG: readonly BuiltinCommandDefinition[] = Object.freeze([
  ...EDITING_COMMANDS,
  ...CURSOR_SELECTION_COMMANDS,
  ...WORKBENCH_COMMANDS,
  ...NAVIGATION_COMMANDS,
  ...CODE_COMMANDS,
  ...PANEL_COMMANDS,
  ...GIT_COMMANDS,
]);

export const BUILTIN_COMMAND_BY_ID: ReadonlyMap<string, BuiltinCommandDefinition> = new Map(
  BUILTIN_COMMAND_CATALOG.map((definition) => [definition.id, definition]),
);
