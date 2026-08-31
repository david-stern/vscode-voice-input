import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PLANNER_PROVIDER_IDS,
  isSettingsHostMessage,
  isSettingsWebviewMessage,
  parseSettingsWebviewMessage,
  projectSettingsViewState,
  serializeSettingsViewState,
  type SettingsViewState,
} from '../src/webview/settings/protocol';
import { createInitialSettingsState } from '../src/webview/settings/state';
import { projectCompatibilityPresentation } from '../src/webview/settings/presentation';

const MAPPING_ID = 'vm_abcdefghijklmnopqrstuv';
const AGENT_ID = 'agent_abcdefghijkl';

function providerCard(id: (typeof PLANNER_PROVIDER_IDS)[number] = 'deepseek') {
  return {
    id,
    name: id,
    enabled: true,
    selected: id === 'deepseek',
    configured: true,
    model: `${id}-model`,
    modelPresets: [`${id}-model`],
    endpointHost: id === 'ollama' ? '127.0.0.1' : `api.${id}.example`,
    locality: id === 'ollama' ? 'local-loopback' as const : 'remote' as const,
    credentialRequired: id !== 'ollama',
    consentRequired: id !== 'ollama',
    consentAcknowledged: true,
    credential: { phase: 'idle' as const, operationRevision: 0 },
    test: { phase: 'idle' as const, operationRevision: 0 },
  };
}

test('settings host boundary accepts every capability family with exact safe payloads', () => {
  const valid: unknown[] = [
    { type: 'settings-ready' },
    { type: 'settings-change', settingsRevision: 2, setting: 'uiLanguage', value: 'he' },
    { type: 'settings-change', settingsRevision: 2, setting: 'languageHint', value: 'auto' },
    { type: 'settings-change', settingsRevision: 2, setting: 'sttModel', value: 'stt-async-v4' },
    { type: 'settings-change', settingsRevision: 2, setting: 'historyTtlDays', value: 7 },
    { type: 'settings-change', settingsRevision: 2, setting: 'injectionMode', value: 'auto' },
    { type: 'settings-change', settingsRevision: 2, setting: 'assistantWakePhrase', value: '' },
    { type: 'settings-change', settingsRevision: 2, setting: 'assistantPersona', value: 'friend' },
    { type: 'settings-change', settingsRevision: 2, setting: 'assistantIntelligence', value: 'off' },
    { type: 'settings-change', settingsRevision: 2, setting: 'deepSeekModel', value: 'deepseek-v4-flash' },
    { type: 'settings-change', settingsRevision: 2, setting: 'deepSeekModel', value: '' },
    { type: 'settings-change', settingsRevision: 2, setting: 'assistantSpeechEnabled', value: true },
    { type: 'settings-change', settingsRevision: 2, setting: 'assistantSpeechVoiceUri', value: '' },
    { type: 'settings-change', settingsRevision: 2, setting: 'assistantSpeechRate', value: 1.4 },
    { type: 'settings-change', settingsRevision: 2, setting: 'audioDevice', value: '' },
    { type: 'settings-open-keybindings', operationRevision: 1 },
    { type: 'settings-open-native', operationRevision: 2 },
    { type: 'settings-open-native', operationRevision: 3, setting: 'audioDevice' },
    { type: 'settings-assistant-action', operationRevision: 4, action: 'start' },
    { type: 'settings-consent-action', consentRevision: 5, consent: 'deepseek', action: 'acknowledge' },
    { type: 'settings-provider-credential', operationRevision: 6, provider: 'soniox', action: 'replace' },
    { type: 'settings-provider-test', operationRevision: 7, provider: 'deepseek', action: 'start' },
    ...PLANNER_PROVIDER_IDS.flatMap((provider) => [
      { type: 'settings-provider-select', providerRevision: 8, provider },
      { type: 'settings-provider-profile', providerRevision: 8, provider, enabled: true, model: `${provider}-model` },
      { type: 'settings-consent-action', consentRevision: 5, consent: provider, action: 'acknowledge' },
    ]),
    { type: 'settings-provider-select', providerRevision: 8, provider: 'off' },
    { type: 'settings-agent-create', agentRevision: 9, templateId: 'teacher-lecturer' },
    { type: 'settings-agent-update-profile', agentRevision: 9, id: AGENT_ID, provider: 'openai', model: 'gpt-5' },
    { type: 'settings-agent-duplicate', agentRevision: 9, id: AGENT_ID },
    { type: 'settings-agent-set-enabled', agentRevision: 9, id: AGENT_ID, enabled: false },
    { type: 'settings-agent-set-default', agentRevision: 9, id: AGENT_ID },
    { type: 'settings-agent-delete', agentRevision: 9, id: AGENT_ID },
    { type: 'settings-speech-stop', operationRevision: 8 },
    { type: 'settings-microphone-scan', operationRevision: 9 },
    { type: 'settings-mapping-add', mappingsRevision: 10 },
    { type: 'settings-mapping-edit', mappingsRevision: 10, id: MAPPING_ID },
    { type: 'settings-mapping-toggle-enabled', mappingsRevision: 10, id: MAPPING_ID },
    { type: 'settings-mapping-toggle-agent', mappingsRevision: 10, id: MAPPING_ID },
    { type: 'settings-mapping-approval', mappingsRevision: 10, id: MAPPING_ID, action: 'grant' },
    { type: 'settings-mapping-delete', mappingsRevision: 10, id: MAPPING_ID },
    { type: 'settings-diagnostics-action', operationRevision: 11, action: 'copy' },
  ];

  for (const message of valid) {
    assert.equal(isSettingsWebviewMessage(message), true, JSON.stringify(message));
    assert.equal(parseSettingsWebviewMessage(message), message);
  }
});

