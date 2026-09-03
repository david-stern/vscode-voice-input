import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import test from 'node:test';

const REQUIRED_BUILD_FILES = [
  'out/extension.js',
  'out/recorderWorker.js',
  'out/webview/mic.client.js',
  'out/webview/settings.client.js',
  'out/webview/settingsLauncher.css',
  'out/webview/controlCenter/client.js',
  'out/webview/controlCenter/styles.css',
  'out/licenses/PICOVOICE-LICENSE.txt',
  'out/licenses/WS-LICENSE.txt',
  'out/vendor/pvrecorder-node/package.json',
  'out/vendor/pvrecorder-node/dist/index.js',
  'out/vendor/pvrecorder-node/lib/linux/x86_64/pv_recorder.node',
  'out/vendor/pvrecorder-node/lib/mac/arm64/pv_recorder.node',
  'out/vendor/pvrecorder-node/lib/mac/x86_64/pv_recorder.node',
  'out/vendor/pvrecorder-node/lib/raspberry-pi/cortex-a53-aarch64/pv_recorder.node',
  'out/vendor/pvrecorder-node/lib/raspberry-pi/cortex-a53/pv_recorder.node',
  'out/vendor/pvrecorder-node/lib/raspberry-pi/cortex-a72-aarch64/pv_recorder.node',
  'out/vendor/pvrecorder-node/lib/raspberry-pi/cortex-a72/pv_recorder.node',
  'out/vendor/pvrecorder-node/lib/raspberry-pi/cortex-a76-aarch64/pv_recorder.node',
  'out/vendor/pvrecorder-node/lib/raspberry-pi/cortex-a76/pv_recorder.node',
  'out/vendor/pvrecorder-node/lib/windows/amd64/pv_recorder.node',
  'out/vendor/pvrecorder-node/lib/windows/arm64/pv_recorder.node',
] as const;

test('production build replaces stale output with the complete package projection', () => {
  const staleModule = 'out/providers/deepseekProbe.js';
  const staleSentinel = 'out/stale-build-sentinel.txt';
  mkdirSync(dirname(staleModule), { recursive: true });
  writeFileSync(staleModule, 'deleted source module');
  writeFileSync(staleSentinel, 'stale output');

  execFileSync(process.execPath, ['esbuild.js'], { stdio: 'pipe' });

  assert.equal(existsSync(staleModule), false);
  assert.equal(existsSync(staleSentinel), false);
  for (const required of REQUIRED_BUILD_FILES) {
    assert.equal(existsSync(required), true, `production build must retain ${required}`);
  }
});

