import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { STRINGS } from '../src/webview/i18n';
import { MicPressLifecycle, micClickAction } from '../src/webview/mic/events';
import {
  planHistoryReconciliation,
  setHistoryActionLabel,
} from '../src/webview/mic/historyView';
import {
  createMicViewModel,
  languageFlag,
  microphoneActionLabel,
} from '../src/webview/mic/renderHelpers';
import { createInitialMicState } from '../src/webview/mic/state';
import { MIC_VIEW_STYLES } from '../src/webview/mic/styles';
import { reconciledSelectValue } from '../src/webview/mic/view';

const viewSource = readFileSync('src/webview/mic/view.ts', 'utf8');
const historyViewSource = readFileSync('src/webview/mic/historyView.ts', 'utf8');
const eventSource = readFileSync('src/webview/mic/events.ts', 'utf8');
const clientSource = readFileSync('src/webview/mic/client.ts', 'utf8');

test('mic view constructs its shell once and patches routine updates in place', () => {
  assert.match(viewSource, /if \(!root\.dataset\.micShell\)/);
  assert.match(viewSource, /root.dataset.micShell = "true"/);
  assert.match(viewSource, /patchMicView\(root\)/);
  assert.match(viewSource, /document.activeElement !== wakePhrase/);
  assert.doesNotMatch(historyViewSource, /history\.(?:innerHTML|outerHTML|replaceChildren)\s*=/);
  assert.match(historyViewSource, /existing\.get\(entry\.id\) \?\? createHistoryEntry\(entry\.id\)/);
  assert.match(historyViewSource, /history\.insertBefore\(row, cursor\)/);
});

test('mic shell has an ordered h1 then h2 heading hierarchy without skipped levels', () => {
  assert.equal((viewSource.match(/<h1\b/g) ?? []).length, 1);
  assert.equal((viewSource.match(/<h2\b/g) ?? []).length, 3);
  assert.doesNotMatch(viewSource, /<h[3-6]\b/);
  assert.match(viewSource, /<h1 id="conversation-title"/);
  assert.match(viewSource, /<h2 id="history-heading"/);
  assert.match(viewSource, /<h2 id="assistant-heading"/);
  assert.match(viewSource, /<h2 id="settings-summary-heading"/);
});

