import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { STRINGS } from '../src/webview/i18n';
import { MicPressLifecycle, micClickAction } from '../src/webview/mic/events';
import { microphoneActionLabel } from '../src/webview/mic/renderHelpers';
import { MIC_VIEW_STYLES } from '../src/webview/mic/styles';
import {
  SETUP_STRINGS_EN,
  SETUP_STRINGS_HE,
} from '../src/webview/settings/setupI18n';

const sharedI18nSource = readFileSync('src/webview/i18n.ts', 'utf8');
const viewSource = readFileSync('src/webview/mic/view.ts', 'utf8');
const eventSource = readFileSync('src/webview/mic/events.ts', 'utf8');
const clientSource = readFileSync('src/webview/mic/client.ts', 'utf8');
const providerSource = readFileSync('src/webview/mic/provider.ts', 'utf8');

test('mic localization excludes legacy setup copy and describes system speech truthfully', () => {
  assert.doesNotMatch(sharedI18nSource, /settings\/i18n/u);
  assert.match(SETUP_STRINGS_EN.setupSpeechBody, /system voice/u);
  assert.match(SETUP_STRINGS_EN.setupRehearsalBody, /system speech/u);
  assert.match(SETUP_STRINGS_HE.setupSpeechBody, /קול המערכת/u);
  assert.match(SETUP_STRINGS_HE.setupRehearsalBody, /דיבור המערכת/u);

  const bilingualSetupCopy = JSON.stringify([SETUP_STRINGS_EN, SETUP_STRINGS_HE]);
  assert.doesNotMatch(
    bilingualSetupCopy,
    /local speech path|selected installed voice|מסלול התמלול, התכנון והדיבור המקומי|בקול המותקן/iu,
  );
  assert.doesNotMatch(viewSource, /Local speech: Pending|דיבור מקומי: בהמתנה/iu);
  assert.match(viewSource, /Offline\/local speech is planned and pending/u);
  assert.match(viewSource, /not included or available in this version/u);
  assert.match(viewSource, /System voices are OS-provided and may be unavailable/u);
  assert.match(viewSource, /דיבור לא־מקוון\/מקומי מתוכנן ובהמתנה/u);
  assert.match(viewSource, /אינו כלול ואינו זמין בגרסה זו/u);
  assert.match(viewSource, /קולות המערכת מסופקים על־ידי מערכת ההפעלה/u);
});

test('compact mic shell is created once and all routine host state is patched in place', () => {
  assert.match(viewSource, /if \(!root\.dataset\.micShell\)/u);
  assert.match(viewSource, /root\.dataset\.micShell = 'true'/u);
  assert.match(viewSource, /patchMicView\(root\)/u);
  assert.equal((viewSource.match(/root\.innerHTML\s*=/gu) ?? []).length, 1);
  assert.doesNotMatch(viewSource, /history-list|settings-grid|assistant-persona/u);
});

test('compact shell keeps one h1 and an ordered h2-only section hierarchy', () => {
  assert.equal((viewSource.match(/<h1\b/gu) ?? []).length, 1);
  assert.equal((viewSource.match(/<h2\b/gu) ?? []).length, 4);
  assert.doesNotMatch(viewSource, /<h[3-6]\b/u);
  assert.match(viewSource, /<h1 id="compact-title"/u);
  for (const id of ['microphone-heading', 'transcript-heading', 'pending-heading', 'launcher-heading']) {
    assert.match(viewSource, new RegExp(`<h2 id="${id}"`));
  }
});

test('primary mic action remains visibly and accessibly localized', () => {
  const labels = [
    microphoneActionLabel(false, STRINGS.en),
    microphoneActionLabel(true, STRINGS.en),
    microphoneActionLabel(false, STRINGS.he),
    microphoneActionLabel(true, STRINGS.he),
  ];
  assert.ok(labels.every((label) => label.trim().length > 0));
  assert.equal(new Set(labels).size, 4);
  assert.match(viewSource, /<button id="mic"[\s\S]*?<span id="mic-action-label"><\/span>/u);
  assert.match(viewSource, /mic\.setAttribute\('aria-label', micLabel\)/u);
  assert.match(viewSource, /setText\(root, 'mic-action-label', micLabel\)/u);
});

test('partial display, final transcript and pending review stay summary-only', () => {
  assert.match(viewSource, /id="partial-transcript"[^>]+aria-live="polite"/u);
  assert.match(viewSource, /id="final-transcript"[^>]+aria-live="polite"/u);
  assert.match(viewSource, /id="pending-label" dir="auto"/u);
  assert.match(viewSource, /setText\(root, 'pending-label', compact\.pendingActionLabel/u);
  assert.doesNotMatch(viewSource, /pendingId|targetId|commandId|receipt|nonce/u);
});

test('native keyboard clicks and press cancellation remain single-dispatch', () => {
  assert.equal(micClickAction(0), 'toggle');
  assert.equal(micClickAction(1), undefined);
  const press = new MicPressLifecycle();
  assert.equal(press.begin(), true);
  assert.equal(press.begin(), false);
  assert.equal(press.end(), true);
  assert.equal(press.end(), false);
  assert.match(eventSource, /addEventListener\('click'/u);
  assert.match(eventSource, /addEventListener\('mouseleave', endPress\)/u);
  assert.match(eventSource, /addEventListener\('touchcancel'/u);
  assert.match(clientSource, /type: 'toggle'/u);
});

test('compact launchers resolve through one host-owned Control Center surface', () => {
  for (const id of ['open-control-center', 'open-voice', 'open-commands', 'pending-review']) {
    assert.match(viewSource, new RegExp(`id="${id}"`));
  }
  assert.match(providerSource, /controlCenter\?\.open\(compactMessage\.route\)/u);
  assert.match(providerSource, /controlCenter\?\.openPendingReview\(\)/u);
  assert.match(providerSource, /controlCenter\?\.disableAuto\(\)/u);
  assert.doesNotMatch(`${viewSource}\n${eventSource}`, /settings-update|audio-device-change|set-api-key/u);
});

test('compact styling retains native tokens, 44px targets, RTL and accessibility media gates', () => {
  assert.match(MIC_VIEW_STYLES, /var\(--vscode-/u);
  assert.match(MIC_VIEW_STYLES, /min-height:\s*44px/u);
  assert.match(MIC_VIEW_STYLES, /padding-inline|margin-inline/u);
  assert.match(MIC_VIEW_STYLES, /@media \(max-width: 375px\)/u);
  assert.match(MIC_VIEW_STYLES, /@media \(forced-colors: active\)/u);
  assert.match(MIC_VIEW_STYLES, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.doesNotMatch(MIC_VIEW_STYLES, /#[0-9a-f]{3,8}|rgba?\(/iu);
});
