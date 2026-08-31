import {
  DEFAULT_AGENT_MAPPING_PAGE_SIZE,
  MAX_AGENT_MAPPING_PAGE_SIZE,
  MAX_AGENT_MAPPING_RESULT_CHARS,
  MAX_CUSTOM_MAPPINGS,
  MappingError,
  type AgentMappingPage,
  type CustomMapping,
} from './mappingTypes';

export function paginateAgentMappings(
  mappings: readonly CustomMapping[],
  cursor = 0,
  limit = DEFAULT_AGENT_MAPPING_PAGE_SIZE,
): AgentMappingPage {
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > MAX_CUSTOM_MAPPINGS) {
    throw new MappingError('invalid-payload');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_AGENT_MAPPING_PAGE_SIZE) {
    throw new MappingError('invalid-payload');
  }
  const exposed = mappings
    .filter((mapping) => mapping.enabled && mapping.agentEnabled)
    .sort((left, right) => left.id.localeCompare(right.id));
  const page = exposed.slice(cursor, cursor + limit).map((mapping) => ({
    mappingId: mapping.id,
    label: mapping.label,
    description: mapping.description,
  }));
  return {
    mappings: page,
    nextCursor: cursor + page.length < exposed.length ? cursor + page.length : null,
    total: exposed.length,
  };
}

export function serializeAgentMappingPage(page: AgentMappingPage): string {
  const serialized = JSON.stringify(page);
  if (serialized.length > MAX_AGENT_MAPPING_RESULT_CHARS) {
    throw new MappingError('invalid-payload');
  }
  return serialized;
}
