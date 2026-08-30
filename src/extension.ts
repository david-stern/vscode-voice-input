import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { MicViewProvider, ViewState, WebviewMessage } from './webview/micView';
import { transcribe } from './stt/soniox';
import { injectText, InjectionMode } from './inject';
import {
  startRecorder,
  startPcmStream,
  RecorderHandle,
  PcmStreamHandle,
  listAudioDevices,
  AudioDevice,
} from './recorder/native';
import { pcm16FramesToWav } from './recorder/wav';
import {
  ASSISTANT_SAMPLE_RATE,
  DEFAULT_WAKE_PHRASES,
  SegmentedUtterance,
  VadSegmenter,
  parseAssistantText,
} from './assistant';
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
const ASSISTANT_CONSENT_KEY = 'voiceInput.assistantDisclosureAcknowledged.v1';

interface Settings {
  speechLang: string;
  uiLang: UiLang;
  ttlDays: 0 | 1 | 7 | 30;
  model: string;
  injectionMode: InjectionMode;
  assistantWakePhrase: string;
}

function readSettings(): Settings {
  const cfg = vscode.workspace.getConfiguration('voiceInput');
  return {
    speechLang: cfg.get<string>('languageHint', 'he'),
    uiLang: cfg.get<UiLang>('uiLanguage', 'en'),
    ttlDays: (cfg.get<number>('historyTtlDays', 30) as 0 | 1 | 7 | 30),
    model: cfg.get<string>('sttModel', 'stt-async-v4'),
    injectionMode: cfg.get<InjectionMode>('injectionMode', 'auto'),
    assistantWakePhrase: cfg.get<string>('assistantWakePhrase', '').trim(),
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
  if (partial.assistantWakePhrase !== undefined)
    await cfg.update('assistantWakePhrase', partial.assistantWakePhrase.trim(), target);
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
  let pushToTalkStopTimer: NodeJS.Timeout | null = null;
  let assistantHandle: PcmStreamHandle | null = null;
  let assistantListening = false;
  let assistantGeneration = 0;
  let assistantVad: VadSegmenter | null = null;
  let assistantRestartTimer: NodeJS.Timeout | null = null;
  let assistantTranscriptionActive = false;
  let assistantQueuedUtterance: SegmentedUtterance | null = null;
  let deactivating = false;
  const activeTranscriptions = new Set<AbortController>();
  const assistantTranscriptions = new Set<AbortController>();
  const pushToTalkTranscriptions = new Set<AbortController>();

  // ── Device list cache ──────────────────────────────────────────────────────
  let deviceCache: { devices: AudioDevice[]; ts: number } | null = null;
  // A short TTL keeps scans current without holding OS-specific filesystem watchers.
  const DEVICE_CACHE_TTL = 5_000;

  async function getCachedDevices(forceRefresh = false): Promise<AudioDevice[]> {
    const now = Date.now();
    if (!forceRefresh && deviceCache && now - deviceCache.ts < DEVICE_CACHE_TTL) {
      return deviceCache.devices;
    }
    const devices = await listAudioDevices();
    const configuredDevice = vscode.workspace
      .getConfiguration('voiceInput')
      .get<string>('audioDevice', '')
      .trim();
    if (configuredDevice && !devices.some((device) => device.id === configuredDevice)) {
      const legacyMatches = devices.filter((device) => device.label === configuredDevice);
      if (legacyMatches.length === 1) {
        await vscode.workspace
          .getConfiguration('voiceInput')
          .update('audioDevice', legacyMatches[0].id, vscode.ConfigurationTarget.Global);
      }
    }
    deviceCache = { devices, ts: Date.now() };
    return devices;
  }

  // Populate the cache in the background so it's ready on first record attempt.
  void getCachedDevices().catch((error) => {
    log('native audio enumeration failed:', (error as Error).message);
  });

  const setIdle = () => {
    isRecording = false;
    if (assistantListening) {
      status.text = '$(radio-tower) Voice — assistant listening';
      status.tooltip = 'Voice Input assistant is listening. Click to start push-to-talk instead.';
      status.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      provider.postRecording(false);
      return;
    }
    status.text = '$(mic) Voice';
    status.tooltip = process.platform === 'darwin'
      ? 'Voice Input — click or Ctrl+Option+M to toggle'
      : 'Voice Input — click or Alt+M to toggle';
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
    status.tooltip = 'Voice Input is processing audio.';
    status.backgroundColor = undefined;
  };

  const setAssistantListening = () => {
    assistantListening = true;
    status.text = '$(radio-tower) Voice — assistant listening';
    status.tooltip = 'Voice Input assistant is listening. Run Toggle Assistant Listening to stop.';
    status.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    void pushFullState();
  };

  const setAssistantStoppedWithError = (message: string) => {
    status.text = '$(error) Voice — assistant stopped';
    status.tooltip = message;
    status.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    provider.postRecording(false);
    void pushFullState();
  };

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
      assistantEnabled: assistantListening,
      assistantListening,
      assistantWakePhrase: s.assistantWakePhrase,
      assistantDisclosureAcknowledged: context.globalState.get<boolean>(ASSISTANT_CONSENT_KEY, false),
    };
    provider.postState(view);
  }

  async function pushHistoryOnly() {
    const s = readSettings();
    const entries = await history.list(s.ttlDays);
    provider.postHistory(entries);
  }

  async function cancelPushToTalk(): Promise<void> {
    if (pushToTalkStopTimer) {
      clearTimeout(pushToTalkStopTimer);
      pushToTalkStopTimer = null;
    }
    for (const controller of pushToTalkTranscriptions) controller.abort();
    pushToTalkTranscriptions.clear();
    const activeHandle = handle;
    handle = null;
    isRecording = false;
    if (!activeHandle) return;
    activeHandle.cancel();
    try {
      await activeHandle.stop();
    } catch {
      // Cancellation is best effort and must not block the assistant from starting.
    }
  }

  async function stopAssistantSession(errorMessage?: string): Promise<void> {
    assistantGeneration += 1;
    assistantListening = false;
    assistantVad?.reset();
    assistantVad = null;
    assistantQueuedUtterance = null;
    assistantTranscriptionActive = false;
    if (assistantRestartTimer) {
      clearTimeout(assistantRestartTimer);
      assistantRestartTimer = null;
    }
    for (const controller of assistantTranscriptions) controller.abort();
    assistantTranscriptions.clear();

    const activeHandle = assistantHandle;
    assistantHandle = null;
    if (activeHandle) {
      activeHandle.cancel();
      try {
        await activeHandle.stop();
      } catch {
        // Preserve the explicit stop/error state rather than surfacing a second failure.
      }
    }

    if (errorMessage) {
      setAssistantStoppedWithError(errorMessage);
      if (!deactivating) void vscode.window.showErrorMessage(errorMessage);
    } else {
      setIdle();
      void pushFullState();
    }
  }

  function failAssistant(message: string): void {
    if (!assistantListening) return;
    void stopAssistantSession(message);
  }

  function captureFailureMessage(scope: 'assistant' | 'recording', error?: unknown): string {
    const detail = error instanceof Error && error.message ? `: ${error.message}` : '';
    if (readSettings().uiLang === 'he') {
      return scope === 'assistant'
        ? `Voice Input: ההאזנה של העוזר הופסקה בגלל שגיאת מיקרופון${detail}`
        : `Voice Input: ההקלטה הופסקה בגלל שגיאת מיקרופון${detail}`;
    }
    return scope === 'assistant'
      ? `Voice Input assistant stopped because microphone capture failed${detail}`
      : `Voice Input recording stopped because microphone capture failed${detail}`;
  }

  function monitorAssistantCapture(
    stream: PcmStreamHandle,
    generation: number,
  ): void {
    void stream.outcome.then((outcome) => {
      if (
        !assistantListening ||
        generation !== assistantGeneration ||
        assistantHandle !== stream
      ) return;
      if (outcome.reason === 'error') {
        failAssistant(captureFailureMessage('assistant', outcome.error));
      } else if (outcome.reason === 'limit') {
        failAssistant(captureFailureMessage('assistant'));
      }
    });
  }

  function monitorPushToTalkCapture(
    recordingHandle: RecorderHandle,
  ): void {
    void recordingHandle.outcome.then((outcome) => {
      if (handle !== recordingHandle || outcome.reason !== 'error') return;
      handle = null;
      isRecording = false;
      if (pushToTalkStopTimer) {
        clearTimeout(pushToTalkStopTimer);
        pushToTalkStopTimer = null;
      }
      const message = captureFailureMessage('recording', outcome.error);
      status.text = '$(error) Voice — recording stopped';
      status.tooltip = message;
      status.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      provider.postRecording(false);
      void recordingHandle.stop().catch(() => {});
      if (!deactivating) void vscode.window.showErrorMessage(message);
    });
  }

  function enqueueAssistantUtterance(
    utterance: SegmentedUtterance,
    generation: number,
  ): void {
    if (!assistantListening || generation !== assistantGeneration) return;
    if (!assistantTranscriptionActive) {
      assistantTranscriptionActive = true;
      void processAssistantUtterance(utterance, generation);
      return;
    }
    if (!assistantQueuedUtterance) {
      assistantQueuedUtterance = utterance;
      return;
    }
    failAssistant('Voice Input assistant stopped: transcription queue overflow.');
  }

  function handleAssistantFrame(
    frame: Int16Array,
    generation: number,
    vad: VadSegmenter,
  ): void {
    if (!assistantListening || generation !== assistantGeneration) return;
    try {
      const result = vad.pushFrame(frame);
      if (!result.accepted) {
        failAssistant('Voice Input assistant stopped: audio processing could not keep up.');
        return;
      }
      if (result.signals.some((signal) => signal.type === 'utterance-queued')) {
        const utterance = vad.takeUtterance();
        if (utterance) enqueueAssistantUtterance(utterance, generation);
      }
    } catch (error) {
      failAssistant(`Voice Input assistant stopped: ${(error as Error).message}`);
    }
  }

  async function processAssistantUtterance(
    utterance: SegmentedUtterance,
    generation: number,
  ): Promise<void> {
    const controller = new AbortController();
    activeTranscriptions.add(controller);
    assistantTranscriptions.add(controller);
    try {
      const apiKey = await context.secrets.get(SECRET_KEY);
      if (!apiKey) throw new Error('Soniox API key is no longer available.');
      if (!assistantListening || generation !== assistantGeneration) return;

      status.text = '$(sync~spin) Voice — assistant transcribing';
      status.tooltip = 'Voice Input assistant is transcribing one completed speech segment.';
      status.backgroundColor = undefined;

      const settings = readSettings();
      const text = await transcribe({
        audio: pcm16FramesToWav([utterance.audio], ASSISTANT_SAMPLE_RATE),
        mime: 'audio/wav',
        apiKey,
        model: settings.model,
        languageHint: settings.speechLang,
        signal: controller.signal,
      });
      if (!assistantListening || generation !== assistantGeneration || !text) return;

      const wakePhrases = settings.assistantWakePhrase
        ? [settings.assistantWakePhrase]
        : DEFAULT_WAKE_PHRASES;
      const parsed = parseAssistantText(text, { wakePhrases });
      if (!parsed.wakeDetected) return;

      if (parsed.intent.kind === 'paste') {
        // The fallback is append-only insertion/paste. It never presses Enter.
        await injectText(parsed.intent.text, 'auto');
      } else {
        switch (parsed.intent.action) {
          case 'stop-listening':
            await stopAssistantSession();
            break;
          case 'open-chat':
            await vscode.commands.executeCommand('workbench.action.chat.open');
            break;
          case 'open-terminal':
            await vscode.commands.executeCommand('workbench.action.terminal.toggleTerminal');
            break;
          case 'open-settings':
            await vscode.commands.executeCommand('workbench.action.openSettings', 'voiceInput');
            break;
        }
      }
    } catch (error) {
      if (!controller.signal.aborted && assistantListening && generation === assistantGeneration) {
        failAssistant(`Voice Input assistant stopped: ${(error as Error).message}`);
      }
    } finally {
      activeTranscriptions.delete(controller);
      assistantTranscriptions.delete(controller);
      if (!assistantListening || generation !== assistantGeneration) return;

      const next = assistantQueuedUtterance;
      assistantQueuedUtterance = null;
      if (next) {
        void processAssistantUtterance(next, generation);
      } else {
        assistantTranscriptionActive = false;
        setAssistantListening();
      }
    }
  }

  async function startAssistantSession(): Promise<void> {
    if (assistantListening || deactivating) return;
    const generation = ++assistantGeneration;

    if (!context.globalState.get<boolean>(ASSISTANT_CONSENT_KEY, false)) {
      const consent = await vscode.window.showWarningMessage(
        'Voice Input assistant uses the microphone continuously while this VS Code window is running. Completed speech segments are sent to Soniox for transcription; silence stays local. It only pastes text or runs the listed safe VS Code actions, and never submits chat messages.',
        { modal: true },
        'Start listening',
      );
      if (consent !== 'Start listening' || generation !== assistantGeneration) {
        void pushFullState();
        return;
      }
      await context.globalState.update(ASSISTANT_CONSENT_KEY, true);
    }

    const apiKey = await context.secrets.get(SECRET_KEY);
    if (generation !== assistantGeneration) return;
    if (!apiKey) {
      const selected = await vscode.window.showErrorMessage(
        'Voice Input: SONIOX_API_KEY not set.',
        'Set now',
      );
      if (selected === 'Set now') await vscode.commands.executeCommand('voiceInput.setApiKey');
      await pushFullState();
      return;
    }

    try {
      await getCachedDevices();
    } catch {
      // startPcmStream will surface the authoritative recorder error below.
    }
    await cancelPushToTalk();
    if (generation !== assistantGeneration) return;

    const vad = new VadSegmenter();
    const configuredDevice = vscode.workspace
      .getConfiguration('voiceInput')
      .get<string>('audioDevice', '')
      .trim();
    try {
      const stream = await startPcmStream({
        deviceId: configuredDevice,
        maxDurationMs: 5 * 60 * 1000,
        onFrame: (frame) => handleAssistantFrame(frame, generation, vad),
      });
      if (generation !== assistantGeneration || deactivating) {
        stream.cancel();
        await stream.stop().catch(() => {});
        return;
      }
      if (stream.sampleRate !== ASSISTANT_SAMPLE_RATE) {
        stream.cancel();
        await stream.stop().catch(() => {});
        throw new Error(`assistant requires ${ASSISTANT_SAMPLE_RATE} Hz audio`);
      }
      assistantVad = vad;
      assistantHandle = stream;
      monitorAssistantCapture(stream, generation);
      assistantQueuedUtterance = null;
      assistantTranscriptionActive = false;
      setAssistantListening();
      // The native capture has a hard safety cap. Renew it before the cap so an
      // explicitly started session remains active while VS Code is running.
      assistantRestartTimer = setTimeout(() => {
        assistantRestartTimer = null;
        void renewAssistantCapture(generation, vad);
      }, 4 * 60 * 1000 + 15 * 1000);
    } catch (error) {
      if (generation === assistantGeneration) {
        assistantListening = false;
        setAssistantStoppedWithError(`Voice Input assistant could not start: ${(error as Error).message}`);
      }
    }
  }

  async function renewAssistantCapture(generation: number, vad: VadSegmenter): Promise<void> {
    if (!assistantListening || generation !== assistantGeneration || deactivating) return;
    // Never rotate the native handle in the middle of an utterance. VAD caps an
    // utterance at 30 seconds, and renewal starts with enough headroom to wait.
    if (vad.isSpeaking) {
      assistantRestartTimer = setTimeout(() => {
        assistantRestartTimer = null;
        void renewAssistantCapture(generation, vad);
      }, 250);
      return;
    }

    const previous = assistantHandle;
    assistantHandle = null;
    if (previous) {
      previous.cancel();
      await previous.stop().catch(() => {});
    }
    if (!assistantListening || generation !== assistantGeneration || deactivating) return;

    try {
      const configuredDevice = vscode.workspace
        .getConfiguration('voiceInput')
        .get<string>('audioDevice', '')
        .trim();
      const next = await startPcmStream({
        deviceId: configuredDevice,
        maxDurationMs: 5 * 60 * 1000,
        onFrame: (frame) => handleAssistantFrame(frame, generation, vad),
      });
      if (!assistantListening || generation !== assistantGeneration || deactivating) {
        next.cancel();
        await next.stop().catch(() => {});
        return;
      }
      assistantHandle = next;
      monitorAssistantCapture(next, generation);
      assistantRestartTimer = setTimeout(() => {
        assistantRestartTimer = null;
        void renewAssistantCapture(generation, vad);
      }, 4 * 60 * 1000 + 15 * 1000);
    } catch (error) {
      failAssistant(`Voice Input assistant stopped: ${(error as Error).message}`);
    }
  }

  async function startRecording() {
    if (isRecording || handle) return;

    if (assistantListening || assistantHandle) await stopAssistantSession();

    try {
      await getCachedDevices();
    } catch {
      // startRecorder will surface the authoritative recorder error below.
    }

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
      const recordingHandle = await startRecorder();
      handle = recordingHandle;
      monitorPushToTalkCapture(recordingHandle);
      setRecording();
      pushToTalkStopTimer = setTimeout(() => {
        pushToTalkStopTimer = null;
        void stopRecording();
      }, 4 * 60 * 1000 + 50 * 1000);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        vscode.window.showErrorMessage(`Voice Input: ${(e as Error).message}`);
      }
      setIdle();
    }
  }

  async function stopRecording() {
    if (pushToTalkStopTimer) {
      clearTimeout(pushToTalkStopTimer);
      pushToTalkStopTimer = null;
    }
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
      if ((e as Error).name !== 'AbortError') {
        vscode.window.showErrorMessage(`Voice Input: ${(e as Error).message}`);
      }
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
    const controller = new AbortController();
    activeTranscriptions.add(controller);
    pushToTalkTranscriptions.add(controller);
    try {
      const text = await transcribe({
        audio,
        mime,
        apiKey,
        model: s.model,
        languageHint: s.speechLang,
        signal: controller.signal,
      });
      if (!text || controller.signal.aborted) return;

      await history.add(text, s.speechLang);
      await pushHistoryOnly();
      await injectText(text, s.injectionMode);
      await abortableDelay(150, controller.signal);
    } finally {
      activeTranscriptions.delete(controller);
      pushToTalkTranscriptions.delete(controller);
    }
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
      case 'assistant-enabled-change':
        if (msg.enabled) await startAssistantSession();
        else await stopAssistantSession();
        break;
      case 'assistant-wake-phrase-change':
        await writeSettings({ assistantWakePhrase: msg.wakePhrase });
        await pushFullState();
        break;
      case 'assistant-disclosure-acknowledged': {
        if (!context.globalState.get<boolean>(ASSISTANT_CONSENT_KEY, false)) {
          const acknowledged = await vscode.window.showWarningMessage(
            'When assistant listening is active, completed speech segments are sent to Soniox for transcription. Silence stays local. Listening only starts when you explicitly enable it and stops when VS Code closes.',
            { modal: true },
            'I understand',
          );
          if (acknowledged === 'I understand') {
            await context.globalState.update(ASSISTANT_CONSENT_KEY, true);
          }
        }
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
    vscode.commands.registerCommand('voiceInput.toggleAssistant', async () => {
      if (assistantListening || assistantHandle) await stopAssistantSession();
      else await startAssistantSession();
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
      log('paste helper checks (using ' + (process.platform === 'win32' ? 'where' : 'which') + '):');
      const checks =
        process.platform === 'darwin'
          ? ['osascript', 'pbcopy', 'pbpaste']
          : process.platform === 'win32'
          ? ['powershell', 'clip']
          : ['wl-copy', 'wl-paste', 'wtype', 'ydotool', 'xdotool'];
      const whichCmd = process.platform === 'win32' ? 'where' : 'which';
      for (const bin of checks) {
        const ok = await new Promise<boolean>((r) => {
          const p = spawn(whichCmd, [bin], { stdio: 'ignore' });
          p.on('exit', (code: number) => r(code === 0));
          p.on('error', () => r(false));
        });
        log(`  ${bin}:`, ok ? 'OK' : 'MISSING');
      }
      try {
        log('native audio devices:', (await getCachedDevices(true)).length);
      } catch (error) {
        log('native audio enumeration failed:', (error as Error).message);
      }
      if (process.platform !== 'darwin') {
        const sock = existsSync('/tmp/.ydotool_socket');
        log('ydotool socket /tmp/.ydotool_socket:', sock ? 'EXISTS' : 'MISSING');
      }
      log('platform:', process.platform);
      log('=== END DIAGNOSTICS ===');
      showLog();
    }),
  );

  context.subscriptions.push({
    dispose() {
      deactivating = true;
      if (assistantRestartTimer) clearTimeout(assistantRestartTimer);
      assistantRestartTimer = null;
      if (pushToTalkStopTimer) clearTimeout(pushToTalkStopTimer);
      pushToTalkStopTimer = null;
      handle?.cancel();
      handle = null;
      assistantHandle?.cancel();
      assistantHandle = null;
      assistantListening = false;
      assistantVad?.reset();
      assistantVad = null;
      assistantQueuedUtterance = null;
      for (const controller of activeTranscriptions) controller.abort();
      activeTranscriptions.clear();
      assistantTranscriptions.clear();
      pushToTalkTranscriptions.clear();
    },
  });

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

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
