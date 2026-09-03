import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ControlCenterController,
  type ControlCenterPanelFactory,
  type ControlCenterPanelPort,
  type ControlCenterPersistence,
  type ControlCenterStateSource,
} from '../src/features/controlCenter/controller';
import { ControlCenterStateCoordinator } from '../src/platform/controlCenterStateCoordinator';
import type { ControlCenterHostMessage } from '../src/webview/controlCenter/contracts';

class FakePanel implements ControlCenterPanelPort {
  readonly identity = this;
  readonly messages: ControlCenterHostMessage[] = [];
  revealCount = 0;
  disposed = false;
  private messageListeners: Array<(value: unknown) => void> = [];
  private disposeListeners: Array<() => void> = [];
  reveal(): void { this.revealCount += 1; }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const listener of this.disposeListeners) listener();
  }
  postMessage(message: ControlCenterHostMessage): boolean { this.messages.push(message); return true; }
  onMessage(listener: (message: unknown) => void) {
    this.messageListeners.push(listener);
    return { dispose: () => { this.messageListeners = this.messageListeners.filter((item) => item !== listener); } };
  }
  onDispose(listener: () => void) {
    this.disposeListeners.push(listener);
    return { dispose: () => { this.disposeListeners = this.disposeListeners.filter((item) => item !== listener); } };
  }
  emit(message: unknown): void { for (const listener of this.messageListeners) listener(message); }
}

class FakeFactory implements ControlCenterPanelFactory {
  readonly created: FakePanel[] = [];
  create(): FakePanel { const panel = new FakePanel(); this.created.push(panel); return panel; }
  adopt(panel: unknown): FakePanel { return panel as FakePanel; }
}

class MemoryPersistence implements ControlCenterPersistence {
  readonly values = new Map<string, unknown>();
  get(key: string): unknown { return this.values.get(key); }
  update(key: string, value: unknown): void { this.values.set(key, value); }
}

/** Bounded wait so a blocked message queue fails the assertions instead of hanging the run. */
function drained(controller: ControlCenterController): Promise<unknown> {
  return Promise.race([
    controller.whenIdle(),
    new Promise((resolve) => { setTimeout(resolve, 50).unref(); }),
  ]);
}

const rows = Array.from({ length: 25 }, (_, index) => ({
  commandId: `command.${index + 1}`,
  enabled: true,
  availability: 'available' as const,
  overridden: false,
  primaryPhrase: `phrase ${index + 1}`,
  localizedLabel: `Command ${index + 1}`,
  slotShortcutSummary: '',
}));

/** A coordinator whose device capture never returns, standing in for a stuck Bluetooth test. */
function stuckMicrophoneCoordinator(
  log: (message: string) => void,
  onMicrophone: () => void,
): ControlCenterStateCoordinator {
  return new ControlCenterStateCoordinator({
    settings: { read: () => ({
      values: { uiLanguage: 'en', transcriptionProvider: 'none', assistantSpeechEnabled: false },
      workspaceOverrides: [],
    }) },
    credentials: { status: async () => ({ provider: 'soniox', configured: false }) },
    consents: { status: () => ({ id: 'soniox', acknowledged: false }) },
    sonioxConsent: { capture: async () => undefined },
    autoMode: { snapshot: () => ({ effective: false, fingerprint: 'auto:ready' }) },
    setupChoices: { snapshot: () => ({ schemaVersion: 1, stt: 'pending', tts: 'pending' }) },
    builtins: {
      isKnownCommandId: (id: string) => /^command\.\d+$/u.test(id),
      commandRows: async () => ({ filteredCount: 0, rows: [] }),
    },
    mappings: {
      pendingAction: undefined,
      pendingBuiltin: undefined,
      settingsSnapshot: () => ({ revision: 1, status: 'ready', items: [] }),
    },
    agents: { defaultId: '', isCorrupted: false, list: () => [] },
    devices: { hasCachedResult: false, cachedDevices: [], selectionStatus: undefined },
    latestTranscript: async () => undefined,
    cancelPending: () => undefined,
    operations: {
      setupState: () => ({
        microphoneState: 'untested', microphoneLabel: '', systemTtsEnabled: false,
        systemTtsVoiceIndex: -1, systemTtsRate: 1,
        stepStates: ['pending', 'pending', 'complete', 'pending'], recommendedStep: 1,
      }),
      diagnosticsState: () => ({
        status: 'idle', summary: '', checks: [], canOpen: false, canCopy: false,
      }),
      systemTtsState: () => 'off',
      microphone: () => { onMicrophone(); return new Promise<void>(() => undefined); },
      observeVoices: () => undefined,
      systemTts: async () => undefined,
      diagnostics: async () => undefined,
    },
    publish: () => undefined,
    log,
  } as never);
}

