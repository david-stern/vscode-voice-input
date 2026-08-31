import assert from 'node:assert/strict';
import test from 'node:test';

import { PROVIDER_IDS, SETTINGS_DEFAULTS } from '../src/config';
import type { DeepSeekPlan } from '../src/assistant/deepseek';
import type { TargetSnapshot } from '../src/assistant/context';
import { AssistantActionController } from '../src/features/assistant/actionController';
import { AssistantFeature } from '../src/features/assistant/feature';
import type { AssistantFeedbackController } from '../src/features/assistant/feedbackController';
import type { AssistantIdSequence } from '../src/features/assistant/idSequence';
import { AssistantPlanningService } from '../src/features/assistant/planningService';
import {
  CredentialChangeAuthorityGate,
  CredentialCommandController,
} from '../src/features/commands/credentialController';
import { registerSettingsSurface } from '../src/features/settings/registration';
import { SettingsController } from '../src/features/settings/controller';
import { SettingsFeature } from '../src/features/settings/feature';
import { SettingsProviderTestController } from '../src/features/settings/providerTestController';
import { providerConsentPrompt } from '../src/features/settings/providerConsentPrompt';
import { SettingsStatePublisher } from '../src/features/settings/statePublisher';
import { SETUP_STEP_IDS } from '../src/webview/settings/protocol';

const EMPTY_AGENTS = {
  list: () => [],
  defaultId: undefined,
  isCorrupted: false,
};

const PROJECTED_AGENT_ID = 'agent_abcdefghijkl';
const PROJECTED_AGENTS = {
  list: () => [{
    id: PROJECTED_AGENT_ID,
    name: 'Teacher',
    description: { en: 'Safe agent description', he: 'תיאור בטוח' },
    provider: 'openai' as const,
    model: 'gpt-5.4',
    persona: 'teacher-lecturer' as const,
    instructions: { en: 'private-agent-instructions', he: 'הוראות פרטיות' },
    speech: { enabled: true, voiceUri: '/home/private/voice', rate: 1 },
    enabled: true,
    templateId: 'teacher-lecturer' as const,
  }],
  defaultId: PROJECTED_AGENT_ID,
  isCorrupted: false,
};

function idleProviderTests(): Record<string, { state: { phase: 'idle'; operationRevision: 0 } }> {
  return Object.fromEntries(PROVIDER_IDS.map((provider) => [
    provider,
    { state: { phase: 'idle' as const, operationRevision: 0 as const } },
  ]));
}

function emptyApprovalPort() {
  return {
    settingsApprovalState: () => 'none' as const,
    approvalHistory: () => [],
  };
}

function setupWorkflowStub() {
  return {
    state: {
      revision: 0,
      currentStep: 'microphone' as const,
      complete: false,
      steps: Object.fromEntries(SETUP_STEP_IDS.map((step) => [step, { status: 'pending' }])),
    },
    run: async () => 'accepted' as const,
    cancel: () => 'accepted' as const,
    speechFinished: () => 'accepted' as const,
    invalidateFrom: () => undefined,
    dispose: () => undefined,
  };
}

test('Settings surface registers the retained provider and open command behaviorally', async () => {
  const registrations: Array<Record<string, unknown>> = [];
  const reveals: string[] = [];
  const containerReveals: string[] = [];
  const disposables = registerSettingsSurface({
    registerView: (viewType, provider, retainContextWhenHidden) => {
      registrations.push({ kind: 'view', viewType, provider, retainContextWhenHidden });
      return { dispose: () => undefined };
    },
    registerCommand: (commandId, callback) => {
      registrations.push({ kind: 'command', commandId, callback });
      return { dispose: () => undefined };
    },
    revealViewContainer: async (containerId) => {
      containerReveals.push(`workbench.view.extension.${containerId}`);
    },
  }, {
    reveal: async (section, revealContainer) => {
      reveals.push(section ?? '');
      await revealContainer?.();
    },
  });

  assert.equal(disposables.length, 2);
  assert.deepEqual(
    registrations.map(({ kind, viewType, commandId, retainContextWhenHidden }) => ({
      kind,
      viewType,
      commandId,
      retainContextWhenHidden,
    })),
    [
      {
        kind: 'view',
        viewType: 'voiceInput.settingsView',
        commandId: undefined,
        retainContextWhenHidden: true,
      },
      {
        kind: 'command',
        viewType: undefined,
        commandId: 'voiceInput.openSettings',
        retainContextWhenHidden: undefined,
      },
    ],
  );
  await (registrations[1].callback as () => Promise<void>)();
  assert.deepEqual(reveals, ['general']);
  assert.deepEqual(containerReveals, ['workbench.view.extension.voiceInput']);
  assert.equal(containerReveals.some((command) => command.endsWith('.settingsView.focus')), false);
});

