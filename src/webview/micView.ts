import * as vscode from 'vscode';
import { HistoryEntry } from '../history';
import { ModelInfo, LanguageInfo } from '../sonioxMeta';
import type { PersonaId } from '../assistant/personas';
import { UiLang } from './i18n';

export type DeepSeekStatus = 'not-configured' | 'checking' | 'ready' | 'error';

export interface PendingAssistantSend {
  id: string;
  preview: string;
  targetLabel?: string;
}

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'history-copy'; id: string }
  | { type: 'history-remove'; id: string }
  | { type: 'history-clear' }
  | { type: 'history-clear-request' }
  | { type: 'set-api-key' }
  | { type: 'open-keybindings' }
  | { type: 'refresh-meta' }
  | { type: 'audio-device-change'; deviceId: string }
  | { type: 'audio-device-scan' }
  | { type: 'assistant-enabled-change'; enabled: boolean }
  | { type: 'assistant-wake-phrase-change'; wakePhrase: string }
  | { type: 'assistant-disclosure-acknowledged' }
  | { type: 'assistant-persona-change'; persona: PersonaId }
  | { type: 'assistant-deepseek-setup' }
  | { type: 'assistant-speech-settings-change'; enabled: boolean; voiceUri: string; rate: number }
  | { type: 'assistant-stop-speaking' }
  | { type: 'assistant-speech-started'; id: string }
  | { type: 'assistant-speech-finished'; id: string; outcome: 'completed' | 'cancelled' | 'error' | 'unavailable' | 'queue-full' }
  | { type: 'assistant-pending-send-confirm'; id: string }
  | { type: 'assistant-pending-send-cancel'; id: string }
  | {
      type: 'settings-update';
      speechLang: string;
      uiLang: UiLang;
      ttlDays: 0 | 1 | 7 | 30;
      model: string;
    };

export interface ViewState {
  uiLang: UiLang;
  speechLang: string;
  ttlDays: 0 | 1 | 7 | 30;
  model: string;
  history: HistoryEntry[];
  recording: boolean;
  keybinding: string;
  models: ModelInfo[];
  languages: LanguageInfo[];
  metaLoading: boolean;
  metaError?: string;
  audioDevice: string;
  audioDevices: { id: string; label: string }[];
  /** Reserved assistant state; the extension host wires these controls. */
  assistantEnabled?: boolean;
  assistantListening?: boolean;
  assistantWakePhrase?: string;
  assistantDisclosureAcknowledged?: boolean;
  assistantPersona?: PersonaId;
  assistantDeepSeekStatus?: DeepSeekStatus;
  assistantDeepSeekError?: string;
  assistantSpeechEnabled?: boolean;
  assistantSpeechVoiceUri?: string;
  assistantSpeechRate?: number;
  assistantSpeaking?: boolean;
  assistantTargetLabel?: string;
  assistantPlanConfidence?: number;
  assistantPendingSend?: PendingAssistantSend;
  assistantFeedback?: string;
}

export type HostMessage =
  | { type: 'state'; payload: ViewState }
  | { type: 'recording-state'; recording: boolean }
  | { type: 'history'; entries: HistoryEntry[] }
  | { type: 'meta'; models: ModelInfo[]; languages: LanguageInfo[]; loading: boolean; error?: string }
  | { type: 'speak'; id: string; text: string; lang?: string }
  | { type: 'cancel-speaking' };

