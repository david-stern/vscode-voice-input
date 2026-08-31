import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

interface Manifest {
  contributes: {
    views: Record<string, Array<{ type?: string; id: string; name: string; icon?: string }>>;
    commands: Array<{ command: string; icon?: string }>;
    menus?: Record<string, Array<{ command: string; when?: string; group?: string }>>;
    configuration: { properties: Record<string, { default?: unknown; enum?: unknown[] }> };
  };
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
}

test('manifest contributes the Settings webview, open command, title gear, and explicit DeepSeek mode', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as Manifest;
  const views = manifest.contributes.views.voiceInput;
  assert.deepEqual(views.map(({ id }) => id), ['voiceInput.micView', 'voiceInput.settingsView']);
  assert.deepEqual(views[1], {
    type: 'webview',
    id: 'voiceInput.settingsView',
    name: 'Settings',
    icon: '$(settings-gear)',
  });
  assert.deepEqual(
    manifest.contributes.commands.find(({ command }) => command === 'voiceInput.openSettings'),
    { command: 'voiceInput.openSettings', title: 'Voice Input: Open Settings', icon: '$(settings-gear)' },
  );
  assert.deepEqual(
    manifest.contributes.menus?.['view/title'],
    [{ command: 'voiceInput.openSettings', when: 'view == voiceInput.micView', group: 'navigation@1' }],
  );
  assert.deepEqual(manifest.contributes.configuration.properties['voiceInput.assistantIntelligence'].enum, ['off', 'deepseek']);
  assert.equal(manifest.contributes.configuration.properties['voiceInput.assistantIntelligence'].default, 'deepseek');
  assert.equal(manifest.contributes.configuration.properties['voiceInput.assistantResumeOnStartup'].default, false);
  assert.equal(manifest.scripts['test:settings'], 'tsx --test test/settings-*.test.ts');
});

test('generic command provider tests bridge native cancellation to the probe signal', () => {
  const workflows = readFileSync('src/platform/voiceInputCommands.ts', 'utf8');
  assert.match(
    workflows,
    /testAssistantProvider\(\)[^]*?withProgress\(\s*\{\s*location:[^,]+,\s*cancellable:\s*true/u,
  );
  assert.match(workflows, /new AbortController\(\)/u);
  assert.match(workflows, /testProvider\(provider, controller\.signal\)/u);
});

test('build, provider document, and release inspection agree on both browser bundle names', () => {
  const build = readFileSync('esbuild.js', 'utf8');
  const settingsDocument = readFileSync('src/webview/settings/document.ts', 'utf8');
  const micDocument = readFileSync('src/webview/mic/document.ts', 'utf8');
  const release = readFileSync('scripts/release.sh', 'utf8');
  const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as Manifest;
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
    packages: Record<string, { version?: string; devDependencies?: Record<string, string> }>;
  };
  assert.match(build, /'mic\.client': 'src\/webview\/mic\.client\.ts'/);
  assert.match(build, /'settings\.client': 'src\/webview\/settings\.client\.ts'/);
  assert.match(micDocument, /'mic\.client\.js'/);
  assert.match(settingsDocument, /'settings\.client\.js'/);
  assert.match(release, /npm run release:verify/);
  assert.match(manifest.scripts['release:verify'], /npm run typecheck/);
  assert.match(manifest.scripts['release:verify'], /npm run lint/);
  assert.match(release, /extension\/out\/webview\/mic\.client\.js/);
  assert.match(release, /extension\/out\/webview\/settings\.client\.js/);
  assert.equal(manifest.devDependencies['@vscode/vsce'], '3.9.2');
  assert.equal(lock.packages[''].devDependencies?.['@vscode/vsce'], '3.9.2');
  assert.equal(lock.packages['node_modules/@vscode/vsce'].version, '3.9.2');
  assert.match(release, /node_modules\/\.bin\/vsce/);
  assert.doesNotMatch(release, /\bnpx\b|command -v vsce/u);
});