test('webviews have an isolated DOM-only typecheck and three explicit browser entries', () => {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const webviewConfig = JSON.parse(readFileSync('tsconfig.webview.json', 'utf8')) as {
    compilerOptions?: { lib?: string[]; types?: string[]; noEmit?: boolean };
    include?: string[];
  };
  const buildScript = readFileSync('esbuild.js', 'utf8');

  assert.equal(packageJson.scripts?.['compile:webview'], 'tsc -p ./tsconfig.webview.json');
  assert.equal(packageJson.scripts?.typecheck, 'npm run compile && npm run compile:webview');
  assert.deepEqual(webviewConfig.compilerOptions?.lib, ['ES2022', 'DOM']);
  assert.deepEqual(webviewConfig.compilerOptions?.types, []);
  assert.equal(webviewConfig.compilerOptions?.noEmit, true);
  assert.ok(webviewConfig.include?.includes('src/webview/mic.client.ts'));
  assert.ok(webviewConfig.include?.includes('src/webview/settings.client.ts'));
  assert.ok(webviewConfig.include?.includes('src/webview/controlCenter/client.ts'));
  assert.match(buildScript, /const outDir = path\.join\(__dirname, 'out'\);/);
  assert.deepEqual(
    [...buildScript.matchAll(/fs\.rmSync\(([^,]+)/gu)].map((match) => match[1].trim()),
    ['outDir'],
  );
  assert.match(buildScript, /'mic\.client': 'src\/webview\/mic\.client\.ts'/);
  assert.match(buildScript, /'settings\.client': 'src\/webview\/settings\.client\.ts'/);
  assert.match(buildScript, /'controlCenter\/client': 'src\/webview\/controlCenter\/client\.ts'/);
  assert.match(buildScript, /'controlCenter', 'styles\.css'/);
  assert.match(buildScript, /'settingsLauncher\.css'/);
  assert.match(buildScript, /'node_modules', 'ws', 'LICENSE'/);
  assert.match(buildScript, /outdir: 'out\/webview'/);
});

test('fresh browser bundles exclude legacy local-speech setup claims in both languages', () => {
  const browserOutput = [
    'out/webview/mic.client.js',
    'out/webview/mic.client.js.map',
    'out/webview/settings.client.js',
    'out/webview/settings.client.js.map',
    'out/webview/controlCenter/client.js',
    'out/webview/controlCenter/client.js.map',
  ].map((path) => {
    const contents = readFileSync(path, 'utf8');
    if (!path.endsWith('.map')) return contents;
    const sourceMap = JSON.parse(contents) as { sourcesContent?: string[] };
    return `${contents}\n${sourceMap.sourcesContent?.join('\n') ?? ''}`;
  }).join('\n');
  assert.doesNotMatch(
    browserOutput,
    /local speech path|selected installed voice|Local speech: Pending|מסלול התמלול, התכנון והדיבור המקומי|בקול המותקן|דיבור מקומי: בהמתנה/iu,
  );

  assert.match(browserOutput, /System voice — temporary and OS-dependent/u);
  assert.match(browserOutput, /קול מערכת — זמני ותלוי במערכת ההפעלה/u);
  assert.match(browserOutput, /Offline\/local speech is planned and pending/u);
  assert.match(browserOutput, /not included or available in this version/u);
  assert.match(browserOutput, /System voices are OS-provided and may be unavailable/u);
  assert.match(browserOutput, /דיבור לא־מקוון\/מקומי מתוכנן ובהמתנה/u);
  assert.match(browserOutput, /אינו כלול ואינו זמין בגרסה זו/u);
  assert.match(browserOutput, /קולות המערכת מסופקים על־ידי מערכת ההפעלה/u);
});

test('the bundled WebSocket transport has no optional native-addon require', () => {
  const bundle = readFileSync('out/extension.js', 'utf8');
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
    packages: Record<string, {
      version?: string;
      license?: string;
      peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    }>;
  };

  assert.doesNotMatch(bundle, /require\(["'](?:bufferutil|utf-8-validate)["']\)/u);
  assert.equal(lock.packages['node_modules/ws'].version, '8.21.3');
  assert.equal(lock.packages['node_modules/ws'].license, 'MIT');
  assert.equal(lock.packages['node_modules/ws'].peerDependenciesMeta?.bufferutil?.optional, true);
  assert.equal(lock.packages['node_modules/ws'].peerDependenciesMeta?.['utf-8-validate']?.optional, true);
});

test('Wave 1 package selection excludes deferred local-speech helpers and model artifacts', () => {
  const ignore = readFileSync('.vscodeignore', 'utf8');
  const release = readFileSync('scripts/release.sh', 'utf8');
  const packageList = execFileSync('node_modules/.bin/vsce', ['ls', '--no-dependencies'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  assert.match(ignore, /^tools\/\*\*$/mu);
  assert.match(ignore, /^docs\/speech-\*\.md$/mu);
  assert.match(ignore, /^docs\/control-center-ux-contract\.md$/mu);
  assert.doesNotMatch(packageList, /(^|\n)(?:tools\/speech-eval|docs\/speech-)/u);
  assert.doesNotMatch(packageList, /(^|\n)docs\/control-center-ux-contract\.md$/mu);
  assert.doesNotMatch(
    packageList,
    /(?:^|\/)(?:models?|weights?|downloaders?|local-speech)(?:\/|$)|\.(?:onnx|gguf|safetensors|tflite)$/mu,
  );
  assert.match(release, /"\$VSCE" ls --no-dependencies/u);
  assert.match(release, /tools\/speech-eval/u);
  assert.match(release, /helper\|supervisor/u);
  assert.match(release, /keyless/u);
  assert.match(release, /offline/u);
  assert.match(release, /while IFS= read -r packaged_file/u);
  assert.match(release, /CLAIM_TEXT_FILE/u);
});

test('the shared protocol has no host runtime imports', () => {
  const source = readFileSync('src/webview/protocol.ts', 'utf8');

  assert.doesNotMatch(source, /from\s+['"](?:node:|vscode|\.\.\/)/);
  assert.doesNotMatch(source, /\brequire\s*\(/);
});
