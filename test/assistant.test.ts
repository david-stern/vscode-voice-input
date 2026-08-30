import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ASSISTANT_SAMPLE_RATE,
  VadSegmenter,
  parseAssistantText,
  type AssistantAction,
} from '../src/assistant';

const FRAME_MS = 100;
const FRAME_SAMPLES = (ASSISTANT_SAMPLE_RATE * FRAME_MS) / 1_000;

function frame(amplitude: number, samples = FRAME_SAMPLES): Int16Array {
  return new Int16Array(samples).fill(amplitude);
}

test('silence does not create an utterance and the pre-roll stays bounded', () => {
  const vad = new VadSegmenter();
  for (let index = 0; index < 20; index += 1) {
    const result = vad.pushFrame(frame(0));
    assert.equal(result.accepted, true);
    assert.equal(result.backpressured, false);
    assert.deepEqual(result.signals, []);
  }

  for (let index = 0; index < 3; index += 1) vad.pushFrame(frame(8_000));
  for (let index = 0; index < 9; index += 1) vad.pushFrame(frame(0));

  const utterance = vad.takeUtterance();
  assert.ok(utterance);
  assert.equal(utterance.audio.length, ASSISTANT_SAMPLE_RATE * 1.7);
  assert.equal(utterance.audio.slice(0, ASSISTANT_SAMPLE_RATE * 0.5).every((s) => s === 0), true);
});

test('segments minimum speech after end silence and exposes single-slot backpressure', () => {
  const vad = new VadSegmenter();
  for (let index = 0; index < 5; index += 1) vad.pushFrame(frame(100));

  const started = vad.pushFrame(frame(9_000));
  assert.deepEqual(started.signals, [{ type: 'speech-started' }]);
  vad.pushFrame(frame(9_000));
  vad.pushFrame(frame(9_000));

  let ended = vad.pushFrame(frame(100));
  for (let index = 1; index < 9; index += 1) ended = vad.pushFrame(frame(100));

  assert.equal(ended.backpressured, true);
  assert.deepEqual(ended.signals, [{ type: 'utterance-queued', endReason: 'silence' }]);
  assert.equal(vad.hasPendingUtterance, true);
  assert.equal(vad.isSpeaking, false);

  const rejectedFrame = frame(7_000);
  const rejected = vad.pushFrame(rejectedFrame);
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.backpressured, true);
  assert.deepEqual(rejected.signals, [
    { type: 'backpressure', reason: 'utterance-pending' },
  ]);

  const utterance = vad.takeUtterance();
  assert.ok(utterance);
  assert.equal(utterance.endReason, 'silence');
  assert.equal(utterance.durationMs, 1_700);
  assert.equal(utterance.speechMs, 300);
  assert.equal(vad.hasPendingUtterance, false);
  assert.equal(vad.pushFrame(rejectedFrame).accepted, true);
});

test('discards speech shorter than the minimum', () => {
  const vad = new VadSegmenter();
  vad.pushFrame(frame(8_000));
  vad.pushFrame(frame(8_000));

  let result = vad.pushFrame(frame(0));
  for (let index = 1; index < 9; index += 1) result = vad.pushFrame(frame(0));

  assert.equal(vad.hasPendingUtterance, false);
  assert.deepEqual(result.signals, [
    { type: 'speech-discarded', reason: 'too-short', speechMs: 200 },
  ]);
});

test('caps an utterance at 30 seconds including pre-roll', () => {
  const vad = new VadSegmenter();
  for (let index = 0; index < 5; index += 1) vad.pushFrame(frame(0));

  let result = vad.pushFrame(frame(10_000));
  for (let index = 1; index < 295; index += 1) result = vad.pushFrame(frame(10_000));

  assert.equal(result.backpressured, true);
  assert.deepEqual(result.signals, [
    { type: 'utterance-queued', endReason: 'max-duration' },
  ]);
  const utterance = vad.takeUtterance();
  assert.ok(utterance);
  assert.equal(utterance.endReason, 'max-duration');
  assert.equal(utterance.audio.length, ASSISTANT_SAMPLE_RATE * 30);
  assert.equal(utterance.durationMs, 30_000);
  assert.equal(utterance.speechMs, 29_500);
});

