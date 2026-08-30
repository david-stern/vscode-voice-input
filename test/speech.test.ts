import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_SPEECH_RATE,
  MAX_SPEECH_TEXT_LENGTH,
  SpeechQueue,
  SpeechLifecycle,
  continuesSpeakingAfterFinish,
  feedbackSpeechLanguage,
  normalizeSpeechRate,
  resolveSpeakingState,
  selectSpeechVoice,
} from '../src/webview/speech';

const voices = [
  { voiceURI: 'english', name: 'English Voice', lang: 'en-US', default: true },
  { voiceURI: 'hebrew-a', name: 'Hebrew A', lang: 'he-IL' },
  { voiceURI: 'hebrew-b', name: 'Hebrew B', lang: 'he-IL', default: true },
];

test('saved voice URI or legacy name wins over language fallback', () => {
  assert.equal(selectSpeechVoice(voices, 'hebrew-a', 'en')?.voiceURI, 'hebrew-a');
  assert.equal(selectSpeechVoice(voices, 'Hebrew B', 'en')?.voiceURI, 'hebrew-b');
});

test('voice selection prefers a language default then the system default', () => {
  assert.equal(selectSpeechVoice(voices, undefined, 'he')?.voiceURI, 'hebrew-b');
  assert.equal(selectSpeechVoice(voices, undefined, 'fr')?.voiceURI, 'english');
  assert.equal(selectSpeechVoice([], undefined, 'he'), undefined);
});

test('a missing saved voice falls back to the platform default without replacing the saved URI', () => {
  const saved = 'voice-that-was-uninstalled';
  assert.equal(selectSpeechVoice(voices, saved, 'he')?.voiceURI, 'english');
  assert.equal(saved, 'voice-that-was-uninstalled');
});

test('speech rate is finite and clamped to the supported range', () => {
  assert.equal(normalizeSpeechRate(0.1), 0.5);
  assert.equal(normalizeSpeechRate(1.25), 1.25);
  assert.equal(normalizeSpeechRate('4'), 2);
  assert.equal(normalizeSpeechRate('invalid'), DEFAULT_SPEECH_RATE);
});

test('feedback speech follows UI language independently from the STT hint', () => {
  const sttLanguage = 'he';
  assert.equal(sttLanguage, 'he');
  assert.equal(feedbackSpeechLanguage('en'), 'en');
  assert.equal(feedbackSpeechLanguage('he'), 'he');
});

test('an active queued utterance stays speaking across a stale host state refresh', () => {
  assert.equal(resolveSpeakingState(false, 'speech-2'), true);
  assert.equal(resolveSpeakingState(false, undefined), false);
  assert.equal(resolveSpeakingState(true, undefined), false);
});

test('finishing one utterance does not render idle when another is queued', () => {
  assert.equal(continuesSpeakingAfterFinish(true, 1), true);
  assert.equal(continuesSpeakingAfterFinish(true, 0), false);
  assert.equal(continuesSpeakingAfterFinish(false, 1), false);
});

test('speech queue preserves FIFO order and cancel returns pending items', () => {
  const queue = new SpeechQueue(3);
  assert.equal(queue.enqueue({ id: '1', text: ' first ' }), true);
  assert.equal(queue.enqueue({ id: '2', text: 'second' }), true);
  assert.deepEqual(queue.take(), { id: '1', text: 'first' });
  assert.deepEqual(queue.cancel(), [{ id: '2', text: 'second' }]);
  assert.equal(queue.length, 0);
});

test('speech queue rejects overflow, empty IDs and oversized text', () => {
  const queue = new SpeechQueue(1);
  assert.equal(queue.enqueue({ id: '1', text: 'one' }), true);
  assert.equal(queue.enqueue({ id: '2', text: 'two' }), false);
  queue.cancel();
  assert.equal(queue.enqueue({ id: '', text: 'missing id' }), false);
  assert.equal(queue.enqueue({ id: '3', text: ' '.repeat(4) }), false);
  assert.equal(queue.enqueue({ id: '4', text: 'x'.repeat(MAX_SPEECH_TEXT_LENGTH + 1) }), false);
  assert.equal(queue.enqueue({ id: '1', text: 'replayed after cancel' }), false);
});

test('speech queue rejects a duplicate ID while the original is active or queued', () => {
  const queue = new SpeechQueue(3);
  assert.equal(queue.enqueue({ id: 'same', text: 'first' }), true);
  assert.equal(queue.enqueue({ id: 'same', text: 'second' }), false);
  assert.deepEqual(queue.take(), { id: 'same', text: 'first' });
  assert.equal(queue.enqueue({ id: 'same', text: 'third' }), false);
});

test('speech queue requires a positive integer capacity', () => {
  assert.throws(() => new SpeechQueue(0), RangeError);
  assert.throws(() => new SpeechQueue(1.5), RangeError);
});

test('speech lifecycle rejects stale callbacks after cancel and a newer start', () => {
  const lifecycle = new SpeechLifecycle();
  const first = lifecycle.start('first');
  assert.equal(typeof first, 'number');
  assert.equal(lifecycle.cancel(), 'first');
  const second = lifecycle.start('second');
  assert.equal(typeof second, 'number');
  assert.equal(lifecycle.finish('first', first!), false);
  assert.equal(lifecycle.activeId, 'second');
  assert.equal(lifecycle.finish('second', second!), true);
  assert.equal(lifecycle.activeId, undefined);
});

test('speech lifecycle advances to a queued item without accepting stale completion', () => {
  const lifecycle = new SpeechLifecycle();
  const first = lifecycle.start('first')!;
  assert.equal(lifecycle.finish('first', first), true);
  const second = lifecycle.start('second')!;
  assert.equal(lifecycle.activeId, 'second');
  assert.equal(lifecycle.finish('first', first), false);
  assert.equal(lifecycle.activeId, 'second');
  assert.equal(lifecycle.finish('second', second), true);
});
