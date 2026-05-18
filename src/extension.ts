import * as vscode from 'vscode';
import * as path from 'path';
import { spawn } from 'child_process';
import { watch as fsWatch } from 'fs';
import { MicViewProvider, ViewState, WebviewMessage } from './webview/micView';
import { transcribe } from './stt/soniox';
import { injectText, InjectionMode } from './inject';
import { startRecorder, RecorderHandle, pickTool, listAudioDevices, AudioDevice } from './recorder/native';
import { HistoryStore } from './history';
import { UiLang } from './webview/i18n';
import { log, show as showLog } from './log';
import {
  fetchModels,
  fetchLanguages,
  ModelInfo,
  LanguageInfo,
  HARDCODED_MODELS,
  HARDCODED_LANGUAGES,
} from './sonioxMeta';

const SECRET_KEY = 'SONIOX_API_KEY';

interface Settings {
  speechLang: string;
  uiLang: UiLang;
  ttlDays: 0 | 1 | 7 | 30;
  model: string;
  injectionMode: InjectionMode;
}

function readSettings(): Settings {
  const cfg = vscode.workspace.getConfiguration('voiceInput');
  return {
    speechLang: cfg.get<string>('languageHint', 'he'),
    uiLang: cfg.get<UiLang>('uiLanguage', 'en'),
    ttlDays: (cfg.get<number>('historyTtlDays', 30) as 0 | 1 | 7 | 30),
    model: cfg.get<string>('sttModel', 'stt-async-v4'),
    injectionMode: cfg.get<InjectionMode>('injectionMode', 'auto'),
  };
}

async function writeSettings(partial: Partial<Settings>) {
  const cfg = vscode.workspace.getConfiguration('voiceInput');
  const target = vscode.ConfigurationTarget.Global;
  if (partial.speechLang !== undefined) await cfg.update('languageHint', partial.speechLang, target);
  if (partial.uiLang !== undefined) await cfg.update('uiLanguage', partial.uiLang, target);
  if (partial.ttlDays !== undefined) await cfg.update('historyTtlDays', partial.ttlDays, target);
  if (partial.model !== undefined && partial.model.length > 0)
    await cfg.update('sttModel', partial.model, target);
}

interface MetaCache {
  models: ModelInfo[];
  languages: LanguageInfo[];
  loading: boolean;
  error?: string;
}

