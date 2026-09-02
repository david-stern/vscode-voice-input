import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { CONTROL_CENTER_ROUTES } from '../src/webview/controlCenter/contracts';
import { renderControlCenterDocument } from '../src/webview/controlCenter/document';
import { CONTROL_CENTER_STRINGS } from '../src/webview/controlCenter/i18n';
import { resolveSetupReloadState } from '../src/webview/controlCenter/routes/setup';

const LOCAL_PENDING_EN = 'Offline/local speech is planned and pending, but it is not included or available in this version. System voices are OS-provided and may be unavailable.';
const LOCAL_PENDING_HE = 'דיבור לא־מקוון/מקומי מתוכנן ובהמתנה, אך אינו כלול ואינו זמין בגרסה זו. קולות המערכת מסופקים על־ידי מערכת ההפעלה וייתכן שלא יהיו זמינים.';

test('Control Center document uses only packaged nonce-bound assets and a closed CSP', () => {
  const document = renderControlCenterDocument({
    cspSource: 'vscode-webview://source', scriptUri: 'vscode-webview://source/client.js',
    styleUri: 'vscode-webview://source/styles.css', nonce: 'safeNonce',
  });
  assert.match(document, /default-src 'none'/u);
  assert.match(document, /script-src 'nonce-safeNonce'/u);
  assert.match(document, /style-src vscode-webview:\/\/source/u);
  for (const directive of ['connect-src', 'frame-src', 'object-src', 'worker-src', 'form-action', 'base-uri']) {
    assert.match(document, new RegExp(`${directive} 'none'`));
  }
  assert.doesNotMatch(document, /unsafe-inline|unsafe-eval|https?:|data:|blob:|command:/u);
  assert.doesNotMatch(document, /<style\b|on(?:click|load)=/iu);
});

test('six routes, four setup steps, honest speech labels, and no install CTA are frozen in both languages', () => {
  assert.deepEqual(CONTROL_CENTER_ROUTES, ['home', 'voice', 'commands', 'assistant', 'privacy', 'diagnostics']);
  for (const language of ['en', 'he'] as const) {
    const strings = CONTROL_CENTER_STRINGS[language];
    assert.equal(strings.setupSteps.length, 4);
    assert.deepEqual(Object.keys(strings.setupStepStatuses), ['complete', 'attention', 'pending']);
    assert.ok(strings.setupCurrent.length > 0);
    assert.match(strings.setupAllComplete, /four|ארבעת/u);
    assert.equal(Object.keys(strings.routes).length, 6);
    assert.match(strings.systemVoice, /temporary|זמני/u);
    assert.match(strings.systemVoice, /OS-dependent|מערכת ההפעלה/u);
    assert.equal(strings.localPending, language === 'en' ? LOCAL_PENDING_EN : LOCAL_PENDING_HE);
    assert.doesNotMatch(
      JSON.stringify(strings),
      /Local speech: Pending — not available in this version|דיבור מקומי: בהמתנה — אינו זמין בגרסה זו|local speech path|download|install voice|works offline|no key required/iu,
    );
  }
});

test('frozen UX contracts preserve the explicit bilingual local-pending nonclaim', () => {
  for (const path of [
    'docs/ux/compact-sidebar-wireframe.md',
    'docs/ux/control-center-wireframe.md',
  ]) {
    const contract = readFileSync(path, 'utf8');
    assert.ok(contract.includes(LOCAL_PENDING_EN));
    assert.ok(contract.includes(LOCAL_PENDING_HE));
    assert.doesNotMatch(
      contract,
      /Local speech: Pending — not available in this version|דיבור מקומי: בהמתנה — אינו זמין בגרסה זו|local speech path/iu,
    );
  }
});

test('configured but unobserved system speech renders only the temporary OS-dependent label', () => {
  const assistant = readFileSync('src/webview/controlCenter/routes/assistant.ts', 'utf8');
  const view = readFileSync('src/webview/controlCenter/view.ts', 'utf8');
  for (const source of [assistant, view]) {
    assert.match(source, /configured-unverified/u);
  }
  assert.doesNotMatch(
    readFileSync('src/platform/controlCenterStateCoordinator.ts', 'utf8'),
    /assistantSpeechEnabled\s*\?\s*'ready'/u,
  );
});

test('responsive CSS preserves VS Code tokens, logical layout, 44px targets, reflow, contrast, and reduced motion', () => {
  const css = readFileSync('src/webview/controlCenter/styles.css', 'utf8');
  assert.match(css, /var\(--vscode-/u);
  assert.match(css, /min-block-size:\s*44px/u);
  assert.match(css, /inset-inline|margin-inline|border-inline|padding-inline/u);
  assert.match(css, /@media \(max-width: 720px\)/u);
  assert.match(css, /overflow-x:\s*hidden/u);
  assert.match(css, /@media \(forced-colors: active\)/u);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}|rgba?\(/iu);
});