const source: ControlCenterStateSource = {
  readProjection: () => ({
    routeState: 'ready', language: 'en', direction: 'ltr', effectiveAutoMode: false,
    capabilities: {
      sttProvider: 'none', sttState: 'not-configured', streamingPartials: false,
      systemTtsState: 'off', localSpeechState: 'pending-not-available', remoteProcessing: false,
    },
  }),
  readCommandPage: () => ({ filteredCount: 100, rows }),
  isKnownCommandId: (id) => /^command\.\d+$/u.test(id),
};

test('latest explicit deep link wins and Commands are published as exact 10/10/5 chunks', async () => {
  const factory = new FakeFactory();
  const persistence = new MemoryPersistence();
  const controller = new ControlCenterController({ factory, persistence, source });
  void controller.createOrShow('voice');
  void controller.createOrShow('commands', { page: 1, commandId: 'command.2', setupStep: 4 });
  await controller.whenIdle();
  assert.equal(factory.created.length, 1);
  const panel = factory.created[0];
  panel.emit({ type: 'ready', lastAppliedRevision: null });
  await controller.whenIdle();
  const snapshot = panel.messages[0] as Extract<ControlCenterHostMessage, { type: 'stateSnapshot' }>;
  assert.equal(snapshot.state.route, 'commands');
  assert.equal(snapshot.state.commandId, 'command.2');
  assert.equal(snapshot.state.setupStep, 4);
  assert.deepEqual(panel.messages.filter((message) => message.type === 'commandPageChunk')
    .map((message) => message.rows.length), [10, 10, 5]);
  assert.equal(panel.messages.at(-1)?.type, 'customCommandPageState');
  const persisted = [...persistence.values.values()][0] as Record<string, unknown>;
  assert.deepEqual(persisted, { route: 'commands', page: 1 });
  controller.dispose();
});

test('management pages are transient, bounded, revisioned projections', async () => {
  const factory = new FakeFactory();
  const managementSource: ControlCenterStateSource = {
    ...source,
    readPlanningProviders: () => ({
      selectedProvider: 'openai',
      items: [{
        id: 'openai', name: 'OpenAI', enabled: true, model: 'gpt-5', locality: 'remote',
        credentialRequired: true, credentialConfigured: true,
        consentRequired: true, consentAcknowledged: true,
      }],
    }),
    readAgentPage: (page) => ({
      totalCount: 9,
      rows: Array.from({ length: page === 1 ? 8 : 1 }, (_, index) => ({
        id: `agent_abcdefghijkl${page}${index}`, name: `Agent ${index}`,
        description: '', provider: 'openai', model: 'gpt-5', enabled: true,
        isDefault: page === 1 && index === 0, instructionsConfigured: false,
      })),
    }),
  };
  const persistence = new MemoryPersistence();
  const controller = new ControlCenterController({ factory, persistence, source: managementSource });
  await controller.createOrShow('assistant');
  const panel = factory.created[0];
  panel.emit({ type: 'ready', lastAppliedRevision: null });
  await controller.whenIdle();
  const first = panel.messages.find((message) => message.type === 'stateSnapshot');
  assert.ok(first && first.type === 'stateSnapshot');
  panel.emit({ type: 'ack', revision: first.revision });
  await controller.whenIdle();
  panel.emit({ type: 'setManagementPageIntent', revision: first.revision, target: 'agents', page: 2 });
  await controller.whenIdle();
  const agentPages = panel.messages.filter((message) => message.type === 'agentPageState');
  assert.deepEqual(agentPages.map(({ pageIndex, pageRowCount }) => [pageIndex, pageRowCount]), [[1, 8], [2, 1]]);
  assert.deepEqual([...persistence.values.values()][0], { route: 'assistant' });
  controller.dispose();
});

