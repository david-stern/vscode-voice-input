import * as vscode from 'vscode';
import {
  isWebviewMessage,
  projectViewState,
  type HistoryEntry,
  type HostMessage,
  type LanguageInfo,
  type ModelInfo,
  type ViewState,
  type WebviewMessage,
} from '../protocol';
import { renderMicDocument } from './document';

/** VS Code adapter for the microphone webview. */
export class MicViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'voiceInput.micView';
  private view?: vscode.WebviewView;
  private onMessageCallback?: (message: WebviewMessage) => void;
  private readonly pendingSpeech: Extract<HostMessage, { type: 'speak' }>[] = [];
  private statePosted = false;
  private viewWasDisposed = false;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.viewWasDisposed = false;
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'out', 'webview')] };
    view.webview.html = renderMicDocument(view.webview, this.extensionUri);
    view.webview.onDidReceiveMessage((message: unknown) => {
      if (isWebviewMessage(message)) this.onMessageCallback?.(message);
    });
    view.onDidDispose(() => this.handleDisposedView(view));
  }

  onMessage(callback: (message: WebviewMessage) => void): void { this.onMessageCallback = callback; }

  postState(state: ViewState): void {
    const posted = this.view?.webview.postMessage({ type: 'state', payload: projectViewState(state) } satisfies HostMessage);
    this.statePosted = Boolean(this.view);
    if (posted && this.pendingSpeech.length > 0) {
      for (const message of this.pendingSpeech.splice(0)) void this.view?.webview.postMessage(message);
    }
  }

  postRecording(recording: boolean): void { void this.view?.webview.postMessage({ type: 'recording-state', recording }); }
  postHistory(entries: HistoryEntry[]): void { void this.view?.webview.postMessage({ type: 'history', entries }); }
  postMeta(models: ModelInfo[], languages: LanguageInfo[], loading: boolean, error?: string): void { void this.view?.webview.postMessage({ type: 'meta', models, languages, loading, error }); }

  postSpeak(id: string, text: string, lang?: string): 'sent' | 'queued' | 'unavailable' {
    const message = { type: 'speak', id, text, lang } satisfies HostMessage;
    if (this.view && this.statePosted) { void this.view.webview.postMessage(message); return 'sent'; }
    if (!this.view && !this.viewWasDisposed && this.pendingSpeech.length < 8) { this.pendingSpeech.push(message); return 'queued'; }
    return 'unavailable';
  }

  cancelSpeaking(): boolean {
    this.pendingSpeech.length = 0;
    if (!this.view || !this.statePosted) return false;
    void this.view.webview.postMessage({ type: 'cancel-speaking' } satisfies HostMessage);
    return true;
  }

  private handleDisposedView(view: vscode.WebviewView): void {
    if (this.view !== view) return;
    this.view = undefined;
    this.statePosted = false;
    this.pendingSpeech.length = 0;
    this.viewWasDisposed = true;
  }
}
