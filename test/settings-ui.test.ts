import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parseLegacySettingsLauncherMessage } from '../src/webview/settings/launcher';

test('legacy Settings browser entry renders one launcher and imports no former Settings application', () => {
  const client = readFileSync('src/webview/settings/client.ts', 'utf8');
  const launcher = readFileSync('src/webview/settings/launcher.ts', 'utf8');
  assert.match(client, /renderSettingsLauncher/u);
  assert.doesNotMatch(client, /SettingsView|attachSettingsEvents|SettingsSpeechPreview|settings-state/u);
  assert.match(launcher, /heading\.textContent = 'Voice Input'/u);
  assert.match(launcher, /open\.textContent = 'Open Control Center'/u);
  assert.match(launcher, /root\.replaceChildren\(main\)/u);
  assert.doesNotMatch(launcher, /createElement\(['"](?:input|select|textarea)['"]\)|provider-list|mapping-form|credential-field/iu);
});

test('legacy launcher protocol maps only six canonical routes and rejects extra authority fields', () => {
  for (const route of ['home', 'voice', 'commands', 'assistant', 'privacy', 'diagnostics'] as const) {
    assert.deepEqual(parseLegacySettingsLauncherMessage({
      type: 'settings-open-control-center', route,
    }), { type: 'settings-open-control-center', route });
  }
  assert.equal(parseLegacySettingsLauncherMessage({
    type: 'settings-open-control-center', route: 'setup',
  }), undefined);
  assert.equal(parseLegacySettingsLauncherMessage({
    type: 'settings-open-control-center', route: 'home', confirmed: true,
  }), undefined);
});

test('legacy Settings document is a strict external-asset launcher with no inline application DOM', () => {
  const source = readFileSync('src/webview/settings/document.ts', 'utf8');
  assert.match(source, /style-src \$\{webview\.cspSource\}/u);
  assert.match(source, /connect-src 'none'/u);
  assert.match(source, /form-action 'none'/u);
  assert.match(source, /settingsLauncher\.css/u);
  assert.doesNotMatch(source, /unsafe-inline|SETTINGS_VIEW_STYLES|<style>/u);
  const css = readFileSync('src/webview/settings/launcher.css', 'utf8');
  assert.match(css, /min-height:\s*44px/u);
  assert.match(css, /overflow-x:\s*hidden/u);
  assert.match(css, /prefers-reduced-motion/u);
});

test('Settings provider routes openSettings and legacy sections to the Control Center singleton', () => {
  const source = readFileSync('src/webview/settings/provider.ts', 'utf8');
  assert.match(source, /voiceInput\.openControlCenter/u);
  assert.match(source, /routeForLegacySection\(section\)/u);
  assert.match(source, /actions: 'commands'/u);
  assert.match(source, /agents: 'assistant'/u);
  assert.doesNotMatch(source, /await revealContainer\(\)/u);
});