test('primary mic button has a visible localized action label in idle and recording states', () => {
  const labels = {
    enIdle: microphoneActionLabel(false, STRINGS.en),
    enRecording: microphoneActionLabel(true, STRINGS.en),
    heIdle: microphoneActionLabel(false, STRINGS.he),
    heRecording: microphoneActionLabel(true, STRINGS.he),
  };
  for (const label of Object.values(labels)) assert.ok(label.trim().length > 0);
  assert.notEqual(labels.enIdle, labels.enRecording);
  assert.notEqual(labels.heIdle, labels.heRecording);
  assert.notEqual(labels.enIdle, labels.heIdle);
  assert.notEqual(labels.enRecording, labels.heRecording);
  assert.match(
    viewSource,
    /<button id="mic"[\s\S]*?<span id="mic-action-label" class="mic-action-label"><\/span>[\s\S]*?<\/button>/,
  );
  assert.match(viewSource, /const micLabel = microphoneActionLabel\(state\.recording, strings\)/);
  assert.match(viewSource, /mic\.setAttribute\('aria-label', micLabel\)/);
  assert.match(viewSource, /setText\(root, 'mic-action-label', micLabel\)/);
  assert.match(MIC_VIEW_STYLES, /\.mic-action-label\s*\{[\s\S]*?overflow-wrap:\s*anywhere/);
});

test('history actions expose visible localized text and matching accessible names', () => {
  const visible = { textContent: '' };
  const attributes = new Map<string, string>();
  const button = {
    title: '',
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    querySelector: (selector: string) => selector === '.history-action-label' ? visible : null,
  } as unknown as HTMLButtonElement;

  setHistoryActionLabel(button, STRINGS.en.copy);
  assert.equal(visible.textContent, 'Copy');
  assert.equal(attributes.get('aria-label'), 'Copy');
  assert.equal(button.title, 'Copy');
  assert.ok(STRINGS.he.copy.length > 0);
  assert.ok(STRINGS.en.remove.length > 0);
  assert.ok(STRINGS.he.remove.length > 0);
  assert.match(historyViewSource, /label\.className = 'history-action-label'/);
  assert.match(historyViewSource, /setHistoryActionLabel\(copy,[^\n]+strings\.copy/);
  assert.match(historyViewSource, /setHistoryActionLabel\(remove, strings\.remove\)/);
});

test('history reconciliation keeps keyed focus and chooses a stable fallback after removal', () => {
  assert.deepEqual(
    planHistoryReconciliation(
      ['first', 'second'],
      ['second', 'first'],
      { id: 'first', index: 0, action: 'copy' },
    ),
    {
      orderedIds: ['second', 'first'],
      removedIds: [],
      focusId: 'first',
      focusAction: 'copy',
      focusHeading: false,
    },
  );
  assert.deepEqual(
    planHistoryReconciliation(
      ['first', 'second', 'third'],
      ['first', 'third'],
      { id: 'second', index: 1, action: 'remove' },
    ),
    {
      orderedIds: ['first', 'third'],
      removedIds: ['second'],
      focusId: 'third',
      focusAction: 'remove',
      focusHeading: false,
    },
  );
  assert.deepEqual(
    planHistoryReconciliation(['only'], [], { id: 'only', index: 0, action: 'copy' }),
    {
      orderedIds: [],
      removedIds: ['only'],
      focusHeading: true,
    },
  );
  assert.match(historyViewSource, /restoreHistoryFocus\(root, history, plan, focus\)/);
  assert.match(historyViewSource, /focus\(\{ preventScroll: true \}\)/);
});

test('copy success updates the focused control and announces a localized status', () => {
  assert.ok(STRINGS.en.copySuccess.length > 0);
  assert.ok(STRINGS.he.copySuccess.length > 0);
  assert.match(eventSource, /setHistoryActionLabel\(button, copied\)/);
  assert.match(eventSource, /announce\(announcement\)/);
  assert.match(clientSource, /copySuccessMessage: \(\) => stringsFor\(state\)\.copySuccess/);
  assert.match(clientSource, /getElementById\('history-announcement'\)/);
  assert.match(clientSource, /queueMicrotask/);
  assert.match(viewSource, /id="history-announcement" class="sr-only"/);
  assert.equal((viewSource.match(/aria-live="polite"/g) ?? []).length, 1);
  assert.doesNotMatch(eventSource, /function flashLabel/);
});

test('late host state and system voices produce a complete localized mic projection', () => {
  const initial = createInitialMicState();
  const projected = createMicViewModel({
    ...initial,
    uiLang: 'en',
    assistantEnabled: true,
    assistantListening: true,
    assistantFeedback: 'Ready for approval',
    assistantPersona: 'friend',
    assistantProviderId: 'openai',
    assistantProviderName: 'OpenAI',
    assistantProviderStatus: 'ready',
    assistantSpeechVoiceUri: 'voice-en',
    assistantSpeechRate: 1.7,
    assistantSpeaking: true,
    assistantTargetLabel: 'Chat composer',
    assistantPlanConfidence: 0.87,
    assistantPendingAction: { id: 'action-1', label: 'Run tests', targetId: 'workbench.action.tasks.test' },
    assistantPendingSend: { id: 'send-1', preview: 'Hello from the assistant' },
  }, [{ voiceURI: 'voice-en', name: 'English Voice', lang: 'en-US', default: true }]);

  assert.equal(projected.direction, 'ltr');
  assert.equal(projected.assistantStatus, 'Voice assistant is listening');
  assert.equal(projected.feedback, 'Ready for approval');
  assert.equal(projected.providerName, 'OpenAI');
  assert.match(projected.providerStatus, /ready/iu);
  assert.equal(projected.targetLabel, 'Chat composer');
  assert.equal(projected.confidence, 87);
  assert.equal(projected.speechRate, 1.7);
  assert.equal(projected.speechStatus, 'The assistant is speaking');
  assert.equal(projected.personas.find(({ value }) => value === 'friend')?.selected, true);
  assert.deepEqual(projected.voices, [{
    value: 'voice-en',
    label: 'English Voice (en-US) — System default voice',
    selected: true,
  }]);
  assert.equal(projected.pendingAction?.label, 'Run tests');
  assert.equal(projected.pendingSend?.preview, 'Hello from the assistant');
  assert.equal(projected.strings.pendingActionConfirm, 'Approve and run');
});

test('conditional mic controls live in stable containers and every late field is reconciled', () => {
  for (const id of [
    'assistant-feedback',
    'assistant-confidence',
    'assistant-pending-action',
    'assistant-pending-send',
    'assistant-disclosure',
  ]) {
    assert.match(viewSource, new RegExp(`id=["']${id}["']`), id);
    assert.match(viewSource, new RegExp(`(?:setText|setHidden)\\(root, ["']${id}["']`), `patches ${id}`);
  }
  assert.equal((viewSource.match(/root\.innerHTML\s*=/g) ?? []).length, 1);
  assert.match(viewSource, /byId<HTMLSelectElement>\(root, 'assistant-speech-voice'\)/);
  assert.match(viewSource, /syncOptions\(voice, model\.voices\)/);
  assert.match(viewSource, /byId<HTMLSelectElement>\(root, 'assistant-persona'\)/);
  assert.match(viewSource, /byId<HTMLInputElement>\(root, 'assistant-speech-rate'\)/);
  assert.match(viewSource, /setText\(root, 'assistant-target-label', model\.targetLabel\)/);
  assert.match(eventSource, /copiedLabel:\s*\(\)\s*=>\s*string/);
});

test('conversation uses one live status and keeps approval target, preview, and user text directions visible', () => {
  assert.equal((viewSource.match(/aria-live="polite"/g) ?? []).length, 1);
  assert.match(viewSource, /id="mic-live"[^>]+aria-atomic="true"/);
  assert.match(viewSource, /id="assistant-pending-action"[^>]+aria-labelledby="pending-action-heading"/);
  assert.match(viewSource, /id="pending-action-target" dir="ltr"/);
  assert.match(viewSource, /id="assistant-pending-send"[^>]+aria-labelledby="pending-send-heading"/);
  assert.match(viewSource, /id="pending-send-preview" dir="auto"/);
  assert.match(viewSource, /id="pending-send-target" dir="auto"/);
  assert.match(viewSource, /pendingSend\?\.targetLabel \?\? strings\.assistantTargetUnknown/);
  assert.match(viewSource, /id="assistant-wake-phrase"[^>]+dir="auto"/);
  assert.match(viewSource, /id="mic-hint-key"[^>]+dir="ltr"/);
});

test('voice list changes preserve a focused valid choice and otherwise follow host selection', () => {
  const options = [
    { value: 'voice-a', label: 'A', selected: true },
    { value: 'voice-b', label: 'B', selected: false },
  ];
  assert.equal(reconciledSelectValue(options, 'voice-b', true), 'voice-b');
  assert.equal(reconciledSelectValue(options, 'missing', true), 'voice-a');
  assert.equal(reconciledSelectValue(options, 'voice-b', false), 'voice-a');
  assert.match(clientSource, /addEventListener\('voiceschanged'/);
  assert.match(viewSource, /document\.activeElement !== rate/);
});

test('mic presentation uses native theme and typography tokens with responsive accessible targets', () => {
  assert.match(MIC_VIEW_STYLES, /font:\s*var\(--vscode-font-size/);
  assert.match(MIC_VIEW_STYLES, /min-height:\s*44px/);
  assert.match(MIC_VIEW_STYLES, /\.history-action[\s\S]+min-width:\s*44px/);
  assert.match(MIC_VIEW_STYLES, /@media \(max-width: 375px\)/);
  assert.match(MIC_VIEW_STYLES, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(MIC_VIEW_STYLES, /#[0-9a-f]{3,8}|rgba?\(/i);
  assert.doesNotMatch(MIC_VIEW_STYLES, /(?:Inter|Arial|Helvetica|Roboto|Monaco|Menlo)/);
  assert.equal(languageFlag('he'), 'HE');
  assert.equal(languageFlag('en'), 'EN');
  assert.doesNotMatch(`${languageFlag('he')}${languageFlag('en')}${languageFlag('')}`, /\p{Extended_Pictographic}/u);
});

test('native keyboard clicks toggle the mic without replaying mouse or touch gestures', () => {
  assert.equal(micClickAction(0), 'toggle');
  assert.equal(micClickAction(1), undefined);
  assert.match(eventSource, /addEventListener\('click'/);
  assert.match(eventSource, /toggle\(\)/);
  assert.match(clientSource, /type: 'toggle'/);
  assert.doesNotMatch(clientSource, /state\.recording\s*\?\s*'stop'\s*:\s*'start'/);
});

test('press lifecycle stops once on leave or cancellation before host state changes', () => {
  const mousePress = new MicPressLifecycle();
  assert.equal(mousePress.begin(), true);
  assert.equal(mousePress.begin(), false);
  assert.equal(mousePress.end(), true);
  assert.equal(mousePress.end(), false);

  const touchPress = new MicPressLifecycle();
  assert.equal(touchPress.begin(), true);
  assert.equal(touchPress.end(), true);
  assert.match(eventSource, /addEventListener\('mouseleave', endPress\)/);
  assert.match(eventSource, /addEventListener\('touchcancel'/);
});

test('mic view has no legacy settings controls and routes to the Settings Center explicitly', () => {
  assert.doesNotMatch(viewSource, /settings-section|settings-grid|speech-lang|ui-lang|audio-device/);
  assert.match(viewSource, /id="open-settings-center"/);
  assert.match(eventSource, /type: 'open-settings-center'/);
  assert.doesNotMatch(eventSource, /settings-update|audio-device-change|set-api-key/);
});

test('mic provider surface is selected-provider neutral and uses the native management action', () => {
  assert.match(viewSource, /setText\(root, 'provider-heading',[^\n]+model\.providerName/u);
  assert.match(viewSource, /id="assistant-provider-status"/u);
  assert.match(viewSource, /id="assistant-provider-manage"/u);
  assert.match(eventSource, /type: 'assistant-provider-manage'/u);
  assert.doesNotMatch(`${viewSource}\n${eventSource}\n${clientSource}`, /assistant-deepseek|DeepSeek setup/iu);
});
