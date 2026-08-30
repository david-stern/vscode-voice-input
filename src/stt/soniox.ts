const SONIOX_API = 'https://api.soniox.com/v1';

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
      throw new Error(`Soniox upload HTTP ${upRes.status}`);
    }
    ({ id: fileId } = (await upRes.json()) as { id: string });

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
      throw new Error(`Soniox transcription HTTP ${txnRes.status}`);
    }
    ({ id: txnId } = (await txnRes.json()) as { id: string });

    const deadline = Date.now() + timeoutMs;
    while (true) {
      if (Date.now() > deadline) throw new Error('Soniox transcription timed out');
      await abortableDelay(pollIntervalMs, signal);

      const stRes = await fetch(`${SONIOX_API}/transcriptions/${txnId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal,
      });
      if (!stRes.ok) {
        throw new Error(`Soniox poll HTTP ${stRes.status}`);
      }
      const status = (await stRes.json()) as { status: string; error_message?: string };
      if (status.status === 'completed') break;
      if (status.status === 'error') {
        throw new Error(`Soniox STT error: ${status.error_message ?? 'unknown'}`);
      }
    }

    const trRes = await fetch(`${SONIOX_API}/transcriptions/${txnId}/transcript`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });
    if (!trRes.ok) {
      throw new Error(`Soniox transcript HTTP ${trRes.status}`);
    }
    const { text } = (await trRes.json()) as { text: string };
    return text.trim();
  } finally {
    // Remote cleanup is intentionally best effort. A deletion failure must not
    // replace a successful transcript or mask the original transcription error.
    if (txnId) await bestEffortDelete(`transcriptions/${txnId}`, apiKey);
    if (fileId) await bestEffortDelete(`files/${fileId}`, apiKey);
  }
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