test('Settings publisher advances the top envelope and projects no host authority data', async () => {
  const published: unknown[] = [];
  const publisher = new SettingsStatePublisher({
    settings: {
      read: () => ({ values: { ...SETTINGS_DEFAULTS }, workspaceOverrides: [] }),
    },
    credentials: {
      status: async (provider) => ({ provider, configured: true }),
    },
    consents: {
      status: (id) => ({ id, acknowledged: false }),
    },
    metadata: {
      state: { models: [], languages: [], loading: false },
    },
    assistant: {
      state: {
        listening: false,
        speaking: false,
        feedback: '',
        targetLabel: '',
        planConfidence: undefined,
        pendingSend: undefined,
        providerBusy: false,
        providerError: undefined,
      },
    },
    devices: { cachedDevices: [], hasCachedResult: false },
    mappings: {
      settingsSnapshot: () => ({
        revision: 3,
        status: 'ready',
        items: [{
          id: 'vm_ABCDEFGHIJKLMNOPQRSTUV',
          label: 'Safe label',
          description: 'Safe description',
          phrases: ['safe phrase'],
          kind: 'command',
          targetId: 'safe.command',
          enabled: true,
          agentEnabled: false,
        }],
      }),
      ...emptyApprovalPort(),
      settingsApprovalState: () => 'approved' as const,
      approvalHistory: () => [{
        mappingId: 'vm_ABCDEFGHIJKLMNOPQRSTUV',
        decision: 'granted' as const,
        timestamp: 123,
        fingerprint: 'private-fingerprint',
      }],
    } as never,
    agents: PROJECTED_AGENTS as never,
    credentialOperations: {
      credentialState: () => ({ phase: 'idle', operationRevision: 0 }),
    },
    providerTests: idleProviderTests() as never,
    diagnostics: { result: undefined },
    view: { postState: (state) => { published.push(state); } },
    shortcut: () => 'Alt+M',
    extensionVersion: '1.3.0',
    platform: 'linux',
    isWorkspaceTrusted: () => true,
    setup: setupWorkflowStub() as never,
  });

  await publisher.refresh();
  await publisher.refresh();

  const states = published as Array<{ revision: number }>;
  assert.deepEqual(states.map(({ revision }) => revision), [1, 2]);
  const serialized = JSON.stringify(states);
  assert.match(serialized, /safe\.command/u);
  const latest = published.at(-1) as {
    providers: { items: Array<{ id: string; endpointHost: string }> };
    agents: { defaultAgentId?: string; items: Array<Record<string, unknown>> };
    mappings: { items: Array<{ approval: string; permissionTier: string }>; approvalHistory: unknown[] };
  };
  assert.equal(latest.providers.items.length, 8);
  assert.equal(latest.providers.items.find(({ id }) => id === 'openai')?.endpointHost, 'api.openai.com');
  assert.equal(latest.agents.defaultAgentId, PROJECTED_AGENT_ID);
  assert.deepEqual(Object.keys(latest.agents.items[0] ?? {}).sort(), [
    'description', 'enabled', 'id', 'instructionsConfigured', 'isDefault', 'model', 'name',
    'persona', 'provider', 'speechEnabled', 'speechRate', 'templateId',
  ]);
  assert.deepEqual(latest.mappings.items[0] && {
    approval: latest.mappings.items[0].approval,
    permissionTier: latest.mappings.items[0].permissionTier,
  }, { approval: 'approved', permissionTier: 'always-approved' });
  assert.deepEqual(latest.mappings.approvalHistory, [{
    mappingId: 'vm_ABCDEFGHIJKLMNOPQRSTUV', decision: 'granted', timestamp: 123,
  }]);
  assert.doesNotMatch(serialized, /private-agent-instructions|private\/voice/u);
  assert.doesNotMatch(
    serialized,
    /secret|credential-value|provider-body|"transcript"|fingerprint|"args"|"input"|\/home\//iu,
  );
});

test('Settings publisher projects stale and repaired microphone recovery without native identities', async () => {
  const published: Array<Record<string, unknown>> = [];
  let selectionStatus: unknown = {
    kind: 'stale',
    deviceId: '/home/david/.config/microphone',
    label: 'private microphone',
    matchingDevices: 0,
  };
  const publisher = new SettingsStatePublisher({
    settings: { read: () => ({ values: { ...SETTINGS_DEFAULTS }, workspaceOverrides: [] }) },
    credentials: { status: async (provider) => ({ provider, configured: false }) },
    consents: { status: (id) => ({ id, acknowledged: false }) },
    metadata: { state: { models: [], languages: [], loading: false } },
    assistant: { state: {
      listening: false, speaking: false, feedback: '', targetLabel: '', planConfidence: undefined,
      pendingSend: undefined, providerBusy: false, providerError: undefined,
    } },
    devices: {
      cachedDevices: [], hasCachedResult: true,
      get selectionStatus() { return selectionStatus; },
    } as never,
    mappings: {
      settingsSnapshot: () => ({ revision: 0, status: 'ready', items: [] }),
      ...emptyApprovalPort(),
    } as never,
    agents: EMPTY_AGENTS as never,
    credentialOperations: { credentialState: () => ({ phase: 'idle', operationRevision: 0 }) },
    providerTests: idleProviderTests() as never,
    diagnostics: { result: undefined },
    view: { postState: (state) => { published.push(state as unknown as Record<string, unknown>); } },
    shortcut: () => 'Alt+M', extensionVersion: '1.4.0', platform: 'linux', isWorkspaceTrusted: () => true,
    setup: setupWorkflowStub() as never,
  });

  await publisher.refresh();
  selectionStatus = {
    kind: 'repaired', previousDeviceId: 'old-native-id', deviceId: 'new-native-id', label: 'Built-in Microphone',
  };
  await publisher.refresh();

  const microphones = published.map((state) => state.microphone as Record<string, unknown>);
  assert.deepEqual(microphones[0].selection, {
    kind: 'stale', status: 'unavailable', recovery: 'select-device',
  });
  assert.equal(microphones[0].status, 'unavailable');
  assert.deepEqual(microphones[1].selection, {
    kind: 'repaired', status: 'ready', recovery: 'none', label: 'Built-in Microphone',
  });
  assert.equal(JSON.stringify(microphones), JSON.stringify(microphones).replace(/old-native-id|new-native-id|\/home\/david/g, ''));
});

