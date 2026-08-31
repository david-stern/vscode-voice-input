import {
  PROVIDER_IDS,
  PlannerError,
  type ProviderDescriptor,
  type ProviderId,
} from './contracts';

const REMOTE = Object.freeze({
  kind: 'remote' as const,
  defaultIsLocal: false,
  localOnlyWhenLoopback: false,
});

const ENDPOINT_DEPENDENT = Object.freeze({
  kind: 'endpoint-dependent' as const,
  defaultIsLocal: true,
  localOnlyWhenLoopback: true,
});

function capabilities(
  protocol: ProviderDescriptor['capabilities']['protocol'],
  structuredOutput: ProviderDescriptor['capabilities']['structuredOutput'],
): ProviderDescriptor['capabilities'] {
  return Object.freeze({
    protocol,
    structuredOutput,
    systemInstruction: true,
    streaming: false,
    tools: false,
  });
}

function descriptor(value: ProviderDescriptor): ProviderDescriptor {
  return Object.freeze({
    ...value,
    modelPresets: Object.freeze([...value.modelPresets]),
  });
}

export const PROVIDER_DESCRIPTORS: readonly ProviderDescriptor[] = Object.freeze([
  descriptor({
    id: 'deepseek',
    name: 'DeepSeek',
    defaultEndpoint: 'https://api.deepseek.com/chat/completions',
    authMode: 'bearer',
    modelEditable: true,
    defaultModel: 'deepseek-v4-flash',
    modelPresets: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    capabilities: capabilities('openai-chat', 'json-object'),
    locality: REMOTE,
  }),
  descriptor({
    id: 'anthropic',
    name: 'Anthropic Claude',
    defaultEndpoint: 'https://api.anthropic.com/v1/messages',
    authMode: 'x-api-key',
    modelEditable: true,
    defaultModel: 'claude-sonnet-4-6',
    modelPresets: ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-6'],
    capabilities: capabilities('anthropic-messages', 'prompt-only'),
    locality: REMOTE,
  }),
  descriptor({
    id: 'openai',
    name: 'OpenAI',
    defaultEndpoint: 'https://api.openai.com/v1/responses',
    authMode: 'bearer',
    modelEditable: true,
    defaultModel: 'gpt-5.4',
    modelPresets: ['gpt-5.4', 'gpt-4.1', 'gpt-4.1-mini'],
    capabilities: capabilities('openai-responses', 'json-schema'),
    locality: REMOTE,
  }),
  descriptor({
    id: 'gemini',
    name: 'Google Gemini',
    defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta',
    authMode: 'x-goog-api-key',
    modelEditable: true,
    defaultModel: 'gemini-3.7-flash',
    modelPresets: ['gemini-3.7-flash', 'gemini-2.5-pro', 'gemini-2.5-flash'],
    capabilities: capabilities('gemini-generate-content', 'json-schema'),
    locality: REMOTE,
  }),
  descriptor({
    id: 'openrouter',
    name: 'OpenRouter',
    defaultEndpoint: 'https://openrouter.ai/api/v1/chat/completions',
    authMode: 'bearer',
    modelEditable: true,
    defaultModel: '~openai/gpt-latest',
    modelPresets: [
      '~openai/gpt-latest',
      'anthropic/claude-sonnet-4.6',
      'google/gemini-2.5-flash',
    ],
    capabilities: capabilities('openai-chat', 'json-object'),
    locality: REMOTE,
  }),
  descriptor({
    id: 'ollama',
    name: 'Ollama',
    defaultEndpoint: 'http://127.0.0.1:11434/api/chat',
    authMode: 'optional-bearer',
    modelEditable: true,
    defaultModel: 'gpt-oss',
    modelPresets: ['gpt-oss', 'qwen3', 'gemma3'],
    capabilities: capabilities('ollama-chat', 'json-schema'),
    locality: ENDPOINT_DEPENDENT,
  }),
  descriptor({
    id: 'bedrock',
    name: 'Amazon Bedrock',
    defaultEndpoint: 'https://bedrock-runtime.us-east-1.amazonaws.com',
    authMode: 'bearer',
    modelEditable: true,
    defaultModel: 'us.anthropic.claude-sonnet-4-6',
    modelPresets: [
      'us.anthropic.claude-sonnet-4-6',
      'amazon.nova-pro-v1:0',
      'meta.llama3-70b-instruct-v1:0',
    ],
    capabilities: capabilities('bedrock-converse', 'json-schema'),
    locality: REMOTE,
  }),
  descriptor({
    id: 'grok',
    name: 'xAI Grok',
    defaultEndpoint: 'https://api.x.ai/v1/chat/completions',
    authMode: 'bearer',
    modelEditable: true,
    defaultModel: 'grok-4.6',
    modelPresets: ['grok-4.6', 'grok-4'],
    capabilities: capabilities('openai-chat', 'json-object'),
    locality: REMOTE,
  }),
]);

const DESCRIPTORS_BY_ID = new Map(
  PROVIDER_DESCRIPTORS.map((value) => [value.id, value] as const),
);

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && (PROVIDER_IDS as readonly string[]).includes(value);
}

export function getProviderDescriptor(id: ProviderId): ProviderDescriptor {
  const result = DESCRIPTORS_BY_ID.get(id);
  if (!result) throw new PlannerError('invalid-input');
  return result;
}
