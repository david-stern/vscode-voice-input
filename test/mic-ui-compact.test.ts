import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  parseCompactMicBrowserMessage,
  projectCompactSidebarLegacyState,
  projectCompactMicState,
} from '../src/webview/mic/compactContracts';
import { createInitialMicState } from '../src/webview/mic/state';
import { MIC_VIEW_STYLES } from '../src/webview/mic/styles';

test('compact sidebar keeps only status, mic, latest transcript, pending summary, and canonical launchers', () => {
  const view = readFileSync('src/webview/mic/view.ts', 'utf8');
  for (const id of [
    'compact-provider-status', 'mic', 'partial-block', 'final-transcript', 'pending-block',
    'open-control-center', 'open-voice', 'open-commands', 'compact-auto',
  ]) assert.match(view, new RegExp(`id=["']${id}["']`));
  assert.doesNotMatch(view, /assistant-wake-phrase|assistant-persona|assistant-speech-rate|history-list|provider-manage|mappings-manage/u);
  assert.match(view, /aria-pressed="false"/u);
  assert.match(view, /aria-live="polite"/u);
  assert.equal((view.match(/<h1\b/gu) ?? []).length, 1);
});

test('compact state is bounded and browser launchers carry no pending ID or authority value', () => {
  const state = projectCompactMicState({
    language: 'en', providerStatus: 'soniox-configured', effectiveAutoMode: true,
    microphoneAvailable: true, streamingPartials: true,
    partialTranscript: 'working', finalTranscript: 'done', pendingActionLabel: 'Commit staged',
  });
  assert.equal(state?.providerStatus, 'soniox-configured');
  assert.equal(projectCompactMicState({ ...state, receipt: 'forged' }), undefined);
  assert.deepEqual(parseCompactMicBrowserMessage({ type: 'mic-control-center-open', route: 'commands' }), {
    type: 'mic-control-center-open', route: 'commands',
  });
  assert.deepEqual(parseCompactMicBrowserMessage({ type: 'mic-open-pending-review' }), {
    type: 'mic-open-pending-review',
  });
  assert.equal(parseCompactMicBrowserMessage({ type: 'mic-open-pending-review', pendingId: 'private' }), undefined);
  assert.equal(parseCompactMicBrowserMessage({ type: 'mic-disable-auto', confirmed: true }), undefined);
});

test('legacy host projection sends only the latest transcript and no removed settings or pending IDs', () => {
  const state = projectCompactSidebarLegacyState({
    ...createInitialMicState(),
    history: [
      { id: 'old', text: 'old', lang: 'en', ts: 1 },
      { id: 'latest', text: 'latest', lang: 'en', ts: 2 },
    ],
    assistantProviderId: 'openai',
    assistantWakePhrase: 'private phrase',
    assistantPendingAction: { id: 'private-id', label: 'Review', targetId: 'private-target' },
  });
  assert.deepEqual(state.history, [{ id: 'latest', text: 'latest', lang: 'en', ts: 2 }]);
  assert.equal(state.assistantProviderId, undefined);
  assert.equal(state.assistantWakePhrase, undefined);
  assert.equal(state.assistantPendingAction, undefined);
});

test('compact sidebar is one-column, 44px, RTL-safe, high-contrast-safe, and reduced-motion-safe', () => {
  assert.match(MIC_VIEW_STYLES, /min-height:\s*44px/u);
  assert.match(MIC_VIEW_STYLES, /padding-inline|margin-inline/u);
  assert.match(MIC_VIEW_STYLES, /overflow-x:\s*hidden/u);
  assert.match(MIC_VIEW_STYLES, /@media \(max-width: 375px\)/u);
  assert.match(MIC_VIEW_STYLES, /@media \(forced-colors: active\)/u);
  assert.match(MIC_VIEW_STYLES, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.doesNotMatch(MIC_VIEW_STYLES, /#[0-9a-f]{3,8}|rgba?\(/iu);
});