export async function activate(context: vscode.ExtensionContext) {
  log('activate v', context.extension.packageJSON.version);
  const provider = new MicViewProvider(context.extensionUri);
  const history = new HistoryStore(context.globalState);

  const meta: MetaCache = {
    models: HARDCODED_MODELS,
    languages: HARDCODED_LANGUAGES,
    loading: false,
  };

  async function refreshMeta() {
    meta.loading = true;
    meta.error = undefined;
    provider.postMeta(meta.models, meta.languages, true);

    const apiKey = await context.secrets.get(SECRET_KEY);
    const tasks: Promise<void>[] = [];

    if (apiKey) {
      tasks.push(
        fetchModels(apiKey)
          .then((models) => {
            meta.models = models;
            log('models fetched:', models.length);
          })
          .catch((e) => {
            log('models fetch failed:', (e as Error).message);
            meta.error = `models: ${(e as Error).message.slice(0, 80)}`;
          }),
      );
    } else {
      log('no api key — skipping model fetch');
    }

    tasks.push(
      fetchLanguages()
        .then((langs) => {
          meta.languages = langs;
        })
        .catch((e) => {
          log('languages fetch failed:', (e as Error).message);
        }),
    );

    await Promise.all(tasks);
    meta.loading = false;
    provider.postMeta(meta.models, meta.languages, false, meta.error);
  }

  // Fire on startup, don't block.
  void refreshMeta();

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(MicViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.text = '$(mic) Voice';
  status.tooltip = process.platform === 'darwin'
    ? 'Voice Input — click or Ctrl+Option+M to toggle'
    : 'Voice Input — click or Alt+M to toggle';
  status.command = 'voiceInput.toggleRecording';
  status.show();
  context.subscriptions.push(status);

  let handle: RecorderHandle | null = null;
  let isRecording = false;

  // ── Device list cache ──────────────────────────────────────────────────────
  let deviceCache: { devices: AudioDevice[]; ts: number } | null = null;
  // Short TTL so a plug/unplug is reflected within a few seconds even without
  // a file-system event (e.g. on macOS / Windows where we have no watcher).
  const DEVICE_CACHE_TTL = 5_000;

  async function getCachedDevices(forceRefresh = false): Promise<AudioDevice[]> {
    const now = Date.now();
    if (!forceRefresh && deviceCache && now - deviceCache.ts < DEVICE_CACHE_TTL) {
      return deviceCache.devices;
    }
    const devices = await listAudioDevices();
    deviceCache = { devices, ts: Date.now() };
    return devices;
  }

  // Populate the cache in the background so it's ready on first record attempt.
  void getCachedDevices();

  // On Linux, watch /dev/snd/ for device additions/removals (USB mic plug/unplug)
  // and immediately invalidate the cache so the next call gets a fresh list.
  if (process.platform === 'linux') {
    try {
      const sndWatcher = fsWatch('/dev/snd/', () => {
        deviceCache = null;
        void getCachedDevices().then(() => void pushFullState());
      });
      context.subscriptions.push({ dispose: () => sndWatcher.close() });
    } catch {
      // /dev/snd/ may not exist on systems without ALSA (unlikely but safe to ignore)
    }
  }

  const setIdle = () => {
    isRecording = false;
    status.text = '$(mic) Voice';
    status.backgroundColor = undefined;
    provider.postRecording(false);
  };
  const setRecording = () => {
    isRecording = true;
    status.text = '$(record) Voice — recording';
    status.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    provider.postRecording(true);
  };
  const setBusy = (label: string) => {
    status.text = `$(sync~spin) Voice — ${label}`;
    status.backgroundColor = undefined;
  };

  const tool = await pickTool();

  // Check all required dependencies and prompt to install if anything is missing.
  // Run in background — don't block activation.
  void checkDependencies(context);

  async function pushFullState() {
    const s = readSettings();
    const entries = await history.list(s.ttlDays);
    const audioDevice = vscode.workspace.getConfiguration('voiceInput').get<string>('audioDevice', '');
    const view: ViewState = {
      uiLang: s.uiLang,
      speechLang: s.speechLang,
      ttlDays: s.ttlDays,
      model: s.model,
      history: entries,
      recording: isRecording,
      keybinding: detectKeybinding(context),
      models: meta.models,
      languages: meta.languages,
      metaLoading: meta.loading,
      metaError: meta.error,
      audioDevice,
      audioDevices: deviceCache?.devices ?? [],
    };
    provider.postState(view);
  }

  async function pushHistoryOnly() {
    const s = readSettings();
    const entries = await history.list(s.ttlDays);
    provider.postHistory(entries);
  }

  async function startRecording() {
    if (isRecording || handle) return;

    // If the device cache is populated and shows no audio inputs, block early
    // and guide the user instead of letting the recorder fail with a cryptic error.
    if (deviceCache) {
      const configuredDevice = vscode.workspace
        .getConfiguration('voiceInput')
        .get<string>('audioDevice', '')
        .trim();
      if (deviceCache.devices.length === 0 && !configuredDevice) {
        const sel = await vscode.window.showErrorMessage(
          'Voice Input: No audio input source found. Connect a microphone and try again.',
          'Select Device',
        );
        if (sel === 'Select Device') {
          await vscode.commands.executeCommand('voiceInput.selectAudioDevice');
        }
        return;
      }
    }

    try {
      handle = await startRecorder();
      setRecording();
    } catch (e) {
      vscode.window.showErrorMessage(`Voice Input: ${(e as Error).message}`);
      setIdle();
    }
  }

  async function stopRecording() {
    if (!handle) {
      setIdle();
      return;
    }
    const h = handle;
    handle = null;
    setBusy('encoding');
    try {
      const result = await h.stop();
      if (!result || result.wav.length < 1024) {
        setIdle();
        return;
      }
      await transcribeAndDispatch(result.wav, result.mime);
    } catch (e) {
      vscode.window.showErrorMessage(`Voice Input: ${(e as Error).message}`);
    } finally {
      setIdle();
    }
  }

  async function transcribeAndDispatch(audio: Uint8Array, mime: string) {
    const apiKey = await context.secrets.get(SECRET_KEY);
    if (!apiKey) {
      vscode.window
        .showErrorMessage(
          'Voice Input: SONIOX_API_KEY not set.',
          'Set now',
        )
        .then((sel) => {
          if (sel === 'Set now') vscode.commands.executeCommand('voiceInput.setApiKey');
        });
      return;
    }
    const s = readSettings();
    setBusy('transcribing');
    const text = await transcribe({
      audio,
      mime,
      apiKey,
      model: s.model,
      languageHint: s.speechLang,
    });
    if (!text) return;

    await history.add(text, s.speechLang);
    await pushHistoryOnly();
    await injectText(text, s.injectionMode);
    // Small delay to let the paste/type operation fully settle before the
    // status-bar and webview state reset (setIdle) triggers a VS Code UI
    // refresh that can steal focus and race with the in-flight paste.
    await new Promise((r) => setTimeout(r, 150));
  }

  provider.onMessage(async (msg: WebviewMessage) => {
    switch (msg.type) {
      case 'ready':
        await pushFullState();
        break;
      case 'start':
        await startRecording();
        break;
      case 'stop':
        await stopRecording();
        break;
      case 'history-copy': {
        const all = await history.list(readSettings().ttlDays);
        const e = all.find((x) => x.id === msg.id);
        if (e) await vscode.env.clipboard.writeText(e.text);
        break;
      }
      case 'history-remove':
        await history.remove(msg.id);
        await pushHistoryOnly();
        break;
      case 'history-clear':
        await history.clear();
        await pushHistoryOnly();
        break;
      case 'history-clear-request': {
        const yes = await vscode.window.showWarningMessage(
          'Clear all voice input history?',
          { modal: true },
          'Clear',
        );
        if (yes === 'Clear') {
          await history.clear();
          await pushHistoryOnly();
        }
        break;
      }
      case 'open-keybindings':
        await vscode.commands.executeCommand(
          'workbench.action.openGlobalKeybindings',
          'voiceInput.toggleRecording',
        );
        break;
      case 'refresh-meta':
        await refreshMeta();
        break;
      case 'audio-device-change':
        await vscode.workspace
          .getConfiguration('voiceInput')
          .update('audioDevice', msg.deviceId, vscode.ConfigurationTarget.Global);
        break;
      case 'audio-device-scan': {
        await getCachedDevices(true);
        await pushFullState();
        break;
      }
      case 'set-api-key':
        await vscode.commands.executeCommand('voiceInput.setApiKey');
        break;
      case 'settings-update':
        await writeSettings({
          speechLang: msg.speechLang,
          uiLang: msg.uiLang,
          ttlDays: msg.ttlDays,
          model: msg.model,
        });
        await pushFullState();
        break;
    }
  });

  // React to external settings changes (e.g. via settings.json).
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('voiceInput')) void pushFullState();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('voiceInput.toggleRecording', async () => {
      // IMPORTANT: do NOT focus/open the view — recording happens in background.
      if (isRecording) await stopRecording();
      else await startRecording();
    }),
    vscode.commands.registerCommand('voiceInput.selectAudioDevice', async () => {
      const devices = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Voice Input: Scanning audio devices…' },
        () => getCachedDevices(true),
      );

      if (devices.length === 0) {
        vscode.window.showErrorMessage(
          'Voice Input: No audio input sources found. Make sure a microphone is connected.',
        );
        return;
      }

      const currentDevice = vscode.workspace
        .getConfiguration('voiceInput')
        .get<string>('audioDevice', '');

      interface DeviceItem extends vscode.QuickPickItem { deviceId: string; }

      const items: DeviceItem[] = [
        {
          label: '$(circle-slash) System default',
          description: 'Let the OS choose the default microphone',
          deviceId: '',
          picked: !currentDevice,
        },
        ...devices.map((d) => ({
          label: `$(device-microphone) ${d.label}`,
          description: d.id,
          deviceId: d.id,
          picked: d.id === currentDevice,
        })),
      ];

      const pick = await vscode.window.showQuickPick(items, {
        title: 'Select Audio Input Device',
        placeHolder: 'Choose a microphone…',
        matchOnDescription: true,
      });

      if (!pick) return;

      await vscode.workspace
        .getConfiguration('voiceInput')
        .update('audioDevice', pick.deviceId, vscode.ConfigurationTarget.Global);

      const friendlyName = pick.deviceId
        ? `"${pick.label.replace(/^\$\([^)]+\)\s*/, '')}"`
        : 'system default';
      vscode.window.showInformationMessage(`Voice Input: Audio device set to ${friendlyName}.`);
    }),
    vscode.commands.registerCommand('voiceInput.setApiKey', async () => {
      const key = await vscode.window.showInputBox({
        title: 'Soniox API Key',
        prompt: 'Paste your SONIOX_API_KEY (stored in VSCode SecretStorage)',
        password: true,
        ignoreFocusOut: true,
      });
      if (!key) return;
      await context.secrets.store(SECRET_KEY, key.trim());
      vscode.window.showInformationMessage('Voice Input: API key saved.');
    }),
    vscode.commands.registerCommand('voiceInput.clearApiKey', async () => {
      await context.secrets.delete(SECRET_KEY);
      vscode.window.showInformationMessage('Voice Input: API key cleared.');
    }),
    vscode.commands.registerCommand('voiceInput.clearHistory', async () => {
      await history.clear();
      await pushHistoryOnly();
    }),
    vscode.commands.registerCommand('voiceInput.showDiagnostics', async () => {
      const ext = context.extension.packageJSON;
      const session = process.env.XDG_SESSION_TYPE ?? 'unknown';
      const wayland = process.env.WAYLAND_DISPLAY ?? 'no';
      const display = process.env.DISPLAY ?? 'no';
      log('=== DIAGNOSTICS ===');
      log('version:', ext.version);
      log('session:', session, 'WAYLAND_DISPLAY:', wayland, 'DISPLAY:', display);
      log('PATH bin checks (using ' + (process.platform === 'win32' ? 'where' : 'which') + '):');
      const checks =
        process.platform === 'darwin'
          ? ['ffmpeg', 'rec', 'osascript', 'pbcopy', 'pbpaste']
          : process.platform === 'win32'
          ? ['ffmpeg', 'powershell', 'clip']
          : ['ffmpeg', 'parecord', 'arecord', 'wl-copy', 'wl-paste', 'wtype', 'ydotool', 'xdotool'];
      const whichCmd = process.platform === 'win32' ? 'where' : 'which';
      for (const bin of checks) {
        const ok = await new Promise<boolean>((r) => {
          const p = require('child_process').spawn(whichCmd, [bin], { stdio: 'ignore' });
          p.on('exit', (code: number) => r(code === 0));
          p.on('error', () => r(false));
        });
        log(`  ${bin}:`, ok ? 'OK' : 'MISSING');
      }
      if (process.platform !== 'darwin') {
        const sock = require('fs').existsSync('/tmp/.ydotool_socket');
        log('ydotool socket /tmp/.ydotool_socket:', sock ? 'EXISTS' : 'MISSING');
      }
      log('platform:', process.platform);
      log('=== END DIAGNOSTICS ===');
      showLog();
    }),
  );

  const existing = await context.secrets.get(SECRET_KEY);
  if (!existing) {
    vscode.window
      .showInformationMessage(
        'Voice Input is installed. Set your Soniox API key to begin.',
        'Set API key',
      )
      .then((sel) => {
        if (sel === 'Set API key') vscode.commands.executeCommand('voiceInput.setApiKey');
      });
  }
}

