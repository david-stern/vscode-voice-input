import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  normalizeControlCenterDeepLink,
  parseControlCenterBrowserMessage,
  parseControlCenterHostMessage,
  sanitizeControlCenterDisplayState,
} from '../src/webview/controlCenter/protocol';
import {
  parseCommandFilterState,
  serializeCommandFilterState,
  updateCommandFilterState,
} from '../src/webview/controlCenter/filters';
import { ControlCenterStateCoordinator } from '../src/platform/controlCenterStateCoordinator';

const capabilities = {
  sttProvider: 'none' as const,
  sttState: 'not-configured' as const,
  streamingPartials: false,
  systemTtsState: 'off' as const,
  localSpeechState: 'pending-not-available' as const,
  remoteProcessing: false,
};

test('frozen protocol document enumerates every closed browser and host message family', () => {
  const document = readFileSync('docs/ux/protocol-state-matrix.md', 'utf8');
  const messages = readFileSync('src/webview/controlCenter/contractMessages.ts', 'utf8');
  const browser = tableTypes(document, '### Browser to host schemas', '### Host to browser schemas');
  const host = tableTypes(document, '### Host to browser schemas', '## 5. Bounded parser contract');
  assert.deepEqual(browser, contractTypes(
    messages, 'export type ControlCenterBrowserMessage =', 'export type ControlCenterHostMessage =',
  ));
  assert.deepEqual(host, contractTypes(
    messages, 'export type ControlCenterHostMessage =',
  ));
  assert.deepEqual(browser, [
    'ready', 'ack', 'navigateIntent', 'setFilterIntent', 'setPageIntent',
    'openPendingReviewIntent', 'pendingReviewIntent', 'openOverlayIntent',
    'closeOverlayIntent', 'requestAutoEnableIntent', 'disableAutoIntent',
    'providerSetupIntent', 'micIntent', 'microphoneSetupIntent',
    'systemTtsVoicesObservedIntent', 'systemTtsIntent', 'commandEditIntent',
    'setManagementPageIntent', 'planningProviderIntent', 'agentManagementIntent',
    'customCommandIntent', 'diagnosticsIntent',
  ]);
  assert.deepEqual(host, [
    'stateSnapshot', 'commandPageChunk', 'commandDetails', 'planningProviderState',
    'agentPageState', 'customCommandPageState', 'customCommandDetails', 'setupState',
    'diagnosticsState', 'statusUpdate', 'transcriptUpdate', 'focusReturn',
  ]);
  assert.match(document, /off\|configured-unverified\|ready\|unavailable\|error/u);
  assert.match(document, /first tuple position that is not `complete`/u);
  assert.match(document, /voiceInput\.controlCenterSetupChoices\.v1/u);
  assert.match(document, /Setup is Pending when the TTS choice marker is `pending`/u);
});

test('browser protocol is closed, revisioned, authority-free, and normalizes unknown routes safely', () => {
  assert.deepEqual(parseControlCenterBrowserMessage({
    type: 'navigateIntent', revision: 4, route: 'commands',
    params: { filter: 'git', page: 2, commandId: 'git.status', setupStep: 3 },
  }), {
    type: 'navigateIntent', revision: 4, route: 'commands',
    params: { filter: 'git', page: 2, commandId: 'git.status', setupStep: 3 },
  });
  assert.deepEqual(parseControlCenterBrowserMessage({
    type: 'navigateIntent', revision: 4, route: 'invented', params: { filter: 'discard-me' },
  }), { type: 'navigateIntent', revision: 4, route: 'home' });
  for (const authority of [
    { type: 'requestAutoEnableIntent', revision: 4, confirmed: true },
    { type: 'requestAutoEnableIntent', revision: 4, nested: { receipt: 'forged' } },
    { type: 'pendingReviewIntent', revision: 4, decision: 'request-native-confirmation', outcome: 'approved' },
  ]) assert.equal(parseControlCenterBrowserMessage(authority), undefined);
  assert.equal(parseControlCenterBrowserMessage({ type: 'setPageIntent', revision: 4, page: 5 }), undefined);
  assert.equal(parseControlCenterBrowserMessage({ type: 'setFilterIntent', revision: 4, filter: 'x'.repeat(201) }), undefined);
});

