const SONIOX_API = 'https://api.soniox.com/v1';

export interface TranscribeOpts {
  audio: Uint8Array;
  mime: string;
  apiKey: string;
  model: string;
  languageHint?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
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
  } = opts;

  const baseMime = mime.split(';')[0].trim();
  const ext = baseMime.includes('ogg') ? 'ogg' : baseMime.includes('wav') ? 'wav' : 'webm';

  const fd = new FormData();
  const ab = audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer;
  const blob = new Blob([ab], { type: baseMime });
  fd.append('file', blob, `audio.${ext}`);

  const upRes = await fetch(`${SONIOX_API}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: fd,
  });
  if (!upRes.ok) {
    throw new Error(`Soniox upload HTTP ${upRes.status}: ${await upRes.text()}`);
  }
  const { id: fileId } = (await upRes.json()) as { id: string };

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
  });
  if (!txnRes.ok) {
    throw new Error(`Soniox transcription HTTP ${txnRes.status}: ${await txnRes.text()}`);
  }
  const { id: txnId } = (await txnRes.json()) as { id: string };

  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (Date.now() > deadline) throw new Error('Soniox transcription timed out');
    await new Promise((r) => setTimeout(r, pollIntervalMs));

    const stRes = await fetch(`${SONIOX_API}/transcriptions/${txnId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!stRes.ok) {
      throw new Error(`Soniox poll HTTP ${stRes.status}: ${await stRes.text()}`);
    }
    const status = (await stRes.json()) as { status: string; error_message?: string };
    if (status.status === 'completed') break;
    if (status.status === 'error') {
      throw new Error(`Soniox STT error: ${status.error_message ?? 'unknown'}`);
    }
  }

  const trRes = await fetch(`${SONIOX_API}/transcriptions/${txnId}/transcript`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!trRes.ok) {
    throw new Error(`Soniox transcript HTTP ${trRes.status}: ${await trRes.text()}`);
  }
  const { text } = (await trRes.json()) as { text: string };
  return text.trim();
}
