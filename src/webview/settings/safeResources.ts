import { PERSONA_IDS, isRevision } from '../protocol';
import {
  PLANNER_PROVIDER_IDS,
  type PlannerProviderId,
  type SettingsAgentCollection,
  type SettingsMappingApprovalState,
  type SettingsProviderCollection,
  type SettingsProviderState,
  type SettingsProviderTestState,
  type SettingsViewState,
} from './contracts';

const PROVIDERS = new Set<PlannerProviderId>(PLANNER_PROVIDER_IDS);
const PERSONAS = new Set<string>(PERSONA_IDS);
const MAPPING_ID_PATTERN = /^vm_[A-Za-z0-9_-]{22,64}$/u;
const AGENT_ID_PATTERN = /^agent_[A-Za-z0-9_-]{12,80}$/u;
const MODEL_ID_PATTERN = /^[A-Za-z0-9~][A-Za-z0-9._~:/@+-]{0,255}$/u;
const TARGET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const HISTORY_DECISIONS = new Set([
  'granted', 'revoked', 'confirmed-execution', 'always-approved-execution',
]);

export function projectSafeProviderCollection(
  value: Readonly<SettingsProviderCollection>,
): SettingsProviderCollection {
  const selectedProvider = value.selectedProvider === 'off' || PROVIDERS.has(value.selectedProvider)
    ? value.selectedProvider
    : 'off';
  const items: SettingsProviderCollection['items'] = [];
  const seen = new Set<PlannerProviderId>();
  for (const provider of value.items) {
    if (!PROVIDERS.has(provider.id) || seen.has(provider.id) || items.length >= 8) continue;
    seen.add(provider.id);
    items.push({
      id: provider.id,
      name: plainText(provider.name, 120),
      enabled: provider.enabled === true,
      selected: selectedProvider === provider.id,
      configured: provider.configured === true,
      model: modelId(provider.model),
      modelPresets: provider.modelPresets.filter(validModelId).slice(0, 24),
      endpointHost: endpointHost(provider.endpointHost),
      locality: provider.locality === 'local-loopback' ? 'local-loopback' : 'remote',
      credentialRequired: provider.credentialRequired === true,
      consentRequired: provider.consentRequired === true,
      consentAcknowledged: provider.consentAcknowledged === true,
      credential: projectCredentialState(provider.credential),
      test: projectProviderTestState(provider.test),
    });
  }
  return { revision: revision(value.revision), selectedProvider, items };
}

export function projectSafeAgentCollection(
  value: Readonly<SettingsAgentCollection>,
): SettingsAgentCollection {
  const items: SettingsAgentCollection['items'] = [];
  const seen = new Set<string>();
  for (const agent of value.items) {
    if (
      !AGENT_ID_PATTERN.test(agent.id)
      || seen.has(agent.id)
      || !PROVIDERS.has(agent.provider)
      || !PERSONAS.has(agent.persona)
      || items.length >= 32
    ) continue;
    seen.add(agent.id);
    const fallback = agent.fallback
      && PROVIDERS.has(agent.fallback.provider)
      && validModelId(agent.fallback.model)
      ? { fallback: { provider: agent.fallback.provider, model: agent.fallback.model } }
      : {};
    items.push({
      id: agent.id,
      name: plainText(agent.name, 80),
      description: plainText(agent.description, 400),
      provider: agent.provider,
      model: modelId(agent.model),
      persona: agent.persona,
      enabled: agent.enabled === true,
      isDefault: false,
      instructionsConfigured: agent.instructionsConfigured === true,
      speechEnabled: agent.speechEnabled === true,
      speechRate: safeSpeechRate(agent.speechRate),
      ...(agent.templateId && PERSONAS.has(agent.templateId) ? { templateId: agent.templateId } : {}),
      ...fallback,
    });
  }
  const defaultAgentId = value.defaultAgentId && seen.has(value.defaultAgentId)
    ? value.defaultAgentId
    : undefined;
  for (const agent of items) agent.isDefault = agent.id === defaultAgentId;
  return {
    revision: revision(value.revision),
    status: value.status === 'ready' ? 'ready' : 'error',
    ...(defaultAgentId ? { defaultAgentId } : {}),
    items,
  };
}

