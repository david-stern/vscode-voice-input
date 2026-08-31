import { createHash } from 'node:crypto';

import { RESERVED_ASSISTANT_PHRASES } from './intents';
import {
  CUSTOM_MAPPING_SCHEMA_VERSION,
  MAPPING_ID_PATTERN,
  MAX_CUSTOM_MAPPINGS,
  MAX_MAPPING_JSON_BYTES,
  MAX_MAPPING_JSON_DEPTH,
  MappingError,
  type CustomMapping,
  type CustomMappingDraft,
  type CustomMappingPayload,
  type JsonObject,
  type JsonValue,
  type MappingErrorCode,
  type MappingTargetCatalog,
} from './mappingTypes';

const MAX_LABEL_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 240;
const MAX_PHRASES_PER_MAPPING = 8;
const MAX_PHRASE_LENGTH = 120;
const MAX_TARGET_ID_LENGTH = 256;
const MAX_ARRAY_ITEMS = 16;
const MAX_OBJECT_KEYS = 32;
const DANGEROUS_CHARACTER_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const FORBIDDEN_JSON_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const RECURSIVE_COMMAND_IDS = new Set([
  'voiceInput.runCustomMapping',
  'voiceInput.executeCustomMapping',
  'voiceInput.manageCustomMappings',
]);
const RECURSIVE_TOOL_NAMES = new Set([
  'voice-input_listMappings',
  'voice-input_runMapping',
]);