test('bounded parser rejects accessors, prototype-bearing values, deep and oversized envelopes', () => {
  const accessor = { type: 'ready' } as Record<string, unknown>;
  Object.defineProperty(accessor, 'lastAppliedRevision', { get: () => 0, enumerable: true });
  assert.equal(parseControlCenterBrowserMessage(accessor), undefined);
  assert.equal(parseControlCenterBrowserMessage(new (class Message {
    type = 'ready'; lastAppliedRevision = 0;
  })()), undefined);
  assert.equal(parseControlCenterBrowserMessage({
    type: 'navigateIntent', revision: 1, route: 'home', params: { a: { b: { c: true } } },
  }), undefined);
  assert.equal(parseControlCenterBrowserMessage({
    type: 'setFilterIntent', revision: 1, filter: 'א'.repeat(40_000),
  }), undefined);
});

test('host snapshot and command chunks enforce exact metadata and safe display projections', () => {
  const snapshot = {
    type: 'stateSnapshot', revision: 7,
    state: {
      route: 'commands', routeState: 'ready', language: 'he', direction: 'rtl',
      effectiveAutoMode: false, filter: '', page: 1,
      commandPage: { pageIndex: 1, pageSize: 25, filteredCount: 25, pageRowCount: 25, chunkCount: 3 },
    },
    capabilities,
    focusTarget: { kind: 'results-heading' },
  };
  assert.ok(parseControlCenterHostMessage(snapshot));
  assert.equal(parseControlCenterHostMessage({
    ...snapshot,
    state: { ...snapshot.state, commandPage: { ...snapshot.state.commandPage, chunkCount: 2 } },
  }), undefined);
  assert.ok(parseControlCenterHostMessage({
    type: 'commandPageChunk', revision: 7, chunkIndex: 1, chunkCount: 3,
    rows: [{
      commandId: 'editor.copy', enabled: true, availability: 'available', overridden: false,
      primaryPhrase: 'copy', localizedLabel: 'Copy', slotShortcutSummary: 'Ctrl+C',
    }],
  }));
  assert.equal(parseControlCenterHostMessage({
    type: 'commandPageChunk', revision: 7, chunkIndex: 0, chunkCount: 3, rows: [],
  }), undefined);
});

test('management protocol accepts only bounded revision-gated provider, agent, and custom-command intents', () => {
  const agentId = 'agent_abcdefghijkl';
  const mappingId = 'vm_abcdefghijklmnopqrstuv';
  assert.deepEqual(parseControlCenterBrowserMessage({
    type: 'planningProviderIntent', revision: 8, provider: 'openai',
    operation: 'save-profile', enabled: true, model: 'gpt-5',
  }), {
    type: 'planningProviderIntent', revision: 8, provider: 'openai',
    operation: 'save-profile', enabled: true, model: 'gpt-5',
  });
  assert.ok(parseControlCenterBrowserMessage({
    type: 'agentManagementIntent', revision: 8, operation: 'update-profile',
    id: agentId, provider: 'anthropic', model: 'claude',
  }));
  assert.ok(parseControlCenterBrowserMessage({
    type: 'customCommandIntent', revision: 8, operation: 'set-enabled',
    id: mappingId, enabled: false,
  }));
  assert.equal(parseControlCenterBrowserMessage({
    type: 'planningProviderIntent', revision: 8, provider: 'openai',
    operation: 'set-credential', secret: 'forbidden',
  }), undefined);
  assert.equal(parseControlCenterBrowserMessage({
    type: 'planningProviderIntent', revision: 8, provider: 'openai',
    operation: 'save-profile', enabled: true, model: ' invalid model\n',
  }), undefined);
  assert.equal(parseControlCenterBrowserMessage({
    type: 'agentManagementIntent', revision: 8, operation: 'delete',
    id: agentId, approved: true,
  }), undefined);
  assert.equal(parseControlCenterBrowserMessage({
    type: 'customCommandIntent', revision: 8, operation: 'edit',
    id: mappingId, args: ['forbidden'],
  }), undefined);
});

