import assert from 'node:assert/strict';
import test from 'node:test';

import { SonioxTranscriptionError, transcribe } from '../src/stt/soniox';

test('provider bodies, error_message, paths, keys, and raw failures never cross the STT boundary', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const malicious = 'private-key /home/david/private provider-response-body';
  const input = {
    audio: new Uint8Array([1, 2, 3, 4]),
    mime: 'audio/wav',
    apiKey: malicious,
    model: 'test-model',
    pollIntervalMs: 0,
  };

  globalThis.fetch = async () => new Response(malicious, { status: 401 });
  await assertSanitizedFailure(input, 'upload-rejected', malicious);

  globalThis.fetch = async () => { throw new Error(malicious); };
  await assertSanitizedFailure(input, 'unavailable', malicious);

  globalThis.fetch = async (request, init) => {
    const url = String(request);
    if (init?.method === 'POST' && url.endsWith('/files')) {
      return Response.json({ id: 'file-safe' }, { status: 201 });
    }
    if (init?.method === 'POST' && url.endsWith('/transcriptions')) {
      return Response.json({ id: 'transcription-safe' }, { status: 201 });
    }
    if (init?.method === 'DELETE') return new Response(null, { status: 204 });
    if (url.endsWith('/transcriptions/transcription-safe')) {
      return Response.json({ status: 'error', error_message: malicious });
    }
    throw new Error(malicious);
  };
  await assertSanitizedFailure(input, 'provider-rejected', malicious);

  globalThis.fetch = async () => Response.json({ id: `../${malicious}` }, { status: 201 });
  await assertSanitizedFailure(input, 'invalid-response', malicious);
});

test('an aborted transcription starts no cleanup requests with the invalidated credential', async () => {
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
    assert.deepEqual(deletes, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('authority loss during cleanup aborts that request and starts no later DELETE', async () => {
  const originalFetch = globalThis.fetch;
  const authority = new AbortController();
  const deletes: Array<{ url: string; signal: AbortSignal | null | undefined }> = [];

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (init?.method === 'POST' && url.endsWith('/files')) {
      return Response.json({ id: 'file-known' }, { status: 201 });
    }
    if (init?.method === 'POST' && url.endsWith('/transcriptions')) {
      return Response.json({ id: 'transcription-known' }, { status: 201 });
    }
    if (url.endsWith('/transcriptions/transcription-known/transcript')) {
      return Response.json({ text: 'must-not-publish' });
    }
    if (init?.method === 'DELETE') {
      deletes.push({ url, signal: init.signal });
      authority.abort();
      return new Response(null, { status: 204 });
    }
    if (url.endsWith('/transcriptions/transcription-known')) {
      return Response.json({ status: 'completed' });
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
        pollIntervalMs: 0,
        signal: authority.signal,
      }),
      (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
    );
    assert.equal(deletes.length, 1);
    assert.equal(deletes[0].url, 'https://api.soniox.com/v1/transcriptions/transcription-known');
    assert.equal(deletes[0].signal?.aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

async function assertSanitizedFailure(
  input: Parameters<typeof transcribe>[0],
  category: SonioxTranscriptionError['category'],
  malicious: string,
): Promise<void> {
  await assert.rejects(
    transcribe(input),
    (error: unknown) => {
      assert.ok(error instanceof SonioxTranscriptionError);
      assert.equal(error.category, category);
      assert.equal(error.message, 'Soniox transcription failed safely.');
      assert.doesNotMatch(JSON.stringify({
        name: error.name,
        message: error.message,
        category: error.category,
      }), new RegExp(escapeRegExp(malicious), 'u'));
      return true;
    },
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