test('Settings router validates at dispatch and rejects stale global writes', async () => {
  let settingsRevision = 0;
  let refreshes = 0;
  const writes: unknown[] = [];
  const notices: string[] = [];
  const state = {
    get currentSettingsRevision() { return settingsRevision; },
    settingsChanged: () => { settingsRevision += 1; },
    showNotice: (_kind: string, code: string) => { notices.push(code); },
    refresh: async () => { refreshes += 1; },
  };
  const controller = new SettingsController({
    settings: { update: async (patch) => { writes.push(patch); } },
    consents: {} as never,
    assistant: {
      beginIntelligenceChange: () => 1,
      finishIntelligenceChange: () => undefined,
    } as never,
    devices: {} as never,
    mappings: {} as never,
    credentials: {} as never,
    providerTests: {} as never,
    diagnostics: {} as never,
    nativeUi: {} as never,
    state: state as never,
    publishMic: async () => undefined,
    setup: setupWorkflowStub() as never,
  });

  await controller.route({
    type: 'settings-change',
    settingsRevision: 0,
    setting: 'uiLanguage',
    value: 'he',
    secret: 'must-be-rejected',
  });
  await controller.route({
    type: 'settings-change',
    settingsRevision: 0,
    setting: 'uiLanguage',
    value: 'he',
  });
  await controller.route({
    type: 'settings-change',
    settingsRevision: 0,
    setting: 'uiLanguage',
    value: 'en',
  });

  assert.deepEqual(writes, [{ uiLanguage: 'he' }]);
  assert.equal(settingsRevision, 1);
  assert.ok(refreshes >= 2);
  assert.deepEqual(notices, ['settings-saved', 'stale-state']);
});

test('audio-device selection stops assistant authority before delayed persistence', async () => {
  const selection = deferred<void>();
  const events: string[] = [];
  let settingsRevision = 0;
  let microphoneRevision = 0;
  const controller = new SettingsController({
    settings: {} as never,
    consents: {} as never,
    assistant: {
      stop: async () => { events.push('assistant-stop'); },
    } as never,
    devices: {
      select: async () => {
        events.push('selection-started');
        await selection.promise;
        events.push('selection-persisted');
      },
    } as never,
    mappings: {} as never,
    credentials: {} as never,
    providerTests: {} as never,
    diagnostics: {} as never,
    nativeUi: {} as never,
    state: {
      get currentSettingsRevision() { return settingsRevision; },
      get currentMicrophoneRevision() { return microphoneRevision; },
      settingsChanged: () => { settingsRevision += 1; },
      setMicrophoneOperation: (revision: number) => { microphoneRevision = revision; },
      showNotice: () => undefined,
      refresh: async () => undefined,
    } as never,
    publishMic: () => undefined,
    setup: setupWorkflowStub() as never,
  });

  const pending = controller.route({
    type: 'settings-change',
    settingsRevision: 0,
    setting: 'audioDevice',
    value: 'device-b',
  });
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(events, ['assistant-stop', 'selection-started']);
  assert.equal(settingsRevision, 0);
  selection.resolve(undefined);
  await pending;
  assert.deepEqual(events, ['assistant-stop', 'selection-started', 'selection-persisted']);
  assert.equal(settingsRevision, 1);
});

test('audio-device selection cancels a paused assistant action before mutation or late feedback', async () => {
  const injectionEntered = deferred<void>();
  const releaseInjection = deferred<void>();
  const spoken: string[] = [];
  let mutations = 0;
  let publications = 0;
  const captured: TargetSnapshot = {
    requestedTarget: 'here',
    resolvedTarget: 'focused-control',
    focusedTarget: 'focused-control',
    vscodeFocused: true,
    activeTabIdentity: 'tab-1',
    activeEditorIdentity: null,
    activeTerminalIdentity: null,
  };
  const actions = new AssistantActionController({
    host: {
      confirmAgentAction: async () => false,
      focusBuiltInChat: async () => false,
      prepareBuiltInChatDraft: async () => undefined,
      hasCommand: async () => false,
      executeCommand: async () => undefined,
      activeTerminal: () => undefined,
      hasActiveEditor: () => false,
      injectIntoEditor: async () => false,
      injectIntoFocusedControl: async (_text, targetStillValid) => {
        injectionEntered.resolve(undefined);
        await releaseInjection.promise;
        if (!targetStillValid()) return false;
        mutations += 1;
        return true;
      },
    },
    target: {
      capture: () => captured,
      forRequestedTarget: (snapshot) => snapshot,
    },
    feedback: { speak: (message: string) => { spoken.push(message); } } as AssistantFeedbackController,
    sequence: { next: (prefix: string) => `${prefix}-1` } as AssistantIdSequence,
    localize: (english) => english,
    publish: () => { publications += 1; },
    stopAssistant: async () => undefined,
  });
  const pendingAction = actions.execute({
    action: 'write-here',
    target: 'current',
    content: 'device-a text',
    spokenReply: '',
    reason: 'Prepare a draft.',
    confidence: 1,
    requiresConfirmation: false,
  }, captured, 'utterance-device-a');
  await injectionEntered.promise;
  const publicationsBeforeChange = publications;

  const settings = new SettingsController({
    settings: {} as never,
    consents: {} as never,
    assistant: {
      stop: async () => { actions.clearPending(false); },
    } as never,
    devices: { select: async () => undefined } as never,
    mappings: {} as never,
    credentials: {} as never,
    providerTests: {} as never,
    diagnostics: {} as never,
    nativeUi: {} as never,
    state: {
      currentSettingsRevision: 0,
      currentMicrophoneRevision: 0,
      settingsChanged: () => undefined,
      setMicrophoneOperation: () => undefined,
      showNotice: () => undefined,
      refresh: async () => undefined,
    } as never,
    publishMic: () => undefined,
    setup: setupWorkflowStub() as never,
  });
  await settings.route({
    type: 'settings-change',
    settingsRevision: 0,
    setting: 'audioDevice',
    value: 'device-b',
  });
  releaseInjection.resolve(undefined);
  await pendingAction;

  assert.equal(mutations, 0);
  assert.deepEqual(spoken, []);
  assert.equal(publications, publicationsBeforeChange);
  actions.dispose();
});

