import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

import { ASSISTANT_ROUTE_IDS, SETUP_STEP_IDS } from '../src/webview/settings/contracts';
import { focusedControlSyncAction } from '../src/webview/settings/dom';
import { SETTINGS_STRINGS } from '../src/webview/settings/i18n';
import { mappingTextDirection, planMappingListUpdate } from '../src/webview/settings/lists';
import { renderSettingsShell } from '../src/webview/settings/shell';
import { SETTINGS_VIEW_STYLES } from '../src/webview/settings/styles';
import {
  languageHintOptions,
  microphoneSelectionStatus,
  providerFocusTarget,
} from '../src/webview/settings/view';

test('settings DOM exposes all nine stable product routes and labeled native controls', () => {
  const html = renderSettingsShell();
  for (const route of ASSISTANT_ROUTE_IDS) {
    assert.match(html, new RegExp(`data-route-panel="${route}"`));
    assert.match(html, new RegExp(`class="route-link"[^>]+data-route="${route}"`));
    assert.match(html, new RegExp(`id="route-${route}-title"`));
  }
  assert.equal((html.match(/class="route-panel"/g) ?? []).length, 9);
  assert.equal((html.match(/class="route-link"/g) ?? []).length, 9);
  assert.doesNotMatch(html, /<details\b/);
  assert.doesNotMatch(html, /id="route-setup"[^>]+hidden/);
  assert.match(html, /id="route-home"[^>]+hidden/);
  assert.match(html, /class="skip-link" href="#settings-main"/);
  assert.equal((html.match(/aria-live="polite"/g) ?? []).length, 1);
  assert.match(html, /<label for="ui-language"/);
  assert.match(html, /<label for="assistant-wake-phrase"/);
  assert.match(html, /<label for="assistant-provider"/);
  assert.match(html, /<label for="speech-test-phrase"/);
  assert.match(html, /<label for="microphone-device"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /id="shortcut-default" dir="ltr"/);
  assert.match(html, /id="assistant-wake-phrase"[^>]+dir="auto"/);
  assert.match(html, /id="speech-test-phrase"[^>]+dir="auto"/);
  assert.match(html, /id="soniox-credential-status"[^>]+tabindex="-1"/);
  assert.match(html, /id="provider-list" class="provider-list"/);
  assert.match(html, /id="agent-list" class="agent-list"/);
  assert.match(html, /id="provider-privacy-list" class="provider-privacy-list"/);
  assert.match(html, /id="approval-history" class="approval-history"/);
  for (const step of SETUP_STEP_IDS) {
    assert.match(html, new RegExp(`data-setup-step="${step}"`));
    assert.match(html, new RegExp(`data-setup-panel="${step}"`));
  }
  assert.match(html, /data-i18n="providerRoleStt"/);
  assert.match(html, /data-i18n="providerRoleReasoning"/);
  assert.match(html, /data-i18n="providerRoleTts"/);
});

