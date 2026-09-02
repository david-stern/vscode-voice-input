import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

interface Manifest {
  activationEvents?: string[];
  contributes: {
    views: Record<string, Array<{ type?: string; id: string; name: string; icon?: string }>>;
    commands: Array<{ command: string; icon?: string }>;
    menus?: Record<string, Array<{ command: string; when?: string; group?: string }>>;
    configuration: { properties: Record<string, { default?: unknown; enum?: unknown[] }> };
  };
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

test('manifest retains the legacy Settings launcher and contributes the Control Center authority surface', () => {
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
    manifest.contributes.commands.find(({ command }) => command === 'voiceInput.openControlCenter'),
    {
      command: 'voiceInput.openControlCenter',
      title: 'Voice Input: Open Control Center',
      icon: '$(window)',
    },
  );
  assert.deepEqual(
    manifest.contributes.commands.find(({ command }) => command === 'voiceInput.disableAutoMode'),
    { command: 'voiceInput.disableAutoMode', title: 'Voice Input: Disable Auto Mode' },
  );
  assert.deepEqual(
    manifest.contributes.menus?.['view/title'],
    [{ command: 'voiceInput.openSettings', when: 'view == voiceInput.micView', group: 'navigation@1' }],
  );
  assert.deepEqual(manifest.contributes.configuration.properties['voiceInput.assistantIntelligence'].enum, ['off', 'deepseek']);
  assert.equal(manifest.contributes.configuration.properties['voiceInput.assistantIntelligence'].default, 'deepseek');
  assert.equal(manifest.contributes.configuration.properties['voiceInput.assistantResumeOnStartup'].default, false);
  assert.deepEqual(
    manifest.contributes.configuration.properties['voiceInput.transcriptionProvider'].enum,
    ['none', 'soniox', 'legacy-soniox-pending'],
  );
  assert.equal(manifest.contributes.configuration.properties['voiceInput.transcriptionProvider'].default, 'none');
  assert.equal(manifest.contributes.configuration.properties['voiceInput.autoMode'].default, false);
  assert.ok(manifest.activationEvents?.includes('onStartupFinished'));
  assert.ok(manifest.activationEvents?.includes('onWebviewPanel:voiceInput.controlCenter'));
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

test('build, provider documents, and release inspection agree on all browser bundle names', () => {
  const build = readFileSync('esbuild.js', 'utf8');
  const settingsDocument = readFileSync('src/webview/settings/document.ts', 'utf8');
  const micDocument = readFileSync('src/webview/mic/document.ts', 'utf8');
  const controlDocument = readFileSync('src/webview/controlCenter/document.ts', 'utf8');
  const release = readFileSync('scripts/release.sh', 'utf8');
  const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as Manifest;
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
    packages: Record<string, {
      version?: string;
      license?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    }>;
  };
  assert.match(build, /'mic\.client': 'src\/webview\/mic\.client\.ts'/);
  assert.match(build, /'settings\.client': 'src\/webview\/settings\.client\.ts'/);
  assert.match(build, /'controlCenter\/client': 'src\/webview\/controlCenter\/client\.ts'/);
  assert.match(micDocument, /'mic\.client\.js'/);
  assert.match(settingsDocument, /'settings\.client\.js'/);
  assert.match(controlDocument, /scriptUri/u);
  assert.match(release, /npm run release:verify/);
  assert.match(manifest.scripts['release:verify'], /npm run typecheck/);
  assert.match(manifest.scripts['release:verify'], /npm run lint/);
  assert.match(release, /extension\/out\/webview\/mic\.client\.js/);
  assert.match(release, /extension\/out\/webview\/settings\.client\.js/);
  assert.match(release, /extension\/out\/webview\/controlCenter\/client\.js/);
  assert.match(release, /extension\/out\/licenses\/WS-LICENSE\.txt/);
  assert.match(release, /"extension\/THIRD_PARTY_NOTICES\.md"/);
  assert.doesNotMatch(release, /"extension\/third_party_notices\.md"/);
  assert.match(release, /Validating source-to-archive documentation and manifest parity/u);
  assert.match(release, /extension\/readme\.md/);
  assert.match(release, /extension\/changelog\.md/);
  assert.match(release, /extension\/package\.json/);
  assert.match(release, /Packaged README differs from README\.md beyond the pinned vsce link rewrite/u);
  assert.match(release, /github\.com\/david-stern\/vscode-voice-input\/blob\/HEAD\/CHANGELOG\.md/u);
  assert.match(release, /github\.com\/david-stern\/vscode-voice-input\/blob\/HEAD\/LICENSE/u);
  assert.equal(manifest.dependencies.ws, '8.21.3');
  assert.equal(manifest.devDependencies['@types/ws'], '8.18.1');
  assert.equal(lock.packages[''].dependencies?.ws, '8.21.3');
  assert.equal(lock.packages['node_modules/ws'].version, '8.21.3');
  assert.equal(lock.packages['node_modules/ws'].license, 'MIT');
  assert.equal(manifest.devDependencies['@vscode/vsce'], '3.9.2');
  assert.equal(lock.packages[''].devDependencies?.['@vscode/vsce'], '3.9.2');
  assert.equal(lock.packages['node_modules/@vscode/vsce'].version, '3.9.2');
  assert.match(release, /node_modules\/\.bin\/vsce/);
  assert.doesNotMatch(release, /\bnpx\b|command -v vsce/u);
});