test('setup, speech observation, diagnostics, and repeatable opens remain closed presentation intents', () => {
  assert.deepEqual(parseControlCenterBrowserMessage({
    type: 'microphoneSetupIntent', revision: 10, operation: 'test-signal',
  }), { type: 'microphoneSetupIntent', revision: 10, operation: 'test-signal' });
  assert.deepEqual(parseControlCenterBrowserMessage({
    type: 'systemTtsVoicesObservedIntent', revision: 10,
    voices: [{ voiceUri: 'os:he-IL', name: 'System Hebrew', language: 'he-IL', isDefault: true }],
  }), {
    type: 'systemTtsVoicesObservedIntent', revision: 10,
    voices: [{ voiceUri: 'os:he-IL', name: 'System Hebrew', language: 'he-IL', isDefault: true }],
  });
  for (const intent of [
    { type: 'systemTtsIntent', revision: 10, operation: 'set-enabled', enabled: false },
    { type: 'systemTtsIntent', revision: 10, operation: 'set-voice', voiceIndex: -1 },
    { type: 'systemTtsIntent', revision: 10, operation: 'set-rate', rate: 1.2 },
    { type: 'diagnosticsIntent', revision: 10, operation: 'run', requestSequence: 1 },
    { type: 'commandEditIntent', revision: 10, commandId: 'editor.copy', operation: 'open', requestSequence: 2 },
    { type: 'customCommandIntent', revision: 10, operation: 'open',
      id: 'vm_abcdefghijklmnopqrstuv', requestSequence: 3 },
  ]) assert.ok(parseControlCenterBrowserMessage(intent));
  for (const rejected of [
    { type: 'systemTtsVoicesObservedIntent', revision: 10, voices: [{
      voiceUri: 'os:he-IL', name: 'System Hebrew', language: 'he-IL', isDefault: true,
      authorityId: 'forbidden',
    }] },
    { type: 'systemTtsIntent', revision: 10, operation: 'set-voice', voiceIndex: 20 },
    { type: 'systemTtsIntent', revision: 10, operation: 'set-rate', rate: 2.1 },
    { type: 'diagnosticsIntent', revision: 10, operation: 'run', requestSequence: 1,
      results: ['browser-authored'] },
    { type: 'commandEditIntent', revision: 10, commandId: 'editor.copy', operation: 'open' },
  ]) assert.equal(parseControlCenterBrowserMessage(rejected), undefined);
});

test('custom-command drafts are friendly bounded fields rather than raw JSON payloads', () => {
  const draft = {
    label: 'Open review', description: 'Open the review view', phrases: ['open review', 'show review'],
    kind: 'command' as const, targetId: 'workbench.action.openSettings',
    enabled: true, agentEnabled: false,
  };
  assert.ok(parseControlCenterBrowserMessage({
    type: 'customCommandIntent', revision: 11, operation: 'add', ...draft,
  }));
  assert.ok(parseControlCenterBrowserMessage({
    type: 'customCommandIntent', revision: 11, operation: 'edit',
    id: 'vm_abcdefghijklmnopqrstuv', ...draft,
  }));
  assert.equal(parseControlCenterBrowserMessage({
    type: 'customCommandIntent', revision: 11, operation: 'add', ...draft,
    rawJson: '{"authority":true}',
  }), undefined);
});

