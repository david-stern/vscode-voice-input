import type { PersonaId } from '../assistant/personas';
import type { ProviderId } from '../inference';

export const AGENT_STORAGE_KEY = 'voiceInput.agents.v1';
export const AGENT_SCHEMA_VERSION = 1 as const;
export const MAX_AGENTS = 32;
export const MAX_AGENT_NAME_LENGTH = 80;
export const MAX_AGENT_DESCRIPTION_LENGTH = 400;
export const MAX_AGENT_INSTRUCTIONS_LENGTH = 4_000;
export const AGENT_ID_PATTERN = /^agent_[A-Za-z0-9_-]{12,80}$/u;

export const BUILTIN_AGENT_TEMPLATE_IDS = Object.freeze([
  'teacher-lecturer',
  'secretary',
  'friend',
  'tour-guide',
  'mathematician',
  'philosopher',
] as const);
export type BuiltinAgentTemplateId = (typeof BUILTIN_AGENT_TEMPLATE_IDS)[number];

export interface LocalizedAgentText {
  en: string;
  he: string;
}

export interface AgentSpeechPreferences {
  enabled: boolean;
  voiceUri: string;
  rate: number;
}

export interface AgentFallback {
  provider: ProviderId;
  model: string;
}

export interface AgentRecord {
  id: string;
  name: string;
  description: LocalizedAgentText;
  provider: ProviderId;
  model: string;
  persona: PersonaId;
  instructions: LocalizedAgentText;
  speech: AgentSpeechPreferences;
  fallback?: AgentFallback;
  enabled: boolean;
  templateId?: BuiltinAgentTemplateId;
}

export type AgentDraft = Omit<AgentRecord, 'id' | 'templateId'> & {
  templateId?: BuiltinAgentTemplateId;
};

export interface AgentPayload {
  schemaVersion: typeof AGENT_SCHEMA_VERSION;
  defaultAgentId: string | null;
  agents: AgentRecord[];
}

export interface AgentStorage {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

export type AgentErrorCode =
  | 'invalid-payload'
  | 'invalid-id'
  | 'invalid-name'
  | 'duplicate-name'
  | 'invalid-description'
  | 'invalid-provider'
  | 'invalid-model'
  | 'invalid-persona'
  | 'invalid-instructions'
  | 'secret-like-content'
  | 'invalid-speech'
  | 'fallback-loop'
  | 'agent-limit'
  | 'agent-not-found'
  | 'agent-disabled'
  | 'storage-failed';

export class AgentError extends Error {
  constructor(readonly code: AgentErrorCode, cause?: unknown) {
    super(`Agent registry rejected the operation: ${code}`, cause === undefined ? undefined : { cause });
    this.name = 'AgentError';
  }
}

export interface AgentLoadResult {
  agents: readonly AgentRecord[];
  defaultAgentId: string | undefined;
  migrated: boolean;
  corrupted: boolean;
  error?: AgentError;
}

export interface LegacyAgentSettings {
  assistantPersona?: unknown;
  assistantIntelligence?: unknown;
  assistantProvider?: unknown;
  deepSeekModel?: unknown;
  providerProfiles?: unknown;
}
