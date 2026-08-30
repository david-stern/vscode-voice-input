import {
  getAssistantPersona,
  normalizePersonaId,
  type PersonaId,
  type PersonaLocale,
} from './personas';

const DEEPSEEK_CHAT_COMPLETIONS_URL = 'https://api.deepseek.com/chat/completions';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 128 * 1024;

export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash';

export const SMART_ASSISTANT_ACTIONS = [
  'write-here',
  'write-editor',
  'write-terminal',
  'write-chat',
  'repeat-last',
  'open-chat',
  'open-terminal',
  'open-settings',
  'request-send',
  'confirm-send',
  'stop-listening',
  'answer-only',
] as const;

export type SmartAssistantAction = (typeof SMART_ASSISTANT_ACTIONS)[number];

/** A remote model can request a send, but can never confirm one. */
export const DEEPSEEK_MODEL_ACTIONS = SMART_ASSISTANT_ACTIONS.filter(
  (action) => action !== 'confirm-send',
) as Exclude<SmartAssistantAction, 'confirm-send'>[];

export const SMART_ASSISTANT_TARGETS = ['current', 'editor', 'terminal', 'chat', 'none'] as const;
export type SmartAssistantTarget = (typeof SMART_ASSISTANT_TARGETS)[number];
export type TargetKind = 'focused-control' | 'editor' | 'terminal' | 'chat' | 'unknown';

export interface MinimalTargetMetadata {
  kind: TargetKind;
  vscodeFocused: boolean;
}

export interface DeepSeekPlan {
  action: SmartAssistantAction;
  target: SmartAssistantTarget;
  content: string | null;
  spokenReply: string;
  reason: string;
  confidence: number;
  requiresConfirmation: boolean;
}

export interface DeepSeekPlanningInput {
  postWakeRequest: string;
  persona: PersonaId;
  locale: PersonaLocale;
  target: MinimalTargetMetadata;
}

export type DeepSeekLogEvent =
  | 'request-started'
  | 'request-succeeded'
  | 'request-aborted'
  | 'request-timed-out'
  | 'request-failed';

export interface DeepSeekClientOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  logger?: (event: DeepSeekLogEvent) => void;
}

export type DeepSeekErrorCode =
  | 'invalid-input'
  | 'invalid-response'
  | 'http-error'
  | 'network-error'
  | 'aborted'
  | 'timed-out';

export class DeepSeekClientError extends Error {
  constructor(readonly code: DeepSeekErrorCode) {
    super(`DeepSeek planning failed: ${code}`);
    this.name = 'DeepSeekClientError';
  }
}

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

const BASE_SYSTEM_POLICY = `You produce exactly one JSON object for a local VS Code assistant. Use only these actions: ${DEEPSEEK_MODEL_ACTIONS.join(', ')}. Use only these targets: ${SMART_ASSISTANT_TARGETS.join(', ')}. The exact keys are action, target, content, spokenReply, reason, confidence, requiresConfirmation. Do not include extra keys. content is text to insert for write actions and request-send, and is otherwise null. write-terminal must never include a newline or control character. request-send targets chat, prepares content, and only requests a separate local confirmation; requiresConfirmation must be true. No other action may set it true. Never provide commands, key names, selectors, coordinates, or an automatic submit instruction. If context is insufficient, choose answer-only, target none, and explain the uncertainty. spokenReply and reason must describe the proposed action, not claim it already succeeded.`;

export function buildDeepSeekPlanningMessages(input: DeepSeekPlanningInput): readonly ChatMessage[] {
  const personaId = normalizePersonaId(input.persona);
  const persona = getAssistantPersona(personaId);
  const locale: PersonaLocale = input.locale === 'he' ? 'he' : 'en';
  const target = sanitizeTargetMetadata(input.target);
  const request = sanitizeRequest(input.postWakeRequest);

  return [
    {
      role: 'system',
      content: `${BASE_SYSTEM_POLICY} Persona policy: ${persona.systemPrompt}`,
    },
    {
      role: 'user',
      content: JSON.stringify({ request, persona: personaId, locale, target }),
    },
  ];
}