export class MicViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'voiceInput.micView';
  private view?: vscode.WebviewView;
  private onMsgCb?: (msg: WebviewMessage) => void;
  private readonly pendingSpeech: Extract<HostMessage, { type: 'speak' }>[] = [];
  private statePosted = false;
  private viewWasDisposed = false;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.viewWasDisposed = false;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'out', 'webview')],
    };
    view.webview.html = this.renderHtml(view.webview);
    view.webview.onDidReceiveMessage((msg) => this.onMsgCb?.(msg as WebviewMessage));
    view.onDidDispose(() => {
      if (this.view === view) {
        this.view = undefined;
        this.statePosted = false;
        this.pendingSpeech.length = 0;
        this.viewWasDisposed = true;
      }
    });
  }

  onMessage(cb: (msg: WebviewMessage) => void) {
    this.onMsgCb = cb;
  }

  postState(state: ViewState) {
    const posted = this.view?.webview.postMessage({ type: 'state', payload: state });
    this.statePosted = Boolean(this.view);
    if (posted && this.pendingSpeech.length > 0) {
      const pending = this.pendingSpeech.splice(0);
      for (const message of pending) void this.view?.webview.postMessage(message);
    }
  }

  postRecording(on: boolean) {
    this.view?.webview.postMessage({ type: 'recording-state', recording: on });
  }

  postHistory(entries: HistoryEntry[]) {
    this.view?.webview.postMessage({ type: 'history', entries });
  }

  postMeta(models: ModelInfo[], languages: LanguageInfo[], loading: boolean, error?: string) {
    this.view?.webview.postMessage({ type: 'meta', models, languages, loading, error });
  }

  postSpeak(id: string, text: string, lang?: string): 'sent' | 'queued' | 'unavailable' {
    const message = { type: 'speak', id, text, lang } satisfies HostMessage;
    if (this.view && this.statePosted) {
      void this.view.webview.postMessage(message);
      return 'sent';
    }
    if (!this.view && !this.viewWasDisposed && this.pendingSpeech.length < 8) {
      this.pendingSpeech.push(message);
      return 'queued';
    }
    return 'unavailable';
  }

  cancelSpeaking(): boolean {
    this.pendingSpeech.length = 0;
    if (!this.view || !this.statePosted) return false;
    void this.view.webview.postMessage({ type: 'cancel-speaking' } satisfies HostMessage);
    return true;
  }

  isVisible(): boolean {
    return Boolean(this.view?.visible);
  }

  private renderHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'out', 'webview', 'mic.client.js'),
    );
    const nonce = randomNonce();
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `img-src ${webview.cspSource} data:`,
    ].join('; ');

    return /* html */ `<!DOCTYPE html>
<html lang="he">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <title>Voice Input</title>
  <style>${CSS}</style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function randomNonce(): string {
  let s = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

const CSS = `
  :root {
    --gap: 12px;
    --radius: 10px;
    --radius-sm: 6px;
    --border: var(--vscode-widget-border, var(--vscode-panel-border, rgba(128,128,128,0.2)));
    --bg-card: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
    --bg-soft: var(--vscode-input-background);
    --accent: var(--vscode-button-background);
    --accent-fg: var(--vscode-button-foreground);
    --accent-hover: var(--vscode-button-hoverBackground);
    --danger: #d64545;
    --danger-bg: rgba(214, 69, 69, 0.12);
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    color: var(--vscode-foreground);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size, 13px);
    background: transparent;
  }
  #root {
    display: flex;
    flex-direction: column;
    gap: var(--gap);
    padding-block: var(--gap);
    padding-inline: var(--gap);
    min-width: 0;
  }

  /* MIC CARD */
  .card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding-block: 16px;
    padding-inline: 16px;
  }
  .mic-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding-block: 20px;
    padding-inline: 16px;
  }
  .mic-btn {
    width: 86px;
    height: 86px;
    border-radius: 50%;
    border: 2px solid transparent;
    background: var(--accent);
    color: var(--accent-fg);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.1s ease, background 0.2s ease, box-shadow 0.2s ease;
    box-shadow: 0 2px 6px rgba(0,0,0,0.15);
    user-select: none;
  }
  .mic-btn:hover {
    background: var(--accent-hover);
    transform: scale(1.04);
  }
  .mic-btn:active { transform: scale(0.96); }
  .mic-btn.recording {
    background: var(--danger);
    color: white;
    box-shadow: 0 0 0 0 rgba(214, 69, 69, 0.6);
    animation: pulse 1.2s infinite;
  }
  @keyframes pulse {
    0%   { box-shadow: 0 0 0 0 rgba(214, 69, 69, 0.6); }
    70%  { box-shadow: 0 0 0 12px rgba(214, 69, 69, 0); }
    100% { box-shadow: 0 0 0 0 rgba(214, 69, 69, 0); }
  }

  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 500;
    opacity: 0.95;
  }
  .status-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--vscode-charts-foreground, #888);
    transition: background 0.2s ease;
  }
  .status-dot.on { background: var(--danger); animation: blink 1s infinite; }
  @keyframes blink { 50% { opacity: 0.3; } }

  .hint {
    font-size: 11px;
    opacity: 0.6;
    text-align: center;
    line-height: 1.5;
  }
  .hint-key {
    background: var(--bg-soft);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 2px 6px;
    font-size: 10px;
    font-weight: 600;
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    display: inline-block;
    opacity: 0.9;
  }

  /* SECTIONS */
  .section {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 12px 14px;
  }
  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-block-end: 10px;
  }
  .section-head h3 {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    opacity: 0.7;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .count {
    background: var(--bg-soft);
    color: var(--vscode-foreground);
    border-radius: 999px;
    font-size: 10px;
    padding: 2px 8px;
    opacity: 0.85;
    text-transform: none;
    letter-spacing: 0;
  }

  /* HISTORY */
  .history-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 320px;
    overflow-y: auto;
  }
  .empty {
    text-align: center;
    padding: 16px 8px;
    opacity: 0.5;
    font-size: 12px;
  }
  .entry {
    background: var(--bg-soft);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    transition: border-color 0.15s ease;
  }
  .entry:hover { border-color: var(--accent); }
  .entry-text {
    font-size: 13px;
    line-height: 1.4;
    white-space: normal;
    overflow-wrap: anywhere;
    unicode-bidi: plaintext;
  }
  .entry-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    opacity: 0.85;
  }
  .badge {
    background: var(--vscode-badge-background, rgba(128,128,128,0.2));
    color: var(--vscode-badge-foreground, inherit);
    border-radius: 999px;
    padding: 2px 8px;
    font-size: 10px;
  }
  .ts { opacity: 0.6; margin-inline-start: auto; }
  .icon-btn {
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    color: inherit;
    cursor: pointer;
    padding: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background 0.12s ease, border-color 0.12s ease;
  }
  .icon-btn:hover { background: var(--bg-card); border-color: var(--border); }
  .icon-btn.danger:hover { color: var(--danger); border-color: var(--danger); background: var(--danger-bg); }
  .icon-btn.flash { background: var(--accent); color: var(--accent-fg); }

  :is(button, select, input, summary):focus-visible {
    outline: 2px solid var(--vscode-focusBorder, var(--accent));
    outline-offset: 2px;
  }

  .link-btn {
    background: transparent;
    border: none;
    color: var(--vscode-textLink-foreground, var(--accent));
    cursor: pointer;
    font-size: 11px;
    padding: 0;
  }
  .link-btn:hover { text-decoration: underline; }
  .link-btn.danger { color: var(--danger); }
  .link-btn:disabled { opacity: 0.4; cursor: default; text-decoration: none; }

  /* SETTINGS */
  .settings-section summary {
    list-style: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    opacity: 0.7;
  }
  .settings-section summary::-webkit-details-marker { display: none; }
  .settings-section .chevron {
    transition: transform 0.2s ease;
    opacity: 0.5;
  }
  .settings-section[open] .chevron { transform: rotate(180deg); }
  .settings-grid {
    margin-top: 12px;
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .settings-grid label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 11px;
    opacity: 0.95;
    min-width: 0;
  }
  .settings-grid label.full { grid-column: 1 / -1; }
  .settings-grid select,
  .settings-grid input {
    background: var(--bg-soft);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--border));
    border-radius: 4px;
    padding: 4px 6px;
    font: inherit;
    width: 100%;
    min-width: 0;
    max-width: 100%;
  }
  .btn {
    background: var(--accent);
    color: var(--accent-fg);
    border: none;
    border-radius: 4px;
    padding: 6px 10px;
    cursor: pointer;
    font-size: 12px;
  }
  .btn:hover { background: var(--accent-hover); }

  .btn-ghost {
    background: transparent;
    color: var(--vscode-textLink-foreground, var(--accent));
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 4px 8px;
    cursor: pointer;
    font-size: 11px;
  }
  .btn-ghost:hover { background: var(--bg-soft); }

  .kb-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .kbd {
    background: var(--bg-soft);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 3px 8px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    color: var(--vscode-foreground);
  }

  .actions-row {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .assistant-section {
    display: grid;
    gap: 10px;
  }
  .assistant-section .section-head { margin-block-end: 0; }
  .assistant-status {
    margin: 0;
    font-size: 12px;
    opacity: 0.85;
  }
  .assistant-feedback {
    margin: 0;
    padding: 8px;
    border-inline-start: 2px solid var(--accent);
    background: var(--bg-soft);
    border-radius: 3px;
    font-size: 12px;
    line-height: 1.45;
    overflow-wrap: anywhere;
    unicode-bidi: plaintext;
  }
  .assistant-field {
    display: grid;
    gap: 4px;
    min-width: 0;
    font-size: 11px;
  }
  .assistant-field input,
  .assistant-field select {
    min-width: 0;
    width: 100%;
    max-width: 100%;
    padding-block: 5px;
    padding-inline: 6px;
    background: var(--bg-soft);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--border));
    border-radius: 4px;
    font: inherit;
  }
  .assistant-field input[type="range"] {
    padding: 0;
    accent-color: var(--accent);
  }
  .assistant-subsection,
  .assistant-target,
  .pending-send {
    display: grid;
    gap: 7px;
    min-width: 0;
    padding: 9px;
    background: var(--bg-soft);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }
  .assistant-row,
  .check-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }
  .check-row {
    justify-content: flex-start;
    cursor: pointer;
    font-size: 11px;
  }
  .check-row input { accent-color: var(--accent); }
  .assistant-subsection .btn-ghost,
  .pending-send button { min-height: 24px; }
  .field-label { font-size: 11px; font-weight: 600; }
  .subtle-status,
  .confidence-label,
  .pending-send p {
    margin: 0;
    font-size: 11px;
    opacity: 0.8;
  }
  .subtle-status.error { color: var(--danger); opacity: 1; }
  .assistant-target progress {
    width: 100%;
    height: 6px;
    accent-color: var(--accent);
  }
  .pending-send {
    border-color: var(--vscode-inputValidation-warningBorder, var(--border));
    background: var(--vscode-inputValidation-warningBackground, var(--bg-soft));
  }
  .pending-send blockquote {
    margin: 0;
    padding-inline-start: 8px;
    border-inline-start: 2px solid var(--border);
    overflow-wrap: anywhere;
    unicode-bidi: plaintext;
    white-space: pre-wrap;
    max-height: 120px;
    overflow-y: auto;
  }
  .toggle-btn {
    background: transparent;
    color: var(--vscode-textLink-foreground, var(--accent));
    border: 1px solid var(--border);
    border-radius: 999px;
    padding-block: 4px;
    padding-inline: 8px;
    cursor: pointer;
    font: inherit;
    font-size: 11px;
  }
  .toggle-btn.on { background: var(--accent); color: var(--accent-fg); }
  :is(.btn, .btn-ghost, .toggle-btn):disabled {
    opacity: 0.45;
    cursor: default;
  }
  .assistant-disclosure {
    border-inline-start: 2px solid var(--border);
    padding-inline-start: 8px;
    font-size: 11px;
    opacity: 0.85;
  }
  .assistant-disclosure p { margin-block: 0 6px; }
  .meta-loading {
    display: inline-block;
    margin-inline-start: 6px;
    animation: spin 1s linear infinite;
    opacity: 0.7;
  }
  .meta-error {
    color: var(--danger);
    font-size: 10px;
    margin-top: 2px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  [dir="rtl"] .ts { margin-inline-start: 0; margin-inline-end: auto; }

  @media (max-width: 260px) {
    #root { padding-inline: 8px; }
    .card, .section { padding-inline: 10px; }
    .section-head, .entry-meta { align-items: flex-start; flex-wrap: wrap; }
    .ts { margin-inline-start: 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      scroll-behavior: auto !important;
      transition-duration: 0.01ms !important;
    }
  }
`;