export function projectSafeMappings(
  value: Readonly<SettingsViewState['mappings']>,
): SettingsViewState['mappings'] {
  const items = value.items.flatMap((mapping) => {
    if (!MAPPING_ID_PATTERN.test(mapping.id)) return [];
    if (mapping.kind !== 'command' && mapping.kind !== 'language-model-tool') return [];
    const approval: SettingsMappingApprovalState = mapping.approval === 'approved'
      ? 'approved'
      : mapping.approval === 'none' ? 'none' : 'revoked';
    return [{
      id: mapping.id,
      label: plainText(mapping.label, 120),
      description: plainText(mapping.description, 400),
      phrases: mapping.phrases.slice(0, 32).map((phrase) => plainText(phrase, 256)),
      kind: mapping.kind,
      targetId: TARGET_ID_PATTERN.test(mapping.targetId) ? mapping.targetId : 'invalid-target',
      enabled: mapping.enabled === true,
      agentEnabled: mapping.agentEnabled === true,
      approval,
      permissionTier: approval === 'approved' ? 'always-approved' as const : 'confirmation-required' as const,
    }];
  });
  const approvalHistory = value.approvalHistory.slice(-100).flatMap((entry) => (
    MAPPING_ID_PATTERN.test(entry.mappingId)
    && HISTORY_DECISIONS.has(entry.decision)
    && Number.isSafeInteger(entry.timestamp)
    && entry.timestamp >= 0
      ? [{ mappingId: entry.mappingId, decision: entry.decision, timestamp: entry.timestamp }]
      : []
  ));
  const status = value.status === 'loading' || value.status === 'ready'
    || value.status === 'untrusted' ? value.status : 'error';
  return { revision: revision(value.revision), status, items, approvalHistory };
}

export function projectSafeProviderState(
  value: Readonly<SettingsProviderState>,
): SettingsProviderState {
  return {
    configured: value.configured === true,
    credential: projectCredentialState(value.credential),
    test: projectProviderTestState(value.test),
  };
}

function projectCredentialState(
  value: Readonly<SettingsProviderState['credential']>,
): SettingsProviderState['credential'] {
  const operationRevision = revision(value.operationRevision);
  if (value.phase === 'updating') return { phase: 'updating', operationRevision };
  if (
    value.phase === 'complete'
    && (value.result === 'saved' || value.result === 'cleared'
      || value.result === 'cancelled' || value.result === 'unavailable')
  ) return { phase: 'complete', operationRevision, result: value.result };
  return { phase: 'idle', operationRevision };
}

function projectProviderTestState(
  value: Readonly<SettingsProviderTestState>,
): SettingsProviderTestState {
  const operationRevision = revision(value.operationRevision);
  if (value.phase === 'running') return { phase: 'running', operationRevision };
  if (value.phase === 'complete' && [
    'connected', 'not-configured', 'consent-required', 'unauthorized', 'rate-limited',
    'rejected', 'unavailable', 'timed-out', 'cancelled',
  ].includes(value.result)) {
    return { phase: 'complete', operationRevision, result: value.result };
  }
  return { phase: 'idle', operationRevision };
}

function revision(value: unknown): number {
  return isRevision(value) ? value : 0;
}

function plainText(value: unknown, maximum: number): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001F\u007F]/gu, ' ').trim().replace(/\s+/gu, ' ').slice(0, maximum)
    : '';
}

function validModelId(value: unknown): value is string {
  return typeof value === 'string' && MODEL_ID_PATTERN.test(value);
}

function modelId(value: unknown): string {
  return validModelId(value) ? value : 'invalid-model';
}

function endpointHost(value: unknown): string {
  return typeof value === 'string'
    && value.length <= 255
    && /^(?:\[[0-9a-f:]+\]|[A-Za-z0-9.-]+)(?::\d{1,5})?$/u.test(value)
    ? value
    : 'invalid-endpoint';
}

function safeSpeechRate(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0.5 && value <= 2
    ? value
    : 1;
}
