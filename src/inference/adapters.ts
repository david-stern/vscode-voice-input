import {
  PlannerError,
  type PlannerClient,
  type PlannerInput,
  type ProviderId,
} from './contracts';
import { getProviderDescriptor, isProviderId } from './descriptors';
import {
  ASSISTANT_PLAN_JSON_SCHEMA,
  buildPlannerMessages,
  isRecord,
} from './planPolicy';
import {
  executePlannerRequest,
  joinEndpoint,
  validateCredential,
  validateEndpoint,
  validateModel,
  type PlannerRuntimeOptions,
} from './transport';

const OPENAI_CHAT_PROVIDERS = ['deepseek', 'openrouter', 'grok'] as const;

export interface CreatePlannerClientOptions extends PlannerRuntimeOptions {
  provider: ProviderId;
}

export class OpenAICompatibleChatPlannerClient implements PlannerClient {
  constructor(
    readonly provider: (typeof OPENAI_CHAT_PROVIDERS)[number],
    private readonly options: PlannerRuntimeOptions = {},
  ) {
    if (!(OPENAI_CHAT_PROVIDERS as readonly string[]).includes(provider)) unsupported();
  }

  async plan(input: PlannerInput, signal?: AbortSignal) {
    const descriptor = getProviderDescriptor(this.provider);
    const model = validateModel(this.options.model, descriptor.defaultModel);
    const endpoint = validateEndpoint(this.options.endpoint ?? descriptor.defaultEndpoint);
    const credential = validateCredential(this.options.apiKey, true) as string;
    const messages = buildPlannerMessages(input);
    return executePlannerRequest({
      url: endpoint,
      headers: Object.freeze({
        Authorization: `Bearer ${credential}`,
        'Content-Type': 'application/json',
      }),
      body: {
        model,
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 700,
        stream: false,
      },
    }, extractOpenAIChatContent, this.options, signal);
  }
}

export class OpenAIResponsesPlannerClient implements PlannerClient {
  readonly provider = 'openai' as const;

  constructor(private readonly options: PlannerRuntimeOptions = {}) {}

  async plan(input: PlannerInput, signal?: AbortSignal) {
    const descriptor = getProviderDescriptor(this.provider);
    const model = validateModel(this.options.model, descriptor.defaultModel);
    const endpoint = validateEndpoint(this.options.endpoint ?? descriptor.defaultEndpoint);
    const credential = validateCredential(this.options.apiKey, true) as string;
    const [system, user] = buildPlannerMessages(input);
    return executePlannerRequest({
      url: endpoint,
      headers: Object.freeze({
        Authorization: `Bearer ${credential}`,
        'Content-Type': 'application/json',
      }),
      body: {
        model,
        instructions: system.content,
        input: user.content,
        text: {
          format: {
            type: 'json_schema',
            name: 'assistant_plan',
            description: 'A bounded proposal for the local Voice Input assistant.',
            schema: ASSISTANT_PLAN_JSON_SCHEMA,
            strict: true,
          },
        },
        tools: [],
        parallel_tool_calls: false,
        max_output_tokens: 700,
        store: false,
        stream: false,
      },
    }, extractOpenAIResponsesContent, this.options, signal);
  }
}

export class AnthropicMessagesPlannerClient implements PlannerClient {
  readonly provider = 'anthropic' as const;

  constructor(private readonly options: PlannerRuntimeOptions = {}) {}

  async plan(input: PlannerInput, signal?: AbortSignal) {
    const descriptor = getProviderDescriptor(this.provider);
    const model = validateModel(this.options.model, descriptor.defaultModel);
    const endpoint = validateEndpoint(this.options.endpoint ?? descriptor.defaultEndpoint);
    const credential = validateCredential(this.options.apiKey, true) as string;
    const [system, user] = buildPlannerMessages(input);
    return executePlannerRequest({
      url: endpoint,
      headers: Object.freeze({
        'x-api-key': credential,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      }),
      body: {
        model,
        system: system.content,
        messages: [{ role: 'user', content: user.content }],
        max_tokens: 700,
        stream: false,
      },
    }, extractAnthropicContent, this.options, signal);
  }
}

export class GeminiGenerateContentPlannerClient implements PlannerClient {
  readonly provider = 'gemini' as const;

  constructor(private readonly options: PlannerRuntimeOptions = {}) {}

