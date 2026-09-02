import assert from 'node:assert/strict';
import test from 'node:test';

import { MicMessageRouter } from '../src/features/commands/micMessageRouter';
import { parseMicProviderInboundMessage } from '../src/webview/mic/providerMessages';
import { parseWebviewMessage, type WebviewMessage } from '../src/webview/protocol';

const LEGACY_AUTHORITY_MESSAGES = [
  { type: 'assistant-pending-send-confirm', id: 'forged-send' },
  { type: 'assistant-pending-send-cancel', id: 'forged-send' },
  { type: 'assistant-pending-action-confirm', id: 'forged-action' },
  { type: 'assistant-pending-action-cancel', id: 'forged-action' },
] as const;

test('compact microphone protocol rejects legacy browser-authored authority IDs', () => {
  for (const message of LEGACY_AUTHORITY_MESSAGES) {
    assert.equal(parseWebviewMessage(message), undefined, message.type);
  }
});

test('microphone provider boundary forwards safe controls but drops legacy authority messages', () => {
  assert.deepEqual(parseMicProviderInboundMessage({ type: 'toggle' }), {
    kind: 'legacy-safe', message: { type: 'toggle' },
  });
  assert.deepEqual(parseMicProviderInboundMessage({
    type: 'mic-control-center-open', route: 'commands',
  }), {
    kind: 'compact', message: { type: 'mic-control-center-open', route: 'commands' },
  });
  for (const message of LEGACY_AUTHORITY_MESSAGES) {
    assert.equal(parseMicProviderInboundMessage(message), undefined, message.type);
  }
});

test('microphone router cannot dispatch forged legacy confirmation or cancellation messages', async () => {
  const calls: string[] = [];
  const router = new MicMessageRouter({
    settings: {} as never,
    consents: {} as never,
    history: {} as never,
    recording: {} as never,
    devices: {} as never,
    metadata: {} as never,
    assistant: {
      state: { pendingSend: { id: 'forged-send', preview: 'private' } },
      confirmPendingSend: async () => { calls.push('confirm-send'); },
      clearPendingSend: () => { calls.push('cancel-send'); },
      nextId: () => 'browser-derived-confirmation',
    } as never,
    mappings: {
      confirmIfPending: async () => { calls.push('confirm-action'); },
      cancelIfPending: () => { calls.push('cancel-action'); },
    } as never,
    state: {} as never,
    ui: {} as never,
    openSettingsCenter: async () => undefined,
  });

  for (const message of LEGACY_AUTHORITY_MESSAGES) {
    await router.route(message as unknown as WebviewMessage);
  }

  assert.deepEqual(calls, []);
});
