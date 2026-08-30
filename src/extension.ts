import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { MicViewProvider, ViewState, WebviewMessage } from './webview/micView';
import { transcribe } from './stt/soniox';
import {
  injectText,
  injectIntoEditor,
  injectIntoFocusedControl,
  InjectionMode,
} from './inject';
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
import {
  captureTargetSnapshot,
  revalidateTargetSnapshot,
  type RequestedTargetKind,
  type ResolvedTargetKind,
  type TargetSnapshot,
} from './assistant/context';
import {
  DEFAULT_DEEPSEEK_MODEL,
  DeepSeekClientError,
  planWithDeepSeek,
  type DeepSeekPlan,
} from './assistant/deepseek';
import { normalizePersonaId, type PersonaId } from './assistant/personas';
import {
  BUILTIN_CHAT_FOCUS_COMMAND,
  BUILTIN_CHAT_OPEN_COMMAND,
  BUILTIN_CHAT_SUBMIT_COMMAND,
  builtInChatDraftArguments,
} from './assistant/chat';
import {
  SafeActionPolicy,
  insertTerminalText,
  type PolicyExplanation,
  type RepeatedAction,
} from './assistant/policy';
import { feedbackSpeechLanguage, normalizeSpeechRate } from './webview/speech';
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
const DEEPSEEK_SECRET_KEY = 'DEEPSEEK_API_KEY';
const ASSISTANT_CONSENT_KEY = 'voiceInput.assistantDisclosureAcknowledged.v1';
const DEEPSEEK_CONSENT_KEY = 'voiceInput.deepSeekDisclosureAcknowledged.v1';

interface Settings {
  speechLang: string;
  uiLang: UiLang;
  ttlDays: 0 | 1 | 7 | 30;
  model: string;
  injectionMode: InjectionMode;
  assistantWakePhrase: string;
  assistantPersona: PersonaId;
  deepSeekModel: string;
  assistantSpeechEnabled: boolean;
  assistantSpeechVoiceUri: string;
  assistantSpeechRate: number;
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
    assistantPersona: normalizePersonaId(cfg.get<string>('assistantPersona')),
    deepSeekModel: cfg.get<string>('deepSeekModel', DEFAULT_DEEPSEEK_MODEL).trim() || DEFAULT_DEEPSEEK_MODEL,
    assistantSpeechEnabled: cfg.get<boolean>('assistantSpeechEnabled', true),
    assistantSpeechVoiceUri: cfg.get<string>('assistantSpeechVoiceUri', '').trim(),
    assistantSpeechRate: normalizeSpeechRate(cfg.get<number>('assistantSpeechRate', 1)),
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
  if (partial.assistantPersona !== undefined)
    await cfg.update('assistantPersona', normalizePersonaId(partial.assistantPersona), target);
  if (partial.deepSeekModel !== undefined && partial.deepSeekModel.trim())
    await cfg.update('deepSeekModel', partial.deepSeekModel.trim(), target);
  if (partial.assistantSpeechEnabled !== undefined)
    await cfg.update('assistantSpeechEnabled', partial.assistantSpeechEnabled, target);
  if (partial.assistantSpeechVoiceUri !== undefined)
    await cfg.update('assistantSpeechVoiceUri', partial.assistantSpeechVoiceUri.trim(), target);
  if (partial.assistantSpeechRate !== undefined)
    await cfg.update('assistantSpeechRate', normalizeSpeechRate(partial.assistantSpeechRate), target);
}

interface CapturedAssistantUtterance {
  utterance: SegmentedUtterance;
  snapshot: TargetSnapshot;
  id: string;
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
  let assistantQueuedUtterance: CapturedAssistantUtterance | null = null;
  let assistantUtteranceSequence = 0;
  let assistantSpeaking = false;
  let assistantTargetLabel = '';
  let assistantPlanConfidence: number | undefined;
  let assistantPendingSend: ViewState['assistantPendingSend'];
  let pendingChatDraft: { id: string; text: string; snapshot: TargetSnapshot } | undefined;
  let assistantFeedback = '';
  let deepSeekBusy = false;
  let deepSeekLastError: string | undefined;
  let assistantPendingSendTimer: NodeJS.Timeout | null = null;
  let intentionalTargetTransition = 0;
  const actionPolicy = new SafeActionPolicy();
  const terminalIdentities = new WeakMap<vscode.Terminal, string>();
  let nextTerminalIdentity = 1;
  let deactivating = false;
  const activeTranscriptions = new Set<AbortController>();
  const assistantTranscriptions = new Set<AbortController>();
  const pushToTalkTranscriptions = new Set<AbortController>();