  async plan(input: PlannerInput, signal?: AbortSignal) {
    const descriptor = getProviderDescriptor(this.provider);
    const model = validateModel(this.options.model, descriptor.defaultModel);
    const endpoint = validateEndpoint(this.options.endpoint ?? descriptor.defaultEndpoint);
    const credential = validateCredential(this.options.apiKey, true) as string;
    const [system, user] = buildPlannerMessages(input);
    return executePlannerRequest({
      url: joinEndpoint(endpoint, `models/${encodeURIComponent(model)}:generateContent`),
      headers: Object.freeze({
        'x-goog-api-key': credential,
        'Content-Type': 'application/json',
      }),
      body: {
        systemInstruction: { parts: [{ text: system.content }] },
        contents: [{ role: 'user', parts: [{ text: user.content }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: ASSISTANT_PLAN_JSON_SCHEMA,
          candidateCount: 1,
          maxOutputTokens: 700,
          temperature: 0.2,
        },
      },
    }, extractGeminiContent, this.options, signal);
  }
}

export class OllamaChatPlannerClient implements PlannerClient {
  readonly provider = 'ollama' as const;

  constructor(private readonly options: PlannerRuntimeOptions = {}) {}

  async plan(input: PlannerInput, signal?: AbortSignal) {
    const descriptor = getProviderDescriptor(this.provider);
    const model = validateModel(this.options.model, descriptor.defaultModel);
    const endpoint = validateEndpoint(
      this.options.endpoint ?? descriptor.defaultEndpoint,
      true,
    );
    const credential = validateCredential(this.options.apiKey, false);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (credential) headers.Authorization = `Bearer ${credential}`;
    return executePlannerRequest({
      url: endpoint,
      headers: Object.freeze(headers),
      body: {
        model,
        messages: buildPlannerMessages(input),
        format: ASSISTANT_PLAN_JSON_SCHEMA,
        stream: false,
        think: false,
      },
    }, extractOllamaContent, this.options, signal);
  }
}

export class BedrockConversePlannerClient implements PlannerClient {
  readonly provider = 'bedrock' as const;

  constructor(private readonly options: PlannerRuntimeOptions = {}) {}

  async plan(input: PlannerInput, signal?: AbortSignal) {
    const descriptor = getProviderDescriptor(this.provider);
    const model = validateModel(this.options.model, descriptor.defaultModel, 2_048);
    const endpoint = validateEndpoint(this.options.endpoint ?? descriptor.defaultEndpoint);
    const credential = validateCredential(this.options.apiKey, true) as string;
    const [system, user] = buildPlannerMessages(input);
    return executePlannerRequest({
      url: joinEndpoint(endpoint, `model/${encodeURIComponent(model)}/converse`),
      headers: Object.freeze({
        Authorization: `Bearer ${credential}`,
        'Content-Type': 'application/json',
      }),
      body: {
        system: [{ text: system.content }],
        messages: [{ role: 'user', content: [{ text: user.content }] }],
        inferenceConfig: { maxTokens: 700, temperature: 0.2 },
        outputConfig: {
          textFormat: {
            type: 'json_schema',
            structure: {
              jsonSchema: {
                schema: JSON.stringify(ASSISTANT_PLAN_JSON_SCHEMA),
                name: 'assistant_plan',
                description: 'A bounded proposal for the local Voice Input assistant.',
              },
            },
          },
        },
      },
    }, extractBedrockContent, this.options, signal);
  }
}

export function createPlannerClient(options: CreatePlannerClientOptions): PlannerClient {
  if (!isProviderId(options.provider)) throw new PlannerError('invalid-input');
  switch (options.provider) {
    case 'deepseek':
    case 'openrouter':
    case 'grok':
      return new OpenAICompatibleChatPlannerClient(options.provider, options);
    case 'openai':
      return new OpenAIResponsesPlannerClient(options);
    case 'anthropic':
      return new AnthropicMessagesPlannerClient(options);
    case 'gemini':
      return new GeminiGenerateContentPlannerClient(options);
    case 'ollama':
      return new OllamaChatPlannerClient(options);
    case 'bedrock':
      return new BedrockConversePlannerClient(options);
  }
}

function extractOpenAIChatContent(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.choices) || value.choices.length !== 1) {
    invalidResponse();
  }
  const choice = value.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) invalidResponse();
  if (choice.finish_reason !== undefined && choice.finish_reason !== 'stop') invalidResponse();
  if (
    choice.message.role !== undefined && choice.message.role !== 'assistant'
    || choice.message.tool_calls !== undefined
    || choice.message.function_call !== undefined
    || choice.message.refusal !== undefined && choice.message.refusal !== null
    || typeof choice.message.content !== 'string'
  ) {
    invalidResponse();
  }
  return choice.message.content;
}