test('serializer/command race keeps one canonical panel, disposes duplicate, and recreates after disposal', async () => {
  const factory = new FakeFactory();
  const controller = new ControlCenterController({ factory, persistence: new MemoryPersistence(), source });
  await controller.createOrShow();
  const canonical = factory.created[0];
  const restoredDuplicate = new FakePanel();
  await controller.adoptOrCreate(restoredDuplicate);
  assert.equal(controller.hasPanel, true);
  assert.equal(restoredDuplicate.disposed, true);
  assert.equal(canonical.disposed, false);
  canonical.dispose();
  await controller.whenIdle();
  assert.equal(controller.hasPanel, false);
  await controller.createOrShow('home');
  assert.equal(factory.created.length, 2);
  controller.dispose();
});

test('intents need a delivered revision; never-sent, duplicate, and unknown are rejected', async () => {
  const factory = new FakeFactory();
  const persistence = new MemoryPersistence();
  const rejected: string[] = [];
  const controller = new ControlCenterController({
    factory,
    persistence,
    source: { ...source, logRejected: (event, reason) => { rejected.push(`${event}/${reason}`); } },
  });
  await controller.createOrShow('commands');
  const panel = factory.created[0];
  panel.emit({ type: 'ready', lastAppliedRevision: null });
  await controller.whenIdle();
  const first = panel.messages[0] as Extract<ControlCenterHostMessage, { type: 'stateSnapshot' }>;
  // No ack is delivered: applying the snapshot is what proves the revision, so this click lands.
  panel.emit({ type: 'setFilterIntent', revision: first.revision, filter: 'git' });
  await controller.whenIdle();
  assert.equal(controller.currentDisplayState.filter, 'git');
  const second = panel.messages.filter((message) => message.type === 'stateSnapshot').at(-1);
  assert.ok(second && second.type === 'stateSnapshot' && second.revision !== first.revision);
  // A revision the host never published cannot be learned by rendering, so it stays rejected.
  panel.emit({ type: 'setFilterIntent', revision: second.revision + 500, filter: 'forged' });
  panel.emit({ type: 'closeOverlayIntent', revision: second.revision, reason: 'close' });
  panel.emit({ type: 'closeOverlayIntent', revision: second.revision, reason: 'close' });
  panel.emit({ type: 'inventedIntent', revision: second.revision });
  await controller.whenIdle();
  assert.equal(controller.currentDisplayState.filter, 'git');
  assert.deepEqual(rejected, [
    'browser-message/stale-revision',
    'browser-message/duplicate-intent',
    'browser-message/invalid-envelope',
  ]);
  assert.equal(panel.messages.filter(({ type }) => type === 'stateSnapshot').length, 2);
  controller.dispose();
});

test('a click made while a newer snapshot is in flight still lands for a lenient intent', async () => {
  const factory = new FakeFactory();
  const rejected: string[] = [];
  const controller = new ControlCenterController({
    factory,
    persistence: new MemoryPersistence(),
    source: { ...source, logRejected: (event, reason) => { rejected.push(`${event}/${reason}`); } },
  });
  await controller.createOrShow('commands');
  const panel = factory.created[0];
  panel.emit({ type: 'ready', lastAppliedRevision: null });
  await controller.whenIdle();
  const published = panel.messages[0] as Extract<ControlCenterHostMessage, { type: 'stateSnapshot' }>;
  // Applying the snapshot is what proves the revision, so this click lands without an ack.
  panel.emit({ type: 'setPageIntent', revision: published.revision, page: 2 });
  await controller.whenIdle();
  assert.equal(controller.currentDisplayState.page, 2);
  assert.deepEqual(rejected, []);
  // A host-side refresh republishes while the user is still looking at the previous snapshot.
  await controller.refresh();
  const inFlight = panel.messages.filter((message) => message.type === 'stateSnapshot').at(-1);
  assert.ok(inFlight && inFlight.type === 'stateSnapshot' && inFlight.revision !== published.revision);
  panel.emit({ type: 'setPageIntent', revision: published.revision, page: 3 });
  await controller.whenIdle();
  assert.equal(controller.currentDisplayState.page, 3, 'the click must not be silently dropped');
  assert.deepEqual(rejected, []);
  controller.dispose();
});

