import { getProviderDescriptor, type ProviderId } from '../inference';
import { isLoopbackEndpoint } from './providerProfiles';

export const PROVIDER_DISCLOSURE_FIELDS = Object.freeze([
  'post-wake-request',
  'persona-and-bounded-user-agent-instructions',
  'locale',
  'minimal-target-kind-and-focus',
] as const);

const PROVIDER_DISCLOSURE_EXCLUSIONS = Object.freeze([
  'screenshots',
  'files-and-selections',
  'clipboard',
  'terminal-and-chat-history',
  'mapping-arguments-and-tool-input',
] as const);

export interface ProviderDisclosure {
  provider: ProviderId;
  providerName: string;
  endpointHost: string;
  locality: 'local-loopback' | 'remote';
  fields: typeof PROVIDER_DISCLOSURE_FIELDS;
  excludes: readonly [
    'screenshots',
    'files-and-selections',
    'clipboard',
    'terminal-and-chat-history',
    'mapping-arguments-and-tool-input',
  ];
}

/** A loopback Ollama endpoint is the only profile described as local. */
export function providerDisclosure(provider: ProviderId, endpoint: string): ProviderDisclosure {
  return Object.freeze({
    provider,
    providerName: getProviderDescriptor(provider).name,
    endpointHost: endpointAuthority(endpoint),
    locality: provider === 'ollama' && isLoopbackEndpoint(endpoint)
      ? 'local-loopback'
      : 'remote',
    fields: PROVIDER_DISCLOSURE_FIELDS,
    excludes: PROVIDER_DISCLOSURE_EXCLUSIONS,
  });
}

function endpointAuthority(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return 'invalid-endpoint';
  }
}
