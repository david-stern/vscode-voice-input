import {
  PROVIDER_IDS,
  getProviderDescriptor,
  type ProviderId,
} from '../inference';
import type { ProviderProfile } from '../config';
import type { ConnectionProbe } from './connection';
import {
  HttpConnectionProbe,
  type HttpConnectionProbeOptions,
  type ProviderFetch,
} from './httpProbe';

export interface PlannerConnectionProbeOptions {
  fetch?: ProviderFetch;
  timeoutMs?: number;
}

/** Provider-native list-model probes carry no transcript or planner request body. */
export function createPlannerConnectionProbe(
  provider: ProviderId,
  options: PlannerConnectionProbeOptions = {},
): ConnectionProbe {
  return {
    probe: (credential, signal, profile) => {
      const effective = profile ?? defaultProfile(provider);
      const request = probeRequest(provider, effective.endpoint, credential);
      return new HttpConnectionProbe({
        endpoint: request.endpoint,
        headers: () => request.headers,
        credentialRequired: request.credentialRequired,
        fetch: options.fetch,
        timeoutMs: options.timeoutMs,
      }).probe(credential, signal);
    },
  };
}

/** @deprecated Use createPlannerConnectionProbe('deepseek', options). */
export function createDeepSeekConnectionProbe(
  options: PlannerConnectionProbeOptions = {},
): ConnectionProbe {
  return createPlannerConnectionProbe('deepseek', options);
}

export function createPlannerConnectionProbes(
  options: Partial<Record<ProviderId, PlannerConnectionProbeOptions>> = {},
): Readonly<Record<ProviderId, ConnectionProbe>> {
  return Object.freeze(Object.fromEntries(PROVIDER_IDS.map((provider) => [
    provider,
    createPlannerConnectionProbe(provider, options[provider]),
  ])) as Record<ProviderId, ConnectionProbe>);
}

interface ProbeRequest {
  endpoint: string;
  headers: Readonly<Record<string, string>>;
  credentialRequired: boolean;
}

function probeRequest(
  provider: ProviderId,
  configuredEndpoint: string,
  credential: string | undefined,
): ProbeRequest {
  const endpoint = modelListEndpoint(provider, configuredEndpoint);
  switch (provider) {
    case 'anthropic':
      return {
        endpoint,
        headers: credential ? {
          'x-api-key': credential,
          'anthropic-version': '2023-06-01',
        } : {},
        credentialRequired: true,
      };
    case 'gemini':
      return {
        endpoint,
        headers: credential ? { 'x-goog-api-key': credential } : {},
        credentialRequired: true,
      };
    case 'ollama':
      return {
        endpoint,
        headers: credential ? { Authorization: `Bearer ${credential}` } : {},
        credentialRequired: false,
      };
    case 'deepseek':
    case 'openai':
    case 'openrouter':
    case 'bedrock':
    case 'grok':
      return {
        endpoint,
        headers: credential ? { Authorization: `Bearer ${credential}` } : {},
        credentialRequired: true,
      };
  }
}

function modelListEndpoint(provider: ProviderId, configuredEndpoint: string): string {
  const endpoint = new URL(configuredEndpoint);
  endpoint.search = '';
  endpoint.hash = '';
  if (provider === 'bedrock') {
    endpoint.hostname = endpoint.hostname.replace(/^bedrock-runtime\./u, 'bedrock.');
    endpoint.pathname = '/foundation-models';
    return endpoint.toString();
  }
  if (provider === 'ollama') {
    endpoint.pathname = replaceKnownSuffix(endpoint.pathname, ['/api/chat'], '/api/tags');
    return endpoint.toString();
  }
  if (provider === 'gemini') {
    endpoint.pathname = endpoint.pathname.endsWith('/models')
      ? endpoint.pathname
      : `${endpoint.pathname.replace(/\/+$/u, '')}/models`;
    return endpoint.toString();
  }
  endpoint.pathname = endpoint.pathname.endsWith('/models')
    ? endpoint.pathname
    : replaceKnownSuffix(
      endpoint.pathname,
      ['/chat/completions', '/responses', '/messages'],
      '/models',
    );
  return endpoint.toString();
}

function replaceKnownSuffix(pathname: string, suffixes: readonly string[], replacement: string): string {
  for (const suffix of suffixes) {
    if (pathname.endsWith(suffix)) {
      return `${pathname.slice(0, -suffix.length)}${replacement}`.replace(/\/{2,}/gu, '/');
    }
  }
  return `${pathname.replace(/\/+$/u, '')}${replacement}`.replace(/\/{2,}/gu, '/');
}

function defaultProfile(provider: ProviderId): Readonly<ProviderProfile> {
  const descriptor = getProviderDescriptor(provider);
  return {
    endpoint: descriptor.defaultEndpoint,
    model: descriptor.defaultModel,
    enabled: true,
  };
}

export type { HttpConnectionProbeOptions };