test('the lenient window is bounded to the last eight delivered revisions', async () => {
  const factory = new FakeFactory();
  const rejected: string[] = [];
  const controller = new ControlCenterController({
    factory,
    persistence: new MemoryPersistence(),
    source: { ...source, logRejected: (event, reason) => { rejected.push(`${event}/${reason}`); } },
  });
  await controller.createOrShow('commands');
  const panel = factory.created[0];
  panel.emit({ type: 'ready', lastAppliedRevision: null });
  await controller.whenIdle();
  const published = panel.messages[0] as Extract<ControlCenterHostMessage, { type: 'stateSnapshot' }>;
  const snapshots = () => panel.messages.filter((message) => message.type === 'stateSnapshot');
  for (let index = 0; index < 8; index += 1) await controller.refresh();
  const oldest = snapshots()[1];
  assert.ok(oldest && oldest.type === 'stateSnapshot');
  panel.emit({ type: 'setPageIntent', revision: published.revision, page: 2 });
  await controller.whenIdle();
  assert.equal(controller.currentDisplayState.page, undefined);
  assert.deepEqual(rejected, ['browser-message/stale-revision']);
  // The oldest revision still inside the window remains acceptable.
  panel.emit({ type: 'setPageIntent', revision: oldest.revision, page: 2 });
  await controller.whenIdle();
  assert.equal(controller.currentDisplayState.page, 2);
  assert.deepEqual(rejected, ['browser-message/stale-revision']);
  controller.dispose();
});

test('a privileged intent that loses the revision race is rejected as strictly stale', async () => {
  const factory = new FakeFactory();
  const rejected: string[] = [];
  const decisions: string[] = [];
  const controller = new ControlCenterController({
    factory,
    persistence: new MemoryPersistence(),
    source: {
      ...source,
      logRejected: (event, reason) => { rejected.push(`${event}/${reason}`); },
      handleIntent: (message) => {
        if (message.type === 'pendingReviewIntent') decisions.push(message.decision);
      },
    },
  });
  await controller.createOrShow('commands');
  const panel = factory.created[0];
  panel.emit({ type: 'ready', lastAppliedRevision: null });
  await controller.whenIdle();
  const published = panel.messages[0] as Extract<ControlCenterHostMessage, { type: 'stateSnapshot' }>;
  await controller.refresh();
  const current = panel.messages.filter((message) => message.type === 'stateSnapshot').at(-1);
  assert.ok(current && current.type === 'stateSnapshot' && current.revision !== published.revision);
  panel.emit({
    type: 'pendingReviewIntent', revision: published.revision,
    decision: 'request-native-confirmation',
  });
  await controller.whenIdle();
  assert.deepEqual(decisions, [], 'confirming must require the pending state the user saw');
  assert.deepEqual(rejected, ['browser-message/stale-revision-strict']);
  panel.emit({ type: 'pendingReviewIntent', revision: current.revision, decision: 'cancel' });
  await controller.whenIdle();
  assert.deepEqual(decisions, ['cancel']);
  assert.deepEqual(rejected, ['browser-message/stale-revision-strict']);
  controller.dispose();
});

test('a new panel attachment cannot be driven by the previous attachment revisions', async () => {
  const factory = new FakeFactory();
  const rejected: string[] = [];
  const controller = new ControlCenterController({
    factory,
    persistence: new MemoryPersistence(),
    source: { ...source, logRejected: (event, reason) => { rejected.push(`${event}/${reason}`); } },
  });
  await controller.createOrShow('commands');
  const first = factory.created[0];
  first.emit({ type: 'ready', lastAppliedRevision: null });
  await controller.whenIdle();
  const retired = first.messages[0] as Extract<ControlCenterHostMessage, { type: 'stateSnapshot' }>;
  first.dispose();
  await controller.whenIdle();
  await controller.createOrShow('commands');
  const second = factory.created[1];
  assert.notEqual(second, first);
  second.emit({ type: 'ready', lastAppliedRevision: null });
  await controller.whenIdle();
  const reattached = second.messages[0] as Extract<ControlCenterHostMessage, { type: 'stateSnapshot' }>;
  assert.ok(reattached.revision > retired.revision);
  second.emit({ type: 'setPageIntent', revision: retired.revision, page: 2 });
  await controller.whenIdle();
  assert.equal(controller.currentDisplayState.page, undefined);
  assert.deepEqual(rejected, ['browser-message/stale-revision']);
  // A reloaded document behind the same panel also starts with no acceptable earlier revision.
  second.emit({ type: 'ready', lastAppliedRevision: null });
  await controller.whenIdle();
  second.emit({ type: 'setPageIntent', revision: reattached.revision, page: 4 });
  await controller.whenIdle();
  assert.equal(controller.currentDisplayState.page, undefined);
  assert.deepEqual(rejected, [
    'browser-message/stale-revision', 'browser-message/stale-revision',
  ]);
  const reloaded = second.messages.filter((message) => message.type === 'stateSnapshot').at(-1);
  assert.ok(reloaded && reloaded.type === 'stateSnapshot');
  second.emit({ type: 'setPageIntent', revision: reloaded.revision, page: 2 });
  await controller.whenIdle();
  assert.equal(controller.currentDisplayState.page, 2);
  assert.deepEqual(rejected, [
    'browser-message/stale-revision', 'browser-message/stale-revision',
  ]);
  controller.dispose();
});