test('planner credential clear invalidates a delayed privileged confirmation', async () => {
  const harness = delayedPrivilegedActionHarness();
  const gate = new CredentialChangeAuthorityGate(
    () => harness.feature.beginIntelligenceChange(),
    (token) => harness.feature.finishIntelligenceChange(token),
  );
  const credentials = new CredentialCommandController({
    credentials: {
      set: async (provider) => ({ provider, configured: true }),
      clear: async (provider) => ({ provider, configured: false }),
      status: async (provider) => ({ provider, configured: true }),
    },
    consents: {
      status: (id) => ({ id, acknowledged: true }),
      revision: () => 0,
      acknowledgeIfCurrent: async () => true,
    },
    ui: {
      confirmDeepSeekDisclosure: async () => true,
      confirmCredentialClear: async () => true,
      promptSonioxKey: async () => undefined,
      promptDeepSeekKey: async () => undefined,
      chooseDeepSeekAction: async () => undefined,
      showInformation: async () => undefined,
      offerSonioxSetup: async () => false,
    },
    beginCredentialChange: () => gate.acquire(),
    clearDeepSeekError: () => undefined,
    publish: () => undefined,
    executeCommand: async () => undefined,
  });

  await harness.prompted.promise;
  const clearing = credentials.clearProvider('deepseek');
  harness.confirmation.resolve(true);
  await harness.pending;
  await clearing;

  harness.assertCancelled();
});

test('planner consent revoke invalidates a delayed privileged confirmation before persistence', async () => {
  const harness = delayedPrivilegedActionHarness();
  const revokeStarted = deferred<void>();
  const releaseRevoke = deferred<void>();
  const controller = new SettingsController({
    settings: {
      read: () => ({ values: { ...SETTINGS_DEFAULTS }, workspaceOverrides: [] }),
    } as never,
    consents: {
      revision: () => 0,
      acknowledgeIfCurrent: async () => true,
      revoke: async () => {
        revokeStarted.resolve(undefined);
        await releaseRevoke.promise;
        return { id: 'deepseek', acknowledged: false };
      },
    } as never,
    assistant: {
      invalidatePlanning: () => harness.feature.invalidatePlanning(),
      clearProviderError: () => harness.feature.clearProviderError(),
      stop: async () => undefined,
    } as never,
    devices: {} as never,
    mappings: {} as never,
    credentials: {} as never,
    providerTests: { deepseek: { cancelIfRunning: () => undefined } } as never,
    diagnostics: {} as never,
    nativeUi: {} as never,
    state: {
      currentConsentRevision: 0,
      consentChanged: () => undefined,
      refresh: async () => undefined,
    } as never,
    publishMic: () => undefined,
    setup: setupWorkflowStub() as never,
  });

  await harness.prompted.promise;
  const revoking = controller.route({
    type: 'settings-consent-action',
    consentRevision: 0,
    consent: 'deepseek',
    action: 'revoke',
  });
  harness.confirmation.resolve(true);
  await harness.pending;
  await revokeStarted.promise;
  releaseRevoke.resolve(undefined);
  await revoking;

  harness.assertCancelled();
});

test('selected provider profile invalidation closes a delayed privileged confirmation', async () => {
  const harness = delayedPrivilegedActionHarness();
  const updateStarted = deferred<void>();
  const releaseUpdate = deferred<void>();
  const controller = new SettingsController({
    settings: {
      read: () => ({ values: { ...SETTINGS_DEFAULTS }, workspaceOverrides: [] }),
      update: async () => {
        updateStarted.resolve(undefined);
        await releaseUpdate.promise;
      },
    } as never,
    consents: {} as never,
    assistant: {
      invalidateActions: () => harness.feature.invalidateActions(),
      beginIntelligenceChange: () => harness.feature.beginIntelligenceChange(),
      finishIntelligenceChange: (token: number) => harness.feature.finishIntelligenceChange(token),
    } as never,
    devices: {} as never,
    mappings: {} as never,
    credentials: {} as never,
    providerTests: {} as never,
    diagnostics: {} as never,
    nativeUi: {} as never,
    state: {
      currentProviderRevision: 0,
      settingsChanged: () => undefined,
      providerChanged: () => undefined,
      showNotice: () => undefined,
      refresh: async () => undefined,
    } as never,
    publishMic: () => undefined,
    setup: setupWorkflowStub() as never,
  });

  await harness.prompted.promise;
  const changing = controller.route({
    type: 'settings-provider-profile',
    providerRevision: 0,
    provider: 'deepseek',
    enabled: false,
    model: SETTINGS_DEFAULTS.providerProfiles.deepseek.model,
  });
  harness.confirmation.resolve(true);
  await harness.pending;
  await updateStarted.promise;
  releaseUpdate.resolve(undefined);
  await changing;

  harness.assertCancelled();
});