test('management projections are closed, paged, and contain presentation fields only', () => {
  assert.ok(parseControlCenterHostMessage({
    type: 'planningProviderState', revision: 9, selectedProvider: 'openai',
    items: [{
      id: 'openai', name: 'OpenAI', enabled: true, model: 'gpt-5', locality: 'remote',
      credentialRequired: true, credentialConfigured: true,
      consentRequired: true, consentAcknowledged: true,
    }],
  }));
  assert.ok(parseControlCenterHostMessage({
    type: 'agentPageState', revision: 9, pageIndex: 1, pageSize: 8,
    totalCount: 1, pageRowCount: 1, items: [{
      id: 'agent_abcdefghijkl', name: 'Agent', description: 'Planning assistant',
      provider: 'openai', model: 'gpt-5', enabled: true,
      isDefault: true, instructionsConfigured: true,
    }],
  }));
  assert.ok(parseControlCenterHostMessage({
    type: 'customCommandPageState', revision: 9, pageIndex: 1, pageSize: 10,
    totalCount: 1, pageRowCount: 1, items: [{
      id: 'vm_abcdefghijklmnopqrstuv', label: 'Open review', description: '',
      kind: 'command', targetId: 'workbench.action.openSettings',
      enabled: true, agentEnabled: false,
    }],
  }));
  assert.equal(parseControlCenterHostMessage({
    type: 'agentPageState', revision: 9, pageIndex: 1, pageSize: 8,
    totalCount: 1, pageRowCount: 1, items: [{
      id: 'agent_abcdefghijkl', name: 'Agent', description: '', provider: 'openai',
      model: 'gpt-5', enabled: true, isDefault: true, instructionsConfigured: true,
      instructions: 'must remain host-only',
    }],
  }), undefined);
});

test('setup and diagnostics projections are bounded, revisioned, and authority-free', () => {
  assert.ok(parseControlCenterHostMessage({
    type: 'setupState', revision: 12,
    microphoneState: 'signal-detected', microphoneLabel: 'WH-1000XM5',
    systemTtsEnabled: true, systemTtsVoiceIndex: 0, systemTtsRate: 1.1,
    stepStates: ['complete', 'complete', 'complete', 'pending'], recommendedStep: 4,
  }));
  assert.ok(parseControlCenterHostMessage({
    type: 'diagnosticsState', revision: 12, status: 'ready', summary: 'Checks complete',
    checks: [{ kind: 'microphone', status: 'ready', message: 'Non-zero signal observed.' }],
    canOpen: true, canCopy: true,
  }));
  assert.equal(parseControlCenterHostMessage({
    type: 'setupState', revision: 12,
    microphoneState: 'signal-detected', microphoneLabel: 'Input',
    systemTtsEnabled: true, systemTtsVoiceIndex: 0, systemTtsRate: 1,
    stepStates: ['complete', 'complete', 'attention', 'pending'], recommendedStep: 3,
    authorityId: 'forbidden',
  }), undefined);
  assert.equal(parseControlCenterHostMessage({
    type: 'setupState', revision: 12,
    microphoneState: 'signal-detected', microphoneLabel: 'Input',
    systemTtsEnabled: true, systemTtsVoiceIndex: 0, systemTtsRate: 1,
    stepStates: ['complete', 'pending', 'complete', 'pending'], recommendedStep: 4,
  }), undefined);
  assert.equal(parseControlCenterHostMessage({
    type: 'setupState', revision: 12,
    microphoneState: 'signal-detected', microphoneLabel: 'Input',
    systemTtsEnabled: true, systemTtsVoiceIndex: 0, systemTtsRate: 1,
    stepStates: ['complete', 'complete', 'complete'], recommendedStep: 4,
  }), undefined);
  assert.equal(parseControlCenterHostMessage({
    type: 'setupState', revision: 12,
    microphoneState: 'signal-detected', microphoneLabel: 'Input',
    systemTtsEnabled: true, systemTtsVoiceIndex: 0, systemTtsRate: 1,
    stepStates: new Array(4), recommendedStep: 4,
  }), undefined);
  assert.equal(parseControlCenterHostMessage({
    type: 'diagnosticsState', revision: 12, status: 'ready', summary: 'Checks complete',
    checks: [], canOpen: true, canCopy: true, secret: 'forbidden',
  }), undefined);
});

