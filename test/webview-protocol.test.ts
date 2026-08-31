import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isWebviewMessage,
  isNewerRevision,
  isRevision,
  nextRevision,
  parseWebviewMessage,
  projectViewState,
  serializeViewState,
  type ViewState,
} from '../src/webview/protocol';

test('revision helpers accept only monotonic safe-integer progress', () => {
  assert.equal(isRevision(0), true);
  assert.equal(isRevision(-1), false);
  assert.equal(isRevision(1.5), false);
  assert.equal(isNewerRevision(4, 3), true);
  assert.equal(isNewerRevision(3, 3), false);
  assert.equal(isNewerRevision(2, 3), false);
  assert.equal(nextRevision(3), 4);
  assert.throws(() => nextRevision(Number.MAX_SAFE_INTEGER), RangeError);
});

test('accepts every current webview message family at the host boundary', () => {
  const validMessages: unknown[] = [
    { type: 'ready' },
    { type: 'toggle' },
    { type: 'start' },
    { type: 'stop' },
    { type: 'history-copy', id: 'entry-1' },
    { type: 'history-remove', id: 'entry-1' },
    { type: 'history-clear-request' },
    { type: 'set-api-key' },
    { type: 'open-keybindings' },
    { type: 'refresh-meta' },
    { type: 'audio-device-change', deviceId: '' },
    { type: 'audio-device-scan' },
    { type: 'assistant-enabled-change', enabled: true },
    { type: 'assistant-wake-phrase-change', wakePhrase: '' },
    { type: 'assistant-disclosure-acknowledged' },
    { type: 'assistant-persona-change', persona: 'teacher-lecturer' },
    { type: 'assistant-provider-manage' },
    { type: 'assistant-speech-settings-change', enabled: true, voiceUri: '', rate: 1.2 },
    { type: 'assistant-stop-speaking' },
    { type: 'assistant-speech-started', id: 'speech-1' },
    { type: 'assistant-speech-finished', id: 'speech-1', outcome: 'completed' },
    { type: 'assistant-pending-send-confirm', id: 'send-1' },
    { type: 'assistant-pending-send-cancel', id: 'send-1' },
    { type: 'assistant-mappings-manage' },
    { type: 'assistant-pending-action-confirm', id: 'action-1' },
    { type: 'assistant-pending-action-cancel', id: 'action-1' },
    { type: 'open-settings-center' },
    {
      type: 'settings-update',
      speechLang: 'he',
      uiLang: 'he',
      ttlDays: 30,
      model: 'stt-async-v4',
    },
  ];

  for (const message of validMessages) {
    assert.equal(isWebviewMessage(message), true, JSON.stringify(message));
    assert.equal(parseWebviewMessage(message), message);
  }
});

test('rejects malformed, unknown, inherited, or over-posted webview messages', () => {
  const inherited = Object.create({ type: 'ready' }) as Record<string, unknown>;
  const invalidMessages: unknown[] = [
    null,
    [],
    inherited,
    { type: 'unknown' },
    { type: 'ready', unexpected: true },
    { type: 'history-copy' },
    { type: 'history-copy', id: 7 },
    { type: 'history-clear' },
    { type: 'assistant-deepseek-setup' },
    { type: 'assistant-enabled-change', enabled: 'true' },
    { type: 'assistant-persona-change', persona: 'administrator' },
    { type: 'assistant-speech-settings-change', enabled: true, voiceUri: '', rate: Infinity },
    { type: 'assistant-speech-finished', id: 'speech-1', outcome: 'success' },
    { type: 'settings-update', speechLang: 'he', uiLang: 'ar', ttlDays: 30, model: 'x' },
    { type: 'settings-update', speechLang: 'he', uiLang: 'he', ttlDays: 2, model: 'x' },
  ];

  for (const message of invalidMessages) {
    assert.equal(isWebviewMessage(message), false, JSON.stringify(message));
    assert.equal(parseWebviewMessage(message), undefined);
  }
});

test('state projection serializes only allowlisted non-secret fields', () => {
  const state: ViewState = {
    uiLang: 'en',
    speechLang: 'he',
    ttlDays: 30,
    model: 'stt-async-v4',
    history: [{ id: 'h1', text: 'hello', lang: 'en', ts: 1 }],
    recording: false,
    keybinding: 'Alt+M',
    models: [{ id: 'stt-async-v4', type: 'async', description: 'Async' }],
    languages: [{ code: 'he', name: 'Hebrew' }],
    metaLoading: false,
    audioDevice: '',
    audioDevices: [{ id: 'default', label: 'Default' }],
    assistantPendingSend: { id: 'p1', preview: 'preview', targetLabel: 'Chat' },
    assistantPendingAction: { id: 'a1', label: 'Format', targetId: 'editor.format' },
    assistantProviderId: 'openai',
    assistantProviderName: 'OpenAI',
    assistantProviderStatus: 'ready',
  };
  const unsafeState = {
    ...state,
    apiKey: 'soniox-secret-value',
    deepSeekApiKey: 'deepseek-secret-value',
    history: [{ ...state.history[0], authorization: 'nested-secret-value' }],
    assistantPendingAction: {
      ...state.assistantPendingAction!,
      arguments: ['must-not-cross'],
      toolInput: { private: true },
    },
  } as ViewState;

  const projected = projectViewState(unsafeState);
  const serialized = serializeViewState(unsafeState);

  assert.deepEqual(projected.history, [{ id: 'h1', text: 'hello', lang: 'en', ts: 1 }]);
  assert.deepEqual(projected.assistantPendingAction, {
    id: 'a1',
    label: 'Format',
    targetId: 'editor.format',
  });
  assert.deepEqual({
    id: projected.assistantProviderId,
    name: projected.assistantProviderName,
    status: projected.assistantProviderStatus,
  }, { id: 'openai', name: 'OpenAI', status: 'ready' });
  for (const forbidden of [
    'apiKey',
    'deepSeekApiKey',
    'authorization',
    'arguments',
    'toolInput',
    'soniox-secret-value',
    'deepseek-secret-value',
    'nested-secret-value',
    'must-not-cross',
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});