test('a microphone test that never finishes leaves the next click responsive', async () => {
  const factory = new FakeFactory();
  let microphoneCalls = 0;
  const rejected: string[] = [];
  const coordinator = stuckMicrophoneCoordinator(
    (message) => { rejected.push(message); },
    () => { microphoneCalls += 1; },
  );
  const controller = new ControlCenterController({
    factory, persistence: new MemoryPersistence(), source: coordinator,
  });
  await controller.createOrShow('home');
  const panel = factory.created[0];
  panel.emit({ type: 'ready', lastAppliedRevision: null });
  await controller.whenIdle();
  const first = panel.messages.find((message) => message.type === 'stateSnapshot');
  assert.ok(first && first.type === 'stateSnapshot');
  panel.emit({
    type: 'microphoneSetupIntent', revision: first.revision, operation: 'test-signal',
  });
  await drained(controller);
  assert.equal(microphoneCalls, 1);
  const testing = panel.messages.filter((message) => message.type === 'stateSnapshot').at(-1);
  assert.ok(testing && testing.type === 'stateSnapshot' && testing.revision !== first.revision);
  // The capture is still running, so the queue must already be free for the next click.
  panel.emit({ type: 'navigateIntent', revision: testing.revision, route: 'commands' });
  await drained(controller);
  assert.equal(controller.currentDisplayState.route, 'commands');
  assert.deepEqual(rejected, []);
  controller.dispose();
});

test('a double-clicked device test inside the lenient window stays one native capture', async () => {
  const factory = new FakeFactory();
  let microphoneCalls = 0;
  const logs: string[] = [];
  const coordinator = stuckMicrophoneCoordinator(
    (message) => { logs.push(message); },
    () => { microphoneCalls += 1; },
  );
  const controller = new ControlCenterController({
    factory, persistence: new MemoryPersistence(), source: coordinator,
  });
  await controller.createOrShow('home');
  const panel = factory.created[0];
  panel.emit({ type: 'ready', lastAppliedRevision: null });
  await controller.whenIdle();
  const first = panel.messages.find((message) => message.type === 'stateSnapshot');
  assert.ok(first && first.type === 'stateSnapshot');
  // Two impatient clicks on one snapshot: the first refreshes, so the second now reaches the
  // host on a stale-but-recent revision instead of dying in the gate.
  const click = { type: 'microphoneSetupIntent', revision: first.revision, operation: 'test-signal' };
  panel.emit(click);
  panel.emit(click);
  await drained(controller);
  const latest = panel.messages.filter((message) => message.type === 'stateSnapshot').at(-1);
  assert.ok(latest && latest.type === 'stateSnapshot' && latest.revision !== first.revision);
  panel.emit({ ...click, revision: latest.revision });
  await drained(controller);
  assert.equal(microphoneCalls, 1, 'the in-flight guard, not the revision gate, contains repeats');
  assert.deepEqual(logs, [
    'Control Center rejected intent: microphone:test-signal is already running',
    'Control Center rejected intent: microphone:test-signal is already running',
  ]);
  controller.dispose();
});

