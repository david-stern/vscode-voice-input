import { normalizePersonaId, PERSONA_IDS } from '../assistant/personas';
import { isProviderId } from '../inference';
import {
  AGENT_ID_PATTERN,
  AGENT_SCHEMA_VERSION,
  BUILTIN_AGENT_TEMPLATE_IDS,
  MAX_AGENTS,
  MAX_AGENT_DESCRIPTION_LENGTH,
  MAX_AGENT_INSTRUCTIONS_LENGTH,
  MAX_AGENT_NAME_LENGTH,
  AgentError,
  type AgentDraft,
  type AgentPayload,
  type AgentRecord,
  type BuiltinAgentTemplateId,
  type LocalizedAgentText,
} from './contracts';

const DANGEROUS_CHARACTER_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const SECRET_LIKE_PATTERN = /(?:\bsk-[A-Za-z0-9_-]{16,}|\bAIza[A-Za-z0-9_-]{16,}|\bAKIA[A-Z0-9]{12,}|\bBearer\s+[A-Za-z0-9._~+/-]{16,})/u;

export function normalizeAgentName(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('en-US');
}

export function validateAgentDraft(value: unknown): AgentDraft {
  const record = requirePlainObject(value);
  assertExactKeys(record, [
    'name',
    'description',
    'provider',
    'model',
    'persona',
    'instructions',
    'speech',
    'fallback',
    'enabled',
    'templateId',
  ], ['fallback', 'templateId']);
  const name = boundedText(record.name, 1, MAX_AGENT_NAME_LENGTH, 'invalid-name');
  const description = localizedText(
    record.description,
    MAX_AGENT_DESCRIPTION_LENGTH,
    'invalid-description',
  );
  if (!isProviderId(record.provider)) throw new AgentError('invalid-provider');
  const model = validateModel(record.model);
  if (!PERSONA_IDS.includes(record.persona as never)) throw new AgentError('invalid-persona');
  const persona = normalizePersonaId(record.persona);
  const instructions = localizedText(
    record.instructions,
    MAX_AGENT_INSTRUCTIONS_LENGTH,
    'invalid-instructions',
  );
  const speech = validateSpeech(record.speech);
  if (typeof record.enabled !== 'boolean') throw new AgentError('invalid-payload');
  const fallback = record.fallback === undefined
    ? undefined
    : validateFallback(record.fallback, record.provider, model);
  const templateId = record.templateId === undefined
    ? undefined
    : validateTemplateId(record.templateId);
  const userText = [
    name,
    description.en,
    description.he,
    model,
    instructions.en,
    instructions.he,
    speech.voiceUri,
    fallback?.model ?? '',
  ];
  if (userText.some((text) => SECRET_LIKE_PATTERN.test(text))) {
    throw new AgentError('secret-like-content');
  }
  return {
    name,
    description,
    provider: record.provider,
    model,
    persona,
    instructions,
    speech,
    ...(fallback ? { fallback } : {}),
    enabled: record.enabled,
    ...(templateId ? { templateId } : {}),
  };
}

export function validateAgentPayload(value: unknown): AgentPayload {
  const payload = requirePlainObject(value);
  assertExactKeys(payload, ['schemaVersion', 'defaultAgentId', 'agents']);
  if (payload.schemaVersion !== AGENT_SCHEMA_VERSION || !Array.isArray(payload.agents)) {
    throw new AgentError('invalid-payload');
  }
  if (payload.agents.length > MAX_AGENTS) throw new AgentError('agent-limit');
  const ids = new Set<string>();
  const names = new Set<string>();
  const agents = payload.agents.map((value) => {
    const record = requirePlainObject(value);
    if (typeof record.id !== 'string' || !AGENT_ID_PATTERN.test(record.id) || ids.has(record.id)) {
      throw new AgentError('invalid-id');
    }
    ids.add(record.id);
    const draft = validateAgentDraft(withoutId(record));
    const normalizedName = normalizeAgentName(draft.name);
    if (names.has(normalizedName)) throw new AgentError('duplicate-name');
    names.add(normalizedName);
    return { id: record.id, ...draft };
  });
  const defaultAgentId = payload.defaultAgentId;
  if (
    defaultAgentId !== null
    && (typeof defaultAgentId !== 'string' || !ids.has(defaultAgentId))
  ) throw new AgentError('invalid-payload');
  if (defaultAgentId !== null && !agents.find(({ id }) => id === defaultAgentId)?.enabled) {
    throw new AgentError('agent-disabled');
  }
  return { schemaVersion: AGENT_SCHEMA_VERSION, defaultAgentId, agents };
}