test('provider, agent, and approval messages route through revisioned host facades only', async () => {
  let values = structuredClone(SETTINGS_DEFAULTS);
  const originalEndpoint = values.providerProfiles.openai.endpoint;
  let settingsRevision = 0;
  let providerRevision = 0;
  let agentRevision = 0;
  let mappingsRevision = 4;
  const notices: string[] = [];
  const agentEvents: string[] = [];
  const approvalEvents: string[] = [];
  const intelligenceEvents: string[] = [];
  let editedDraft: Record<string, unknown> | undefined;
  const agent = {
    id: PROJECTED_AGENT_ID,
    name: 'Teacher',
    description: { en: 'Safe', he: 'בטוח' },
    provider: 'deepseek' as const,
    model: 'deepseek-v4-flash',
    persona: 'teacher-lecturer' as const,
    instructions: { en: 'host-only instructions', he: 'הוראות במארח' },
    speech: { enabled: true, voiceUri: 'native-voice', rate: 1 },
    enabled: true,
  };
  const acceptedMapping = () => ({
    status: 'accepted' as const,
    snapshot: { revision: ++mappingsRevision, status: 'ready' as const, items: [] },
  });
  const controller = new SettingsController({
    settings: {
      read: () => ({ values, workspaceOverrides: [] }),
      update: async (patch) => { values = { ...values, ...patch } as typeof values; },
    },
    consents: {} as never,
    assistant: {
      invalidateActions: () => { intelligenceEvents.push('actions'); },
      beginIntelligenceChange: () => { intelligenceEvents.push('begin'); return 1; },
      finishIntelligenceChange: () => { intelligenceEvents.push('finish'); },
    } as never,
    devices: {} as never,
    mappings: {
      settingsSetAlwaysApproved: async (id, approved, revision) => {
        approvalEvents.push(`${id}:${approved}:${revision}`);
        return acceptedMapping();
      },
    } as never,
    agents: {
      list: () => [agent],
      get: (id) => id === agent.id ? agent : undefined,
      create: async () => { agentEvents.push('create'); return agent; },
      edit: async (_id, draft) => {
        agentEvents.push('edit');
        editedDraft = draft as unknown as Record<string, unknown>;
        return agent;
      },
      duplicate: async () => { agentEvents.push('duplicate'); return agent; },
      setEnabled: async (_id, enabled) => { agentEvents.push(`enabled:${enabled}`); return agent; },
      setDefault: async () => { agentEvents.push('default'); return agent; },
      delete: async () => { agentEvents.push('delete'); },
    } as never,
    credentials: {} as never,
    providerTests: idleProviderTests() as never,
    diagnostics: {} as never,
    nativeUi: {} as never,
    state: {
      get currentSettingsRevision() { return settingsRevision; },
      get currentProviderRevision() { return providerRevision; },
      get currentAgentRevision() { return agentRevision; },
      settingsChanged: () => { settingsRevision += 1; },
      providerChanged: () => { providerRevision += 1; },
      agentChanged: () => { agentRevision += 1; },
      showNotice: (_kind: string, code: string) => { notices.push(code); },
      refresh: async () => undefined,
    } as never,
    publishMic: () => undefined,
    setup: setupWorkflowStub() as never,
  });

  await controller.route({ type: 'settings-provider-select', providerRevision: 0, provider: 'openai' });
  await controller.route({
    type: 'settings-provider-profile', providerRevision: 1, provider: 'openai', enabled: false, model: 'gpt-5',
  });
  await controller.route({
    type: 'settings-provider-profile', providerRevision: 1, provider: 'openai', enabled: true, model: 'stale-model',
  });
  assert.equal(values.assistantProvider, 'openai');
  assert.deepEqual(values.providerProfiles.openai, {
    endpoint: originalEndpoint,
    enabled: false,
    model: 'gpt-5',
  });
  assert.deepEqual(intelligenceEvents, [
    'actions', 'begin', 'finish',
    'actions', 'begin', 'finish',
    'actions',
  ]);

  await controller.route({ type: 'settings-agent-create', agentRevision: 0, templateId: 'friend' });
  await controller.route({
    type: 'settings-agent-update-profile', agentRevision: 1, id: agent.id, provider: 'anthropic', model: 'claude-sonnet-4-6',
  });
  await controller.route({ type: 'settings-agent-duplicate', agentRevision: 2, id: agent.id });
  await controller.route({ type: 'settings-agent-set-enabled', agentRevision: 3, id: agent.id, enabled: false });
  await controller.route({ type: 'settings-agent-set-default', agentRevision: 4, id: agent.id });
  await controller.route({ type: 'settings-agent-delete', agentRevision: 5, id: agent.id });
  assert.deepEqual(agentEvents, ['create', 'edit', 'duplicate', 'enabled:false', 'default', 'delete']);
  assert.deepEqual(editedDraft?.instructions, agent.instructions);
  assert.equal('endpoint' in (editedDraft ?? {}), false);

  await controller.route({
    type: 'settings-mapping-approval', mappingsRevision: 4,
    id: 'vm_abcdefghijklmnopqrstuv', action: 'grant',
  });
  await controller.route({
    type: 'settings-mapping-approval', mappingsRevision: 5,
    id: 'vm_abcdefghijklmnopqrstuv', action: 'revoke',
  });
  assert.deepEqual(approvalEvents, [
    'vm_abcdefghijklmnopqrstuv:true:4',
    'vm_abcdefghijklmnopqrstuv:false:5',
  ]);
  assert.equal(providerRevision, 2);
  assert.equal(agentRevision, 6);
  assert.ok(notices.includes('stale-state'));
  assert.ok(notices.includes('provider-updated'));
  assert.ok(notices.includes('agent-updated'));
  assert.ok(notices.includes('mapping-updated'));
});

test('an accepted off write blocks new remote planning while persistence is pending', async () => {
  let values = { ...SETTINGS_DEFAULTS };
  let remoteUses = 0;
  let settingsRevision = 0;
  const updateStarted = deferred<void>();
  const releaseUpdate = deferred<void>();
  const planning = new AssistantPlanningService({
    credentials: {
      status: async () => ({ provider: 'deepseek', configured: true }),
      use: async () => {
        remoteUses += 1;
        return plan('remote');
      },
    } as never,
    consents: { status: () => ({ id: 'deepseek', acknowledged: true }) },
    settings: { read: () => ({ values, workspaceOverrides: [] }) },
    localize: (english) => english,
    publish: () => undefined,
    log: () => undefined,
  });
  const controller = new SettingsController({
    settings: {
      update: async (patch) => {
        updateStarted.resolve(undefined);
        await releaseUpdate.promise;
        values = { ...values, ...patch };
      },
    },
    consents: {} as never,
    assistant: {
      invalidateActions: () => undefined,
      beginIntelligenceChange: () => planning.beginIntelligenceChange(),
      finishIntelligenceChange: (token) => planning.finishIntelligenceChange(token),
    } as never,
    devices: {} as never,
    mappings: {} as never,
    credentials: {} as never,
    providerTests: {} as never,
    diagnostics: {} as never,
    nativeUi: {} as never,
    state: {
      get currentSettingsRevision() { return settingsRevision; },
      settingsChanged: () => { settingsRevision += 1; },
      showNotice: () => undefined,
      refresh: async () => undefined,
    } as never,
    publishMic: () => undefined,
    setup: setupWorkflowStub() as never,
  });

  const pendingWrite = controller.route({
    type: 'settings-change',
    settingsRevision: 0,
    setting: 'assistantIntelligence',
    value: 'off',
  });
  await updateStarted.promise;
  planning.invalidate(); // An unrelated host invalidation must not reopen the pending gate.

  const fallback = plan('fallback');
  const planned = await planning.create(
    'draft this',
    targetSnapshot(),
    new AbortController().signal,
    fallback,
  );
  assert.equal(planned, fallback);
  assert.equal(remoteUses, 0);

  releaseUpdate.resolve(undefined);
  await pendingWrite;
  assert.equal(values.assistantIntelligence, 'off');
});