export async function planWithDeepSeek(
  input: DeepSeekPlanningInput,
  options: DeepSeekClientOptions,
): Promise<DeepSeekPlan> {
  if (!options.apiKey.trim()) throw new DeepSeekClientError('invalid-input');
  const messages = buildDeepSeekPlanningMessages(input);
  const model = sanitizeModel(options.model);
  const timeoutMs = sanitizeTimeout(options.timeoutMs);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const requestControl = createRequestControl(options.signal, timeoutMs);

  options.logger?.('request-started');
  try {
    if (requestControl.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const response = await withAbort(
      fetchImpl(DEEPSEEK_CHAT_COMPLETIONS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          response_format: { type: 'json_object' },
          temperature: 0.2,
          max_tokens: 700,
          stream: false,
        }),
        signal: requestControl.signal,
      }),
      requestControl.signal,
    );

    if (!response.ok) throw new DeepSeekClientError('http-error');
    const responseText = await withAbort(response.text(), requestControl.signal);
    if (Buffer.byteLength(responseText, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new DeepSeekClientError('invalid-response');
    }
    const envelope = parseJson(responseText);
    const content = readResponseContent(envelope);
    const plan = parseDeepSeekPlan(content);
    options.logger?.('request-succeeded');
    return plan;
  } catch (error) {
    const normalized = normalizeClientError(error, requestControl.timedOut(), options.signal);
    options.logger?.(eventForError(normalized.code));
    throw normalized;
  } finally {
    requestControl.dispose();
  }
}

export function parseDeepSeekPlan(content: string): DeepSeekPlan {
  if (Buffer.byteLength(content, 'utf8') > MAX_RESPONSE_BYTES) {
    throw new DeepSeekClientError('invalid-response');
  }
  const value = parseJson(content);
  if (!isRecord(value)) throw new DeepSeekClientError('invalid-response');

  const allowedKeys = [
    'action',
    'target',
    'content',
    'spokenReply',
    'reason',
    'confidence',
    'requiresConfirmation',
  ];
  if (
    Object.keys(value).length !== allowedKeys.length ||
    !Object.keys(value).every((key) => allowedKeys.includes(key))
  ) {
    throw new DeepSeekClientError('invalid-response');
  }

  const action = readEnum(value.action, DEEPSEEK_MODEL_ACTIONS);
  const target = readEnum(value.target, SMART_ASSISTANT_TARGETS);
  const plan: DeepSeekPlan = {
    action,
    target,
    content: readNullableContent(value.content, 4_000),
    spokenReply: readBoundedString(value.spokenReply, 1_000),
    reason: readBoundedString(value.reason, 800),
    confidence: readConfidence(value.confidence),
    requiresConfirmation: readBoolean(value.requiresConfirmation),
  };
  validatePlanPolicy(plan);
  return plan;
}

function sanitizeRequest(value: unknown): string {
  if (typeof value !== 'string') throw new DeepSeekClientError('invalid-input');
  const request = value.trim();
  if (!request || request.length > 4_000) throw new DeepSeekClientError('invalid-input');
  return request;
}

function sanitizeTargetMetadata(value: unknown): MinimalTargetMetadata {
  if (!isRecord(value)) return { kind: 'unknown', vscodeFocused: false };
  const kinds: readonly TargetKind[] = ['focused-control', 'editor', 'terminal', 'chat', 'unknown'];
  return {
    kind: kinds.includes(value.kind as TargetKind) ? (value.kind as TargetKind) : 'unknown',
    vscodeFocused: value.vscodeFocused === true,
  };
}

