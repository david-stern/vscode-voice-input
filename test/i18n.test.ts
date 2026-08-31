import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ASSISTANT_LISTENING_DISCLOSURE,
  assistantListeningDisclosure,
} from '../src/platform/nativeLocalization';
import { STRINGS, UiLang } from '../src/webview/i18n';

test('custom command UI strings are complete in every supported language', () => {
  const required: (keyof typeof STRINGS.en)[] = [
    'customMappings',
    'customMappingsCount',
    'customMappingsAgentExposed',
    'customMappingsStatusReady',
    'customMappingsStatusUntrusted',
    'customMappingsStatusError',
    'customMappingsManage',
    'pendingAction',
    'pendingActionExplain',
    'pendingActionTarget',
    'pendingActionConfirm',
    'pendingActionCancel',
  ];

  for (const language of Object.keys(STRINGS) as UiLang[]) {
    for (const key of required) {
      assert.ok(STRINGS[language][key].trim(), `${language}.${key} must be translated`);
    }
  }
});

test('native assistant consent truthfully localizes the Soniox data flow', () => {
  const english = assistantListeningDisclosure((value) => value);
  const hebrew = assistantListeningDisclosure((_english, value) => value);

  assert.equal(english, ASSISTANT_LISTENING_DISCLOSURE.english);
  assert.match(english, /Every completed speech utterance is sent to Soniox/u);
  assert.match(english, /wake phrase is checked only after Soniox returns the transcript/u);
  assert.match(english, /Silence .* stays local/u);

  assert.equal(hebrew, ASSISTANT_LISTENING_DISCLOSURE.hebrew);
  assert.match(hebrew, /כל אמירת דיבור שהושלמה נשלחת ל־Soniox/u);
  assert.match(hebrew, /ביטוי ההפעלה נבדק רק לאחר ש־Soniox מחזיר את התמלול/u);
  assert.match(hebrew, /שקט .* נשאר מקומי/u);
});
