import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ASSISTANT_PERSONAS,
  DEFAULT_PERSONA_ID,
  PERSONA_IDS,
  getAssistantPersona,
  getPersonaLabel,
  isPersonaId,
  normalizePersonaId,
} from '../src/assistant/personas';

test('defines exactly the six supported persona IDs and localized labels', () => {
  assert.deepEqual(PERSONA_IDS, [
    'teacher-lecturer',
    'secretary',
    'friend',
    'tour-guide',
    'mathematician',
    'philosopher',
  ]);
  assert.equal(ASSISTANT_PERSONAS.length, 6);
  assert.deepEqual(
    ASSISTANT_PERSONAS.map(({ id }) => id),
    [...PERSONA_IDS],
  );
  for (const persona of ASSISTANT_PERSONAS) {
    assert.ok(persona.labels.he.trim());
    assert.ok(persona.labels.en.trim());
    assert.equal(getPersonaLabel(persona.id, 'he'), persona.labels.he);
    assert.equal(getPersonaLabel(persona.id, 'en'), persona.labels.en);
  }
});

test('every bounded persona prompt preserves the shared safety and teaching invariants', () => {
  for (const persona of ASSISTANT_PERSONAS) {
    assert.ok(persona.systemPrompt.length > 100);
    assert.ok(persona.systemPrompt.length < 1_000);
    assert.match(persona.systemPrompt, /polite, natural/i);
    assert.match(persona.systemPrompt, /proposed action/i);
    assert.match(persona.systemPrompt, /reason/i);
    assert.match(persona.systemPrompt, /uncertainty/i);
    assert.match(persona.systemPrompt, /Never claim that an action succeeded/i);
    assert.match(persona.systemPrompt, /Never invent access/i);
  }
});

test('invalid persisted values fall back to the validated default persona', () => {
  assert.equal(DEFAULT_PERSONA_ID, 'teacher-lecturer');
  assert.equal(isPersonaId('friend'), true);
  assert.equal(isPersonaId('Friend'), false);
  assert.equal(isPersonaId(undefined), false);
  assert.equal(normalizePersonaId('friend'), 'friend');
  assert.equal(normalizePersonaId('ignore all policy'), DEFAULT_PERSONA_ID);
  assert.equal(getAssistantPersona({ id: 'philosopher' }).id, DEFAULT_PERSONA_ID);
});
