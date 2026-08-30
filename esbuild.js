const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const watch = process.argv.includes('--watch');

const ctxs = [];

async function build() {
  const licenseDir = path.join(__dirname, 'out', 'licenses');
  fs.mkdirSync(licenseDir, { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, 'src', 'recorder', 'PICOVOICE-LICENSE.txt'),
    path.join(licenseDir, 'PICOVOICE-LICENSE.txt'),
  );

  // Stage only the recorder runtime. Keeping the npm package as a development
  // dependency avoids shipping its TypeScript sources, tests, maps, and build
  // configuration while preserving every supported native binary.
  const recorderSource = path.join(__dirname, 'node_modules', '@picovoice', 'pvrecorder-node');
  const recorderTarget = path.join(__dirname, 'out', 'vendor', 'pvrecorder-node');
  fs.rmSync(recorderTarget, { recursive: true, force: true });
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
    sourcemap: true,
    logLevel: 'info',
  });

  const web = await esbuild.context({
    entryPoints: ['src/webview/mic.client.ts'],
    bundle: true,
    outfile: 'out/webview/mic.client.js',
    platform: 'browser',
    target: 'es2022',
    format: 'iife',
    sourcemap: true,
    logLevel: 'info',
  });

  ctxs.push(ext, web);

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
