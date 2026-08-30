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

  const ext = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'out/extension.js',
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    // Keep the native recorder package intact so its platform-specific
    // `.node` binaries are resolved relative to the package at runtime.
    external: ['vscode', '@picovoice/pvrecorder-node'],
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