test('provider tests keep separate revisions and cancellation authority', async () => {
  const soniox = deferred<'connected'>();
  const deepseek = deferred<'connected'>();
  const service = {
    test: async (provider: 'soniox' | 'deepseek', signal?: AbortSignal) => {
      const category = await (provider === 'soniox' ? soniox.promise : deepseek.promise);
      return {
        provider,
        category: signal?.aborted ? 'cancelled' as const : category,
      };
    },
  };
  const sonioxController = new SettingsProviderTestController('soniox', service, () => {});
  const deepseekController = new SettingsProviderTestController('deepseek', service, () => {});

  const older = sonioxController.handle(1, 'start');
  const current = deepseekController.handle(1, 'start');
  assert.equal(sonioxController.state.phase, 'running');
  assert.equal(deepseekController.state.phase, 'running');
  await sonioxController.handle(2, 'cancel');
  soniox.resolve('connected');
  deepseek.resolve('connected');
  await Promise.all([older, current]);

  assert.deepEqual(sonioxController.state, {
    phase: 'complete',
    operationRevision: 2,
    result: 'cancelled',
  });
  assert.deepEqual(deepseekController.state, {
    phase: 'complete',
    operationRevision: 1,
    result: 'connected',
  });
});

test('a stale native consent modal cannot regrant after a newer mutation', async () => {
  const modal = deferred<boolean>();
  const modalOpened = deferred<void>();
  let serviceRevision = 0;
  let acknowledgements = 0;
  const notices: string[] = [];
  const controller = new SettingsController({
    settings: {
      read: () => ({ values: { ...SETTINGS_DEFAULTS }, workspaceOverrides: [] }),
    } as never,
    consents: {
      revision: () => serviceRevision,
      acknowledgeIfCurrent: async (_consent, expectedRevision) => {
        if (expectedRevision !== serviceRevision) return false;
        acknowledgements += 1;
        serviceRevision += 1;
        return true;
      },
      revoke: async (id) => ({ id, acknowledged: false }),
    },
    assistant: {} as never,
    devices: {} as never,
    mappings: {} as never,
    credentials: {} as never,
    providerTests: {} as never,
    diagnostics: {} as never,
    nativeUi: {
      confirmConsent: async (consent, disclosure) => {
        assert.equal(consent, 'deepseek');
        assert.equal(disclosure?.provider, 'deepseek');
        assert.equal(disclosure?.endpointHost, 'api.deepseek.com');
        modalOpened.resolve(undefined);
        return modal.promise;
      },
    } as never,
    state: {
      currentConsentRevision: 0,
      showNotice: (_kind: string, code: string) => { notices.push(code); },
      refresh: async () => undefined,
    } as never,
    publishMic: () => undefined,
    setup: setupWorkflowStub() as never,
  });

  const pending = controller.route({
    type: 'settings-consent-action',
    consentRevision: 0,
    consent: 'deepseek',
    action: 'acknowledge',
  });
  await modalOpened.promise;
  serviceRevision += 1; // A newer revoke or consent mutation wins while the modal is open.
  modal.resolve(true);
  await pending;

  assert.equal(acknowledgements, 0);
  assert.deepEqual(notices, ['stale-state']);
});

test('provider native disclosure is specific, bilingual, and endpoint-host only', () => {
  const disclosure = {
    provider: 'openai' as const,
    providerName: 'OpenAI',
    endpointHost: 'api.openai.com',
    locality: 'remote' as const,
    fields: [] as never,
    excludes: [] as never,
  };
  const english = providerConsentPrompt(disclosure, (value) => value);
  const hebrew = providerConsentPrompt(disclosure, (_english, value) => value);

  assert.match(english.action, /OpenAI/u);
  assert.match(english.message, /api\.openai\.com/u);
  assert.match(english.message, /post-wake request/u);
  assert.match(english.message, /never sends screenshots/u);
  assert.match(hebrew.message, /api\.openai\.com/u);
  assert.match(hebrew.message, /לעולם אינו שולח/u);
  assert.doesNotMatch(`${english.message}${hebrew.message}`, /https?:|\/v1|credential|api[_ -]?key/iu);
});

test('revoking DeepSeek consent cancels its test and invalidates planning', async () => {
  const events: string[] = [];
  let consentRevision = 0;
  const controller = new SettingsController({
    settings: {} as never,
    consents: {
      revision: () => 0,
      acknowledgeIfCurrent: async () => true,
      revoke: async (id) => { events.push(`revoke:${id}`); return { id, acknowledged: false }; },
    },
    assistant: {
      invalidatePlanning: () => { events.push('authority'); },
      clearProviderError: () => { events.push('planning'); },
    } as never,
    devices: {} as never,
    mappings: {} as never,
    credentials: {} as never,
    providerTests: {
      soniox: {},
      deepseek: { cancelIfRunning: () => { events.push('test'); } },
    } as never,
    diagnostics: {} as never,
    nativeUi: {} as never,
    state: {
      get currentConsentRevision() { return consentRevision; },
      consentChanged: () => { consentRevision += 1; },
      refresh: async () => undefined,
    } as never,
    publishMic: () => undefined,
    setup: setupWorkflowStub() as never,
  });

  await controller.route({
    type: 'settings-consent-action',
    consentRevision: 0,
    consent: 'deepseek',
    action: 'revoke',
  });

  assert.deepEqual(events, ['authority', 'test', 'planning', 'revoke:deepseek']);
  assert.equal(consentRevision, 1);
});

