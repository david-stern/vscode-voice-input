const SONIOX_API = 'https://api.soniox.com/v1';
const PROVIDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/u;

export type SonioxTranscriptionFailureCategory =
  | 'upload-rejected'
  | 'request-rejected'
  | 'status-rejected'
  | 'provider-rejected'
  | 'transcript-rejected'
  | 'invalid-response'
  | 'timed-out'
  | 'unavailable';

/** Fixed, content-free error crossing the Soniox provider boundary. */
export class SonioxTranscriptionError extends Error {
  constructor(public readonly category: SonioxTranscriptionFailureCategory) {
    super('Soniox transcription failed safely.');
    this.name = 'SonioxTranscriptionError';
  }
}

export interface TranscribeOpts {
  audio: Uint8Array;
  mime: string;
  apiKey: string;
  model: string;
  languageHint?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function transcribe(opts: TranscribeOpts): Promise<string> {
  const {
    audio,
    mime,
    apiKey,
    model,
    languageHint,
    pollIntervalMs = 500,
    timeoutMs = 60_000,
    signal,
  } = opts;

  const baseMime = mime.split(';')[0].trim();
  const ext = baseMime.includes('ogg') ? 'ogg' : baseMime.includes('wav') ? 'wav' : 'webm';

  const fd = new FormData();
  const ab = audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer;
  const blob = new Blob([ab], { type: baseMime });
  fd.append('file', blob, `audio.${ext}`);

  let fileId: string | undefined;
  let txnId: string | undefined;
  try {
    const upRes = await fetch(`${SONIOX_API}/files`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: fd,
      signal,
    });
    if (!upRes.ok) {
      throw new SonioxTranscriptionError('upload-rejected');
    }
    fileId = await readProviderId(upRes);

    const body: Record<string, unknown> = { model, file_id: fileId };
    if (languageHint && languageHint !== 'auto') {
      body.language_hints = [languageHint];
    }

    const txnRes = await fetch(`${SONIOX_API}/transcriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!txnRes.ok) {
      throw new SonioxTranscriptionError('request-rejected');
    }
    txnId = await readProviderId(txnRes);

    const deadline = Date.now() + timeoutMs;
    while (true) {
      if (Date.now() > deadline) throw new SonioxTranscriptionError('timed-out');
      await abortableDelay(pollIntervalMs, signal);

      const stRes = await fetch(`${SONIOX_API}/transcriptions/${txnId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal,
      });
      if (!stRes.ok) {
        throw new SonioxTranscriptionError('status-rejected');
      }
      const status = await readProviderObject(stRes);
      if (typeof status.status !== 'string') {
        throw new SonioxTranscriptionError('invalid-response');
      }
      if (status.status === 'completed') break;
      if (status.status === 'error') {
        // `error_message` and all other provider body fields are intentionally ignored.
        throw new SonioxTranscriptionError('provider-rejected');
      }
    }

    const trRes = await fetch(`${SONIOX_API}/transcriptions/${txnId}/transcript`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });
    if (!trRes.ok) {
      throw new SonioxTranscriptionError('transcript-rejected');
    }
    const transcript = await readProviderObject(trRes);
    if (typeof transcript.text !== 'string') {
      throw new SonioxTranscriptionError('invalid-response');
    }
    const { text } = transcript;
    return text.trim();
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) {
      throw new DOMException('Aborted', 'AbortError');
    }
    if (error instanceof SonioxTranscriptionError) throw error;
    throw new SonioxTranscriptionError('unavailable');
  } finally {
    // Remote cleanup is intentionally best effort. A deletion failure must not
    // replace a successful transcript or mask the original transcription error.
    if (txnId) await bestEffortDelete(`transcriptions/${txnId}`, apiKey);
    if (fileId) await bestEffortDelete(`files/${fileId}`, apiKey);
  }
}

async function readProviderId(response: Response): Promise<string> {
  const body = await readProviderObject(response);
  if (typeof body.id !== 'string' || !PROVIDER_ID_PATTERN.test(body.id)) {
    throw new SonioxTranscriptionError('invalid-response');
  }
  return body.id;
}

async function readProviderObject(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new SonioxTranscriptionError('invalid-response');
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SonioxTranscriptionError) throw error;
    throw new SonioxTranscriptionError('invalid-response');
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

async function bestEffortDelete(path: string, apiKey: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    await fetch(`${SONIOX_API}/${path}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
  } catch {
    // Cleanup support can vary by account/API version; never mask the result.
  } finally {
    clearTimeout(timer);
  }
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