export function cloneAgent(agent: AgentRecord): AgentRecord {
  return {
    ...agent,
    description: { ...agent.description },
    instructions: { ...agent.instructions },
    speech: { ...agent.speech },
    ...(agent.fallback ? { fallback: { ...agent.fallback } } : {}),
  };
}

export function validateModel(value: unknown): string {
  if (typeof value !== 'string') throw new AgentError('invalid-model');
  const model = value.trim();
  if (!model || model.length > 256 || !/^[A-Za-z0-9~][A-Za-z0-9._~:/@+-]*$/u.test(model)) {
    throw new AgentError('invalid-model');
  }
  return model;
}

function validateFallback(value: unknown, provider: unknown, model: string) {
  const fallback = requirePlainObject(value);
  assertExactKeys(fallback, ['provider', 'model']);
  if (!isProviderId(fallback.provider)) throw new AgentError('invalid-provider');
  const fallbackModel = validateModel(fallback.model);
  if (fallback.provider === provider && fallbackModel === model) {
    throw new AgentError('fallback-loop');
  }
  return { provider: fallback.provider, model: fallbackModel };
}

function validateSpeech(value: unknown) {
  const speech = requirePlainObject(value);
  assertExactKeys(speech, ['enabled', 'voiceUri', 'rate']);
  if (typeof speech.enabled !== 'boolean' || typeof speech.rate !== 'number' || !Number.isFinite(speech.rate)) {
    throw new AgentError('invalid-speech');
  }
  const voiceUri = boundedText(speech.voiceUri, 0, 1_024, 'invalid-speech');
  if (speech.rate < 0.5 || speech.rate > 2) throw new AgentError('invalid-speech');
  return { enabled: speech.enabled, voiceUri, rate: speech.rate };
}

function localizedText(
  value: unknown,
  maximum: number,
  code: 'invalid-description' | 'invalid-instructions',
): LocalizedAgentText {
  const text = requirePlainObject(value);
  assertExactKeys(text, ['en', 'he']);
  return {
    en: boundedText(text.en, 1, maximum, code),
    he: boundedText(text.he, 1, maximum, code),
  };
}

function validateTemplateId(value: unknown): BuiltinAgentTemplateId {
  if (!(BUILTIN_AGENT_TEMPLATE_IDS as readonly unknown[]).includes(value)) {
    throw new AgentError('invalid-payload');
  }
  return value as BuiltinAgentTemplateId;
}

function boundedText(
  value: unknown,
  minimum: number,
  maximum: number,
  code: 'invalid-name' | 'invalid-description' | 'invalid-instructions' | 'invalid-speech',
): string {
  if (typeof value !== 'string') throw new AgentError(code);
  const normalized = value.normalize('NFKC').trim();
  if (
    normalized.length < minimum
    || normalized.length > maximum
    || DANGEROUS_CHARACTER_PATTERN.test(normalized)
  ) throw new AgentError(code);
  return normalized;
}

function requirePlainObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AgentError('invalid-payload');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new AgentError('invalid-payload');
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  optional: readonly string[] = [],
): void {
  const keys = Object.keys(value);
  const allowedSet = new Set(allowed);
  if (
    keys.some((key) => !allowedSet.has(key) || ['__proto__', 'prototype', 'constructor'].includes(key))
    || allowed.some((key) => !optional.includes(key) && !Object.hasOwn(value, key))
  ) throw new AgentError('invalid-payload');
}

function withoutId(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'id'));
}