test('Settings construction and refresh never start, test, or grant consent', async () => {
  let starts = 0;
  let tests = 0;
  let acknowledgements = 0;
  const feature = new SettingsFeature({
    settings: {
      read: () => ({ values: { ...SETTINGS_DEFAULTS }, workspaceOverrides: [] }),
      update: async () => undefined,
    } as never,
    credentials: {
      status: async (provider: 'soniox' | 'deepseek') => ({ provider, configured: false }),
    } as never,
    consents: {
      status: (id: 'assistant-listening' | 'deepseek') => ({ id, acknowledged: false }),
      acknowledge: async (id: 'assistant-listening' | 'deepseek') => {
        acknowledgements += 1;
        return { id, acknowledged: true };
      },
    } as never,
    assistant: {
      state: {
        listening: false,
        speaking: false,
        feedback: '',
        targetLabel: '',
        planConfidence: undefined,
        pendingSend: undefined,
        providerBusy: false,
        providerError: undefined,
      },
      start: async () => { starts += 1; },
    } as never,
    devices: { cachedDevices: [], hasCachedResult: false } as never,
    metadata: { state: { models: [], languages: [], loading: false } } as never,
    transcriptions: { abort: () => undefined } as never,
    mappings: {
      settingsSnapshot: () => ({ revision: 0, status: 'ready', items: [] }),
      ...emptyApprovalPort(),
    } as never,
    agents: EMPTY_AGENTS as never,
    credentialOperations: {
      credentialState: () => ({ phase: 'idle', operationRevision: 0 }),
    } as never,
    connectionTests: {
      test: async (provider: 'soniox' | 'deepseek') => {
        tests += 1;
        return { provider, category: 'connected' };
      },
      cancel: () => undefined,
    } as never,
    diagnostics: { result: undefined } as never,
    view: { postState: () => undefined },
    nativeUi: {} as never,
    shortcut: () => 'Alt+M',
    extensionVersion: '1.3.0',
    isWorkspaceTrusted: () => true,
    publishMic: () => undefined,
    startPcmStream: async () => { throw new Error('setup capture must remain closed'); },
  });

  await feature.refresh();

  assert.deepEqual({ starts, tests, acknowledgements }, {
    starts: 0,
    tests: 0,
    acknowledgements: 0,
  });
  feature.dispose();
});

test('credential settings operations stay native, serialized, revisioned, and status-only', async () => {
  const mutations: string[] = [];
  let clearConfirmations = 0;
  const credentials = new CredentialCommandController({
    credentials: {
      set: async (provider, value) => {
        mutations.push(`set:${provider}:${value.length}`);
        return { provider, configured: true };
      },
      clear: async (provider) => {
        mutations.push(`clear:${provider}`);
        return { provider, configured: false };
      },
      status: async (provider) => ({ provider, configured: false }),
    },
    consents: {
      status: () => ({ id: 'deepseek', acknowledged: true }),
      acknowledge: async () => ({ id: 'deepseek', acknowledged: true }),
    },
    ui: {
      confirmDeepSeekDisclosure: async () => true,
      confirmCredentialClear: async () => { clearConfirmations += 1; return true; },
      promptSonioxKey: async () => 'private-soniox-value',
      promptDeepSeekKey: async () => 'private-deepseek-value',
      chooseDeepSeekAction: async () => undefined,
      showInformation: async () => undefined,
      offerSonioxSetup: async () => false,
    },
    clearDeepSeekError: () => undefined,
    publish: () => undefined,
    executeCommand: async () => undefined,
  });

  assert.equal(await credentials.runSettingsOperation('soniox', 'set', 1), 'accepted');
  assert.equal(await credentials.runSettingsOperation('soniox', 'replace', 1), 'stale');
  assert.equal(await credentials.runSettingsOperation('soniox', 'clear', 2), 'accepted');

  assert.deepEqual(mutations, ['set:soniox:20', 'clear:soniox']);
  assert.equal(clearConfirmations, 1);
  assert.deepEqual(credentials.credentialState('soniox'), {
    phase: 'complete',
    operationRevision: 2,
    result: 'cleared',
  });
  assert.doesNotMatch(JSON.stringify(credentials.credentialState('soniox')), /private|soniox-value/iu);
});

test('settings cancels an active provider probe before entering the native credential flow', async () => {
  const operation = deferred<'accepted'>();
  const events: string[] = [];
  const controller = new SettingsController({
    settings: {} as never,
    consents: {} as never,
    assistant: {} as never,
    devices: {} as never,
    mappings: {} as never,
    credentials: {
      runSettingsOperation: () => {
        events.push('credential-flow');
        return operation.promise;
      },
      credentialState: () => ({
        phase: 'complete', operationRevision: 1, result: 'cancelled',
      }),
    },
    providerTests: {
      soniox: {
        cancelIfRunning: () => { events.push('probe-cancelled'); },
      },
    } as never,
    diagnostics: {} as never,
    nativeUi: {} as never,
    state: {
      showNotice: () => undefined,
      refresh: async () => undefined,
    } as never,
    publishMic: () => undefined,
    setup: setupWorkflowStub() as never,
  });

  const pending = controller.route({
    type: 'settings-provider-credential',
    operationRevision: 1,
    provider: 'soniox',
    action: 'replace',
  });
  assert.deepEqual(events, ['probe-cancelled', 'credential-flow']);
  operation.resolve('accepted');
  await pending;
});