test('settings host boundary rejects over-posting, inherited values, secrets, and malformed authority', () => {
  const inherited = Object.create({ type: 'settings-ready' }) as Record<string, unknown>;
  const invalid: unknown[] = [
    null,
    [],
    inherited,
    { type: 'ready' },
    { type: 'settings-ready', revision: 1 },
    { type: 'settings-change', settingsRevision: -1, setting: 'uiLanguage', value: 'he' },
    { type: 'settings-change', settingsRevision: 1, setting: 'uiLanguage', value: 'ar' },
    { type: 'settings-change', settingsRevision: 1, setting: 'historyTtlDays', value: 2 },
    { type: 'settings-change', settingsRevision: 1, setting: 'assistantSpeechRate', value: Infinity },
    { type: 'settings-change', settingsRevision: 1, setting: 'apiKey', value: 'secret' },
    { type: 'settings-provider-credential', operationRevision: 1, provider: 'soniox', action: 'set', apiKey: 'secret' },
    { type: 'settings-provider-test', operationRevision: 1, provider: 'other', action: 'start' },
    { type: 'settings-provider-profile', providerRevision: 1, provider: 'openai', enabled: true, model: 'gpt-5', apiKey: 'secret' },
    { type: 'settings-provider-profile', providerRevision: 1, provider: 'openai', enabled: true, model: '' },
    { type: 'settings-provider-select', providerRevision: 1, provider: 'soniox' },
    { type: 'settings-agent-update-profile', agentRevision: 1, id: AGENT_ID, provider: 'openai', model: 'gpt-5', instructions: 'private' },
    { type: 'settings-agent-set-default', agentRevision: 1, id: 'teacher' },
    { type: 'settings-consent-action', consentRevision: 1, consent: 'deepseek', action: 'grant-silently' },
    { type: 'settings-mapping-edit', mappingsRevision: 1, id: 'editor.formatDocument' },
    { type: 'settings-mapping-toggle-enabled', mappingsRevision: 1, id: MAPPING_ID, enabled: true },
    { type: 'settings-mapping-delete', mappingsRevision: 1, id: MAPPING_ID, args: [] },
    { type: 'settings-diagnostics-action', operationRevision: 1, action: 'export-secrets' },
  ];

  for (const message of invalid) {
    assert.equal(isSettingsWebviewMessage(message), false, JSON.stringify(message));
    assert.equal(parseSettingsWebviewMessage(message), undefined);
  }
});

