import {
  PROVIDER_IDS,
  getProviderDescriptor,
  type ProviderId,
} from '../inference';

export type AssistantProviderSelection = 'off' | ProviderId;

export interface ProviderProfile {
  endpoint: string;
  model: string;
  enabled: boolean;
}

export type ProviderProfiles = Readonly<Record<ProviderId, Readonly<ProviderProfile>>>;

export const MAX_PROVIDER_ENDPOINT_LENGTH = 2_048;
export const MAX_PROVIDER_MODEL_LENGTH = 256;

export const DEFAULT_PROVIDER_PROFILES: ProviderProfiles = Object.freeze(
  Object.fromEntries(PROVIDER_IDS.map((provider) => {
    const descriptor = getProviderDescriptor(provider);
    return [provider, Object.freeze({
      endpoint: descriptor.defaultEndpoint,
      model: descriptor.defaultModel,
      enabled: true,
    })];
  })) as Record<ProviderId, Readonly<ProviderProfile>>,
);

export function normalizeAssistantProvider(value: unknown): AssistantProviderSelection {
  return value === 'off' || (PROVIDER_IDS as readonly unknown[]).includes(value)
    ? value as AssistantProviderSelection
    : 'deepseek';
}

export function normalizeProviderProfiles(value: unknown): ProviderProfiles {
  const input = isPlainObject(value) ? value : {};
  return Object.freeze(Object.fromEntries(PROVIDER_IDS.map((provider) => {
    const fallback = DEFAULT_PROVIDER_PROFILES[provider];
    const candidate = isPlainObject(input[provider]) ? input[provider] : {};
    return [provider, Object.freeze({
      endpoint: normalizeProviderEndpoint(provider, candidate.endpoint, fallback.endpoint),
      model: normalizeProviderModel(candidate.model, fallback.model),
      enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : fallback.enabled,
    })];
  })) as Record<ProviderId, Readonly<ProviderProfile>>);
}

export function normalizeProviderModel(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const model = value.trim();
  if (
    !model
    || model.length > MAX_PROVIDER_MODEL_LENGTH
    || !/^[A-Za-z0-9~][A-Za-z0-9._~:/@+-]*$/u.test(model)
  ) return fallback;
  return model;
}

export function normalizeProviderEndpoint(
  provider: ProviderId,
  value: unknown,
  fallback = getProviderDescriptor(provider).defaultEndpoint,
): string {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_PROVIDER_ENDPOINT_LENGTH) {
    return fallback;
  }
  try {
    const endpoint = new URL(value.trim());
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return fallback;
    if (endpoint.protocol === 'https:' && providerEndpointHostnameAllowed(provider, endpoint.hostname)) {
      return endpoint.toString();
    }
    if (provider === 'ollama' && endpoint.protocol === 'http:' && isLoopbackHostname(endpoint.hostname)) {
      return endpoint.toString();
    }
  } catch {
    // Invalid user settings fall back to the documented provider endpoint.
  }
  return fallback;
}

/** Prevents a workspace or copied profile from redirecting a vendor credential. */
export function providerEndpointHostnameAllowed(provider: ProviderId, hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  switch (provider) {
    case 'deepseek': return normalized === 'api.deepseek.com';
    case 'anthropic': return normalized === 'api.anthropic.com';
    case 'openai': return normalized === 'api.openai.com';
    case 'gemini': return normalized === 'generativelanguage.googleapis.com';
    case 'openrouter': return normalized === 'openrouter.ai';
    case 'bedrock': return /^bedrock-runtime\.[a-z0-9-]+\.amazonaws\.com(?:\.cn)?$/u.test(normalized);
    case 'grok': return normalized === 'api.x.ai';
    case 'ollama': return true;
  }
}

export function isLoopbackEndpoint(value: string): boolean {
  try {
    const endpoint = new URL(value);
    return (endpoint.protocol === 'http:' || endpoint.protocol === 'https:')
      && isLoopbackHostname(endpoint.hostname);
  } catch {
    return false;
  }
}

export function providerConsentRequired(provider: ProviderId, endpoint: string): boolean {
  return provider !== 'ollama' || !isLoopbackEndpoint(endpoint);
}

export function cloneProviderProfiles(profiles: ProviderProfiles): ProviderProfiles {
  return Object.freeze(Object.fromEntries(PROVIDER_IDS.map((provider) => [
    provider,
    Object.freeze({ ...profiles[provider] }),
  ])) as Record<ProviderId, Readonly<ProviderProfile>>);
}

function isLoopbackHostname(value: string): boolean {
  const hostname = value.toLowerCase().replace(/^\[|\]$/gu, '');
  if (hostname === 'localhost' || hostname === '::1') return true;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(hostname);
  if (!match) return false;
  return match.slice(1).every((part) => Number(part) <= 255) && Number(match[1]) === 127;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
