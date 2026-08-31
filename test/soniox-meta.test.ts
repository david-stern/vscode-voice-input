import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchModels } from '../src/sonioxMeta';

test('model metadata failures discard provider bodies, credentials and raw errors', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const privateBody = 'private-provider-response';
  const credential = 'private-api-key';

  globalThis.fetch = async () => new Response(privateBody, { status: 401 });
  await assertSanitizedFailure(credential, privateBody);

  globalThis.fetch = async () => new Response(JSON.stringify({ privateBody }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  await assertSanitizedFailure(credential, privateBody);

  globalThis.fetch = async () => { throw new Error(`network leaked ${credential}`); };
  await assertSanitizedFailure(credential, privateBody);
});

test('model metadata keeps the compatible allowlisted model projection', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({
    models: [{ id: 'stt-v4', type: 'async', display_name: 'STT v4' }],
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  assert.deepEqual(await fetchModels('private-api-key'), [{
    id: 'stt-v4',
    type: 'async',
    description: 'STT v4',
  }]);
});

async function assertSanitizedFailure(credential: string, body: string): Promise<void> {
  await assert.rejects(
    fetchModels(credential),
    (error: Error) => {
      assert.equal(error.message, 'Soniox model metadata is unavailable');
      assert.doesNotMatch(error.message, new RegExp(`${credential}|${body}`, 'u'));
      return true;
    },
  );
}
