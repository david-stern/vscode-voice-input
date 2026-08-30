import assert from 'node:assert/strict';
import test from 'node:test';

import { transcribe } from '../src/stt/soniox';

test('an aborted transcription still deletes known remote resources independently', async () => {
  const originalFetch = globalThis.fetch;
  const mainController = new AbortController();
  const deletes: Array<{ url: string; signal: AbortSignal | null | undefined }> = [];

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (init?.method === 'POST' && url.endsWith('/files')) {
      return Response.json({ id: 'file-known' }, { status: 201 });
    }
    if (init?.method === 'POST' && url.endsWith('/transcriptions')) {
      mainController.abort();
      return Response.json({ id: 'transcription-known' }, { status: 201 });
    }
    if (init?.method === 'DELETE') {
      deletes.push({ url, signal: init.signal });
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected fetch: ${init?.method ?? 'GET'} ${url}`);
  };

  try {
    await assert.rejects(
      transcribe({
        audio: new Uint8Array([1, 2, 3, 4]),
        mime: 'audio/wav',
        apiKey: 'test-key',
        model: 'test-model',
        pollIntervalMs: 1,
        signal: mainController.signal,
      }),
      (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
    );

    assert.equal(mainController.signal.aborted, true);
    assert.deepEqual(
      deletes.map(({ url }) => url),
      [
        'https://api.soniox.com/v1/transcriptions/transcription-known',
        'https://api.soniox.com/v1/files/file-known',
      ],
    );
    for (const deletion of deletes) {
      assert.ok(deletion.signal);
      assert.notEqual(deletion.signal, mainController.signal);
      assert.equal(deletion.signal.aborted, false);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