  function terminalIdentity(terminal: vscode.Terminal | undefined): string | null {
    if (!terminal) return null;
    let identity = terminalIdentities.get(terminal);
    if (!identity) {
      identity = `terminal-${nextTerminalIdentity++}`;
      terminalIdentities.set(terminal, identity);
    }
    return identity;
  }

  function activeTabIdentity(): string | null {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (!tab) return null;
    const input = tab.input;
    if (input instanceof vscode.TabInputText) return `text:${input.uri.toString(true)}`;
    if (input instanceof vscode.TabInputTextDiff) {
      return `diff:${input.original.toString(true)}:${input.modified.toString(true)}`;
    }
    if (input instanceof vscode.TabInputNotebook) return `notebook:${input.uri.toString(true)}`;
    const inputType = typeof input === 'object' && input !== null
      ? (input as { constructor?: { name?: string } }).constructor?.name ?? 'unknown'
      : typeof input;
    return `${inputType}:${tab.label}`.slice(0, 512);
  }

  function editorIdentity(editor = vscode.window.activeTextEditor): string | null {
    if (!editor) return null;
    return `${editor.document.uri.toString(true)}:${editor.viewColumn ?? 0}`;
  }

  function captureAssistantTarget(
    requestedTarget: RequestedTargetKind = 'here',
    provenFocus: Exclude<ResolvedTargetKind, 'unknown'> | null = null,
  ): TargetSnapshot {
    return captureTargetSnapshot({
      requestedTarget,
      focusedTarget: provenFocus,
      vscodeFocused: vscode.window.state.focused,
      activeTabIdentity: activeTabIdentity(),
      activeEditorIdentity: editorIdentity(),
      activeTerminalIdentity: terminalIdentity(vscode.window.activeTerminal),
    });
  }