function sanitizeModel(value: string | undefined): string {
  if (value === undefined || value.trim() === '') return DEFAULT_DEEPSEEK_MODEL;
  const model = value.trim();
  if (model.length > 100 || !/^[A-Za-z0-9._:/-]+$/u.test(model)) {
    throw new DeepSeekClientError('invalid-input');
  }
  return model;
}

function sanitizeTimeout(value: number | undefined): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(value) || value < 1 || value > 60_000) {
    throw new DeepSeekClientError('invalid-input');
  }
  return Math.floor(value);
}

function readResponseContent(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.choices) || value.choices.length !== 1) {
    throw new DeepSeekClientError('invalid-response');
  }
  const choice = value.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message) || typeof choice.message.content !== 'string') {
    throw new DeepSeekClientError('invalid-response');
  }
  return choice.message.content;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new DeepSeekClientError('invalid-response');
  }
}

function readEnum<const T extends readonly string[]>(value: unknown, allowed: T): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new DeepSeekClientError('invalid-response');
  }
  return value as T[number];
}

function readBoundedString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') throw new DeepSeekClientError('invalid-response');
  const result = value.trim();
  if (!result || result.length > maxLength) throw new DeepSeekClientError('invalid-response');
  return result;
}

function readNullableContent(value: unknown, maxLength: number): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new DeepSeekClientError('invalid-response');
  }
  return value;
}

function readConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new DeepSeekClientError('invalid-response');
  }
  return value;
}

function readBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new DeepSeekClientError('invalid-response');
  return value;
}

function validatePlanPolicy(plan: DeepSeekPlan): void {
  const writeTargets: Partial<Record<SmartAssistantAction, SmartAssistantTarget>> = {
    'write-here': 'current',
    'write-editor': 'editor',
    'write-terminal': 'terminal',
    'write-chat': 'chat',
  };
  const expectedWriteTarget = writeTargets[plan.action];
  if (expectedWriteTarget) {
    if (plan.target !== expectedWriteTarget || plan.content === null) invalidPlan();
  } else if (plan.action === 'request-send') {
    if (plan.target !== 'chat' || plan.content === null || !plan.requiresConfirmation) invalidPlan();
  } else if (plan.content !== null) {
    invalidPlan();
  }

  if (plan.action === 'write-terminal' && /[\r\n\u2028\u2029\p{Cc}]/u.test(plan.content ?? '')) invalidPlan();
  if (plan.action !== 'request-send' && plan.requiresConfirmation) {
    invalidPlan();
  }

  const fixedTargets: Partial<Record<SmartAssistantAction, SmartAssistantTarget>> = {
    'open-chat': 'chat',
    'open-terminal': 'terminal',
    'open-settings': 'none',
    'stop-listening': 'none',
    'answer-only': 'none',
    'repeat-last': 'current',
    'confirm-send': 'current',
  };
  const expectedTarget = fixedTargets[plan.action];
  if (expectedTarget && plan.target !== expectedTarget) invalidPlan();
}

function invalidPlan(): never {
  throw new DeepSeekClientError('invalid-response');
}

function normalizeClientError(
  error: unknown,
  timedOut: boolean,
  externalSignal: AbortSignal | undefined,
): DeepSeekClientError {
  if (timedOut) return new DeepSeekClientError('timed-out');
  if (externalSignal?.aborted) return new DeepSeekClientError('aborted');
  if (error instanceof DeepSeekClientError) return error;
  return new DeepSeekClientError('network-error');
}

function eventForError(code: DeepSeekErrorCode): DeepSeekLogEvent {
  if (code === 'aborted') return 'request-aborted';
  if (code === 'timed-out') return 'request-timed-out';
  return 'request-failed';
}

function createRequestControl(externalSignal: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  timedOut: () => boolean;
  dispose: () => void;
} {
  const controller = new AbortController();
  let timeoutReached = false;
  const abortFromExternal = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
  const timer = setTimeout(() => {
    timeoutReached = true;
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timeoutReached,
    dispose: () => {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', abortFromExternal);
    },
  };
}

function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
