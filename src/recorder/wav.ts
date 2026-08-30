const WAV_HEADER_BYTES = 44;
const PCM_BITS_PER_SAMPLE = 16;
const PCM_CHANNELS = 1;

/** Encode signed PCM16 frames as a canonical mono little-endian WAV file. */
export function pcm16FramesToWav(frames: readonly Int16Array[], sampleRate: number): Uint8Array {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new Error(`Invalid WAV sample rate: ${sampleRate}`);
  }

  const sampleCount = frames.reduce((total, frame) => total + frame.length, 0);
  const dataBytes = sampleCount * Int16Array.BYTES_PER_ELEMENT;
  const wav = Buffer.alloc(WAV_HEADER_BYTES + dataBytes);

  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(PCM_CHANNELS, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * PCM_CHANNELS * (PCM_BITS_PER_SAMPLE / 8), 28);
  wav.writeUInt16LE(PCM_CHANNELS * (PCM_BITS_PER_SAMPLE / 8), 32);
  wav.writeUInt16LE(PCM_BITS_PER_SAMPLE, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(dataBytes, 40);

  let offset = WAV_HEADER_BYTES;
  for (const frame of frames) {
    for (const sample of frame) {
      wav.writeInt16LE(sample, offset);
      offset += Int16Array.BYTES_PER_ELEMENT;
    }
  }

  return new Uint8Array(wav.buffer, wav.byteOffset, wav.byteLength);
}