function extractOpenAIResponsesContent(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.output)) invalidResponse();
  if (value.status !== undefined && value.status !== 'completed') invalidResponse();
  if (value.error !== undefined && value.error !== null) invalidResponse();
  if (value.incomplete_details !== undefined && value.incomplete_details !== null) {
    invalidResponse();
  }
  const messages = value.output.filter((item) => isRecord(item) && item.type === 'message');
  if (
    messages.length !== 1
    || value.output.some((item) => !isRecord(item) || !['message', 'reasoning'].includes(String(item.type)))
  ) {
    invalidResponse();
  }
  const message = messages[0];
  if (message.role !== undefined && message.role !== 'assistant') invalidResponse();
  if (!Array.isArray(message.content) || message.content.length !== 1) invalidResponse();
  const part = message.content[0];
  if (!isRecord(part) || part.type !== 'output_text' || typeof part.text !== 'string') {
    invalidResponse();
  }
  return part.text;
}

function extractAnthropicContent(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.content) || value.content.length !== 1) {
    invalidResponse();
  }
  if (value.role !== undefined && value.role !== 'assistant') invalidResponse();
  if (value.stop_details !== undefined && value.stop_details !== null) invalidResponse();
  if (
    value.stop_reason !== undefined
    && !['end_turn', 'stop_sequence'].includes(String(value.stop_reason))
  ) {
    invalidResponse();
  }
  const part = value.content[0];
  if (!isRecord(part) || part.type !== 'text' || typeof part.text !== 'string') {
    invalidResponse();
  }
  return part.text;
}

function extractGeminiContent(value: unknown): string {
  if (!isRecord(value)) invalidResponse();
  if (
    isRecord(value.promptFeedback)
    && value.promptFeedback.blockReason !== undefined
  ) {
    invalidResponse();
  }
  if (!Array.isArray(value.candidates) || value.candidates.length !== 1) invalidResponse();
  const candidate = value.candidates[0];
  if (!isRecord(candidate) || !isRecord(candidate.content)) invalidResponse();
  if (candidate.finishReason !== undefined && candidate.finishReason !== 'STOP') invalidResponse();
  if (candidate.content.role !== undefined && candidate.content.role !== 'model') invalidResponse();
  if (!Array.isArray(candidate.content.parts) || candidate.content.parts.length !== 1) {
    invalidResponse();
  }
  const part = candidate.content.parts[0];
  if (!isRecord(part) || typeof part.text !== 'string' || Object.keys(part).length !== 1) {
    invalidResponse();
  }
  return part.text;
}

function extractOllamaContent(value: unknown): string {
  if (!isRecord(value) || !isRecord(value.message)) invalidResponse();
  if (value.done !== undefined && value.done !== true) invalidResponse();
  if (value.done_reason !== undefined && value.done_reason !== 'stop') invalidResponse();
  if (value.message.role !== undefined && value.message.role !== 'assistant') invalidResponse();
  if (
    value.message.tool_calls !== undefined
    || typeof value.message.content !== 'string'
  ) {
    invalidResponse();
  }
  return value.message.content;
}

function extractBedrockContent(value: unknown): string {
  if (!isRecord(value) || !isRecord(value.output) || !isRecord(value.output.message)) {
    invalidResponse();
  }
  if (Object.keys(value.output).length !== 1) invalidResponse();
  if (
    value.stopReason !== undefined
    && !['end_turn', 'stop_sequence'].includes(String(value.stopReason))
  ) {
    invalidResponse();
  }
  const message = value.output.message;
  if (message.role !== undefined && message.role !== 'assistant') invalidResponse();
  if (!Array.isArray(message.content) || message.content.length !== 1) invalidResponse();
  const part = message.content[0];
  if (!isRecord(part) || typeof part.text !== 'string' || Object.keys(part).length !== 1) {
    invalidResponse();
  }
  return part.text;
}

function unsupported(): never {
  throw new PlannerError('unsupported-capability');
}

function invalidResponse(): never {
  throw new PlannerError('invalid-response');
}
