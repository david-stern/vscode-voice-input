import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ConsentService,
  SETTINGS_DEFAULTS,
  type AssistantIntelligence,
} from '../src/config';
import type { DeepSeekPlan } from '../src/assistant/deepseek';
import { AssistantPlanningService } from '../src/features/assistant/planningService';
import { AssistantFeedbackController } from '../src/features/assistant/feedbackController';
import { AssistantIdSequence } from '../src/features/assistant/idSequence';
import {
  CredentialChangeAuthorityGate,
  CredentialCommandController,
} from '../src/features/commands/credentialController';
import { HostInvalidationController } from '../src/features/commands/hostInvalidationController';
import { MicMessageRouter } from '../src/features/commands/micMessageRouter';
import { registerVoiceInputCommands } from '../src/features/commands/registerCommands';
import { HostRuntimeLifecycle } from '../src/features/commands/runtimeLifecycle';
import { DiagnosticsService } from '../src/features/diagnostics';
import { TranscriptionMetadataService } from '../src/features/recording/metadataService';
import { HostStatePublisher } from '../src/features/state';
import type { ViewState } from '../src/webview/protocol';

test('credential controller requires DeepSeek consent before opening the secret prompt', async () => {
  let prompted = 0;
  let published = 0;
  const controller = new CredentialCommandController({
    credentials: {
      set: async (provider) => ({ provider, configured: true }),
      clear: async (provider) => ({ provider, configured: false }),
      status: async (provider) => ({ provider, configured: false }),
    },
    consents: {
      status: () => ({ id: 'deepseek', acknowledged: false }),
      revision: () => 0,
      acknowledgeIfCurrent: async () => true,
    },
    ui: {
      confirmDeepSeekDisclosure: async () => false,
      confirmCredentialClear: async () => true,
      promptSonioxKey: async () => undefined,
      promptDeepSeekKey: async () => { prompted += 1; return 'private-key'; },
      chooseDeepSeekAction: async () => undefined,
      showInformation: async () => undefined,
      offerSonioxSetup: async () => false,
    },
    clearDeepSeekError: () => {},
    publish: () => { published += 1; },
    executeCommand: async () => undefined,
  });

  await controller.setDeepSeek();

  assert.equal(prompted, 0);
  assert.equal(published, 2);
});

