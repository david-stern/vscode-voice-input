import type { PersonaId, PersonaLocale } from '../assistant/personas';
import type { SafeAssistantAction } from '../assistant/policy';

export const PROVIDER_IDS = Object.freeze([
  'deepseek',
  'anthropic',
  'openai',
  'gemini',
  'openrouter',
  'ollama',
  'bedrock',
  'grok',
] as const);

export type ProviderId = (typeof PROVIDER_IDS)[number];
export type PlannerAction = SafeAssistantAction;
export type RemotePlannerAction = Exclude<PlannerAction, 'confirm-send'>;

export const PLANNER_TARGETS = Object.freeze([
  'current',
  'editor',
  'terminal',
  'chat',
  'none',
] as const);
export type PlannerTarget = (typeof PLANNER_TARGETS)[number];
export type PlannerTargetKind =
  | 'focused-control'
  | 'editor'
  | 'terminal'
  | 'chat'
  | 'unknown';

export interface MinimalTargetMetadata {
  kind: PlannerTargetKind;
  vscodeFocused: boolean;
}

export interface PlannerInput {
  postWakeRequest: string;
  persona: PersonaId;
  /** Bounded user-authored persona guidance; never carries host authority. */
  agentInstructions?: string;
  locale: PersonaLocale;
  target: MinimalTargetMetadata;
}

export interface AssistantPlan {
  action: PlannerAction;
  target: PlannerTarget;
  content: string | null;
  spokenReply: string;
  reason: string;
  confidence: number;
  requiresConfirmation: boolean;
}

export interface PlannerClient {
  readonly provider: ProviderId;
  plan(input: PlannerInput, signal?: AbortSignal): Promise<AssistantPlan>;
}

export type PlannerErrorCode =
  | 'invalid-input'
  | 'unsupported-capability'
  | 'invalid-response'
  | 'http-error'
  | 'network-error'
  | 'aborted'
  | 'timed-out';

/** Fixed-message boundary error: request data, credentials, and provider bodies never escape. */
export class PlannerError extends Error {
  constructor(readonly code: PlannerErrorCode) {
    super(`Assistant planning failed: ${code}`);
    this.name = 'PlannerError';
  }
}

export type PlannerLogEvent =
  | 'request-started'
  | 'request-succeeded'
  | 'request-aborted'
  | 'request-timed-out'
  | 'request-failed';

export type ProviderProtocol =
  | 'openai-chat'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'gemini-generate-content'
  | 'ollama-chat'
  | 'bedrock-converse';

export type ProviderAuthMode =
  | 'bearer'
  | 'x-api-key'
  | 'x-goog-api-key'
  | 'optional-bearer';

export type StructuredOutputMode = 'json-schema' | 'json-object' | 'prompt-only';

export interface ProviderCapabilities {
  protocol: ProviderProtocol;
  structuredOutput: StructuredOutputMode;
  systemInstruction: true;
  streaming: false;
  tools: false;
}

export interface ProviderLocality {
  kind: 'remote' | 'endpoint-dependent';
  defaultIsLocal: boolean;
  localOnlyWhenLoopback: boolean;
}

export interface ProviderDescriptor {
  id: ProviderId;
  name: string;
  defaultEndpoint: string;
  authMode: ProviderAuthMode;
  modelEditable: true;
  defaultModel: string;
  modelPresets: readonly string[];
  capabilities: Readonly<ProviderCapabilities>;
  locality: Readonly<ProviderLocality>;
}