test('a repeated detached operation is a contained no-op instead of a second native prompt', async () => {
  let enableCalls = 0;
  let releaseEnable!: () => void;
  const coordinator = new ControlCenterStateCoordinator({
    settings: { read: () => ({ values: { uiLanguage: 'en' }, workspaceOverrides: [] }) },
    enableAuto: () => {
      enableCalls += 1;
      return new Promise<boolean>((resolve) => { releaseEnable = () => resolve(true); });
    },
    publish: () => undefined,
    log: () => undefined,
  } as never);
  const intent = { type: 'requestAutoEnableIntent', revision: 1 } as const;
  assert.deepEqual(await coordinator.handleIntent(intent), {
    refresh: true, focusTarget: { kind: 'trigger', trigger: 'auto-badge' },
  });
  assert.deepEqual(await coordinator.handleIntent(intent), {
    refresh: true, focusTarget: { kind: 'trigger', trigger: 'auto-badge' },
  });
  assert.equal(enableCalls, 1);
  releaseEnable();
  await coordinator.whenIdle();
  assert.deepEqual(await coordinator.handleIntent(intent), {
    refresh: true, focusTarget: { kind: 'trigger', trigger: 'auto-badge' },
  });
  assert.equal(enableCalls, 2);
  releaseEnable();
  await coordinator.whenIdle();
});

test('panel disposal synchronously advances generation and invalidates pending native authority', async () => {
  const factory = new FakeFactory();
  let invalidations = 0;
  let releaseIntent!: () => void;
  const blockedIntent = new Promise<void>((resolve) => { releaseIntent = resolve; });
  const controller = new ControlCenterController({
    factory,
    persistence: new MemoryPersistence(),
    source: {
      ...source,
      invalidateAuthority: () => { invalidations += 1; },
      handleIntent: async (message) => {
        if (message.type === 'pendingReviewIntent') await blockedIntent;
      },
    },
  });
  await controller.createOrShow('commands');
  const panel = factory.created[0];
  panel.emit({ type: 'ready', lastAppliedRevision: null });
  await controller.whenIdle();
  const snapshot = panel.messages[0] as Extract<ControlCenterHostMessage, { type: 'stateSnapshot' }>;
  panel.emit({ type: 'ack', revision: snapshot.revision });
  await controller.whenIdle();
  panel.emit({
    type: 'pendingReviewIntent', revision: snapshot.revision,
    decision: 'request-native-confirmation',
  });
  await Promise.resolve();
  const generation = controller.generation;
  panel.dispose();
  assert.equal(controller.generation, generation + 1);
  assert.equal(invalidations, 1);
  releaseIntent();
  await controller.whenIdle();
  assert.equal(controller.hasPanel, false);
});

test('request sequence makes repeated command and custom detail requests independently reachable', async () => {
  const factory = new FakeFactory();
  const customId = 'vm_abcdefghijklmnopqrstuv';
  const controller = new ControlCenterController({
    factory,
    persistence: new MemoryPersistence(),
    source: {
      ...source,
      handleIntent: (message) => {
        if (message.type === 'commandEditIntent' && message.operation === 'open') {
          return {
            commandDetails: {
              commandId: message.commandId, phrases: ['copy'], slotSummary: '',
              executorLabel: 'VS Code API', enabled: true,
            },
          };
        }
        if (message.type === 'customCommandIntent' && message.operation === 'open') {
          return {
            customCommandDetails: {
              id: customId, label: 'Custom', description: '', phrases: ['custom phrase'],
              kind: 'command', targetId: 'editor.action.copyLinesDownAction',
              enabled: true, agentEnabled: false,
            },
          };
        }
      },
    },
  });
  await controller.createOrShow('commands');
  const panel = factory.created[0];
  panel.emit({ type: 'ready', lastAppliedRevision: null });
  await controller.whenIdle();
  const snapshot = panel.messages[0] as Extract<ControlCenterHostMessage, { type: 'stateSnapshot' }>;
  panel.emit({ type: 'ack', revision: snapshot.revision });
  await controller.whenIdle();
  panel.emit({
    type: 'commandEditIntent', revision: snapshot.revision,
    commandId: 'command.2', operation: 'open', requestSequence: 1,
  });
  panel.emit({
    type: 'commandEditIntent', revision: snapshot.revision,
    commandId: 'command.2', operation: 'open', requestSequence: 2,
  });
  panel.emit({
    type: 'customCommandIntent', revision: snapshot.revision,
    id: customId, operation: 'open', requestSequence: 3,
  });
  panel.emit({
    type: 'customCommandIntent', revision: snapshot.revision,
    id: customId, operation: 'open', requestSequence: 4,
  });
  await controller.whenIdle();
  assert.equal(panel.messages.filter(({ type }) => type === 'commandDetails').length, 2);
  assert.equal(panel.messages.filter(({ type }) => type === 'customCommandDetails').length, 2);
  controller.dispose();
});