test('a stale credential dialog cannot restore a key after a newer clear', async () => {
  const keyPrompt = deferred<string | undefined>();
  const mutations: string[] = [];
  const controller = new CredentialCommandController({
    credentials: {
      set: async (provider) => {
        mutations.push(`set:${provider}`);
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
      revision: () => 0,
      acknowledgeIfCurrent: async () => true,
    },
    ui: {
      confirmDeepSeekDisclosure: async () => true,
      confirmCredentialClear: async () => true,
      promptSonioxKey: () => keyPrompt.promise,
      promptDeepSeekKey: async () => undefined,
      chooseDeepSeekAction: async () => undefined,
      showInformation: async () => undefined,
      offerSonioxSetup: async () => false,
    },
    clearDeepSeekError: () => {},
    publish: () => {},
    executeCommand: async () => undefined,
  });

  const staleSet = controller.setSoniox();
  await controller.clearSoniox();
  keyPrompt.resolve('private-key');
  await staleSet;

  assert.deepEqual(mutations, ['clear:soniox']);
});

test('credential authority closes before native disclosure or key prompts and reopens last', async () => {
  const keyPrompt = deferred<string | undefined>();
  const events: string[] = [];
  const controller = new CredentialCommandController({
    credentials: {
      set: async (provider) => ({ provider, configured: true }),
      clear: async (provider) => ({ provider, configured: false }),
      status: async (provider) => ({ provider, configured: true }),
    },
    consents: {
      status: () => ({ id: 'deepseek', acknowledged: true }),
      revision: () => 0,
      acknowledgeIfCurrent: async () => true,
    },
    ui: {
      confirmDeepSeekDisclosure: async () => true,
      confirmCredentialClear: async () => true,
      promptSonioxKey: async () => undefined,
      promptDeepSeekKey: () => { events.push('prompt'); return keyPrompt.promise; },
      chooseDeepSeekAction: async () => undefined,
      showInformation: async () => undefined,
      offerSonioxSetup: async () => false,
    },
    beginCredentialChange: () => {
      events.push('authority-closed');
      return { dispose: () => { events.push('authority-open'); } };
    },
    clearDeepSeekError: () => {},
    publish: () => { events.push('publish'); },
    executeCommand: async () => undefined,
  });

  const pending = controller.setDeepSeek();
  await waitFor(() => events.includes('prompt'));

  assert.equal(controller.isChanging('deepseek'), true);
  assert.deepEqual(events, ['authority-closed', 'publish', 'prompt']);
  keyPrompt.resolve(undefined);
  await pending;
  assert.deepEqual(events, [
    'authority-closed',
    'publish',
    'prompt',
    'publish',
    'authority-open',
  ]);
});

test('overlapping provider prompts retain a single authority gate until the last release', () => {
  const events: string[] = [];
  let token = 0;
  const gate = new CredentialChangeAuthorityGate(
    () => { events.push('closed'); return ++token; },
    (released) => { events.push(`open:${released}`); },
  );

  const first = gate.acquire();
  const second = gate.acquire();
  first.dispose();
  first.dispose();
  assert.deepEqual(events, ['closed']);
  second.dispose();
  assert.deepEqual(events, ['closed', 'open:1']);
});

test('newer DeepSeek planning owns busy and error state until it completes', async () => {
  const firstPlan = deferred<DeepSeekPlan>();
  const secondPlan = deferred<DeepSeekPlan>();
  let uses = 0;
  const planning = new AssistantPlanningService({
    credentials: {
      status: async () => ({ provider: 'deepseek', configured: true }),
      use: async () => {
        uses += 1;
        return uses === 1 ? firstPlan.promise : secondPlan.promise;
      },
    } as never,
    consents: { status: () => ({ id: 'deepseek', acknowledged: true }) },
    settings: {
      read: () => ({ values: { ...SETTINGS_DEFAULTS }, workspaceOverrides: [] }),
    },
    localize: (english) => english,
    publish: () => {},
    log: () => {},
  });
  const fallback = plan('fallback');
  const target = {
    requestedTarget: 'here' as const,
    resolvedTarget: 'focused-control' as const,
    vscodeFocused: true,
    activeTabIdentity: 'tab',
    activeEditorIdentity: null,
    activeTerminalIdentity: null,
  };

  const older = planning.create('first', target, new AbortController().signal, fallback);
  await waitFor(() => uses === 1);
  const newer = planning.create('second', target, new AbortController().signal, fallback);
  await waitFor(() => uses === 2);
  firstPlan.resolve(plan('older'));
  await older;
  assert.equal(planning.isBusy, true);
  assert.equal(planning.error, undefined);

  secondPlan.resolve(plan('newer'));
  await newer;
  assert.equal(planning.isBusy, false);
  assert.equal(planning.error, undefined);
});

test('assistant intelligence off bypasses DeepSeek while the default still uses it', async () => {
  const fallback = plan('fallback');
  const target = {
    requestedTarget: 'here' as const,
    resolvedTarget: 'focused-control' as const,
    vscodeFocused: true,
    activeTabIdentity: 'tab',
    activeEditorIdentity: null,
    activeTerminalIdentity: null,
  };
  const calls = { consent: 0, status: 0, use: 0 };
  const createPlanning = (assistantIntelligence: AssistantIntelligence) => new AssistantPlanningService({
    credentials: {
      status: async () => {
        calls.status += 1;
        return { provider: 'deepseek', configured: true };
      },
      use: async () => {
        calls.use += 1;
        return plan('deepseek');
      },
    } as never,
    consents: {
      status: () => {
        calls.consent += 1;
        return { id: 'deepseek', acknowledged: true };
      },
    },
    settings: {
      read: () => ({
        values: { ...SETTINGS_DEFAULTS, assistantIntelligence },
        workspaceOverrides: [],
      }),
    },
    localize: (english) => english,
    publish: () => {},
    log: () => {},
  });

  const disabledPlanning = createPlanning('off');
  const empty = await disabledPlanning.create(
    '   ',
    target,
    new AbortController().signal,
    fallback,
  );
  assert.equal(empty.reason, 'No request followed the wake phrase.');

  const disabled = await disabledPlanning.create(
    'draft this',
    target,
    new AbortController().signal,
    fallback,
  );
  assert.equal(disabled, fallback);
  assert.deepEqual(calls, { consent: 0, status: 0, use: 0 });

  assert.equal(SETTINGS_DEFAULTS.assistantIntelligence, 'deepseek');
  const enabled = await createPlanning(SETTINGS_DEFAULTS.assistantIntelligence).create(
    'draft this',
    target,
    new AbortController().signal,
    fallback,
  );
  assert.equal(enabled.reason, 'deepseek');
  assert.deepEqual(calls, { consent: 1, status: 1, use: 1 });
});

test('turning assistant intelligence off invalidates a pending credential check before provider use', async () => {
  const pendingStatus = deferred<{ provider: 'deepseek'; configured: boolean }>();
  let useCalls = 0;
  let values = { ...SETTINGS_DEFAULTS };
  const planning = new AssistantPlanningService({
    credentials: {
      status: async () => pendingStatus.promise,
      use: async () => { useCalls += 1; return plan('remote'); },
    },
    consents: { status: () => ({ id: 'deepseek', acknowledged: true }) },
    settings: { read: () => ({ values, workspaceOverrides: [] }) },
    localize: (english) => english,
    publish: () => undefined,
    log: () => undefined,
  });
  const fallback = plan('fallback');
  const request = planning.create(
    'draft this',
    {
      requestedTarget: 'here',
      resolvedTarget: 'focused-control',
      vscodeFocused: true,
      activeTabIdentity: 'tab',
      activeEditorIdentity: null,
      activeTerminalIdentity: null,
    },
    new AbortController().signal,
    fallback,
  );
  await Promise.resolve();
  values = { ...values, assistantIntelligence: 'off' };
  planning.invalidate();
  pendingStatus.resolve({ provider: 'deepseek', configured: true });

  assert.equal(await request, fallback);
  assert.equal(useCalls, 0);
});

test('planning revalidates assistant intelligence immediately before credential use', async () => {
  let useCalls = 0;
  let values = { ...SETTINGS_DEFAULTS };
  const planning = new AssistantPlanningService({
    credentials: {
      status: async () => {
        values = { ...values, assistantIntelligence: 'off' };
        return { provider: 'deepseek', configured: true };
      },
      use: async () => { useCalls += 1; return plan('remote'); },
    },
    consents: { status: () => ({ id: 'deepseek', acknowledged: true }) },
    settings: { read: () => ({ values, workspaceOverrides: [] }) },
    localize: (english) => english,
    publish: () => undefined,
    log: () => undefined,
  });
  const fallback = plan('fallback');

  assert.equal(await planning.create(
    'draft this',
    {
      requestedTarget: 'here',
      resolvedTarget: 'focused-control',
      vscodeFocused: true,
      activeTabIdentity: 'tab',
      activeEditorIdentity: null,
      activeTerminalIdentity: null,
    },
    new AbortController().signal,
    fallback,
  ), fallback);
  assert.equal(useCalls, 0);
});

test('a pending persisted revoke blocks new DeepSeek planning immediately', async () => {
  const persisted = new Map<string, unknown>();
  let holdWrites = false;
  const release = deferred<void>();
  const consents = new ConsentService({
    get: <T>(key: string, fallback: T) => (
      persisted.has(key) ? persisted.get(key) as T : fallback
    ),
    update: async (key, value) => {
      if (holdWrites) await release.promise;
      persisted.set(key, value);
    },
  });
  await consents.acknowledge('deepseek');
  holdWrites = true;
  let remoteUses = 0;
  const planning = new AssistantPlanningService({
    credentials: {
      status: async () => ({ provider: 'deepseek', configured: true }),
      use: async () => { remoteUses += 1; return plan('remote'); },
    } as never,
    consents,
    settings: {
      read: () => ({ values: { ...SETTINGS_DEFAULTS }, workspaceOverrides: [] }),
    },
    localize: (english) => english,
    publish: () => {},
    log: () => {},
  });

  const revoke = consents.revoke('deepseek');
  const fallback = plan('fallback');
  const result = await planning.create('request', {
    requestedTarget: 'here',
    resolvedTarget: 'focused-control',
    vscodeFocused: true,
    activeTabIdentity: 'tab',
    activeEditorIdentity: null,
    activeTerminalIdentity: null,
  }, new AbortController().signal, fallback);

  assert.equal(result, fallback);
  assert.equal(remoteUses, 0);
  release.resolve(undefined);
  await revoke;
});

test('stale speech lifecycle IDs cannot finish a newer queued utterance', () => {
  const delivered: string[] = [];
  const feedback = new AssistantFeedbackController({
    settings: {
      read: () => ({ values: { ...SETTINGS_DEFAULTS }, workspaceOverrides: [] }),
    },
    sequence: new AssistantIdSequence(),
    speech: {
      postSpeak: (id) => { delivered.push(id); return 'queued'; },
      cancelSpeaking: () => true,
    },
    status: { showFeedback: () => undefined },
    publish: () => undefined,
    log: () => undefined,
  });

  feedback.speak('first');
  feedback.speak('second');
  assert.equal(feedback.isSpeaking, true);
  feedback.speechFinished(delivered[0], 'completed');
  assert.equal(feedback.isSpeaking, true);
  feedback.speechStarted(delivered[1]);
  feedback.speechFinished(delivered[1], 'completed');
  assert.equal(feedback.isSpeaking, false);
});

test('active-agent speech disablement is enforced before browser delivery', () => {
  let deliveries = 0;
  const feedback = new AssistantFeedbackController({
    settings: {
      read: () => ({ values: { ...SETTINGS_DEFAULTS }, workspaceOverrides: [] }),
    },
    sequence: new AssistantIdSequence(),
    speech: {
      postSpeak: () => { deliveries += 1; return 'sent'; },
      cancelSpeaking: () => true,
    },
    status: { showFeedback: () => undefined },
    agentSpeech: () => ({ enabled: false, voiceUri: 'agent-voice', rate: 1.4 }),
    publish: () => undefined,
    log: () => undefined,
  });

  feedback.speak('visible but silent feedback');
  assert.equal(feedback.message, 'visible but silent feedback');
  assert.equal(feedback.isSpeaking, false);
  assert.equal(deliveries, 0);
});

test('host invalidation revokes stale authority and refreshes both views on external changes', () => {
  const events: string[] = [];
  let transitioning = true;
  const controller = new HostInvalidationController({
    isTargetTransitioning: () => transitioning,
    clearPendingSend: () => events.push('send'),
    cancelMapping: () => events.push('mapping'),
    invalidatePlanning: () => events.push('planning'),
    stopAssistant: async () => { events.push('assistant-stop'); },
    publish: () => events.push('publish'),
    publishSettings: (reason) => events.push(`settings:${reason}`),
  });

  controller.targetChanged();
  assert.deepEqual(events, []);
  transitioning = false;
  controller.windowFocusChanged(false);
  assert.deepEqual(events, ['send', 'mapping']);
  controller.configurationChanged(false);
  assert.deepEqual(events, ['send', 'mapping']);
  controller.configurationChanged(true, false);
  controller.configurationChanged(true, true);
  controller.workspaceTrustGranted();
  assert.deepEqual(events, [
    'send',
    'mapping',
    'mapping',
    'planning',
    'publish',
    'settings:configuration',
    'mapping',
    'planning',
    'assistant-stop',
    'publish',
    'settings:configuration',
    'mapping',
    'planning',
    'assistant-stop',
    'publish',
    'settings:trust',
  ]);
});

test('runtime lifecycle starts once and disposes host resources in authority-first order', async () => {
  const events: string[] = [];
  const runtime = new HostRuntimeLifecycle({
    metadata: { refresh: async () => { events.push('metadata'); } },
    devices: { get: async () => { events.push('devices'); return []; } },
    credentials: { offerInitialSonioxSetup: async () => { events.push('setup'); } },
    credentialStore: { dispose: () => { events.push('credential-store'); } },
    state: { invalidate: () => { events.push('state'); } },
    settings: {
      refresh: async () => { events.push('settings-refresh'); },
      dispose: () => { events.push('settings-dispose'); },
    },
    recording: { dispose: () => { events.push('recording'); } },
    assistant: { dispose: () => { events.push('assistant'); } },
    mappings: { dispose: () => { events.push('mappings'); } },
    transcriptions: { abortAll: () => { events.push('transcriptions'); } },
    setDeactivating: () => { events.push('deactivating'); },
    log: () => {},
  });

  await runtime.start();
  await runtime.start();
  runtime.dispose();
  runtime.dispose();

  assert.deepEqual(events, [
    'metadata',
    'devices',
    'settings-refresh',
    'setup',
    'deactivating',
    'state',
    'transcriptions',
    'credential-store',
    'settings-dispose',
    'recording',
    'assistant',
    'mappings',
  ]);
});

test('startup resume requires every readiness gate and rechecks credentials without prompting', async () => {
  const cases = [
    { name: 'not opted in', enabled: false, trusted: true, consent: true, devices: 1, kind: 'default', credentials: [true, true], starts: 0, setups: 0 },
    { name: 'untrusted', enabled: true, trusted: false, consent: true, devices: 1, kind: 'default', credentials: [true, true], starts: 0, setups: 0 },
    { name: 'missing consent', enabled: true, trusted: true, consent: false, devices: 1, kind: 'default', credentials: [true, true], starts: 0, setups: 0 },
    { name: 'missing credential', enabled: true, trusted: true, consent: true, devices: 1, kind: 'default', credentials: [false], starts: 0, setups: 0 },
    { name: 'credential lost during recheck', enabled: true, trusted: true, consent: true, devices: 1, kind: 'default', credentials: [true, false], starts: 0, setups: 0 },
    { name: 'no microphone', enabled: true, trusted: true, consent: true, devices: 0, kind: 'default', credentials: [true, true], starts: 0, setups: 0 },
    { name: 'stale microphone', enabled: true, trusted: true, consent: true, devices: 1, kind: 'stale', credentials: [true, true], starts: 0, setups: 0 },
    { name: 'ready', enabled: true, trusted: true, consent: true, devices: 1, kind: 'available', credentials: [true, true], starts: 1, setups: 0 },
  ] as const;

  for (const scenario of cases) {
    let starts = 0;
    let setups = 0;
    let credentialReads = 0;
    const runtime = new HostRuntimeLifecycle({
      metadata: { refresh: async () => undefined },
      devices: { get: async () => Array.from({ length: scenario.devices }, () => ({ id: 'mic', label: 'Mic' })) },
      credentials: { offerInitialSonioxSetup: async () => { setups += 1; } },
      credentialStore: { dispose: () => undefined },
      state: { invalidate: () => undefined },
      settings: { refresh: async () => undefined, dispose: () => undefined },
      recording: { dispose: () => undefined },
      assistant: { dispose: () => undefined },
      mappings: { dispose: () => undefined },
      transcriptions: { abortAll: () => undefined },
      setDeactivating: () => undefined,
      log: () => undefined,
      startupResume: {
        settings: {
          read: () => ({
            values: { ...SETTINGS_DEFAULTS, assistantResumeOnStartup: scenario.enabled },
            workspaceOverrides: [],
          }),
        },
        consents: {
          status: () => ({ id: 'assistant-listening', acknowledged: scenario.consent }),
        },
        credentials: {
          status: async () => ({
            provider: 'soniox',
            configured: scenario.credentials[Math.min(credentialReads++, scenario.credentials.length - 1)],
          }),
        },
        devices: { selectionStatus: { kind: scenario.kind } as never },
        workspaceTrusted: () => scenario.trusted,
        start: async () => { starts += 1; },
      },
    });

    await runtime.start();
    assert.deepEqual({ starts, setups }, {
      starts: scenario.starts,
      setups: scenario.setups,
    }, scenario.name);
  }
});

test('command registration preserves stable IDs while invoking only injected workflows', async () => {
  const callbacks = new Map<string, () => unknown>();
  const calls: string[] = [];
  const disposables = registerVoiceInputCommands({
    registerCommand: (commandId, callback) => {
      callbacks.set(commandId, callback);
      return { dispose: () => { calls.push(`dispose:${commandId}`); } };
    },
  }, {
    recording: { toggle: async () => { calls.push('recording'); } },
    assistant: { toggle: async () => { calls.push('assistant'); } },
    mappings: { manage: async () => { calls.push('mappings'); } },
    credentials: {
      setSoniox: async () => { calls.push('set-soniox'); },
      clearSoniox: async () => { calls.push('clear-soniox'); },
      setDeepSeek: async () => { calls.push('set-deepseek'); },
      clearDeepSeek: async () => { calls.push('clear-deepseek'); },
    },
    selectAudioDevice: async () => { calls.push('audio'); },
    clearHistory: async () => { calls.push('history'); },
    manageAssistantProvider: async () => { calls.push('manage-provider'); },
    testAssistantProvider: async () => { calls.push('test-provider'); },
    diagnostics: { run: async () => { calls.push('diagnostics'); return {} as never; } },
  });

  assert.deepEqual([...callbacks.keys()], [
    'voiceInput.toggleRecording',
    'voiceInput.toggleAssistant',
    'voiceInput.manageCustomMappings',
    'voiceInput.selectAudioDevice',
    'voiceInput.setApiKey',
    'voiceInput.clearApiKey',
    'voiceInput.setDeepSeekApiKey',
    'voiceInput.clearDeepSeekApiKey',
    'voiceInput.clearHistory',
    'voiceInput.manageAssistantProvider',
    'voiceInput.testAssistantProvider',
    'voiceInput.showDiagnostics',
  ]);
  for (const callback of callbacks.values()) await callback();
  assert.deepEqual(calls, [
    'recording',
    'assistant',
    'mappings',
    'audio',
    'set-soniox',
    'clear-soniox',
    'set-deepseek',
    'clear-deepseek',
    'history',
    'manage-provider',
    'test-provider',
    'diagnostics',
  ]);
  disposables.forEach((disposable) => disposable.dispose());
  assert.equal(calls.filter((call) => call.startsWith('dispose:')).length, 12);
});

test('microphone toggle messages leave pending-start authority with the host controller', async () => {
  const calls: string[] = [];
  const router = new MicMessageRouter({
    settings: {} as never,
    consents: {} as never,
    history: {} as never,
    recording: {
      toggle: async () => { calls.push('toggle'); },
      start: async () => { calls.push('start'); },
      stop: async () => { calls.push('stop'); },
    },
    devices: {} as never,
    metadata: {} as never,
    assistant: {} as never,
    mappings: {} as never,
    credentials: {} as never,
    state: {} as never,
    ui: {} as never,
    openSettingsCenter: async () => undefined,
  });

  await router.route({ type: 'toggle' });
  await router.route({ type: 'start' });
  await router.route({ type: 'stop' });

  assert.deepEqual(calls, ['toggle', 'start', 'stop']);
});

test('microphone router writes typed settings and opens host-owned management', async () => {
  const writes: unknown[] = [];
  let publications = 0;
  let settingsOpens = 0;
  const commands: string[] = [];
  const router = new MicMessageRouter({
    settings: {
      read: () => ({ values: { ...SETTINGS_DEFAULTS }, workspaceOverrides: [] }),
      update: async (patch) => { writes.push(patch); },
    },
    consents: {} as never,
    history: {} as never,
    recording: {} as never,
    devices: {} as never,
    metadata: {} as never,
    assistant: {} as never,
    mappings: {} as never,
    credentials: {} as never,
    state: {
      pushFull: async () => { publications += 1; },
      pushHistory: async () => {},
    } as never,
    ui: { executeCommand: async (command: string) => { commands.push(command); } } as never,
    openSettingsCenter: async () => { settingsOpens += 1; },
  });

  await router.route({
    type: 'settings-update',
    speechLang: 'en',
    uiLang: 'he',
    ttlDays: 7,
    model: 'stt-next',
  });
  await router.route({ type: 'open-settings-center' });
  await router.route({ type: 'assistant-provider-manage' });

  assert.deepEqual(writes, [{
    languageHint: 'en',
    uiLanguage: 'he',
    historyTtlDays: 7,
    sttModel: 'stt-next',
  }]);
  assert.equal(publications, 1);
  assert.equal(settingsOpens, 1);
  assert.deepEqual(commands, ['voiceInput.manageAssistantProvider']);
});

test('microphone history can be cleared only after the modal request is accepted', async () => {
  let confirmations = 0;
  let clears = 0;
  let publications = 0;
  const router = new MicMessageRouter({
    settings: {} as never,
    consents: {} as never,
    history: { clear: async () => { clears += 1; } } as never,
    recording: {} as never,
    devices: {} as never,
    metadata: {} as never,
    assistant: {} as never,
    mappings: {} as never,
    credentials: {} as never,
    state: { pushHistory: async () => { publications += 1; } } as never,
    ui: {
      confirmHistoryClear: async () => {
        confirmations += 1;
        return confirmations === 2;
      },
    } as never,
    openSettingsCenter: async () => undefined,
  });

  await router.route({ type: 'history-clear-request' });
  await router.route({ type: 'history-clear-request' });

  assert.deepEqual({ confirmations, clears, publications }, {
    confirmations: 2,
    clears: 1,
    publications: 1,
  });
});

test('newer history publication prevents an older full snapshot from restoring entries', async () => {
  const firstHistory = deferred<Array<{ id: string; text: string; lang: string; ts: number }>>();
  let historyCalls = 0;
  const published: ViewState[] = [];
  const publisher = new HostStatePublisher({
    settings: {
      read: () => ({ values: { ...SETTINGS_DEFAULTS }, workspaceOverrides: [] }),
    },
    credentials: { status: async () => ({ provider: 'deepseek', configured: true }) },
    consents: { status: (id) => ({ id, acknowledged: true }) },
    history: {
      list: async () => {
        historyCalls += 1;
        if (historyCalls === 1) return firstHistory.promise;
        return [{ id: 'new', text: 'new', lang: 'he', ts: 2 }];
      },
    },
    recording: { isRecording: false },
    devices: { cachedDevices: [] },
    metadata: { state: { models: [], languages: [], loading: false } },
    assistant: {
      state: {
        listening: false,
        speaking: false,
        feedback: '',
        targetLabel: '',
        planConfidence: undefined,
        pendingSend: undefined,
        speechPreferences: { enabled: true, voiceUri: 'agent-voice', rate: 1.4 },
        providerBusy: false,
        providerError: undefined,
      },
    },
    mappings: {
      summary: () => ({ total: 0, enabled: 0, agentExposed: 0, status: 'ready' }),
      pendingAction: undefined,
    },
    view: {
      postState: (state) => { published.push(state); },
      postHistory: () => {},
    },
    keybinding: () => 'Alt+M',
  });

  const older = publisher.pushFull();
  await publisher.pushHistory();
  firstHistory.resolve([{ id: 'old', text: 'old', lang: 'he', ts: 1 }]);
  await older;

  assert.equal(published.length, 1);
  assert.deepEqual(published[0].history.map((entry) => entry.id), ['new']);
  assert.equal(published[0].assistantSpeechVoiceUri, 'agent-voice');
  assert.equal(published[0].assistantSpeechRate, 1.4);
  assert.deepEqual({
    id: published[0].assistantProviderId,
    name: published[0].assistantProviderName,
    status: published[0].assistantProviderStatus,
  }, { id: 'deepseek', name: 'DeepSeek', status: 'ready' });
  assert.doesNotMatch(JSON.stringify(published), /credential|private|secret/iu);
});

test('diagnostics reports bounded host health through injected probes', async () => {
  const rows: unknown[][] = [];
  const checks: string[] = [];
  let shown = 0;
  const diagnostics = new DiagnosticsService({
    version: '1.3.0',
    devices: { get: async () => [{ id: 'mic', label: 'Microphone' }] },
    log: (...values) => { rows.push(values); },
    showLog: () => { shown += 1; },
    platform: 'linux',
    environment: {
      XDG_SESSION_TYPE: 'wayland',
      WAYLAND_DISPLAY: '/run/user/private-display',
      DISPLAY: 'private-display-value',
    },
    commandExists: async (command, executable) => {
      checks.push(`${command}:${executable}`);
      return executable === 'wl-copy';
    },
    pathExists: () => true,
  });

  const result = await diagnostics.run();

  assert.equal(shown, 1);
  assert.deepEqual(checks, [
    'which:wl-copy',
    'which:wl-paste',
    'which:wtype',
    'which:ydotool',
    'which:xdotool',
  ]);
  const report = JSON.stringify(rows);
  assert.match(report, /native audio devices.*1/u);
  assert.doesNotMatch(
    report,
    /api.?key|transcript|credential|private-display|\/run\/user/iu,
  );
  assert.match(result.report, /extension=ok/u);
  assert.doesNotMatch(
    result.report,
    /api.?key|transcript|credential|private-display|\/run\/user|\/tmp\//iu,
  );
});

test('metadata refresh prevents an older provider completion from overwriting newer models', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const olderModels = deferred<Response>();
  let modelRequests = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (!url.endsWith('/models')) return new Response('', { status: 503 });
    modelRequests += 1;
    if (modelRequests === 1) return olderModels.promise;
    return modelsResponse('new-model');
  };
  const publications: string[][] = [];
  const metadata = new TranscriptionMetadataService(
    {
      status: async () => ({ provider: 'soniox', configured: true }),
      use: async (_provider, operation) => operation('private-key'),
    } as never,
    {
      postMeta: (models) => { publications.push(models.map((model) => model.id)); },
    },
    () => {},
  );

  const older = metadata.refresh();
  await waitFor(() => modelRequests === 1);
  await metadata.refresh();
  olderModels.resolve(modelsResponse('old-model'));
  await older;

  assert.deepEqual(metadata.state.models.map((model) => model.id), ['new-model']);
  assert.deepEqual(publications.at(-1), ['new-model']);
});

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function modelsResponse(id: string): Response {
  return new Response(JSON.stringify({ models: [{ id, type: 'async' }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
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

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail('condition was not reached');
}
