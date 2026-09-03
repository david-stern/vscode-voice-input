import assert from 'node:assert/strict';
import test from 'node:test';

import { SETTINGS_DEFAULTS } from '../src/config';
import { ControlCenterManagementBridge } from '../src/platform/controlCenterManagement';
import { ControlCenterStateCoordinator } from '../src/platform/controlCenterStateCoordinator';

test('management bridge translates browser intents to revision-gated Settings messages', async () => {
  const routed: unknown[] = [];
  const feature = {
    route: async (message: unknown) => { routed.push(message); },
    refresh: async () => undefined,
  };
  const bridge = new ControlCenterManagementBridge(
    { postState: () => undefined },
    () => feature as never,
  );
  bridge.view.postState({
    providers: {
      revision: 7,
      items: [{
        id: 'openai',
        credential: { phase: 'idle', operationRevision: 3 },
        test: { phase: 'idle', operationRevision: 5 },
      }],
    },
    privacy: { consentRevision: 11 },
    agents: { revision: 13 },
  } as never);

  await bridge.planningProvider({
    type: 'planningProviderIntent', revision: 1,
    provider: 'openai', operation: 'select',
  });
  await bridge.planningProvider({
    type: 'planningProviderIntent', revision: 1,
    provider: 'openai', operation: 'save-profile', enabled: false, model: 'gpt-5.4',
  });
  await bridge.planningProvider({
    type: 'planningProviderIntent', revision: 1,
    provider: 'openai', operation: 'replace-credential',
  });
  await bridge.planningProvider({
    type: 'planningProviderIntent', revision: 1,
    provider: 'openai', operation: 'test',
  });
  await bridge.planningProvider({
    type: 'planningProviderIntent', revision: 1,
    provider: 'openai', operation: 'review-consent',
  });
  await bridge.agentManagement({
    type: 'agentManagementIntent', revision: 1,
    operation: 'create', templateId: 'teacher-lecturer',
  });
  await bridge.agentManagement({
    type: 'agentManagementIntent', revision: 1,
    operation: 'update-profile', id: 'agent_abcdefghijkl', provider: 'openai', model: 'gpt-5.4',
  });
  await bridge.agentManagement({
    type: 'agentManagementIntent', revision: 1,
    operation: 'set-enabled', id: 'agent_abcdefghijkl', enabled: false,
  });

  assert.deepEqual(routed, [
    { type: 'settings-provider-select', providerRevision: 7, provider: 'openai' },
    {
      type: 'settings-provider-profile', providerRevision: 7,
      provider: 'openai', enabled: false, model: 'gpt-5.4',
    },
    {
      type: 'settings-provider-credential', operationRevision: 4,
      provider: 'openai', action: 'replace',
    },
    {
      type: 'settings-provider-test', operationRevision: 6,
      provider: 'openai', action: 'start',
    },
    {
      type: 'settings-consent-action', consentRevision: 11,
      consent: 'openai', action: 'acknowledge',
    },
    {
      type: 'settings-agent-create', agentRevision: 13,
      templateId: 'teacher-lecturer',
    },
    {
      type: 'settings-agent-update-profile', agentRevision: 13,
      id: 'agent_abcdefghijkl', provider: 'openai', model: 'gpt-5.4',
    },
    {
      type: 'settings-agent-set-enabled', agentRevision: 13,
      id: 'agent_abcdefghijkl', enabled: false,
    },
  ]);
});

