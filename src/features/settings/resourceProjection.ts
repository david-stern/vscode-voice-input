import {
  providerConsentRequired,
  providerDisclosure,
  type ConsentService,
  type VoiceInputSettings,
} from '../../config';
import type { AgentRecord, AgentRegistry } from '../../agents';
import { PROVIDER_DESCRIPTORS, type ProviderId } from '../../inference';
import type {
  SettingsAgentCollection,
  SettingsMappingApprovalState,
  SettingsProviderCollection,
  SettingsViewState,
} from '../../webview/settings/protocol';
import type { CredentialCommandController } from '../commands/credentialController';
import type { SettingsMappingPort, SettingsMappingSnapshot } from './ports';
import type { SettingsProviderTestController } from './providerTestController';

export function projectProviderCollection(
  values: Readonly<VoiceInputSettings>,
  revision: number,
  configured: ReadonlyMap<ProviderId, boolean>,
  credentialOperations: Pick<CredentialCommandController, 'credentialState'>,
  tests: Readonly<Record<ProviderId, SettingsProviderTestController>>,
  consents: Pick<ConsentService, 'status'>,
): SettingsProviderCollection {
  return {
    revision,
    selectedProvider: values.assistantProvider,
    items: PROVIDER_DESCRIPTORS.map((descriptor) => {
      const profile = values.providerProfiles[descriptor.id];
      const disclosure = providerDisclosure(descriptor.id, profile.endpoint);
      const consentRequired = providerConsentRequired(descriptor.id, profile.endpoint);
      const credentialRequired = descriptor.id !== 'ollama' || consentRequired;
      return {
        id: descriptor.id,
        name: descriptor.name,
        enabled: profile.enabled,
        selected: values.assistantProvider === descriptor.id,
        configured: !credentialRequired || configured.get(descriptor.id) === true,
        model: profile.model,
        modelPresets: [...descriptor.modelPresets],
        endpointHost: disclosure.endpointHost,
        locality: disclosure.locality,
        credentialRequired,
        consentRequired,
        consentAcknowledged: !consentRequired || consents.status(descriptor.id).acknowledged,
        credential: credentialOperations.credentialState(descriptor.id),
        test: tests[descriptor.id].state,
      };
    }),
  };
}

export function projectAgentCollection(
  agents: Pick<AgentRegistry, 'list' | 'defaultId' | 'isCorrupted'>,
  revision: number,
  language: SettingsViewState['uiLang'],
): SettingsAgentCollection {
  try {
    const defaultAgentId = agents.defaultId;
    const items = agents.list().slice(0, 32).map((agent) => projectAgent(agent, defaultAgentId, language));
    return {
      revision,
      status: agents.isCorrupted ? 'error' : 'ready',
      ...(defaultAgentId ? { defaultAgentId } : {}),
      items,
    };
  } catch {
    return { revision, status: 'error', items: [] };
  }
}

export function projectMappingCollection(
  snapshot: Readonly<SettingsMappingSnapshot>,
  mappings: Pick<SettingsMappingPort, 'settingsApprovalState' | 'approvalHistory'>,
): SettingsViewState['mappings'] {
  return {
    revision: snapshot.revision,
    status: snapshot.status,
    items: snapshot.items.map((mapping) => {
      const approval = safeApprovalState(mappings, mapping.id);
      return {
        ...mapping,
        phrases: [...mapping.phrases],
        approval,
        permissionTier: approval === 'approved' ? 'always-approved' : 'confirmation-required',
      };
    }),
    approvalHistory: safeApprovalHistory(mappings),
  };
}

function projectAgent(
  agent: Readonly<AgentRecord>,
  defaultAgentId: string | undefined,
  language: SettingsViewState['uiLang'],
): SettingsAgentCollection['items'][number] {
  const description = language === 'he' ? agent.description.he : agent.description.en;
  const instructions = language === 'he' ? agent.instructions.he : agent.instructions.en;
  return {
    id: agent.id,
    name: agent.name,
    description,
    provider: agent.provider,
    model: agent.model,
    persona: agent.persona,
    enabled: agent.enabled,
    isDefault: agent.id === defaultAgentId,
    instructionsConfigured: instructions.trim().length > 0,
    speechEnabled: agent.speech.enabled,
    speechRate: agent.speech.rate,
    ...(agent.templateId ? { templateId: agent.templateId } : {}),
    ...(agent.fallback ? { fallback: { ...agent.fallback } } : {}),
  };
}

function safeApprovalState(
  mappings: Pick<SettingsMappingPort, 'settingsApprovalState'>,
  id: string,
): SettingsMappingApprovalState {
  try {
    return mappings.settingsApprovalState(id);
  } catch {
    return 'revoked';
  }
}

function safeApprovalHistory(
  mappings: Pick<SettingsMappingPort, 'approvalHistory'>,
): SettingsViewState['mappings']['approvalHistory'] {
  try {
    return mappings.approvalHistory().slice(-100).map(({ mappingId, decision, timestamp }) => ({
      mappingId,
      decision,
      timestamp,
    }));
  } catch {
    return [];
  }
}
