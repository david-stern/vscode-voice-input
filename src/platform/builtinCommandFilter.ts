import type { BuiltinCommandDefinition } from '../commands';
import { parseCommandFilterState } from '../webview/controlCenter/filters';

export function filterBuiltinCommands(
  catalog: readonly BuiltinCommandDefinition[],
  token: string,
  language: 'en' | 'he',
  changed: (commandId: string) => boolean,
): BuiltinCommandDefinition[] {
  const state = parseCommandFilterState(token);
  const query = state.query.normalize('NFKC').trim().toLocaleLowerCase(language);
  return catalog.filter((definition) => {
    if (state.enabledOnly && !definition.enabledByDefault) return false;
    if (state.changedOnly && !changed(definition.id)) return false;
    if (state.category && definition.category !== categoryFromFilter(state.category)) return false;
    const text = [
      definition.id,
      definition.label[language],
      ...definition.phrases[language],
    ].join(' ').toLocaleLowerCase(language);
    return !query || text.includes(query);
  });
}

function categoryFromFilter(value: string): BuiltinCommandDefinition['category'] | undefined {
  const categories: Readonly<Record<string, BuiltinCommandDefinition['category']>> = {
    editing: 'editing',
    'selection-cursor': 'cursor-selection',
    'files-tabs': 'files-tabs-groups',
    'search-navigation': 'search-navigation',
    'code-refactor': 'code-refactor',
    'panels-debug-tests': 'panels-debug-tests',
    git: 'git',
  };
  return categories[value];
}
