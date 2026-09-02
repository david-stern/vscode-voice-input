import assert from 'node:assert/strict';
import test from 'node:test';

import { TranscriptionService } from '../src/features/recording/transcriptionService';
import {
  NO_SPEECH_CAPABILITIES,
  SONIOX_SPEECH_CAPABILITIES,
} from '../src/speech/contracts';

test('provider-neutral transcription projects registry capabilities and completed final WAV text', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const service = new TranscriptionService({
    registry: {
      capabilities: SONIOX_SPEECH_CAPABILITIES,
      transcribeFinal: async (input, signal) => {
        calls.push({
          audio: [...input.audio],
          mime: input.mime,
          languageHint: input.languageHint,
          aborted: signal?.aborted,
        });
        return {
          status: 'ready',
          capabilities: SONIOX_SPEECH_CAPABILITIES,
          value: 'final text',
        };
      },
    },
  });
  const operation = service.open('push-to-talk');

  assert.deepEqual(service.capabilities, SONIOX_SPEECH_CAPABILITIES);
  assert.deepEqual(await operation.transcribe({
    audio: new Uint8Array([1, 2, 3, 4]),
    mime: 'audio/wav',
  }), { status: 'completed', text: 'final text' });
  assert.deepEqual(calls, [{
    audio: [1, 2, 3, 4],
    mime: 'audio/wav',
    languageHint: undefined,
    aborted: false,
  }]);
  operation.dispose();
});

test('none, legacy pending, consent, credential, and stale authority remain distinct and content-free', async (context) => {
  const cases = [
    ['not-configured', { status: 'not-configured', text: '' }],
    ['legacy-pending', { status: 'legacy-pending', text: '' }],
    ['consent-required', { status: 'consent-required', text: '' }],
    ['missing-credential', { status: 'missing-credential' }],
    ['authority-changed', { status: 'authority-changed', text: '' }],
  ] as const;

  for (const [status, expected] of cases) {
    await context.test(status, async () => {
      const service = new TranscriptionService({
        registry: {
          capabilities: NO_SPEECH_CAPABILITIES,
          transcribeFinal: async () => ({ status, capabilities: NO_SPEECH_CAPABILITIES }),
        },
      });
      const operation = service.open('setup');
      const result = await operation.transcribe({
        audio: new Uint8Array([1, 2]),
        mime: 'audio/wav',
      });
      assert.deepEqual(result, expected);
      assert.doesNotMatch(JSON.stringify(result), /secret|receipt|nonce|endpoint|profile/u);
      operation.dispose();
    });
  }
});

test('aborting a provider-neutral lane reaches the registry operation and suppresses late completion', async () => {
  let signalSeen: AbortSignal | undefined;
  const service = new TranscriptionService({
    registry: {
      capabilities: SONIOX_SPEECH_CAPABILITIES,
      transcribeFinal: async (_input, signal) => {
        signalSeen = signal;
        return new Promise((resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
            once: true,
          });
          void resolve;
        });
      },
    },
  });
  const operation = service.open('assistant');
  const pending = operation.transcribe({ audio: new Uint8Array([1, 2]), mime: 'audio/wav' });
  service.abort('assistant');

  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(signalSeen?.aborted, true);
  assert.equal(operation.signal.aborted, true);
  operation.dispose();
});
