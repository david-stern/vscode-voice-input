export const COMMAND_CATEGORY_FILTERS = [
  'editing',
  'selection-cursor',
  'files-tabs',
  'search-navigation',
  'code-refactor',
  'panels-debug-tests',
  'git',
] as const;

export type CommandCategoryFilter = (typeof COMMAND_CATEGORY_FILTERS)[number];

export interface CommandFilterState {
  query: string;
  category?: CommandCategoryFilter;
  enabledOnly: boolean;
  changedOnly: boolean;
}

const EMPTY_FILTERS: Readonly<CommandFilterState> = {
  query: '',
  enabledOnly: false,
  changedOnly: false,
};
const VERSIONED_FILTER = /^v1:([0-7]):([01]):([01]):([\s\S]*)$/u;
const MAX_QUERY_CODE_POINTS = 180;
const MAX_TOKEN_CODE_POINTS = 200;

/** The compact persisted token never appears in the search box or filter labels. */
export function parseCommandFilterState(value: string | undefined): CommandFilterState {
  if (!value) return { ...EMPTY_FILTERS };
  const match = VERSIONED_FILTER.exec(value);
  if (match) {
    const categoryIndex = Number(match[1]);
    const category = categoryIndex > 0 ? COMMAND_CATEGORY_FILTERS[categoryIndex - 1] : undefined;
    return {
      query: truncateCodePoints(match[4] ?? '', MAX_QUERY_CODE_POINTS),
      ...(category ? { category } : {}),
      enabledOnly: match[2] === '1',
      changedOnly: match[3] === '1',
    };
  }
  if (value === 'enabled:true') return { ...EMPTY_FILTERS, enabledOnly: true };
  if (value === 'changed:true') return { ...EMPTY_FILTERS, changedOnly: true };
  if (value.startsWith('category:')) {
    const category = value.slice('category:'.length) as CommandCategoryFilter;
    if (COMMAND_CATEGORY_FILTERS.includes(category)) return { ...EMPTY_FILTERS, category };
  }
  return { ...EMPTY_FILTERS, query: truncateCodePoints(value, MAX_QUERY_CODE_POINTS) };
}

export function serializeCommandFilterState(state: Readonly<CommandFilterState>): string {
  const query = truncateCodePoints(state.query, MAX_QUERY_CODE_POINTS);
  const categoryIndex = state.category
    ? COMMAND_CATEGORY_FILTERS.indexOf(state.category) + 1
    : 0;
  if (!query && categoryIndex === 0 && !state.enabledOnly && !state.changedOnly) return '';
  const token = `v1:${categoryIndex}:${state.enabledOnly ? 1 : 0}:${state.changedOnly ? 1 : 0}:${query}`;
  return truncateCodePoints(token, MAX_TOKEN_CODE_POINTS);
}

export function updateCommandFilterState(
  current: string | undefined,
  update: Partial<CommandFilterState>,
): string {
  return serializeCommandFilterState({ ...parseCommandFilterState(current), ...update });
}

function truncateCodePoints(value: string, maximum: number): string {
  return Array.from(value).slice(0, maximum).join('');
}