test('route layout follows VS Code tokens, responsive targets, RTL logic, and reduced motion', () => {
  assert.match(SETTINGS_VIEW_STYLES, /font:\s*var\(--vscode-font-size/);
  assert.match(SETTINGS_VIEW_STYLES, /min-height:\s*44px/);
  assert.match(SETTINGS_VIEW_STYLES, /@media \(max-width: 375px\)/);
  assert.match(SETTINGS_VIEW_STYLES, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(SETTINGS_VIEW_STYLES, /padding-inline|border-inline-start/);
  assert.doesNotMatch(SETTINGS_VIEW_STYLES, /#[0-9a-f]{3,8}|rgba?\(/i);
  assert.doesNotMatch(SETTINGS_VIEW_STYLES, /(?:Inter|Arial|Helvetica|Roboto|Monaco|Menlo)/);
  const viewSource = readFileSync('src/webview/settings/view.ts', 'utf8');
  assert.match(viewSource, /document\.documentElement\.dir = state\.uiLang === 'he' \? 'rtl' : 'ltr'/);
  assert.match(viewSource, /heading\?\.focus\(\{ preventScroll: true \}\)/);
});

test('focused settings survive local renders and reconcile an authoritative rejection on blur', () => {
  assert.equal(focusedControlSyncAction(true, false, true), 'preserve');
  assert.equal(focusedControlSyncAction(true, true, true), 'defer');
  assert.equal(focusedControlSyncAction(false, false, true), 'apply');
  assert.equal(focusedControlSyncAction(true, true, false), 'clear');
});

test('language hints contain one localized Auto option when metadata already includes auto', () => {
  const options = languageHintOptions([
    { code: 'auto', name: 'Auto-detect' },
    { code: 'he', name: 'Hebrew' },
    { code: 'auto', name: 'Duplicate Auto' },
  ], SETTINGS_STRINGS.en);

  assert.deepEqual(options, [
    { value: 'auto', label: 'Auto' },
    { value: 'he', label: 'Hebrew (he)' },
  ]);
});

test('user-authored mapping text follows its content while command identifiers stay LTR', () => {
  assert.equal(mappingTextDirection('label'), 'auto');
  assert.equal(mappingTextDirection('description'), 'auto');
  assert.equal(mappingTextDirection('phrases'), 'auto');
  assert.equal(mappingTextDirection('target'), 'ltr');
});

test('mapping refresh keeps storage order and follows a rotated authority ID at the same index', () => {
  const plan = planMappingListUpdate(
    ['vm_AAAAAAAAAAAAAAAAAAAAAA', 'vm_BBBBBBBBBBBBBBBBBBBBBB', 'vm_CCCCCCCCCCCCCCCCCCCCCC'],
    ['vm_AAAAAAAAAAAAAAAAAAAAAA', 'vm_DDDDDDDDDDDDDDDDDDDDDD', 'vm_CCCCCCCCCCCCCCCCCCCCCC'],
    { id: 'vm_BBBBBBBBBBBBBBBBBBBBBB', index: 1, action: 'toggle-enabled' },
  );
  assert.deepEqual(plan.orderedIds, [
    'vm_AAAAAAAAAAAAAAAAAAAAAA', 'vm_DDDDDDDDDDDDDDDDDDDDDD', 'vm_CCCCCCCCCCCCCCCCCCCCCC',
  ]);
  assert.deepEqual(plan.removedIds, ['vm_BBBBBBBBBBBBBBBBBBBBBB']);
  assert.equal(plan.focusId, 'vm_DDDDDDDDDDDDDDDDDDDDDD');
  assert.equal(plan.focusAction, 'toggle-enabled');
});

test('provider status transitions choose an explicit keyboard focus destination', () => {
  const state = {
    configured: true,
    credential: { phase: 'idle' as const, operationRevision: 2 },
    test: { phase: 'running' as const, operationRevision: 3 },
  };
  assert.equal(providerFocusTarget('test-start', state), 'test-cancel');
  assert.equal(providerFocusTarget('set', state), 'replace');
  assert.equal(providerFocusTarget('clear', state), 'clear');
  assert.equal(providerFocusTarget('clear', { ...state, configured: false }), 'set');
  assert.equal(providerFocusTarget('replace', {
    ...state,
    credential: { phase: 'updating' as const, operationRevision: 3 },
  }), 'status');
});

test('microphone recovery keeps repaired status honest and directs stale or legacy choices to selection', () => {
  assert.equal(microphoneSelectionStatus({
    kind: 'repaired', status: 'ready', recovery: 'none', label: 'Built-in Microphone',
  }, SETTINGS_STRINGS.en), 'The saved microphone was repaired to “Built-in Microphone”.');
  assert.equal(microphoneSelectionStatus({
    kind: 'stale', status: 'unavailable', recovery: 'select-device',
  }, SETTINGS_STRINGS.en), SETTINGS_STRINGS.en.microphoneSelectDeviceRecovery);
  assert.equal(microphoneSelectionStatus({
    kind: 'legacy', status: 'unavailable', recovery: 'select-device',
  }, SETTINGS_STRINGS.he), SETTINGS_STRINGS.he.microphoneSelectDeviceRecovery);
});

test('settings DOM never contains a credential field or hidden mapping authority payload', () => {
  const html = renderSettingsShell();
  assert.doesNotMatch(html, /type="password"/i);
  assert.doesNotMatch(html, /name="?(?:apiKey|credential|secret)/i);
  assert.doesNotMatch(html, /mapping-(?:args|input)|tool-input/i);
  assert.match(html, /data-i18n="credentialNativeOnly"/);
});

test('every static Settings DOM label has complete non-empty Hebrew and English text', () => {
  const html = renderSettingsShell();
  const keys = new Set<string>();
  for (const match of html.matchAll(/data-i18n(?:-placeholder)?="([A-Za-z0-9]+)"/g)) {
    keys.add(match[1]);
  }
  assert.ok(keys.size > 70);
  for (const language of ['en', 'he'] as const) {
    for (const key of keys) {
      assert.ok(key in SETTINGS_STRINGS[language], `${language}.${key} is missing`);
      assert.ok(SETTINGS_STRINGS[language][key as keyof typeof SETTINGS_STRINGS.en].trim(), `${language}.${key} is blank`);
    }
  }
  assert.deepEqual(Object.keys(SETTINGS_STRINGS.en).sort(), Object.keys(SETTINGS_STRINGS.he).sort());
});

test('settings browser dependency lane stays DOM-only and every Settings module remains readable', () => {
  const browserModules = [
    'approvalList.ts', 'client.ts', 'contracts.ts', 'dom.ts', 'events.ts', 'i18n.ts', 'lists.ts',
    'presentation.ts', 'protocol.ts', 'resourceI18n.ts', 'resourceLists.ts', 'shell.ts',
    'safeResources.ts', 'speechPreview.ts', 'state.ts', 'styles.ts', 'view.ts',
  ];
  for (const file of browserModules) {
    const source = readFileSync(`src/webview/settings/${file}`, 'utf8');
    assert.doesNotMatch(source, /from\s+['"](?:node:|vscode)/, file);
    assert.doesNotMatch(source, /\brequire\s*\(/, file);
  }
  for (const file of readdirSync('src/webview/settings').filter((name) => name.endsWith('.ts'))) {
    const lineCount = readFileSync(`src/webview/settings/${file}`, 'utf8').split('\n').length;
    assert.ok(lineCount <= 500, `${file} has ${lineCount} lines`);
  }
});
