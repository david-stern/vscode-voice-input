import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const projectRoot = resolve(__dirname, '..');
const codeExecutable = resolveCodeExecutable();
const extensionHostRunner = String.raw`
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vscode = require('vscode');

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

async function waitForWebviewReadiness(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let latest;
  do {
    latest = await vscode.commands.executeCommand('voiceInput.internal.webviewReadiness');
    if (latest && latest.microphone === true && latest.settings === true) return latest;
    await delay(100);
  } while (Date.now() < deadline);
  return latest;
}

async function run() {
  const unhandled = [];
  const onUnhandled = (reason) => { unhandled.push(reason); };
  process.on('unhandledRejection', onUnhandled);
  try {
    const extension = vscode.extensions.getExtension('david-stern.voice-input');
    assert.ok(extension, 'Voice Input development extension is registered');
    await extension.activate();
    assert.equal(extension.isActive, true, 'Voice Input activates');

    const manifest = extension.packageJSON;
    const views = manifest.contributes && manifest.contributes.views
      && manifest.contributes.views.voiceInput;
    assert.ok(Array.isArray(views), 'Voice Input view container contributions are registered');
    assert.deepEqual(
      views.map((view) => view.id),
      ['voiceInput.micView', 'voiceInput.settingsView'],
      'both contributed webviews are present in the fresh profile',
    );

    const registeredCommands = new Set(await vscode.commands.getCommands(true));
    for (const contribution of manifest.contributes.commands || []) {
      assert.ok(
        registeredCommands.has(contribution.command),
        'registered contributed command: ' + contribution.command,
      );
    }
    assert.equal(
      (manifest.contributes.commands || []).some(
        (command) => command.command === 'voiceInput.internal.webviewReadiness',
      ),
      false,
      'runtime webview observation is internal and not contributed',
    );
    assert.ok(
      registeredCommands.has('voiceInput.internal.webviewReadiness'),
      'internal runtime webview observation is registered',
    );

    const properties = manifest.contributes.configuration.properties || {};
    for (const fullName of Object.keys(properties)) {
      assert.match(fullName, /^voiceInput\./, 'configuration key is in the Voice Input section');
      const setting = fullName.slice('voiceInput.'.length);
      assert.notEqual(
        vscode.workspace.getConfiguration('voiceInput').inspect(setting),
        undefined,
        'fresh Extension Host registered configuration key: ' + fullName,
      );
    }

    for (const bundleName of ['mic.client.js', 'settings.client.js']) {
      const bundlePath = join(extension.extensionPath, 'out', 'webview', bundleName);
      const bundle = readFileSync(bundlePath, 'utf8');
      assert.ok(bundle.length > 100, 'webview bundle is loadable: ' + bundleName);
    }

    await vscode.commands.executeCommand('workbench.view.extension.voiceInput');
    await vscode.commands.executeCommand('voiceInput.openSettings');
    const readiness = await waitForWebviewReadiness(5_000);
    assert.deepEqual(
      readiness,
      { microphone: true, settings: true },
      'both webview clients executed and posted their validated ready messages',
    );
    await delay(250);
    assert.deepEqual(
      unhandled.map((reason) => reason instanceof Error ? reason.message : String(reason)),
      [],
      'activation and both webview reveal paths emit no unhandled rejections',
    );
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }
}

module.exports = { run };
`;

async function main(): Promise<void> {
  const manifest = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8')) as {
    main?: string;
  };
  assert.equal(manifest.main, './out/extension.js', 'smoke harness expects the built host bundle');
  await Promise.all([
    readFile(join(projectRoot, 'out', 'extension.js')),
    readFile(join(projectRoot, 'out', 'webview', 'mic.client.js')),
    readFile(join(projectRoot, 'out', 'webview', 'settings.client.js')),
  ]);

  const temporaryRoot = await mkdtemp(join(tmpdir(), 'voice-input-extension-host-'));
  const userDataDirectory = join(temporaryRoot, 'user-data');
  const extensionsDirectory = join(temporaryRoot, 'extensions');
  const workspaceDirectory = join(temporaryRoot, 'read-only-workspace');
  const runnerPath = join(temporaryRoot, 'extension-host-runner.cjs');
  try {
    await Promise.all([
      mkdir(userDataDirectory),
      mkdir(extensionsDirectory),
      mkdir(workspaceDirectory),
      writeFile(runnerPath, extensionHostRunner, 'utf8'),
    ]);
    await chmod(workspaceDirectory, 0o555);

    const environment = { ...process.env };
    delete environment.ELECTRON_RUN_AS_NODE;
    delete environment.VSCODE_CWD;
    delete environment.VSCODE_IPC_HOOK_CLI;
    delete environment.VSCODE_NLS_CONFIG;

    const args = [
      '--new-window',
      '--disable-crash-reporter',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-workspace-trust',
      '--skip-release-notes',
      '--skip-welcome',
      `--user-data-dir=${userDataDirectory}`,
      `--extensions-dir=${extensionsDirectory}`,
      `--extensionDevelopmentPath=${projectRoot}`,
      `--extensionTestsPath=${runnerPath}`,
      workspaceDirectory,
    ];
    const exitCode = await launch(codeExecutable, args, environment);
    assert.equal(exitCode, 0, `${basename(codeExecutable)} Extension Host smoke exited successfully`);
    console.log('Extension Host smoke passed on a fresh profile and read-only workspace.');
  } finally {
    await chmod(workspaceDirectory, 0o755).catch(() => undefined);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function resolveCodeExecutable(): string {
  const configured = process.env.VOICE_INPUT_VSCODE_EXECUTABLE?.trim();
  if (configured) return configured;
  const candidates = process.platform === 'linux'
    ? ['/usr/share/code/code', '/usr/share/code-insiders/code-insiders']
    : process.platform === 'darwin'
      ? ['/Applications/Visual Studio Code.app/Contents/MacOS/Electron']
      : [];
  return candidates.find(existsSync) ?? 'code';
}

function launch(
  executable: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<number | null> {
  return new Promise((resolveLaunch, rejectLaunch) => {
    let output = '';
    const appendOutput = (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.length > 2_000_000) output = output.slice(-2_000_000);
    };
    const child = spawn(executable, [...args], {
      cwd: projectRoot,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', appendOutput);
    child.stderr?.on('data', appendOutput);
    const closeOutput = () => {
      child.stdout?.destroy();
      child.stderr?.destroy();
    };
    let timedOut = false;
    let forceKill: ReturnType<typeof setTimeout> | undefined;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      forceKill = setTimeout(() => child.kill('SIGKILL'), 5_000);
    }, 45_000);
    child.once('error', (error) => {
      clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      process.stderr.write(output);
      closeOutput();
      rejectLaunch(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      closeOutput();
      if (timedOut) {
        process.stderr.write(output);
        rejectLaunch(new Error('Extension Host smoke timed out after 45 seconds'));
      } else {
        if (code !== 0) process.stderr.write(output);
        resolveLaunch(code);
      }
    });
  });
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
