import assert from 'node:assert/strict';
import test from 'node:test';
import { pcm16FramesToWav } from '../../src/recorder/wav';

test('encodes canonical mono PCM16 little-endian WAV metadata and samples', () => {
  const wav = Buffer.from(pcm16FramesToWav([
    Int16Array.from([-32768, -1]),
    Int16Array.from([0, 1, 32767]),
  ], 16_000));

  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(4), wav.length - 8);
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.toString('ascii', 12, 16), 'fmt ');
  assert.equal(wav.readUInt32LE(16), 16);
  assert.equal(wav.readUInt16LE(20), 1);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 16_000);
  assert.equal(wav.readUInt32LE(28), 32_000);
  assert.equal(wav.readUInt16LE(32), 2);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.toString('ascii', 36, 40), 'data');
  assert.equal(wav.readUInt32LE(40), 10);
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((index) => wav.readInt16LE(44 + index * 2)),
    [-32768, -1, 0, 1, 32767],
  );
});

test('encodes an empty recording as a valid header-only WAV', () => {
  const wav = Buffer.from(pcm16FramesToWav([], 48_000));
  assert.equal(wav.length, 44);
  assert.equal(wav.readUInt32LE(4), 36);
  assert.equal(wav.readUInt32LE(40), 0);
});

test('rejects invalid sample rates', () => {
  assert.throws(() => pcm16FramesToWav([], 0), /Invalid WAV sample rate/);
  assert.throws(() => pcm16FramesToWav([], 44_100.5), /Invalid WAV sample rate/);
});