test('browser client waits for all declared command chunks before applying and acknowledging', () => {
  const source = readFileSync('src/webview/controlCenter/client.ts', 'utf8');
  assert.match(source, /pending\.chunks\.size !== page\.chunkCount/u);
  assert.match(source, /rows\.length !== page\.pageRowCount/u);
  assert.match(source, /new Set\(rows\.map/u);
  assert.match(source, /post\(\{ type: 'ack', revision: next\.revision \}\)/u);
  assert.match(source, /message\.kind === 'partial' && !snapshot\.capabilities\.streamingPartials/u);
});

test('setup panels expose microphone proof, Soniox skip, system speech, and authority review actions', () => {
  const setup = readFileSync('src/webview/controlCenter/routes/setup.ts', 'utf8');
  const client = readFileSync('src/webview/controlCenter/client.ts', 'utf8');
  const systemSpeech = readFileSync('src/webview/controlCenter/systemSpeech.ts', 'utf8');
  for (const action of [
    'select-microphone', 'test-microphone-signal', 'stop-microphone-test',
    'configure-soniox', 'leave-stt-off', 'preview-system-voice', 'reviewCommands', 'reviewAuthority',
  ]) assert.match(`${setup}\n${client}`, new RegExp(action, 'u'));
  assert.match(setup, /aria-controls/u);
  assert.match(setup, /aria-expanded/u);
  assert.match(setup, /setup\.recommendedStep/u);
  assert.match(setup, /setup\.stepStates\.every/u);
  assert.match(setup, /dataset\.stepState/u);
  assert.match(setup, /aria-describedby/u);
  assert.match(setup, /if \(!setup\)/u);
  assert.match(client, /type: 'microphoneSetupIntent'/u);
  assert.match(client, /type: 'systemTtsVoicesObservedIntent'/u);
  assert.match(client, /type: 'systemTtsIntent'/u);
  assert.match(systemSpeech, /const selected = voiceIndex >= 0/u);
  assert.match(systemSpeech, /: undefined\s*\n\s*: selectSpeechVoice/u);
});

test('setup reload selects the authoritative safe next step and preserves explicit transient selection', () => {
  assert.deepEqual(resolveSetupReloadState(undefined, {
    stepStates: ['pending', 'pending', 'pending', 'pending'], recommendedStep: 1,
  }), { activeStep: 1, allComplete: false });
  assert.deepEqual(resolveSetupReloadState(undefined, {
    stepStates: ['complete', 'complete', 'attention', 'pending'], recommendedStep: 3,
  }), { activeStep: 3, allComplete: false });
  assert.deepEqual(resolveSetupReloadState(undefined, {
    stepStates: ['complete', 'complete', 'complete', 'complete'], recommendedStep: 4,
  }), { activeStep: 4, allComplete: true });
  assert.deepEqual(resolveSetupReloadState(2, {
    stepStates: ['complete', 'complete', 'attention', 'pending'], recommendedStep: 3,
  }), { activeStep: 2, allComplete: false });
});

test('pending action preview closes its DOM before emitting payload-free confirmation or cancellation', () => {
  const client = readFileSync('src/webview/controlCenter/client.ts', 'utf8');
  const overlays = readFileSync('src/webview/controlCenter/clientOverlays.ts', 'utf8');
  const start = client.indexOf('function closeForPendingDecision');
  const end = client.indexOf('function postCustomCommandAction', start);
  const decision = client.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.ok(decision.indexOf('closeForNativePrompt') < decision.indexOf("type: 'pendingReviewIntent'"));
  assert.match(decision, /decision: 'request-native-confirmation' \| 'cancel'/u);
  assert.doesNotMatch(decision, /pendingId|authorityId|receipt|approved|result/u);
  assert.match(overlays, /kind: 'action-preview'/u);
});

test('filters, late projections, narrow navigation, and repeatable details preserve UI state and focus', () => {
  const client = readFileSync('src/webview/controlCenter/client.ts', 'utf8');
  const clientOverlays = readFileSync('src/webview/controlCenter/clientOverlays.ts', 'utf8');
  const commands = readFileSync('src/webview/controlCenter/routes/commands.ts', 'utf8');
  const focus = readFileSync('src/webview/controlCenter/focus.ts', 'utf8');
  const overlay = readFileSync('src/webview/controlCenter/overlay.ts', 'utf8');
  assert.match(client, /updateCommandFilterState\(snapshot\.state\.filter/u);
  assert.match(commands, /search\.value = filterState\.query/u);
  assert.match(commands, /checkbox\.checked = checked/u);
  assert.match(commands, /aria-pressed/u);
  assert.match(`${client}\n${focus}`, /captureFocusBookmark/u);
  assert.match(`${client}\n${focus}`, /restoreFocusBookmark/u);
  assert.match(client, /requestSequence: nextInteractionSequence\(\)/u);
  assert.match(clientOverlays, /setAttribute\('aria-expanded', 'true'\)/u);
  assert.match(client, /setAttribute\('aria-expanded', 'false'\)/u);
  assert.match(clientOverlays, /initialFocus: 'current-route'/u);
  assert.match(overlay, /\[aria-current="page"\]/u);
});

test('diagnostics and custom command management use visible bounded fields with no raw JSON wizard', () => {
  const client = readFileSync('src/webview/controlCenter/client.ts', 'utf8');
  const diagnostics = readFileSync('src/webview/controlCenter/routes/diagnostics.ts', 'utf8');
  const commands = readFileSync('src/webview/controlCenter/routes/commands.ts', 'utf8');
  assert.match(client, /type: 'diagnosticsIntent'/u);
  assert.match(diagnostics, /run-diagnostics|diagnostics-summary|diagnostic-check/u);
  for (const field of [
    'custom-command-label', 'custom-command-description', 'custom-command-phrases',
    'custom-command-kind', 'custom-command-target', 'custom-command-enabled',
  ]) assert.match(commands, new RegExp(field, 'u'));
  assert.doesNotMatch(`${client}\n${commands}`, /JSON\.parse|raw JSON|window\.prompt\(/iu);
});

test('built-in command enablement is editable in both table and drawer without resetting phrases', () => {
  const client = readFileSync('src/webview/controlCenter/client.ts', 'utf8');
  const overlays = readFileSync('src/webview/controlCenter/clientOverlays.ts', 'utf8');
  const commands = readFileSync('src/webview/controlCenter/routes/commands.ts', 'utf8');
  assert.match(commands, /toggle\.checked = row\.enabled/u);
  assert.doesNotMatch(commands, /toggle\.disabled\s*=\s*row\.availability/u);
  assert.match(overlays, /enabled\.checked = message\.enabled/u);
  assert.match(overlays, /operation: 'set-enabled', value: enabled\.checked/u);
  assert.match(overlays, /operation: 'replace-phrases', value/u);
  assert.match(client, /showCommandDetailsOverlay/u);
});

test('Assistant and Commands expose host-backed management without browser authority fields', () => {
  const client = readFileSync('src/webview/controlCenter/client.ts', 'utf8');
  const overlays = readFileSync('src/webview/controlCenter/clientOverlays.ts', 'utf8');
  const assistant = readFileSync('src/webview/controlCenter/routes/assistant.ts', 'utf8');
  const commands = readFileSync('src/webview/controlCenter/routes/commands.ts', 'utf8');
  assert.match(client, /type: 'planningProviderIntent'/u);
  assert.match(client, /type: 'agentManagementIntent'/u);
  assert.match(client, /type: 'customCommandIntent'/u);
  assert.match(overlays, /operation: 'replace-phrases'/u);
  assert.match(overlays, /parsePhraseLines/u);
  assert.match(assistant, /provider-profile-form|agent-profile-form|agent-create-form/u);
  assert.match(commands, /custom-command-form/u);
  assert.match(commands, /edit-custom-command/u);
  assert.match(commands, /delete-custom-command/u);
  assert.doesNotMatch(`${client}\n${overlays}\n${assistant}\n${commands}`, /receipt|nonce|raw executor|pendingId/iu);
});

test('selected Soniox always exposes native-only credential, consent, test, and revoke recovery intents', () => {
  const client = readFileSync('src/webview/controlCenter/client.ts', 'utf8');
  const assistant = readFileSync('src/webview/controlCenter/routes/assistant.ts', 'utf8');
  for (const request of ['configure-secret', 'request-remote-consent', 'test', 'revoke']) {
    assert.match(client, new RegExp(`'${request}'`, 'u'));
  }
  assert.match(assistant, /sttProvider === 'none'/u);
  assert.match(assistant, /remoteProcessing/u);
  assert.match(assistant, /configure-soniox-secret/u);
  assert.match(assistant, /request-soniox-consent/u);
  assert.doesNotMatch(`${client}\n${assistant}`, /credential\s*:/iu);
});

test('one-overlay controller provides dialog semantics, inert background, Escape, trap, and safe return', () => {
  const source = readFileSync('src/webview/controlCenter/overlay.ts', 'utf8');
  assert.match(source, /if \(this\.active\) this\.close\(false\)/u);
  assert.match(source, /role', 'dialog'/u);
  assert.match(source, /aria-modal', 'true'/u);
  assert.match(source, /\.inert = inert/u);
  assert.match(source, /event\.key === 'Escape'/u);
  assert.match(source, /event\.key !== 'Tab'/u);
  assert.match(source, /active\.trigger/u);
  assert.match(source, /document\.querySelector<HTMLElement>\('main h1'\)/u);
});