export function normalizeMappingPhrase(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[’׳`]/gu, "'")
    .replace(/\s+/gu, ' ')
    .trim();
}

export function isReservedMappingPhrase(value: string): boolean {
  const normalized = normalizeReservedPhrase(value);
  return RESERVED_ASSISTANT_PHRASES.some(
    (phrase) => normalizeReservedPhrase(phrase) === normalized,
  );
}

export function mappingFingerprint(mapping: CustomMapping): string {
  return createHash('sha256').update(canonicalJson(mapping)).digest('hex');
}

export function findMappingByPhrase(
  mappings: readonly CustomMapping[],
  postWakeText: string,
): CustomMapping | undefined {
  const candidate = normalizeMappingPhrase(postWakeText);
  if (!candidate) return undefined;
  const found = mappings.find(
    (mapping) =>
      mapping.enabled &&
      mapping.phrases.some((phrase) => normalizeMappingPhrase(phrase) === candidate),
  );
  return found ? cloneMapping(found) : undefined;
}

export function validateCustomMappingPayload(value: unknown): CustomMappingPayload {
  if (!isPlainObject(value) || value.schemaVersion !== CUSTOM_MAPPING_SCHEMA_VERSION) {
    throw new MappingError('invalid-payload');
  }
  const payloadKeys = Object.keys(value);
  if (
    payloadKeys.length !== 2 ||
    !payloadKeys.includes('schemaVersion') ||
    !payloadKeys.includes('mappings')
  ) {
    throw new MappingError('invalid-payload');
  }
  if (!Array.isArray(value.mappings) || value.mappings.length > MAX_CUSTOM_MAPPINGS) {
    throw new MappingError('invalid-payload');
  }

  const ids = new Set<string>();
  const phrases = new Set<string>();
  const mappings = value.mappings.map((raw) => {
    if (!isPlainObject(raw) || typeof raw.id !== 'string' || !MAPPING_ID_PATTERN.test(raw.id)) {
      throw new MappingError('invalid-id');
    }
    if (ids.has(raw.id)) throw new MappingError('invalid-id');
    ids.add(raw.id);
    const mapping = validateDraft(raw, undefined, true);
    for (const phrase of mapping.phrases) {
      const normalized = normalizeMappingPhrase(phrase);
      if (phrases.has(normalized)) throw new MappingError('duplicate-phrase');
      phrases.add(normalized);
    }
    return { id: raw.id, ...mapping } as CustomMapping;
  });
  return { schemaVersion: CUSTOM_MAPPING_SCHEMA_VERSION, mappings };
}

export function validateCustomMappingDraft(
  value: unknown,
  catalog: MappingTargetCatalog,
): CustomMappingDraft {
  return validateDraft(value, catalog);
}

export function isAllowedMappingTargetId(
  kind: CustomMappingDraft['kind'],
  targetId: string,
): boolean {
  try {
    validateTargetId(targetId, kind);
    return true;
  } catch {
    return false;
  }
}

export function createSelectableMappingTargetCatalog(
  commands: readonly string[],
  tools: readonly string[],
): MappingTargetCatalog {
  return {
    commands: new Set(commands.filter(
      (commandId) => isAllowedMappingTargetId('command', commandId),
    )),
    tools: new Set(tools.filter(
      (toolName) => isAllowedMappingTargetId('language-model-tool', toolName),
    )),
  };
}

export function validateDraft(
  value: unknown,
  catalog: MappingTargetCatalog | undefined,
  allowPersistedId = false,
): CustomMappingDraft {
  if (!isPlainObject(value)) throw new MappingError('invalid-payload');
  assertExactDraftKeys(value, allowPersistedId);
  const label = boundedPlainString(value.label, 1, MAX_LABEL_LENGTH, 'invalid-label');
  const description = boundedPlainString(
    value.description,
    0,
    MAX_DESCRIPTION_LENGTH,
    'invalid-description',
  );
  if (!Array.isArray(value.phrases) || value.phrases.length < 1 || value.phrases.length > MAX_PHRASES_PER_MAPPING) {
    throw new MappingError('invalid-phrase');
  }
  const normalizedPhrases = new Set<string>();
  const phrases = value.phrases.map((phrase) => {
    const text = boundedPlainString(phrase, 1, MAX_PHRASE_LENGTH, 'invalid-phrase');
    const normalized = normalizeMappingPhrase(text);
    if (!normalized || normalizedPhrases.has(normalized)) throw new MappingError('duplicate-phrase');
    if (isReservedMappingPhrase(normalized)) throw new MappingError('reserved-phrase');
    normalizedPhrases.add(normalized);
    return text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  });
  if (typeof value.enabled !== 'boolean' || typeof value.agentEnabled !== 'boolean') {
    throw new MappingError('invalid-payload');
  }

  const presentation = {
    label,
    description,
    phrases,
    enabled: value.enabled,
    agentEnabled: value.agentEnabled,
  };

  if (value.kind === 'command') {
    const commandId = validateTargetId(value.commandId, 'command');
    if (catalog && !catalog.commands.has(commandId)) throw new MappingError('target-unavailable');
    if (!Array.isArray(value.args)) throw new MappingError('invalid-json');
    validateJson(value.args);
    return { ...presentation, kind: 'command', commandId, args: cloneJson(value.args) };
  }
  if (value.kind === 'language-model-tool') {
    const toolName = validateTargetId(value.toolName, 'language-model-tool');
    if (catalog && !catalog.tools.has(toolName)) throw new MappingError('target-unavailable');
    if (!isPlainObject(value.input)) throw new MappingError('invalid-json');
    validateJson(value.input);
    return {
      ...presentation,
      kind: 'language-model-tool',
      toolName,
      input: cloneJson(value.input) as JsonObject,
    };
  }
  throw new MappingError('invalid-target');
}

function assertExactDraftKeys(value: Record<string, unknown>, allowPersistedId: boolean): void {
  const common = [
    'label',
    'description',
    'phrases',
    'enabled',
    'agentEnabled',
    'kind',
  ];
  const target = value.kind === 'command'
    ? ['commandId', 'args']
    : value.kind === 'language-model-tool'
      ? ['toolName', 'input']
      : [];
  const allowed = new Set([...common, ...target, ...(allowPersistedId ? ['id'] : [])]);
  const keys = Object.keys(value);
  if (
    target.length === 0 ||
    keys.some((key) => FORBIDDEN_JSON_KEYS.has(key) || !allowed.has(key)) ||
    allowed.size !== keys.length
  ) {
    throw new MappingError('invalid-payload');
  }
}

function validateTargetId(value: unknown, kind: CustomMappingDraft['kind']): string {
  const id = boundedPlainString(value, 1, MAX_TARGET_ID_LENGTH, 'invalid-target');
  if (id.startsWith('_') || /\s/u.test(id)) throw new MappingError('invalid-target');
  if (
    kind === 'command' &&
    (RECURSIVE_COMMAND_IDS.has(id) || /^voiceInput\.(?:run|execute).*mapping/iu.test(id))
  ) {
    throw new MappingError('invalid-target');
  }
  if (
    kind === 'language-model-tool' &&
    (RECURSIVE_TOOL_NAMES.has(id) || /^voice-input_/iu.test(id))
  ) {
    throw new MappingError('invalid-target');
  }
  return id;
}

function validateJson(value: unknown): asserts value is JsonValue {
  let serialized: string;
  try {
    assertJsonNode(value, 0, new Set<object>());
    serialized = canonicalJson(value as JsonValue);
  } catch (error) {
    if (error instanceof MappingError) throw error;
    throw new MappingError('invalid-json', error);
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_MAPPING_JSON_BYTES) {
    throw new MappingError('invalid-json');
  }
}

function assertJsonNode(value: unknown, depth: number, ancestors: Set<object>): void {
  if (depth > MAX_MAPPING_JSON_DEPTH) throw new MappingError('invalid-json');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new MappingError('invalid-json');
    return;
  }
  if (typeof value === 'string') {
    assertSafeText(value, 'invalid-json');
    if (value.includes('${') || /command\s*:/iu.test(value)) {
      throw new MappingError('invalid-json');
    }
    return;
  }
  if (typeof value !== 'object') throw new MappingError('invalid-json');
  if (ancestors.has(value)) throw new MappingError('invalid-json');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY_ITEMS) throw new MappingError('invalid-json');
      for (const item of value) assertJsonNode(item, depth + 1, ancestors);
      return;
    }
    if (!isPlainObject(value)) throw new MappingError('invalid-json');
    const keys = Object.keys(value);
    if (keys.length > MAX_OBJECT_KEYS) throw new MappingError('invalid-json');
    for (const key of keys) {
      if (FORBIDDEN_JSON_KEYS.has(key)) throw new MappingError('invalid-json');
      assertSafeText(key, 'invalid-json');
      assertJsonNode(value[key], depth + 1, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}

function boundedPlainString(
  value: unknown,
  minimum: number,
  maximum: number,
  code: MappingErrorCode,
): string {
  if (typeof value !== 'string') throw new MappingError(code);
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < minimum || normalized.length > maximum) throw new MappingError(code);
  assertSafeText(normalized, code);
  return normalized;
}

function assertSafeText(value: string, code: MappingErrorCode): void {
  if (DANGEROUS_CHARACTER_PATTERN.test(value)) throw new MappingError(code);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`;
}

function normalizeReservedPhrase(value: string): string {
  return normalizeMappingPhrase(value).replace(/[\s\p{P}\p{S}]+$/gu, '').trim();
}

export function isUnavailableTargetRiskReduction(
  previous: CustomMapping,
  next: CustomMappingDraft,
): boolean {
  const reduced = (previous.enabled && !next.enabled) ||
    (previous.agentEnabled && !next.agentEnabled);
  if (!reduced || (!previous.enabled && next.enabled) ||
    (!previous.agentEnabled && next.agentEnabled)) {
    return false;
  }
  const previousAuthority = cloneMappingAuthority(previous);
  const nextAuthority = cloneMappingAuthority(next);
  return canonicalJson(previousAuthority) === canonicalJson(nextAuthority);
}

function cloneMappingAuthority(mapping: CustomMapping | CustomMappingDraft): JsonValue {
  const common = {
    kind: mapping.kind,
    label: mapping.label,
    description: mapping.description,
    phrases: mapping.phrases,
  };
  return mapping.kind === 'command'
    ? { ...common, commandId: mapping.commandId, args: mapping.args }
    : { ...common, toolName: mapping.toolName, input: mapping.input };
}

function cloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function cloneMapping(mapping: CustomMapping): CustomMapping {
  return cloneJson(mapping as unknown as JsonValue) as unknown as CustomMapping;
}
