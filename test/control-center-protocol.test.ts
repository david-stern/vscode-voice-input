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
import {
  ControlCenterRevisionWindow,
  classifyControlCenterIntent,
  evaluateControlCenterIntent,
  type ControlCenterIntentMessage,
} from '../src/features/controlCenter/intentGate';

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
    { type: 'systemTtsIntent', revision: 10, operation: 'preview' },
    { type: 'systemTtsIntent', revision: 10, operation: 'preview-stop' },
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
    // The host fallback identity is appended host-side; a browser may not claim it.
    { type: 'systemTtsVoicesObservedIntent', revision: 10, voices: [{
      voiceUri: 'voice-input-host:speech-dispatcher', name: 'System speech',
      language: 'he', isDefault: false,
    }] },
    // Neither may a browser impersonate a remote voice whose key it never holds.
    { type: 'systemTtsVoicesObservedIntent', revision: 10, voices: [{
      voiceUri: 'voice-input-soniox:Maya', name: 'Soniox Maya',
      language: '', isDefault: false,
    }] },
    { type: 'systemTtsVoicesObservedIntent', revision: 10, voices: [
      { voiceUri: 'os:he-IL', name: 'System Hebrew', language: 'he-IL', isDefault: true },
      { voiceUri: 'voice-input-soniox:Adrian', name: 'Soniox Adrian', language: '', isDefault: false },
    ] },
    { type: 'systemTtsVoicesObservedIntent', revision: 10,
      voices: Array.from({ length: 21 }, (_, index) => ({
        voiceUri: `os:voice-${index}`, name: `Voice ${index}`, language: 'he-IL', isDefault: false,
      })) },
    { type: 'systemTtsIntent', revision: 10, operation: 'set-voice', voiceIndex: 50 },
    { type: 'systemTtsIntent', revision: 10, operation: 'set-rate', rate: 2.1 },
    // The host composes its own preview text, so the browser can never author one.
    { type: 'systemTtsIntent', revision: 10, operation: 'preview', text: 'browser-authored' },
    { type: 'systemTtsIntent', revision: 10, operation: 'preview', voiceIndex: 0 },
    { type: 'systemTtsIntent', revision: 10, operation: 'previewing' },
    { type: 'systemTtsIntent', revision: 10, operation: 'preview-stop', text: 'browser-authored' },
    { type: 'systemTtsIntent', revision: 10, operation: 'preview-stop', voiceIndex: 0 },
    { type: 'systemTtsIntent', revision: 10, operation: 'preview-stopping' },
    { type: 'diagnosticsIntent', revision: 10, operation: 'run', requestSequence: 1,
      results: ['browser-authored'] },
    { type: 'commandEditIntent', revision: 10, commandId: 'editor.copy', operation: 'open' },
  ]) assert.equal(parseControlCenterBrowserMessage(rejected), undefined);
});

