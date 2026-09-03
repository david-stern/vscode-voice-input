const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const watch = process.argv.includes('--watch');
const outDir = path.join(__dirname, 'out');

const ctxs = [];

async function build() {
  fs.rmSync(outDir, { recursive: true, force: true });

  const licenseDir = path.join(outDir, 'licenses');
  fs.mkdirSync(licenseDir, { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, 'src', 'recorder', 'PICOVOICE-LICENSE.txt'),
    path.join(licenseDir, 'PICOVOICE-LICENSE.txt'),
  );
  fs.copyFileSync(
    path.join(__dirname, 'node_modules', 'ws', 'LICENSE'),
    path.join(licenseDir, 'WS-LICENSE.txt'),
  );
  const webviewAssetDir = path.join(outDir, 'webview');
  fs.mkdirSync(path.join(webviewAssetDir, 'controlCenter'), { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, 'src', 'webview', 'controlCenter', 'styles.css'),
    path.join(webviewAssetDir, 'controlCenter', 'styles.css'),
  );
  fs.copyFileSync(
    path.join(__dirname, 'src', 'webview', 'settings', 'launcher.css'),
    path.join(webviewAssetDir, 'settingsLauncher.css'),
  );

  // Stage only the recorder runtime. Keeping the npm package as a development
  // dependency avoids shipping its TypeScript sources, tests, maps, and build
  // configuration while preserving every supported native binary.
  const recorderSource = path.join(__dirname, 'node_modules', '@picovoice', 'pvrecorder-node');
  const recorderTarget = path.join(outDir, 'vendor', 'pvrecorder-node');
  fs.mkdirSync(recorderTarget, { recursive: true });
  fs.copyFileSync(path.join(recorderSource, 'package.json'), path.join(recorderTarget, 'package.json'));
  fs.cpSync(path.join(recorderSource, 'lib'), path.join(recorderTarget, 'lib'), { recursive: true });
  fs.cpSync(path.join(recorderSource, 'dist'), path.join(recorderTarget, 'dist'), {
    recursive: true,
    filter: (source) => !source.endsWith('.map') && !source.includes(`${path.sep}types`),
  });

  const ext = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'out/extension.js',
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    // Keep the native recorder package intact so its platform-specific
    // `.node` binaries are resolved relative to the package at runtime.
    external: ['vscode', './vendor/pvrecorder-node'],
    define: {
      'process.env.WS_NO_BUFFER_UTIL': '"1"',
      'process.env.WS_NO_UTF_8_VALIDATE': '"1"',
    },
    sourcemap: true,
    logLevel: 'info',
  });

  // Every synchronous PvRecorder call runs on this worker thread. It sits next to
  // out/extension.js so its external `./vendor/pvrecorder-node` require resolves
  // against the same staged native package.
  const recorderWorker = await esbuild.context({
    entryPoints: ['src/recorder/worker.entry.ts'],
    bundle: true,
    outfile: 'out/recorderWorker.js',
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    external: ['./vendor/pvrecorder-node'],
    define: {
      'process.env.WS_NO_BUFFER_UTIL': '"1"',
      'process.env.WS_NO_UTF_8_VALIDATE': '"1"',
    },
    sourcemap: true,
    logLevel: 'info',
  });

  const web = await esbuild.context({
    entryPoints: {
      'mic.client': 'src/webview/mic.client.ts',
      'settings.client': 'src/webview/settings.client.ts',
      'controlCenter/client': 'src/webview/controlCenter/client.ts',
    },
    bundle: true,
    outdir: 'out/webview',
    platform: 'browser',
    target: 'es2022',
    format: 'iife',
    sourcemap: true,
    logLevel: 'info',
  });

  ctxs.push(ext, recorderWorker, web);

  if (watch) {
    await Promise.all(ctxs.map((c) => c.watch()));
    console.log('watching...');
  } else {
    await Promise.all(ctxs.map((c) => c.rebuild()));
    await Promise.all(ctxs.map((c) => c.dispose()));
  }
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