test('coordinator projects bounded management pages and uses current mapping revisions', async () => {
  const mappingCalls: unknown[] = [];
  const customItems = Array.from({ length: 11 }, (_, index) => ({
    id: `vm_${String(index).padStart(22, 'a')}`,
    label: `Custom ${index}`,
    description: '',
    phrases: [`phrase ${index}`],
    kind: 'command' as const,
    targetId: 'editor.action.copyLinesDownAction',
    enabled: index !== 10,
    agentEnabled: false,
  }));
  let mappingStatus: 'ready' | 'untrusted' = 'ready';
  const mappingSnapshot = () => ({ revision: 17, status: mappingStatus, items: customItems });
  let pendingBuiltin: { commandId: string; label: { en: string; he: string } } | undefined;
  let pendingAction: { id: string; label: string } | undefined;
  const pendingDecisions: string[] = [];
  const settings = {
    ...SETTINGS_DEFAULTS,
    uiLanguage: 'en' as const,
    assistantProvider: 'openai' as const,
    assistantSpeechEnabled: true,
  };
  let setupSttDecision: 'pending' | 'none' | 'soniox' = 'none';
  let autoFingerprint = 'auto:ready';
  let setupProjection = {
    microphoneState: 'untested' as const,
    microphoneLabel: '',
    systemTtsEnabled: true,
    systemTtsVoiceIndex: -1,
    systemTtsRate: 1,
    stepStates: ['pending', 'pending', 'pending', 'pending'] as const,
    recommendedStep: 1 as const,
  };
  const coordinator = new ControlCenterStateCoordinator({
    settings: {
      read: () => ({ values: settings, workspaceOverrides: [] }),
    },
    credentials: {
      status: async (provider: string) => ({ provider, configured: provider === 'openai' }),
    },
    consents: {
      status: (provider: string) => ({ id: provider, acknowledged: provider === 'openai' }),
    },
    sonioxConsent: { capture: async () => undefined },
    autoMode: { snapshot: () => ({ effective: false, fingerprint: autoFingerprint }) },
    setupChoices: {
      snapshot: () => ({ schemaVersion: 1, stt: setupSttDecision, tts: 'pending' }),
      recordStt: async (decision: 'none' | 'soniox') => { setupSttDecision = decision; },
    },
    builtins: {
      isKnownCommandId: (commandId: string) => commandId === 'command.2',
      commandRows: async () => ({ filteredCount: 0, rows: [] }),
    },
    mappings: {
      get pendingAction() { return pendingAction; },
      get pendingBuiltin() { return pendingBuiltin; },
      settingsSnapshot: mappingSnapshot,
      settingsAddVisible: async (draft: unknown, revision: number) => {
        mappingCalls.push(['add', draft, revision]);
        return { status: 'accepted', snapshot: mappingSnapshot() };
      },
      settingsEditVisible: async (id: string, draft: unknown, revision: number) => {
        mappingCalls.push(['edit', id, draft, revision]);
        return { status: 'accepted', snapshot: mappingSnapshot() };
      },
      settingsToggleEnabled: async (id: string, revision: number) => {
        mappingCalls.push(['toggle', id, revision]);
        return { status: 'accepted', snapshot: mappingSnapshot() };
      },
      settingsDelete: async (id: string, revision: number) => {
        mappingCalls.push(['delete', id, revision]);
        return { status: 'accepted', snapshot: mappingSnapshot() };
      },
    },
    agents: {
      defaultId: 'agent_abcdefghijkl',
      isCorrupted: false,
      list: () => [{
        id: 'agent_abcdefghijkl',
        name: 'Teacher',
        description: { en: 'Explains clearly', he: 'מסביר בבירור' },
        provider: 'openai',
        model: 'gpt-5.4',
        enabled: true,
        instructions: { en: 'Be clear', he: 'היה ברור' },
      }],
    },
    devices: { hasCachedResult: false, cachedDevices: [], selectionStatus: undefined },
    latestTranscript: async () => undefined,
    enableAuto: async () => false,
    disableAuto: async () => undefined,
    setupSoniox: async () => undefined,
    selectNoProvider: async () => undefined,
    microphone: async () => undefined,
    confirmPending: async (kind: string) => {
      pendingDecisions.push(`confirm:${kind}`);
      if (kind === 'builtin') pendingBuiltin = undefined;
      else pendingAction = undefined;
    },
    cancelPending: () => {
      pendingDecisions.push('cancel');
      pendingBuiltin = undefined;
      pendingAction = undefined;
    },
    planningProvider: async () => undefined,
    agentManagement: async () => undefined,
    operations: {
      setupState: () => setupProjection,
      diagnosticsState: () => ({ status: 'idle', summary: '', checks: [], canOpen: false, canCopy: false }),
      systemTtsState: () => 'configured-unverified',
      microphone: async () => undefined,
      observeVoices: () => undefined,
      systemTts: async () => undefined,
      diagnostics: async () => undefined,
    },
    publish: () => undefined,
    log: () => undefined,
  } as never);

  const providers = await coordinator.readPlanningProviders();
  assert.equal(providers.selectedProvider, 'openai');
  assert.equal(providers.items.length, 8);
  assert.equal(providers.items.find(({ id }) => id === 'openai')?.credentialConfigured, true);
  assert.deepEqual(
    providers.items.find(({ id }) => id === 'ollama'),
    {
      id: 'ollama', name: 'Ollama', enabled: true, model: 'gpt-oss',
      locality: 'local-loopback', credentialRequired: false, credentialConfigured: true,
      consentRequired: false, consentAcknowledged: true,
    },
  );
  assert.deepEqual(coordinator.readAgentPage(1), {
    totalCount: 1,
    rows: [{
      id: 'agent_abcdefghijkl', name: 'Teacher', description: 'Explains clearly',
      provider: 'openai', model: 'gpt-5.4', enabled: true, isDefault: true,
      instructionsConfigured: true,
    }],
  });
  assert.equal(coordinator.readCustomCommandPage(2).rows.length, 1);
  assert.equal((await coordinator.readCompactState()).providerStatus, 'system-voice');
  assert.deepEqual(coordinator.readSetupState(), {
    microphoneState: 'untested', microphoneLabel: '', systemTtsEnabled: true,
    systemTtsVoiceIndex: -1, systemTtsRate: 1,
    stepStates: ['pending', 'complete', 'pending', 'complete'], recommendedStep: 1,
  });
  setupProjection = {
    microphoneState: 'signal-detected', microphoneLabel: 'Desk microphone',
    systemTtsEnabled: false, systemTtsVoiceIndex: -1, systemTtsRate: 1,
    stepStates: ['complete', 'pending', 'complete', 'pending'], recommendedStep: 2,
  };
  assert.deepEqual(coordinator.readSetupState().stepStates, [
    'complete', 'complete', 'complete', 'complete',
  ]);
  assert.equal(coordinator.readSetupState().recommendedStep, 4);
  autoFingerprint = 'auto:uninitialized';
  assert.deepEqual(coordinator.readSetupState().stepStates, [
    'complete', 'complete', 'complete', 'pending',
  ]);
  autoFingerprint = 'auto:ready';
  mappingStatus = 'untrusted';
  assert.deepEqual(coordinator.readSetupState().stepStates, [
    'complete', 'complete', 'complete', 'attention',
  ]);
  mappingStatus = 'ready';
  setupSttDecision = 'pending';
  assert.deepEqual(coordinator.readSetupState().stepStates, [
    'complete', 'pending', 'complete', 'complete',
  ]);
  assert.equal(coordinator.readSetupState().recommendedStep, 2);
  await coordinator.handleIntent({
    type: 'providerSetupIntent', revision: 1, provider: 'none', request: 'select',
  });
  // Provider setup crosses native prompts, so it runs detached from the message queue.
  await coordinator.whenIdle();
  assert.equal(setupSttDecision, 'none');
  assert.deepEqual(coordinator.readSetupState().stepStates, [
    'complete', 'complete', 'complete', 'complete',
  ]);

  await coordinator.handleIntent({
    type: 'customCommandIntent', revision: 1, operation: 'add',
    label: 'New', description: '', phrases: ['new phrase'], kind: 'command',
    targetId: 'editor.action.copyLinesDownAction', enabled: true, agentEnabled: false,
  });
  await coordinator.handleIntent({
    type: 'customCommandIntent', revision: 1, operation: 'edit', id: customItems[0].id,
    label: 'Edited', description: '', phrases: ['edited phrase'], kind: 'command',
    targetId: 'editor.action.copyLinesDownAction', enabled: true, agentEnabled: false,
  });
  await coordinator.handleIntent({
    type: 'customCommandIntent', revision: 1, operation: 'set-enabled',
    id: customItems[0].id, enabled: true,
  });
  await coordinator.handleIntent({
    type: 'customCommandIntent', revision: 1, operation: 'set-enabled',
    id: customItems[10].id, enabled: true,
  });
  await coordinator.handleIntent({
    type: 'customCommandIntent', revision: 1, operation: 'delete', id: customItems[1].id,
  });
  assert.deepEqual(mappingCalls, [
    ['add', {
      type: 'customCommandIntent', revision: 1, operation: 'add',
      label: 'New', description: '', phrases: ['new phrase'], kind: 'command',
      targetId: 'editor.action.copyLinesDownAction', enabled: true, agentEnabled: false,
    }, 17],
    ['edit', customItems[0].id, {
      type: 'customCommandIntent', revision: 1, operation: 'edit', id: customItems[0].id,
      label: 'Edited', description: '', phrases: ['edited phrase'], kind: 'command',
      targetId: 'editor.action.copyLinesDownAction', enabled: true, agentEnabled: false,
    }, 17],
    ['toggle', customItems[10].id, 17],
    ['delete', customItems[1].id, 17],
  ]);

  pendingBuiltin = { commandId: 'command.2', label: { en: 'Copy', he: 'העתקה' } };
  assert.deepEqual(coordinator.readSetupState().stepStates, [
    'complete', 'complete', 'complete', 'attention',
  ]);
  assert.equal(coordinator.readSetupState().recommendedStep, 4);
  assert.deepEqual(await coordinator.handleIntent({
    type: 'pendingReviewIntent', revision: 2, decision: 'request-native-confirmation',
  }), {
    refresh: true,
    focusTarget: { kind: 'command-row', commandId: 'command.2' },
  });
  pendingAction = { id: customItems[0].id, label: 'Custom 0' };
  assert.deepEqual(await coordinator.handleIntent({
    type: 'pendingReviewIntent', revision: 3, decision: 'cancel',
  }), {
    refresh: true,
    focusTarget: { kind: 'pending-custom-review' },
  });
  // The builtin confirmation is a detached native modal; cancel stays synchronous.
  await coordinator.whenIdle();
  assert.deepEqual(pendingDecisions, ['confirm:builtin', 'cancel']);
});