test('every browser intent family is deliberately classified before the revision gate runs', () => {
  const commandId = 'editor.copy';
  const mappingId = 'vm_abcdefghijklmnopqrstuv';
  const samples: Array<[Record<string, unknown>, 'lenient' | 'strict']> = [
    [{ type: 'navigateIntent', revision: 3, route: 'commands' }, 'lenient'],
    [{ type: 'setFilterIntent', revision: 3, filter: 'git' }, 'lenient'],
    [{ type: 'setPageIntent', revision: 3, page: 2 }, 'lenient'],
    [{ type: 'setManagementPageIntent', revision: 3, target: 'agents', page: 2 }, 'lenient'],
    [{ type: 'openOverlayIntent', revision: 3, kind: 'narrow-nav' }, 'lenient'],
    [{ type: 'closeOverlayIntent', revision: 3, reason: 'escape' }, 'lenient'],
    [{ type: 'openPendingReviewIntent', revision: 3 }, 'lenient'],
    [{ type: 'micIntent', revision: 3, action: 'start' }, 'lenient'],
    [{ type: 'microphoneSetupIntent', revision: 3, operation: 'test-signal' }, 'lenient'],
    [{ type: 'systemTtsVoicesObservedIntent', revision: 3, voices: [] }, 'lenient'],
    [{ type: 'systemTtsIntent', revision: 3, operation: 'set-enabled', enabled: true }, 'lenient'],
    [{ type: 'systemTtsIntent', revision: 3, operation: 'set-rate', rate: 1.5 }, 'lenient'],
    // 'set-voice' selects local vs remote (Soniox) synthesis, so it must see the latest state.
    [{ type: 'systemTtsIntent', revision: 3, operation: 'set-voice', voiceIndex: 0 }, 'strict'],
    [{ type: 'systemTtsIntent', revision: 3, operation: 'preview' }, 'lenient'],
    [{ type: 'systemTtsIntent', revision: 3, operation: 'preview-stop' }, 'lenient'],
    [{ type: 'diagnosticsIntent', revision: 3, operation: 'run', requestSequence: 1 }, 'lenient'],
    [{ type: 'commandEditIntent', revision: 3, commandId, operation: 'open', requestSequence: 1 }, 'lenient'],
    [{ type: 'commandEditIntent', revision: 3, commandId, operation: 'reset' }, 'strict'],
    [{ type: 'commandEditIntent', revision: 3, commandId, operation: 'set-enabled', value: false }, 'strict'],
    [{ type: 'commandEditIntent', revision: 3, commandId, operation: 'replace-phrases', value: ['copy'] }, 'strict'],
    [{ type: 'pendingReviewIntent', revision: 3, decision: 'request-native-confirmation' }, 'strict'],
    [{ type: 'pendingReviewIntent', revision: 3, decision: 'cancel' }, 'strict'],
    [{ type: 'requestAutoEnableIntent', revision: 3 }, 'strict'],
    [{ type: 'disableAutoIntent', revision: 3 }, 'strict'],
    [{ type: 'providerSetupIntent', revision: 3, provider: 'soniox', request: 'configure-secret' }, 'strict'],
    [{ type: 'planningProviderIntent', revision: 3, provider: 'openai', operation: 'set-credential' }, 'strict'],
    [{ type: 'agentManagementIntent', revision: 3, operation: 'set-default', id: 'agent_abcdefghijkl' }, 'strict'],
    [{ type: 'customCommandIntent', revision: 3, operation: 'delete', id: mappingId }, 'strict'],
    [{ type: 'customCommandIntent', revision: 3, operation: 'open', id: mappingId, requestSequence: 1 }, 'strict'],
  ];
  const covered = new Set<string>();
  for (const [raw, tier] of samples) {
    const message = parseControlCenterBrowserMessage(raw);
    assert.ok(message && message.type !== 'ready' && message.type !== 'ack', JSON.stringify(raw));
    covered.add(message.type);
    assert.equal(classifyControlCenterIntent(message), tier, JSON.stringify(raw));
  }
  const families = contractTypes(
    readFileSync('src/webview/controlCenter/contractMessages.ts', 'utf8'),
    'export type ControlCenterBrowserMessage =', 'export type ControlCenterHostMessage =',
  ).filter((type) => type !== 'ready' && type !== 'ack');
  assert.deepEqual([...covered].sort(), [...families].sort());
});