test('command filters compose internally while restoring independent visible values', () => {
  const token = serializeCommandFilterState({
    query: 'copy selection', category: 'editing', enabledOnly: true, changedOnly: true,
  });
  assert.equal(token, 'v1:1:1:1:copy selection');
  assert.deepEqual(parseCommandFilterState(token), {
    query: 'copy selection', category: 'editing', enabledOnly: true, changedOnly: true,
  });
  const changedQuery = updateCommandFilterState(token, { query: 'git status' });
  assert.deepEqual(parseCommandFilterState(changedQuery), {
    query: 'git status', category: 'editing', enabledOnly: true, changedOnly: true,
  });
  assert.equal(parseCommandFilterState(changedQuery).query.includes('v1:'), false);
  assert.deepEqual(parseCommandFilterState('enabled:true'), {
    query: '', enabledOnly: true, changedOnly: false,
  });
});

function tableTypes(document: string, startHeading: string, endHeading: string): string[] {
  const start = document.indexOf(startHeading);
  const end = document.indexOf(endHeading, start + startHeading.length);
  assert.ok(start >= 0 && end > start);
  return Array.from(document.slice(start, end).matchAll(/^\| `([^`]+)` \|/gmu), (match) => match[1]);
}

function contractTypes(source: string, startMarker: string, endMarker?: string): string[] {
  const start = source.indexOf(startMarker);
  const end = endMarker === undefined
    ? source.length
    : source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start);
  return Array.from(new Set(
    Array.from(source.slice(start, end).matchAll(/\btype:\s*'([^']+)'/gu), (match) => match[1]),
  ));
}

test('enabled system speech stays configured-unverified until browser voice observation exists', async () => {
  const coordinator = new ControlCenterStateCoordinator({
    settings: { read: () => ({
      values: {
        uiLanguage: 'en', transcriptionProvider: 'none', assistantSpeechEnabled: true,
      },
      workspaceOverrides: [],
    }) },
    credentials: { status: async () => ({ provider: 'soniox', configured: false }) },
    sonioxConsent: { capture: async () => undefined },
    autoMode: { snapshot: () => ({ effective: false }) },
    builtins: { isKnownCommandId: () => false },
    mappings: { pendingAction: undefined, pendingBuiltin: undefined },
    devices: { hasCachedResult: false, cachedDevices: [], selectionStatus: undefined },
    latestTranscript: async () => undefined,
    enableAuto: async () => false,
    disableAuto: async () => undefined,
    setupSoniox: async () => undefined,
    selectNoProvider: async () => undefined,
    microphone: async () => undefined,
    confirmPending: async () => undefined,
    cancelPending: () => undefined,
    publish: () => undefined,
    log: () => undefined,
  } as never);

  const projection = await coordinator.readProjection({ route: 'voice' });
  assert.equal(projection.capabilities.systemTtsState, 'configured-unverified');
  assert.notEqual(projection.capabilities.systemTtsState, 'ready');
  assert.ok(parseControlCenterHostMessage({
    type: 'stateSnapshot',
    revision: 1,
    state: {
      route: 'voice', routeState: 'not-configured', language: 'en', direction: 'ltr',
      effectiveAutoMode: false,
    },
    capabilities: projection.capabilities,
  }));
});

test('persistence and legacy deep links retain only bounded route/filter/page', () => {
  assert.deepEqual(sanitizeControlCenterDisplayState({
    route: 'commands', filter: 'git', page: 2, commandId: 'private', setupStep: 4,
    receipt: 'forged', modal: 'open', direction: 'rtl',
  }), { route: 'commands', filter: 'git', page: 2 });
  assert.deepEqual(normalizeControlCenterDeepLink('mappings', { page: 3 }), {
    route: 'commands', params: { page: 3 },
  });
  assert.deepEqual(normalizeControlCenterDeepLink('unknown', { page: 3 }), {
    route: 'home', params: Object.create(null),
  });
  assert.deepEqual(normalizeControlCenterDeepLink('commands', { page: 3, receipt: 'forged' }), {
    route: 'home', params: Object.create(null),
  });
});