export function deactivate() {}

/**
 * Best-effort detection of the active keybinding for our toggle command.
 * VSCode does not expose a public keybindings-query API, so we read the
 * default from package.json. Users who customize via the keybindings editor
 * see their override take effect immediately, but the panel will continue
 * to display the package default.
 */
function detectKeybinding(context: vscode.ExtensionContext): string {
  const kbs: Array<{ command: string; key?: string; mac?: string }> =
    context.extension.packageJSON?.contributes?.keybindings ?? [];
  const kb = kbs.find((k) => k.command === 'voiceInput.toggleRecording');
  if (!kb) return 'Alt+M';
  const isMac = process.platform === 'darwin';
  const raw = (isMac ? kb.mac : kb.key) ?? kb.key ?? 'alt+m';
  return prettifyKey(raw);
}

function prettifyKey(raw: string): string {
  return raw
    .split('+')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('+');
}

// ── Dependency checker ───────────────────────────────────────────────────────

/**
 * Per-platform required tools. Keys are bin names; values are human labels
 * shown in the notification. Only bins that are NOT expected to ship
 * pre-installed on that platform are listed (e.g. osascript/pbcopy are
 * omitted on macOS because they are always present).
 */
function requiredBins(): string[] {
  if (process.platform === 'darwin') {
    return ['ffmpeg'];
  }
  if (process.platform === 'win32') {
    return ['ffmpeg'];
  }
  // Linux — check audio recorder + the right paste-key tool for the session.
  const isWayland =
    Boolean(process.env.WAYLAND_DISPLAY) ||
    process.env.XDG_SESSION_TYPE === 'wayland';
  if (isWayland) {
    return ['ffmpeg', 'ydotool', 'wl-copy'];
  }
  return ['ffmpeg', 'xdotool'];
}