test('the revision gate accepts only delivered revisions and keeps privileged intents current', () => {
  const window = new ControlCenterRevisionWindow();
  for (let revision = 1; revision <= 9; revision += 1) window.record(revision);
  assert.equal(window.size, 8);
  assert.equal(window.has(1), false, 'the ninth delivery evicts the oldest revision');
  assert.equal(window.has(2), true);
  const gate = { currentRevision: 9, sentRevision: 9, recentRevisions: window };
  const navigate: ControlCenterIntentMessage = { type: 'navigateIntent', revision: 2, route: 'home' };
  const confirm: ControlCenterIntentMessage = {
    type: 'pendingReviewIntent', revision: 2, decision: 'request-native-confirmation',
  };
  assert.deepEqual(evaluateControlCenterIntent(navigate, gate), { accepted: true, tier: 'lenient' });
  assert.deepEqual(evaluateControlCenterIntent({ ...navigate, revision: 1 }, gate), {
    accepted: false, reason: 'stale-revision',
  });
  assert.deepEqual(evaluateControlCenterIntent(confirm, gate), {
    accepted: false, reason: 'stale-revision-strict',
  });
  assert.deepEqual(evaluateControlCenterIntent({ ...confirm, revision: 9 }, gate), {
    accepted: true, tier: 'strict',
  });
  // A revision that was allocated but never delivered is unknown to both tiers.
  const undelivered = { currentRevision: 10, sentRevision: 9, recentRevisions: window };
  for (const message of [navigate, confirm]) {
    assert.deepEqual(evaluateControlCenterIntent({ ...message, revision: 10 }, undelivered), {
      accepted: false, reason: 'stale-revision',
    });
  }
  window.clear();
  assert.equal(window.has(9), false, 'a new panel attachment starts with no acceptable revision');
  assert.deepEqual(evaluateControlCenterIntent({ ...navigate, revision: 9 }, {
    currentRevision: 9, sentRevision: undefined, recentRevisions: window,
  }), { accepted: false, reason: 'stale-revision' });
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
    type: 'setupState', revision: 12,
    microphoneState: 'signal-detected', microphoneLabel: 'WH-1000XM5',
    systemTtsEnabled: true, systemTtsVoiceIndex: 0, systemTtsRate: 1.1,
    stepStates: ['complete', 'complete', 'complete', 'pending'], recommendedStep: 4,
    hostVoices: [{
      voiceUri: 'voice-input-host:speech-dispatcher', name: 'System speech (speech-dispatcher)',
      language: 'he', isDefault: false,
    }],
  }));
  for (const rejected of [
    [],
    [{ voiceUri: 'a', name: 'A', language: 'he', isDefault: false },
      { voiceUri: 'b', name: 'B', language: 'he', isDefault: false },
      { voiceUri: 'c', name: 'C', language: 'he', isDefault: false }],
    [{ voiceUri: 'voice-input-host:speech-dispatcher', name: 'A', language: 'he', isDefault: false },
      { voiceUri: 'voice-input-host:speech-dispatcher', name: 'A', language: 'he', isDefault: false }],
    [{ voiceUri: 'voice-input-host:speech-dispatcher', name: 'A', language: 'he', isDefault: false,
      authorityId: 'forbidden' }],
    [{ voiceUri: '', name: 'A', language: 'he', isDefault: false }],
    // An arbitrary URI on the host channel would render an unplayable dropdown entry.
    [{ voiceUri: 'os:he-IL', name: 'System Hebrew', language: 'he-IL', isDefault: false }],
    'voice-input-host:speech-dispatcher',
  ]) assert.equal(parseControlCenterHostMessage({
    type: 'setupState', revision: 12,
    microphoneState: 'signal-detected', microphoneLabel: 'WH-1000XM5',
    systemTtsEnabled: true, systemTtsVoiceIndex: 0, systemTtsRate: 1.1,
    stepStates: ['complete', 'complete', 'complete', 'pending'], recommendedStep: 4,
    hostVoices: rejected,
  }), undefined, JSON.stringify(rejected));
  // Soniox voices travel as bare ids on the same host channel: only the host holds their
  // key and their machine/profile-local remote-processing receipt.
  assert.ok(parseControlCenterHostMessage({
    type: 'setupState', revision: 12,
    microphoneState: 'signal-detected', microphoneLabel: 'WH-1000XM5',
    systemTtsEnabled: true, systemTtsVoiceIndex: 28, systemTtsRate: 1.1,
    stepStates: ['complete', 'complete', 'complete', 'pending'], recommendedStep: 4,
    hostVoices: [{
      voiceUri: 'voice-input-host:speech-dispatcher', name: 'System speech (speech-dispatcher)',
      language: 'he', isDefault: false,
    }],
    sonioxVoices: sonioxVoiceIds(28),
  }));
  for (const rejected of [
    [],
    sonioxVoiceIds(29),
    ['Maya', 'Maya'],
    ['0bad'],
    ['has space'],
    ['M'.repeat(65)],
    [42],
    [{ voiceUri: 'voice-input-soniox:Maya', name: 'Maya', language: '', isDefault: false }],
    'Maya',
  ]) assert.equal(parseControlCenterHostMessage({
    type: 'setupState', revision: 12,
    microphoneState: 'signal-detected', microphoneLabel: 'WH-1000XM5',
    systemTtsEnabled: true, systemTtsVoiceIndex: 0, systemTtsRate: 1.1,
    stepStates: ['complete', 'complete', 'complete', 'pending'], recommendedStep: 4,
    sonioxVoices: rejected,
  }), undefined, JSON.stringify(rejected));
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

/** Host-channel Soniox voice ids, exactly as the coordinator projects them. */
function sonioxVoiceIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `Voice${index}`);
}

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

test('preview playback reaches the host without a refresh that would pull focus mid-utterance', async () => {
  const routed: string[] = [];
  const coordinator = new ControlCenterStateCoordinator({
    settings: { read: () => ({
      values: { uiLanguage: 'en', transcriptionProvider: 'none', assistantSpeechEnabled: true },
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
    operations: {
      systemTtsState: () => 'ready',
      systemTts: async (message: { operation: string }) => { routed.push(message.operation); },
    },
    publish: () => undefined,
    log: () => undefined,
  } as never);

  for (const operation of ['preview', 'preview-stop']) {
    assert.equal(
      await coordinator.handleIntent({ type: 'systemTtsIntent', revision: 1, operation } as never),
      undefined,
      `${operation} must not refresh the panel`,
    );
  }
  assert.deepEqual(
    await coordinator.handleIntent({
      type: 'systemTtsIntent', revision: 1, operation: 'set-rate', rate: 1.2,
    }),
    { refresh: true, focusTarget: { kind: 'route-h1' } },
    'a persisted change still refreshes and returns focus to the route heading',
  );
  assert.deepEqual(routed, ['preview', 'preview-stop', 'set-rate']);
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