  function snapshotForRequestedTarget(
    snapshot: TargetSnapshot,
    requestedTarget: Exclude<RequestedTargetKind, 'here'>,
  ): TargetSnapshot {
    return { ...snapshot, requestedTarget, resolvedTarget: requestedTarget };
  }

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
    const deepSeekKey = await context.secrets.get(DEEPSEEK_SECRET_KEY);
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
      assistantPersona: s.assistantPersona,
      assistantDeepSeekStatus: deepSeekBusy ? 'checking'
        : deepSeekLastError ? 'error'
        : deepSeekKey && context.globalState.get<boolean>(DEEPSEEK_CONSENT_KEY, false) ? 'ready'
        : 'not-configured',
      assistantDeepSeekError: deepSeekLastError,
      assistantSpeechEnabled: s.assistantSpeechEnabled,
      assistantSpeechVoiceUri: s.assistantSpeechVoiceUri,
      assistantSpeechRate: s.assistantSpeechRate,
      assistantSpeaking,
      assistantTargetLabel,
      assistantPlanConfidence,
      assistantPendingSend,
      assistantFeedback,
    };
    provider.postState(view);
  }

  async function pushHistoryOnly() {
    const s = readSettings();
    const entries = await history.list(s.ttlDays);
    provider.postHistory(entries);
  }

  function localeText(en: string, he: string): string {
    return readSettings().uiLang === 'he' ? he : en;
  }

  function targetLabel(target: ResolvedTargetKind): string {
    const labels: Record<ResolvedTargetKind, [string, string]> = {
      'focused-control': ['Focused VS Code control', 'הרכיב הממוקד ב־VS Code'],
      editor: ['Active editor', 'העורך הפעיל'],
      terminal: ['Active terminal', 'המסוף הפעיל'],
      chat: ['Built-in VS Code chat', 'הצ׳אט המובנה של VS Code'],
      unknown: ['Unknown target', 'יעד לא ידוע'],
    };
    const [en, he] = labels[target];
    return localeText(en, he);
  }

  function speakFeedback(text: string): void {
    const bounded = text.trim().slice(0, 1_000);
    if (!bounded) return;
    assistantFeedback = bounded;
    status.tooltip = bounded;
    vscode.window.setStatusBarMessage(`$(comment-discussion) Voice: ${bounded}`, 8_000);
    const s = readSettings();
    void pushFullState();
    if (!s.assistantSpeechEnabled) return;
    const id = `speech-${Date.now()}-${++assistantUtteranceSequence}`;
    const delivery = provider.postSpeak(id, bounded, feedbackSpeechLanguage(s.uiLang));
    assistantSpeaking = delivery !== 'unavailable';
    if (delivery === 'unavailable') {
      log('assistant speech unavailable: sidebar view queue is full or disposed');
    }
  }

  function explainPolicy(explanation: PolicyExplanation): void {
    speakFeedback(readSettings().uiLang === 'he' ? explanation.he : explanation.en);
  }

  function clearPendingSend(announce = false): void {
    if (assistantPendingSendTimer) clearTimeout(assistantPendingSendTimer);
    assistantPendingSendTimer = null;
    if (!assistantPendingSend) return;
    assistantPendingSend = undefined;
    pendingChatDraft = undefined;
    actionPolicy.cancelPendingSend();
    if (announce) {
      speakFeedback(localeText('I cancelled the pending send.', 'ביטלתי את השליחה הממתינה.'));
    }
    void pushFullState();
  }

  async function focusBuiltInChat(targetStillValid: () => boolean): Promise<boolean> {
    const commands = await vscode.commands.getCommands(true);
    if (!commands.includes(BUILTIN_CHAT_OPEN_COMMAND)) {
      throw new Error('The built-in VS Code chat focus command is unavailable.');
    }
    if (!targetStillValid()) return false;
    intentionalTargetTransition += 1;
    try {
      await vscode.commands.executeCommand(BUILTIN_CHAT_OPEN_COMMAND);
      if (commands.includes(BUILTIN_CHAT_FOCUS_COMMAND)) {
        await vscode.commands.executeCommand(BUILTIN_CHAT_FOCUS_COMMAND);
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    } finally {
      intentionalTargetTransition -= 1;
    }
    return true;
  }

  async function prepareBuiltInChatDraft(
    text: string,
    targetStillValid: () => boolean,
  ): Promise<TargetSnapshot | undefined> {
    const commands = await vscode.commands.getCommands(true);
    if (!commands.includes(BUILTIN_CHAT_OPEN_COMMAND)) {
      throw new Error('The built-in VS Code chat draft command is unavailable.');
    }
    // Command discovery is asynchronous. Revalidate immediately before the
    // supported mutation command, not only before entering this helper.
    if (!targetStillValid()) return undefined;
    intentionalTargetTransition += 1;
    try {
      await vscode.commands.executeCommand(
        BUILTIN_CHAT_OPEN_COMMAND,
        builtInChatDraftArguments(text),
      );
      if (commands.includes(BUILTIN_CHAT_FOCUS_COMMAND)) {
        await vscode.commands.executeCommand(BUILTIN_CHAT_FOCUS_COMMAND);
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    } finally {
      intentionalTargetTransition -= 1;
    }
    // This is a generic VS Code snapshot. Command success proves that the
    // documented API prepared a draft; it does not prove third-party DOM focus.
    return captureAssistantTarget();
  }

  function deterministicPlan(
    postWakeText: string,
    intent: Exclude<ReturnType<typeof parseAssistantText>, { wakeDetected: false }>['intent'],
  ): DeepSeekPlan {
    if (intent.kind === 'paste') {
      return {
        action: 'write-here', target: 'current', content: postWakeText,
        spokenReply: '',
        reason: localeText('You asked me to write in the focused control.', 'ביקשת ממני לכתוב ברכיב הממוקד.'),
        confidence: 1,
        requiresConfirmation: false,
      };
    }
    return {
      action: intent.action,
      target: intent.action === 'open-chat' ? 'chat'
        : intent.action === 'open-terminal' ? 'terminal'
        : intent.action === 'confirm-send' || intent.action === 'repeat-last' ? 'current'
        : 'none',
      content: null,
      spokenReply: '',
      reason: localeText('This is an explicit supported voice command.', 'זו פקודה קולית מפורשת ונתמכת.'),
      confidence: 1,
      requiresConfirmation: false,
    };
  }

  async function createAssistantPlan(
    postWakeRequest: string,
    snapshot: TargetSnapshot,
    signal: AbortSignal,
    fallbackPlan: DeepSeekPlan,
  ): Promise<DeepSeekPlan> {
    if (!postWakeRequest.trim()) {
      return {
        action: 'answer-only', target: 'none', content: null,
        spokenReply: localeText('I am listening. What would you like me to do?', 'אני מקשיב. מה תרצה שאעשה?'),
        reason: localeText('No request followed the wake phrase.', 'לא נאמרה בקשה לאחר ביטוי ההפעלה.'),
        confidence: 1,
        requiresConfirmation: false,
      };
    }
    const apiKey = await context.secrets.get(DEEPSEEK_SECRET_KEY);
    const consent = context.globalState.get<boolean>(DEEPSEEK_CONSENT_KEY, false);
    if (!apiKey || !consent) return fallbackPlan;
    const s = readSettings();
    deepSeekBusy = true;
    deepSeekLastError = undefined;
    void pushFullState();
    try {
      return await planWithDeepSeek({
        postWakeRequest,
        persona: s.assistantPersona,
        locale: s.uiLang,
        target: { kind: snapshot.resolvedTarget, vscodeFocused: snapshot.vscodeFocused },
      }, {
        apiKey,
        model: s.deepSeekModel,
        signal,
        logger: (event) => log('DeepSeek planner:', event),
      });
    } catch (error) {
      deepSeekLastError = localeText('Planning request failed safely.', 'בקשת התכנון נכשלה באופן בטוח.');
      throw error;
    } finally {
      deepSeekBusy = false;
      void pushFullState();
    }
  }

  function successfulFeedback(plan: DeepSeekPlan, outcome: string): string {
    const reason = plan.reason.trim();
    return reason ? `${outcome} ${reason}` : outcome;
  }

  function originalTargetStillValid(captured: TargetSnapshot): boolean {
    const validation = revalidateTargetSnapshot(captured, captureAssistantTarget());
    if (validation.valid) return true;
    explainPolicy({
      code: validation.reason,
      en: `I stopped because the original target is no longer safe (${validation.reason}).`,
      he: `עצרתי מפני שהיעד המקורי כבר אינו בטוח (${validation.reason}).`,
    });
    return false;
  }

  async function executeRepeatedAction(
    repeated: RepeatedAction,
    utteranceId: string,
  ): Promise<void> {
    const plan: DeepSeekPlan = {
      action: repeated.action,
      target: repeated.action === 'write-editor' ? 'editor'
        : repeated.action === 'write-terminal' ? 'terminal'
        : repeated.action === 'write-chat' ? 'chat'
        : repeated.action === 'write-here' ? 'current'
        : repeated.action === 'open-chat' ? 'chat'
        : repeated.action === 'open-terminal' ? 'terminal'
        : 'none',
      content: repeated.text ?? null,
      spokenReply: '',
      reason: localeText('I repeated the recent action on the current target.', 'חזרתי על הפעולה האחרונה ביעד הנוכחי.'),
      confidence: 1,
      requiresConfirmation: false,
    };
    await executeAssistantPlan(plan, repeated.snapshot, utteranceId, false);
  }

  async function executeAssistantPlan(
    plan: DeepSeekPlan,
    captured: TargetSnapshot,
    utteranceId: string,
    remember = true,
  ): Promise<void> {
    assistantPlanConfidence = plan.confidence;
    const currentTarget = plan.action === 'write-editor' ? 'editor'
      : plan.action === 'write-terminal' ? 'terminal'
      : plan.action === 'write-chat' || plan.action === 'request-send' ? 'chat'
      : captured.resolvedTarget;
    assistantTargetLabel = targetLabel(currentTarget);
    void pushFullState();

    if (plan.action !== 'confirm-send' && assistantPendingSend) clearPendingSend(false);

    if (plan.action === 'answer-only') {
      if (plan.spokenReply) speakFeedback(plan.spokenReply);
      return;
    }
    if (plan.action === 'stop-listening') {
      speakFeedback(localeText('I am stopping the assistant because you asked me to.', 'אני מפסיק את העוזר מפני שביקשת ממני.'));
      await stopAssistantSession();
      return;
    }
    if (plan.action === 'open-chat') {
      if (!originalTargetStillValid(captured)) return;
      if (!(await focusBuiltInChat(() => originalTargetStillValid(captured)))) return;
      speakFeedback(successfulFeedback(plan, localeText('I opened the built-in chat.', 'פתחתי את הצ׳אט המובנה.')));
      if (remember) actionPolicy.rememberLast({ action: 'open-chat' });
      return;
    }
    if (plan.action === 'open-terminal') {
      if (!originalTargetStillValid(captured)) return;
      await vscode.commands.executeCommand('workbench.action.terminal.toggleTerminal');
      speakFeedback(successfulFeedback(plan, localeText('I opened the terminal.', 'פתחתי את המסוף.')));
      if (remember) actionPolicy.rememberLast({ action: 'open-terminal' });
      return;
    }
    if (plan.action === 'open-settings') {
      if (!originalTargetStillValid(captured)) return;
      await vscode.commands.executeCommand('workbench.action.openSettings', 'voiceInput');
      speakFeedback(successfulFeedback(plan, localeText('I opened Voice Input settings.', 'פתחתי את הגדרות Voice Input.')));
      if (remember) actionPolicy.rememberLast({ action: 'open-settings' });
      return;
    }
    if (plan.action === 'repeat-last') {
      // The repeat command itself must still belong to the context in which it
      // was spoken. Only after that check do we intentionally re-resolve the
      // destination for the remembered action.
      if (!originalTargetStillValid(captured)) return;
      const repeated = actionPolicy.repeatLast(captureAssistantTarget());
      if (!repeated.allowed) explainPolicy(repeated.explanation);
      else await executeRepeatedAction(repeated.instruction, utteranceId);
      return;
    }
    if (plan.action === 'confirm-send') {
      if (!assistantPendingSend || !pendingChatDraft || pendingChatDraft.id !== assistantPendingSend.id) {
        const noPending = actionPolicy.confirmSend(captureAssistantTarget(), utteranceId);
        if (!noPending.allowed) explainPolicy(noPending.explanation);
        return;
      }
      const pendingState = assistantPendingSend;
      const draft = pendingChatDraft;
      const pendingStillMatches = () =>
        assistantPendingSend?.id === pendingState.id &&
        pendingChatDraft === draft &&
        actionPolicy.getPendingSend() !== null;
      const bothCapturedContextsMatch = (current: TargetSnapshot) =>
        revalidateTargetSnapshot(captured, current).valid &&
        revalidateTargetSnapshot(draft.snapshot, current).valid;
      if (!pendingStillMatches() || !bothCapturedContextsMatch(captureAssistantTarget())) {
        clearPendingSend(false);
        speakFeedback(localeText(
          'I did not send because the draft context changed or the confirmation expired.',
          'לא שלחתי מפני שהקשר הטיוטה השתנה או שחלון האישור פג.',
        ));
        return;
      }
      const prepared = await prepareBuiltInChatDraft(draft.text, () =>
        pendingStillMatches() && bothCapturedContextsMatch(captureAssistantTarget()),
      );
      if (!prepared) {
        clearPendingSend(false);
        speakFeedback(localeText(
          'I did not send because the confirmation target changed.',
          'לא שלחתי מפני שיעד האישור השתנה.',
        ));
        return;
      }
      const commands = await vscode.commands.getCommands(true);
      if (!commands.includes(BUILTIN_CHAT_SUBMIT_COMMAND)) {
        clearPendingSend(false);
        speakFeedback(localeText(
          'I left the text prepared, but this VS Code version does not expose the safe built-in chat submit command. Please send it manually.',
          'השארתי את הטקסט מוכן, אך גרסת VS Code הזו אינה חושפת פקודת שליחה בטוחה לצ׳אט המובנה. יש לשלוח ידנית.',
        ));
        return;
      }
      // This is the last asynchronous boundary before submission. Bind the
      // confirmation utterance, the exact prepared draft, and the pending
      // capability to the same current context, then consume the capability
      // synchronously before invoking the allowlisted submit command.
      const finalTarget = captureAssistantTarget();
      if (
        !pendingStillMatches() ||
        !bothCapturedContextsMatch(finalTarget) ||
        !revalidateTargetSnapshot(prepared, finalTarget).valid
      ) {
        clearPendingSend(false);
        speakFeedback(localeText(
          'I did not send because the chat context changed before submission.',
          'לא שלחתי מפני שהקשר הצ׳אט השתנה לפני השליחה.',
        ));
        return;
      }
      const decision = actionPolicy.confirmSend(finalTarget, utteranceId);
      if (!decision.allowed) {
        assistantPendingSend = undefined;
        pendingChatDraft = undefined;
        explainPolicy(decision.explanation);
        void pushFullState();
        return;
      }
      await vscode.commands.executeCommand(BUILTIN_CHAT_SUBMIT_COMMAND);
      assistantPendingSend = undefined;
      pendingChatDraft = undefined;
      if (assistantPendingSendTimer) clearTimeout(assistantPendingSendTimer);
      assistantPendingSendTimer = null;
      speakFeedback(localeText('I sent the prepared message after your separate confirmation.', 'שלחתי את ההודעה המוכנה לאחר האישור הנפרד שלך.'));
      void pushFullState();
      return;
    }

    const content = plan.content ?? '';
    if (plan.action === 'request-send') {
      if (!originalTargetStillValid(captured)) return;
      const pendingSnapshot = await prepareBuiltInChatDraft(
        content,
        () => originalTargetStillValid(captured),
      );
      if (!pendingSnapshot) return;
      const pending = actionPolicy.requestPreparedChatSend(pendingSnapshot, utteranceId);
      if (!pending.allowed) { explainPolicy(pending.explanation); return; }
      assistantPendingSend = {
        id: utteranceId,
        preview: content.slice(0, 300),
        targetLabel: targetLabel('chat'),
      };
      pendingChatDraft = { id: utteranceId, text: content, snapshot: pendingSnapshot };
      if (assistantPendingSendTimer) clearTimeout(assistantPendingSendTimer);
      assistantPendingSendTimer = setTimeout(() => {
        if (assistantPendingSend?.id !== utteranceId) return;
        assistantPendingSend = undefined;
        pendingChatDraft = undefined;
        actionPolicy.cancelPendingSend();
        speakFeedback(localeText('I did not send because the confirmation window expired.', 'לא שלחתי מפני שחלון האישור פג.'));
        void pushFullState();
      }, 12_050);
      speakFeedback(localeText(
        'I prepared the message in chat. Say “confirm send” or use the approval button within twelve seconds.',
        'הכנתי את ההודעה בצ׳אט. אמור „אשר שליחה” או השתמש בכפתור האישור בתוך שתים־עשרה שניות.',
      ));
      void pushFullState();
      return;
    }

    if (plan.action === 'write-chat') {
      if (!originalTargetStillValid(captured)) return;
      const prepared = await prepareBuiltInChatDraft(
        content,
        () => originalTargetStillValid(captured),
      );
      if (!prepared) return;
      if (remember) actionPolicy.rememberLast({ action: 'write-chat', text: content });
      speakFeedback(successfulFeedback(plan, localeText(
        'I prepared the draft in the built-in chat without sending it.',
        'הכנתי את הטיוטה בצ׳אט המובנה בלי לשלוח אותה.',
      )));
      return;
    } else if (plan.action === 'write-terminal') {
      const initial = snapshotForRequestedTarget(captured, 'terminal');
      const current = captureAssistantTarget('terminal', vscode.window.activeTerminal ? 'terminal' : null);
      const terminal = vscode.window.activeTerminal;
      if (!terminal) {
        speakFeedback(localeText('I could not find an active terminal.', 'לא מצאתי מסוף פעיל.'));
        return;
      }
      const inserted = insertTerminalText(terminal, content, initial, current);
      if (!inserted.allowed) { explainPolicy(inserted.explanation); return; }
    } else if (plan.action === 'write-editor') {
      const initial = snapshotForRequestedTarget(captured, 'editor');
      const current = captureAssistantTarget('editor', vscode.window.activeTextEditor ? 'editor' : null);
      const decision = actionPolicy.authorizeWrite('write-editor', content, initial, current);
      if (!decision.allowed) { explainPolicy(decision.explanation); return; }
      const editor = vscode.window.activeTextEditor;
      if (!editor || !(await injectIntoEditor(editor, content))) {
        speakFeedback(localeText('The editor rejected the edit, so I made no change.', 'העורך דחה את העריכה, ולכן לא ביצעתי שינוי.'));
        return;
      }
    } else {
      const current = captureAssistantTarget();
      const decision = actionPolicy.authorizeWrite('write-here', content, captured, current);
      if (!decision.allowed) { explainPolicy(decision.explanation); return; }
      let targetChangedDuringPaste = false;
      const inserted = await injectIntoFocusedControl(content, () => {
        const valid = revalidateTargetSnapshot(captured, captureAssistantTarget()).valid;
        if (!valid) targetChangedDuringPaste = true;
        return valid;
      });
      if (!inserted) {
        if (targetChangedDuringPaste) {
          speakFeedback(localeText(
            'I stopped before pasting because the focused target changed.',
            'עצרתי לפני ההדבקה מפני שהיעד הממוקד השתנה.',
          ));
          return;
        }
        speakFeedback(localeText(
          'I copied the text to the clipboard, but could not confirm that it was pasted.',
          'העתקתי את הטקסט ללוח, אך לא הצלחתי לוודא שהוא הודבק.',
        ));
        return;
      }
    }

    if (remember) actionPolicy.rememberLast({ action: plan.action, text: content });
    speakFeedback(successfulFeedback(plan, localeText('Done.', 'בוצע.')));
  }

  async function setDeepSeekApiKey(): Promise<void> {
    if (!context.globalState.get<boolean>(DEEPSEEK_CONSENT_KEY, false)) {
      const consent = await vscode.window.showWarningMessage(
        'DeepSeek smart planning sends only the spoken request after the wake phrase, the selected persona, interface language, and minimal target kind/focus metadata to DeepSeek. It never sends screenshots, files, selections, clipboard content, terminal history, or chat history.',
        { modal: true },
        'I understand and enable DeepSeek',
      );
      if (consent !== 'I understand and enable DeepSeek') {
        await pushFullState();
        return;
      }
      await context.globalState.update(DEEPSEEK_CONSENT_KEY, true);
    }
    const key = await vscode.window.showInputBox({
      title: 'DeepSeek API Key',
      prompt: 'Paste your DeepSeek API key (stored only in VS Code SecretStorage)',
      password: true,
      ignoreFocusOut: true,
    });
    if (!key?.trim()) return;
    await context.secrets.store(DEEPSEEK_SECRET_KEY, key.trim());
    deepSeekLastError = undefined;
    vscode.window.showInformationMessage('Voice Input: DeepSeek API key saved securely.');
    await pushFullState();
  }

  async function clearDeepSeekApiKey(): Promise<void> {
    await context.secrets.delete(DEEPSEEK_SECRET_KEY);
    deepSeekLastError = undefined;
    vscode.window.showInformationMessage('Voice Input: DeepSeek API key cleared. Deterministic commands remain available.');
    await pushFullState();
  }

  async function configureDeepSeek(): Promise<void> {
    const existing = await context.secrets.get(DEEPSEEK_SECRET_KEY);
    if (!existing) {
      await setDeepSeekApiKey();
      return;
    }
    const choice = await vscode.window.showQuickPick([
      { label: '$(key) Replace DeepSeek API key', action: 'set' as const },
      { label: '$(trash) Clear DeepSeek API key', action: 'clear' as const },
    ], { title: 'Voice Input: DeepSeek setup' });
    if (choice?.action === 'set') await setDeepSeekApiKey();
    else if (choice?.action === 'clear') await clearDeepSeekApiKey();
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
    clearPendingSend(false);
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
    item: CapturedAssistantUtterance,
    generation: number,
  ): void {
    if (!assistantListening || generation !== assistantGeneration) return;
    if (!assistantTranscriptionActive) {
      assistantTranscriptionActive = true;
      void processAssistantUtterance(item, generation);
      return;
    }
    if (!assistantQueuedUtterance) {
      assistantQueuedUtterance = item;
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
        if (utterance) {
          // Capture before transcription/LLM latency. This snapshot is carried
          // through planning and checked again immediately before mutation.
          enqueueAssistantUtterance({
            utterance,
            snapshot: captureAssistantTarget(),
            id: `utterance-${Date.now()}-${++assistantUtteranceSequence}`,
          }, generation);
        }
      }
    } catch (error) {
      failAssistant(`Voice Input assistant stopped: ${(error as Error).message}`);
    }
  }

  async function processAssistantUtterance(
    item: CapturedAssistantUtterance,
    generation: number,
  ): Promise<void> {
    const controller = new AbortController();
    let phase: 'transcription' | 'planning' | 'action' = 'transcription';
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
        audio: pcm16FramesToWav([item.utterance.audio], ASSISTANT_SAMPLE_RATE),
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
      phase = 'planning';
      const fallbackPlan = deterministicPlan(parsed.postWakeText, parsed.intent);
      // Confirmation authority is local-only: an explicit recognized phrase
      // bypasses remote planning, while model output cannot contain this action.
      const plan = parsed.intent.kind === 'action' && parsed.intent.action === 'confirm-send'
        ? fallbackPlan
        : await createAssistantPlan(
          parsed.postWakeText,
          item.snapshot,
          controller.signal,
          fallbackPlan,
        );
      if (!assistantListening || generation !== assistantGeneration || controller.signal.aborted) return;
      phase = 'action';
      await executeAssistantPlan(plan, item.snapshot, item.id);
    } catch (error) {
      if (!controller.signal.aborted && assistantListening && generation === assistantGeneration) {
        if (error instanceof DeepSeekClientError) {
          // Smart planning is optional. A provider failure must not turn into a
          // guessed mutation, so explain it and keep listening.
          speakFeedback(localeText(
            'DeepSeek could not safely plan this request, so I made no change.',
            'DeepSeek לא הצליח לתכנן את הבקשה בבטחה, ולכן לא ביצעתי שינוי.',
          ));
        } else if (phase === 'action') {
          speakFeedback(localeText(
            'The action failed safely, so I made no further change.',
            'הפעולה נכשלה באופן בטוח, ולכן לא ביצעתי שינוי נוסף.',
          ));
        } else {
          failAssistant(`Voice Input assistant stopped: ${(error as Error).message}`);
        }
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
        'Voice Input assistant uses the microphone continuously while this VS Code window is running. Completed speech segments are sent to Soniox for transcription; silence stays local. Actions stay on a closed safety list. Built-in chat submission is possible only after a separate confirmation within 12 seconds.',
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
      case 'assistant-persona-change':
        await writeSettings({ assistantPersona: normalizePersonaId(msg.persona) });
        await pushFullState();
        break;
      case 'assistant-deepseek-setup':
        await configureDeepSeek();
        break;
      case 'assistant-speech-settings-change':
        await writeSettings({
          assistantSpeechEnabled: msg.enabled,
          assistantSpeechVoiceUri: msg.voiceUri,
          assistantSpeechRate: msg.rate,
        });
        if (!msg.enabled) {
          provider.cancelSpeaking();
          assistantSpeaking = false;
        }
        await pushFullState();
        break;
      case 'assistant-stop-speaking':
        provider.cancelSpeaking();
        assistantSpeaking = false;
        await pushFullState();
        break;
      case 'assistant-speech-started':
        assistantSpeaking = true;
        break;
      case 'assistant-speech-finished':
        assistantSpeaking = false;
        log('assistant speech finished:', msg.outcome);
        break;
      case 'assistant-pending-send-confirm':
        if (assistantPendingSend?.id === msg.id) {
          try {
            await executeAssistantPlan({
              action: 'confirm-send', target: 'current', content: null,
              spokenReply: '', reason: '', confidence: 1, requiresConfirmation: false,
            }, captureAssistantTarget(), `ui-confirm-${Date.now()}-${++assistantUtteranceSequence}`, false);
          } catch {
            clearPendingSend(false);
            speakFeedback(localeText(
              'The send confirmation failed safely. The prepared text was not submitted.',
              'אישור השליחה נכשל באופן בטוח. הטקסט המוכן לא נשלח.',
            ));
          }
        }
        break;
      case 'assistant-pending-send-cancel':
        if (assistantPendingSend?.id === msg.id) clearPendingSend(true);
        break;
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
    vscode.window.onDidChangeWindowState((state) => {
      if (!state.focused && intentionalTargetTransition === 0) clearPendingSend(false);
    }),
    vscode.window.tabGroups.onDidChangeTabs(() => {
      if (intentionalTargetTransition === 0) clearPendingSend(false);
    }),
    vscode.window.onDidChangeActiveTextEditor(() => {
      if (intentionalTargetTransition === 0) clearPendingSend(false);
    }),
    vscode.window.onDidChangeActiveTerminal(() => {
      if (intentionalTargetTransition === 0) clearPendingSend(false);
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
    vscode.commands.registerCommand('voiceInput.setDeepSeekApiKey', setDeepSeekApiKey),
    vscode.commands.registerCommand('voiceInput.clearDeepSeekApiKey', clearDeepSeekApiKey),
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
      clearPendingSend(false);
      provider.cancelSpeaking();
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
