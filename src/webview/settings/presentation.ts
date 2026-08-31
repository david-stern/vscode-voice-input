import type {
  CompatibilityPresentation,
  PresentationReadiness,
  SettingsProviderState,
  SettingsViewState,
  SetupStepId,
} from './contracts';

export const READINESS_ITEM_IDS = [
  'transcription',
  'microphone',
  'reasoning',
  'speech',
  'actions',
  'privacy',
] as const;

export type ReadinessItemId = (typeof READINESS_ITEM_IDS)[number];

export interface ReadinessPresentation {
  id: ReadinessItemId;
  readiness: PresentationReadiness;
}

/**
 * Adapts host-owned transcription, provider, agent, and system-speech state to
 * a browser-safe presentation. The adapter is intentionally
 * allowlisted and contains no credentials, request bodies, action arguments,
 * or browser-owned authority.
 */
export function projectCompatibilityPresentation(
  state: Readonly<SettingsViewState>,
): CompatibilityPresentation {
  return {
    providers: [
      {
        id: 'soniox',
        name: 'Soniox',
        role: 'speech-to-text',
        execution: 'remote',
        readiness: providerReadiness(state.transcription),
        configured: state.transcription.configured,
        modelId: state.general.sttModel,
        credentialSurface: 'native-host',
      },
      ...state.providers.items.map((provider) => ({
        id: provider.id,
        name: provider.name,
        role: 'reasoning' as const,
        execution: provider.locality === 'local-loopback' ? 'system' as const : 'remote' as const,
        readiness: provider.enabled
          ? providerReadiness(provider, provider.consentAcknowledged)
          : 'attention' as const,
        configured: provider.configured,
        modelId: provider.model,
        credentialSurface: 'native-host' as const,
      })),
      {
        id: 'system-tts',
        name: 'System TTS',
        role: 'text-to-speech',
        execution: 'system',
        readiness: state.speech.enabled ? 'ready' : 'attention',
        configured: state.speech.enabled,
        modelId: state.speech.voiceUri || undefined,
        credentialSurface: 'not-applicable',
      },
    ],
    agents: state.agents.items.map((agent) => ({
      id: agent.id,
      name: agent.name,
      persona: agent.persona,
      readiness: agent.enabled ? assistantReadiness(state) : 'attention',
      listening: agent.isDefault && state.assistant.status === 'listening',
      authority: 'host-policy',
      approval: 'explicit-before-send-or-action',
    })),
    actions: state.mappings.items.map((mapping) => ({
      id: mapping.id,
      name: mapping.label,
      kind: mapping.kind,
      targetId: mapping.targetId,
      enabled: mapping.enabled,
      agentEnabled: mapping.agentEnabled,
      approval: 'host-confirmed',
    })),
  };
}

export function createReadinessPresentation(
  state: Readonly<SettingsViewState>,
): ReadinessPresentation[] {
  const compatibility = projectCompatibilityPresentation(state);
  const provider = new Map(compatibility.providers.map((item) => [item.id, item]));
  return [
    { id: 'transcription', readiness: provider.get('soniox')?.readiness ?? 'unavailable' },
    { id: 'microphone', readiness: microphoneReadiness(state) },
    {
      id: 'reasoning',
      readiness: state.providers.selectedProvider === 'off'
        ? 'attention'
        : provider.get(state.providers.selectedProvider)?.readiness ?? 'unavailable',
    },
    { id: 'speech', readiness: provider.get('system-tts')?.readiness ?? 'unavailable' },
    { id: 'actions', readiness: mappingsReadiness(state) },
    { id: 'privacy', readiness: state.privacy.workspaceTrusted ? 'ready' : 'attention' },
  ];
}

export function createSetupReadiness(
  state: Readonly<SettingsViewState>,
): Readonly<Record<SetupStepId, PresentationReadiness>> {
  return Object.fromEntries(Object.entries(state.setup.steps).map(([step, value]) => [
    step,
    value.status === 'ready'
      ? 'ready'
      : value.status === 'running'
        ? 'loading'
        : value.status === 'error'
          ? 'unavailable'
          : 'attention',
  ])) as Record<SetupStepId, PresentationReadiness>;
}

function providerReadiness(
  provider: Readonly<SettingsProviderState>,
  consentSatisfied = true,
): PresentationReadiness {
  if (provider.credential.phase === 'updating' || provider.test.phase === 'running') return 'loading';
  if (!provider.configured || !consentSatisfied) return 'attention';
  if (provider.test.phase !== 'complete') return 'ready';
  if (provider.test.result === 'connected') return 'ready';
  if (provider.test.result === 'unavailable' || provider.test.result === 'timed-out') return 'unavailable';
  return 'attention';
}

function microphoneReadiness(state: Readonly<SettingsViewState>): PresentationReadiness {
  if (state.microphone.status === 'scanning') return 'loading';
  if (state.microphone.status === 'unavailable' || state.microphone.status === 'error') return 'unavailable';
  if (state.microphone.status === 'ready') return 'ready';
  return 'attention';
}

function assistantReadiness(state: Readonly<SettingsViewState>): PresentationReadiness {
  if (state.assistant.status === 'starting' || state.assistant.status === 'stopping') return 'loading';
  if (state.assistant.status === 'error') return 'unavailable';
  if (!state.assistant.consentAcknowledged || !state.agents.defaultAgentId) return 'attention';
  return 'ready';
}

function mappingsReadiness(state: Readonly<SettingsViewState>): PresentationReadiness {
  if (state.mappings.status === 'loading') return 'loading';
  if (state.mappings.status === 'error') return 'unavailable';
  if (state.mappings.status === 'untrusted') return 'attention';
  return state.mappings.items.some((mapping) => mapping.enabled) ? 'ready' : 'attention';
}
