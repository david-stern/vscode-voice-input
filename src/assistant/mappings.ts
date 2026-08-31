export {
  CUSTOM_MAPPING_SCHEMA_VERSION,
  CUSTOM_MAPPING_STORAGE_KEY,
  DEFAULT_AGENT_MAPPING_PAGE_SIZE,
  DEFAULT_MAPPING_CONFIRMATION_TTL_MS,
  MAX_AGENT_MAPPING_PAGE_SIZE,
  MAX_AGENT_MAPPING_RESULT_CHARS,
  MAX_CUSTOM_MAPPINGS,
  MAX_MAPPING_JSON_BYTES,
  MAX_MAPPING_JSON_DEPTH,
  MappingError,
} from './mappingTypes';
export type {
  AgentMappingPage,
  AgentMappingSummary,
  CommandMappingDraft,
  CustomMapping,
  CustomMappingDraft,
  CustomMappingPayload,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  LanguageModelToolMappingDraft,
  MappingCapabilityDecision,
  MappingCapabilityFailure,
  MappingErrorCode,
  MappingLoadResult,
  MappingStorage,
  MappingTargetCatalog,
} from './mappingTypes';

export {
  createSelectableMappingTargetCatalog,
  findMappingByPhrase,
  isAllowedMappingTargetId,
  isReservedMappingPhrase,
  mappingFingerprint,
  normalizeMappingPhrase,
  validateCustomMappingDraft,
  validateCustomMappingPayload,
} from './mappingValidation';

export { CustomMappingRegistry } from './mappingRegistry';
export { MappingCapabilityPolicy } from './mappingCapability';
export {
  paginateAgentMappings,
  serializeAgentMappingPage,
} from './mappingAgentPage';
