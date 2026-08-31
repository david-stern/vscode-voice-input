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
  'out/webview/mic.client.js',
  'out/webview/settings.client.js',
  'out/licenses/PICOVOICE-LICENSE.txt',
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

test('webview has an isolated DOM-only typecheck and two explicit browser entries', () => {
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
  assert.match(buildScript, /const outDir = path\.join\(__dirname, 'out'\);/);
  assert.deepEqual(
    [...buildScript.matchAll(/fs\.rmSync\(([^,]+)/gu)].map((match) => match[1].trim()),
    ['outDir'],
  );
  assert.match(buildScript, /'mic\.client': 'src\/webview\/mic\.client\.ts'/);
  assert.match(buildScript, /'settings\.client': 'src\/webview\/settings\.client\.ts'/);
  assert.match(buildScript, /outdir: 'out\/webview'/);
});

test('the shared protocol has no host runtime imports', () => {
  const source = readFileSync('src/webview/protocol.ts', 'utf8');

  assert.doesNotMatch(source, /from\s+['"](?:node:|vscode|\.\.\/)/);
  assert.doesNotMatch(source, /\brequire\s*\(/);
});
