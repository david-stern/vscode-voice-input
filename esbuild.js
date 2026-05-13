const esbuild = require('esbuild');
const path = require('path');

const watch = process.argv.includes('--watch');

const ctxs = [];

async function build() {
  const ext = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'out/extension.js',
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    external: ['vscode'],
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