test('diagnostics and native navigation remain explicit host-only actions', async () => {
  let diagnosticsRevision = 0;
  let report: { status: 'ready'; checks: []; report: string } | undefined;
  let opened = 0;
  const copied: string[] = [];
  const nativeSettings: Array<string | undefined> = [];
  let keybindings = 0;
  const state = {
    get currentDiagnosticsRevision() { return diagnosticsRevision; },
    setDiagnosticsOperation: (revision: number) => { diagnosticsRevision = revision; },
    showNotice: () => undefined,
    refresh: async () => undefined,
  };
  const diagnostics = {
    get result() { return report; },
    collect: async () => {
      report = { status: 'ready', checks: [], report: 'extension=ok\nplatform=linux' };
      return report;
    },
    open: () => { opened += 1; },
  };
  const controller = new SettingsController({
    settings: {} as never,
    consents: {} as never,
    assistant: {} as never,
    devices: {} as never,
    mappings: {} as never,
    credentials: {} as never,
    providerTests: {} as never,
    diagnostics,
    nativeUi: {
      confirmConsent: async () => false,
      openNativeSettings: async (setting) => { nativeSettings.push(setting); },
      openKeybindings: async () => { keybindings += 1; },
      copyText: async (text) => { copied.push(text); },
    },
    state: state as never,
    publishMic: () => undefined,
    setup: setupWorkflowStub() as never,
  });

  await controller.route({ type: 'settings-diagnostics-action', operationRevision: 1, action: 'run' });
  await controller.route({ type: 'settings-diagnostics-action', operationRevision: 2, action: 'copy' });
  await controller.route({ type: 'settings-diagnostics-action', operationRevision: 3, action: 'open' });
  await controller.route({ type: 'settings-open-native', operationRevision: 0, setting: 'sttModel' });
  await controller.route({ type: 'settings-open-keybindings', operationRevision: 0 });

  assert.equal(diagnosticsRevision, 3);
  assert.deepEqual(copied, ['extension=ok\nplatform=linux']);
  assert.equal(opened, 1);
  assert.deepEqual(nativeSettings, ['sttModel']);
  assert.equal(keybindings, 1);
});

function delayedPrivilegedActionHarness() {
  const confirmation = deferred<boolean>();
  const prompted = deferred<void>();
  const feedback: string[] = [];
  let mutations = 0;
  let publications = 0;
  let sequence = 0;
  const captured: TargetSnapshot = {
    requestedTarget: 'here',
    resolvedTarget: 'focused-control',
    focusedTarget: 'focused-control',
    vscodeFocused: true,
    activeTabIdentity: 'tab-provider-authority',
    activeEditorIdentity: null,
    activeTerminalIdentity: null,
  };
  const actions = new AssistantActionController({
    host: {
      confirmAgentAction: async () => {
        prompted.resolve(undefined);
        return confirmation.promise;
      },
      focusBuiltInChat: async () => false,
      prepareBuiltInChatDraft: async () => undefined,
      hasCommand: async () => true,
      executeCommand: async () => { mutations += 1; },
      activeTerminal: () => undefined,
      hasActiveEditor: () => false,
      injectIntoEditor: async () => false,
      injectIntoFocusedControl: async () => false,
    },
    target: {
      capture: () => captured,
      forRequestedTarget: (snapshot) => snapshot,
    },
    feedback: { speak: (message: string) => { feedback.push(message); } } as AssistantFeedbackController,
    sequence: { next: (prefix: string) => `${prefix}-${++sequence}` } as AssistantIdSequence,
    localize: (english) => english,
    publish: () => { publications += 1; },
    stopAssistant: async () => undefined,
    authority: {
      request: (proposal: unknown) => ({
        status: 'confirmation-required',
        pendingId: 'pending-provider-change',
        permissionTier: 'confirmation-required',
        expiresAt: Date.now() + 30_000,
        preview: proposal,
      }),
      confirm: () => ({
        status: 'authorized',
        authorizationId: 'authorized-provider-change',
        permissionTier: 'confirmation-required',
        mode: 'confirmed',
        expiresAt: Date.now() + 30_000,
      }),
      execute: async (_id: string, _context: unknown, operation: () => PromiseLike<void>) => {
        await operation();
        return { ok: true, value: undefined };
      },
      revoke: () => undefined,
    } as never,
    isWorkspaceTrusted: () => true,
  });
  const planning = {
    nextToken: 0,
    beginIntelligenceChange() { this.nextToken += 1; return this.nextToken; },
    finishIntelligenceChange: () => undefined,
    invalidate: () => undefined,
    clearError: () => undefined,
  };
  const feature = Object.assign(Object.create(AssistantFeature.prototype), {
    actions,
    planning,
  }) as AssistantFeature;
  const pending = actions.execute({
    action: 'open-settings',
    target: 'none',
    content: null,
    spokenReply: '',
    reason: 'Open settings.',
    confidence: 1,
    requiresConfirmation: false,
  }, captured, 'utterance-provider-change');

  return {
    confirmation,
    prompted,
    pending,
    feature,
    assertCancelled: () => {
      assert.equal(mutations, 0);
      assert.deepEqual(feedback, []);
      assert.equal(publications, 0);
      actions.dispose();
    },
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function plan(reason: string): DeepSeekPlan {
  return {
    action: 'answer-only',
    target: 'none',
    content: null,
    spokenReply: '',
    reason,
    confidence: 1,
    requiresConfirmation: false,
  };
}

function targetSnapshot() {
  return {
    requestedTarget: 'here' as const,
    resolvedTarget: 'focused-control' as const,
    vscodeFocused: true,
    activeTabIdentity: 'tab',
    activeEditorIdentity: null,
    activeTerminalIdentity: null,
  };
}