test('settings state projection drops secrets, provider bodies, paths, mapping args and tool input', () => {
  const base = createInitialSettingsState();
  const state: SettingsViewState = {
    ...base,
    revision: 4,
    general: {
      ...base.general,
      settingsRevision: 3,
      workspaceOverrides: [{
        setting: 'uiLanguage',
        source: 'workspace',
        globalValue: 'en',
        effectiveValue: 'he',
      }],
    },
    mappings: {
      revision: 8,
      status: 'ready',
      items: [{
        id: MAPPING_ID,
        label: 'Format document',
        description: 'Formats the active document',
        phrases: ['format document'],
        kind: 'command',
        targetId: 'editor.action.formatDocument',
        enabled: true,
        agentEnabled: false,
        approval: 'approved',
        permissionTier: 'always-approved',
      }],
      approvalHistory: [{ mappingId: MAPPING_ID, decision: 'granted', timestamp: 123 }],
    },
    providers: {
      revision: 2,
      selectedProvider: 'deepseek',
      items: [providerCard()],
    },
    agents: {
      revision: 2,
      status: 'ready',
      defaultAgentId: AGENT_ID,
      items: [{
        id: AGENT_ID,
        name: 'Teacher',
        description: 'Safe description',
        provider: 'deepseek',
        model: 'deepseek-chat',
        persona: 'teacher-lecturer',
        enabled: true,
        isDefault: true,
        instructionsConfigured: true,
        speechEnabled: true,
        speechRate: 1,
      }],
    },
  };
  const unsafe = {
    ...state,
    apiKey: 'soniox-secret',
    username: 'private-user',
    path: '/home/private-user/project',
    providers: {
      ...state.providers,
      items: state.providers.items.map((provider) => ({
        ...provider,
        endpointHost: 'https://private-user:secret@example.test/private/path',
        endpoint: 'https://private-user:secret@example.test/private/path',
        authorization: 'Bearer provider-secret',
        responseBody: 'raw-provider-body',
      })),
    },
    agents: {
      ...state.agents,
      items: state.agents.items.map((agent) => ({
        ...agent,
        instructions: 'private raw instructions',
        voiceUri: '/home/private-user/voice',
      })),
    },
    mappings: {
      ...state.mappings,
      items: [{
        ...state.mappings.items[0],
        args: ['hidden-argument'],
        input: { hidden: 'tool-input' },
        fingerprint: 'private-fingerprint',
      }],
    },
  } as SettingsViewState;

  const projected = projectSettingsViewState(unsafe);
  const serialized = serializeSettingsViewState(unsafe);
  assert.deepEqual(projected.general.workspaceOverrides, [{
    setting: 'uiLanguage',
    source: 'workspace',
    globalValue: 'en',
    effectiveValue: 'he',
  }]);
  assert.deepEqual(projected.mappings.items[0], state.mappings.items[0]);
  assert.equal(projected.providers.items[0]?.endpointHost, 'invalid-endpoint');
  for (const forbidden of [
    'soniox-secret', 'private-user', '/home/', 'provider-secret', 'raw-provider-body',
    'hidden-argument', 'tool-input', 'private-fingerprint', 'authorization', 'responseBody',
    'private raw instructions', 'private/path',
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test('settings host messages require a monotonic envelope shape and a known section', () => {
  assert.equal(isSettingsHostMessage({ type: 'settings-state', payload: createInitialSettingsState() }), true);
  assert.equal(isSettingsHostMessage({ type: 'settings-navigate', revision: 3, section: 'privacy' }), true);
  assert.equal(isSettingsHostMessage({ type: 'settings-navigate', revision: 3, section: 'secrets' }), false);
  assert.equal(isSettingsHostMessage({ type: 'settings-navigate', revision: 3, section: 'privacy', focus: 'api-key' }), false);
});

test('compatibility presentation separates STT, reasoning, TTS, agents, and action approvals without secrets', () => {
  const state = createInitialSettingsState();
  state.transcription.configured = true;
  state.providers.items = [providerCard()];
  state.agents = {
    revision: 1,
    status: 'ready',
    defaultAgentId: AGENT_ID,
    items: [{
      id: AGENT_ID,
      name: 'Teacher',
      description: 'Safe',
      provider: 'deepseek',
      model: 'deepseek-chat',
      persona: 'teacher-lecturer',
      enabled: true,
      isDefault: true,
      instructionsConfigured: true,
      speechEnabled: true,
      speechRate: 1,
    }],
  };
  state.mappings = {
    revision: 1,
    status: 'ready',
    items: [{
      id: MAPPING_ID,
      label: 'Run tests',
      description: 'Runs a saved task',
      phrases: ['run tests'],
      kind: 'command',
      targetId: 'workbench.action.tasks.test',
      enabled: true,
      agentEnabled: true,
      approval: 'none',
      permissionTier: 'confirmation-required',
    }],
    approvalHistory: [],
  };

  const unsafe = {
    ...state,
    apiKey: 'browser-secret',
    providers: {
      ...state.providers,
      items: [{ ...state.providers.items[0], apiKey: 'soniox-secret' }],
    },
    mappings: {
      ...state.mappings,
      items: [{ ...state.mappings.items[0], args: ['hidden'], input: { private: true } }],
    },
  } as SettingsViewState;
  const projection = projectCompatibilityPresentation(unsafe);
  assert.deepEqual(projection.providers.map(({ id, role, execution }) => ({ id, role, execution })), [
    { id: 'soniox', role: 'speech-to-text', execution: 'remote' },
    { id: 'deepseek', role: 'reasoning', execution: 'remote' },
    { id: 'system-tts', role: 'text-to-speech', execution: 'system' },
  ]);
  assert.equal(projection.agents[0].authority, 'host-policy');
  assert.equal(projection.agents[0].approval, 'explicit-before-send-or-action');
  assert.equal(projection.actions[0].approval, 'host-confirmed');
  const serialized = JSON.stringify(projection);
  for (const forbidden of ['browser-secret', 'soniox-secret', 'hidden', 'private', 'apiKey', 'args', 'input']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test('microphone recovery projection copies only the safe status summary', () => {
  const state = createInitialSettingsState();
  const unsafe = {
    ...state,
    microphone: {
      ...state.microphone,
      status: 'unavailable' as const,
      selection: {
        kind: 'stale' as const,
        status: 'unavailable' as const,
        recovery: 'select-device' as const,
        label: '/home/david/.config/private-device',
        previousDeviceId: '/home/david/.config/private-device',
        token: 'secret-token',
      },
    },
  } as SettingsViewState;
  const projected = projectSettingsViewState(unsafe);
  assert.deepEqual(projected.microphone.selection, {
    kind: 'stale', status: 'unavailable', recovery: 'select-device',
  });
  const serialized = serializeSettingsViewState(unsafe);
  assert.doesNotMatch(serialized, /private-device|secret-token|\/home\//u);
});