test('reset clears active audio, pending output, and learned noise', () => {
  const vad = new VadSegmenter({ initialNoiseFloor: 0.003 });
  vad.pushFrame(frame(200));
  assert.notEqual(vad.currentNoiseFloor, 0.003);
  vad.pushFrame(frame(9_000));
  assert.equal(vad.isSpeaking, true);

  vad.reset();
  assert.equal(vad.isSpeaking, false);
  assert.equal(vad.hasPendingUtterance, false);
  assert.equal(vad.currentNoiseFloor, 0.003);
  assert.equal(vad.takeUtterance(), undefined);

  for (let index = 0; index < 20; index += 1) vad.pushFrame(frame(0));
  assert.equal(vad.hasPendingUtterance, false);
});

test('recognizes only the allowlisted English actions after a wake phrase', () => {
  const cases: [string, AssistantAction][] = [
    ['Hey Assistant, stop listening.', 'stop-listening'],
    ['assistant open chat', 'open-chat'],
    ['okay assistant: open terminal!', 'open-terminal'],
    ['OK ASSISTANT open settings', 'open-settings'],
  ];

  for (const [text, expectedAction] of cases) {
    const result = parseAssistantText(text);
    assert.equal(result.wakeDetected, true);
    if (!result.wakeDetected) assert.fail('wake phrase was not detected');
    assert.deepEqual(result.intent, { kind: 'action', action: expectedAction });
  }

  assert.deepEqual(parseAssistantText('open terminal'), {
    wakeDetected: false,
    intent: null,
  });
  assert.equal(parseAssistantText('assistantship open terminal').wakeDetected, false);
});

test('recognizes Hebrew and mixed-language wake/command pairs', () => {
  const hebrew = parseAssistantText("היי עוזר, פתח את הצ'אט");
  assert.equal(hebrew.wakeDetected, true);
  if (!hebrew.wakeDetected) assert.fail('Hebrew wake phrase was not detected');
  assert.deepEqual(hebrew.intent, { kind: 'action', action: 'open-chat' });

  const mixed = parseAssistantText('hey assistant פתח את הטרמינל');
  assert.equal(mixed.wakeDetected, true);
  if (!mixed.wakeDetected) assert.fail('mixed wake phrase was not detected');
  assert.deepEqual(mixed.intent, { kind: 'action', action: 'open-terminal' });

  const reverseMixed = parseAssistantText('היי עוזרת open settings');
  assert.equal(reverseMixed.wakeDetected, true);
  if (!reverseMixed.wakeDetected) assert.fail('mixed wake phrase was not detected');
  assert.deepEqual(reverseMixed.intent, { kind: 'action', action: 'open-settings' });

  const codex = parseAssistantText('היי קודקס פתח את הצ׳אט');
  assert.equal(codex.wakeDetected, true);
  if (!codex.wakeDetected) assert.fail('Codex wake phrase was not detected');
  assert.deepEqual(codex.intent, { kind: 'action', action: 'open-chat' });
});

test('all non-allowlisted post-wake text is paste-only and never auto-submits', () => {
  const result = parseAssistantText('assistant run rm -rf /');
  assert.equal(result.wakeDetected, true);
  if (!result.wakeDetected) assert.fail('wake phrase was not detected');
  assert.deepEqual(result.intent, {
    kind: 'paste',
    text: 'run rm -rf /',
    submit: false,
  });

  const nearMiss = parseAssistantText('assistant open terminal and run tests');
  assert.equal(nearMiss.wakeDetected, true);
  if (!nearMiss.wakeDetected) assert.fail('wake phrase was not detected');
  assert.deepEqual(nearMiss.intent, {
    kind: 'paste',
    text: 'open terminal and run tests',
    submit: false,
  });
});

test('a custom wake phrase preserves the stripped request for deterministic fallback', () => {
  const result = parseAssistantText('שלום מערכת, פתח את הטרמינל', {
    wakePhrases: ['שלום מערכת'],
  });
  assert.equal(result.wakeDetected, true);
  if (!result.wakeDetected) assert.fail('custom wake phrase was not detected');
  assert.equal(result.postWakeText, 'פתח את הטרמינל');
  assert.deepEqual(result.intent, { kind: 'action', action: 'open-terminal' });
});
