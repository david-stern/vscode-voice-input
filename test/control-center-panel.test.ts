import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ControlCenterController,
  type ControlCenterPanelFactory,
  type ControlCenterPanelPort,
  type ControlCenterPersistence,
  type ControlCenterStateSource,
} from '../src/features/controlCenter/controller';
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

const rows = Array.from({ length: 25 }, (_, index) => ({
  commandId: `command.${index + 1}`,
  enabled: true,
  availability: 'available' as const,
  overridden: false,
  primaryPhrase: `phrase ${index + 1}`,
  localizedLabel: `Command ${index + 1}`,
  slotShortcutSummary: '',
}));

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

test('mutating intents require the current acknowledged revision and duplicate intents are rejected', async () => {
  const factory = new FakeFactory();
  const persistence = new MemoryPersistence();
  const controller = new ControlCenterController({ factory, persistence, source });
  await controller.createOrShow('commands');
  const panel = factory.created[0];
  panel.emit({ type: 'ready', lastAppliedRevision: null });
  await controller.whenIdle();
  const first = panel.messages[0] as Extract<ControlCenterHostMessage, { type: 'stateSnapshot' }>;
  panel.emit({ type: 'setFilterIntent', revision: first.revision, filter: 'ignored-before-ack' });
  panel.emit({ type: 'ack', revision: first.revision });
  await controller.whenIdle();
  panel.emit({ type: 'setFilterIntent', revision: first.revision, filter: 'git' });
  panel.emit({ type: 'setFilterIntent', revision: first.revision, filter: 'git' });
  await controller.whenIdle();
  assert.equal(controller.currentDisplayState.filter, 'git');
  assert.equal(panel.messages.filter(({ type }) => type === 'stateSnapshot').length, 2);
  controller.dispose();
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