function binExists(bin: string): Promise<boolean> {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  return new Promise((resolve) => {
    const p = spawn(cmd, [bin], { stdio: 'ignore' });
    p.on('exit', (code) => resolve(code === 0));
    p.on('error', () => resolve(false));
  });
}

/** Returns the absolute path to the platform install script. */
function installScriptPath(extensionPath: string): string | null {
  if (process.platform === 'darwin') {
    return path.join(extensionPath, 'scripts', 'install-mac.sh');
  }
  if (process.platform === 'win32') {
    return path.join(extensionPath, 'scripts', 'install-windows.ps1');
  }
  if (process.platform === 'linux') {
    return path.join(extensionPath, 'scripts', 'install-linux.sh');
  }
  return null;
}

/**
 * Check for missing tools and, if any are absent, show a one-time
 * notification offering to open a terminal that runs the install script.
 * Uses globalState to avoid re-prompting after the user dismisses.
 */
async function checkDependencies(context: vscode.ExtensionContext): Promise<void> {
  const SKIP_KEY = 'depsPromptDismissed';
  if (context.globalState.get<boolean>(SKIP_KEY)) return;

  const bins = requiredBins();
  const checks = await Promise.all(bins.map(async (b) => ({ bin: b, ok: await binExists(b) })));
  const missing = checks.filter((c) => !c.ok).map((c) => c.bin);

  if (missing.length === 0) return;

  log('checkDependencies: missing tools:', missing.join(', '));

  const scriptPath = installScriptPath(context.extensionPath);

  const action = scriptPath ? 'Install now' : undefined;
  const sel = await vscode.window.showWarningMessage(
    `Voice Input: missing required tool${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`,
    ...(action ? [action] : []),
    'Dismiss',
  );

  if (sel === 'Dismiss' || sel === undefined) {
    // Don't prompt again this install.
    await context.globalState.update(SKIP_KEY, true);
    return;
  }

  if (sel === 'Install now' && scriptPath) {
    openInstallTerminal(scriptPath);
  }
}

/** Open a new terminal and run the install script for the current platform. */
function openInstallTerminal(scriptPath: string): void {
  const term = vscode.window.createTerminal({ name: 'Voice Input Setup' });
  term.show(true /* preserveFocus */);

  if (process.platform === 'win32') {
    // Escape spaces in path for PowerShell.
    const escaped = scriptPath.replace(/ /g, '` ');
    term.sendText(`powershell -ExecutionPolicy Bypass -File "${escaped}"`);
  } else {
    // Make the script executable then run it.
    term.sendText(`bash "${scriptPath}"`);
  }
}
