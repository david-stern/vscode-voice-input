import * as vscode from 'vscode';

import { isNewerRevision, nextRevision, type Revision } from '../protocol';
import {
  parseSettingsWebviewMessage,
  projectSettingsViewState,
  type SettingsHostMessage,
  type SettingsSectionId,
  type SettingsViewState,
  type SettingsWebviewMessage,
} from './protocol';
import { renderSettingsDocument } from './document';

export type SettingsPostResult = 'posted' | 'cached' | 'stale';

/** VS Code adapter with one validated callback and monotonic state/navigation publication. */
export class SettingsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'voiceInput.settingsView';

  private view: vscode.WebviewView | undefined;
  private browserReady = false;
  private callback: ((message: SettingsWebviewMessage) => void) | undefined;
  private lastState: SettingsViewState | undefined;
  private navigationRevision: Revision = 0;
  private pendingNavigation: SettingsHostMessage & { type: 'settings-navigate' } | undefined;
  private revealRequested = false;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.browserReady = false;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'out', 'webview')],
    };
    view.webview.html = renderSettingsDocument(view.webview, this.extensionUri);
    view.webview.onDidReceiveMessage((raw: unknown) => {
      const message = parseSettingsWebviewMessage(raw);
      if (!message) return;
      if (message.type === 'settings-ready') {
        this.browserReady = true;
        this.replayState();
        this.replayNavigation();
      }
      this.callback?.(message);
    });
    view.onDidDispose(() => {
      if (this.view !== view) return;
      this.view = undefined;
      this.browserReady = false;
    });
    if (this.revealRequested) {
      this.revealRequested = false;
      view.show(false);
    }
  }

  onMessage(callback: (message: SettingsWebviewMessage) => void): void {
    this.callback = callback;
  }

  postState(state: Readonly<SettingsViewState>): SettingsPostResult {
    if (this.lastState && !isNewerRevision(state.revision, this.lastState.revision)) return 'stale';
    this.lastState = projectSettingsViewState(state);
    if (!this.view || !this.browserReady) return 'cached';
    void this.view.webview.postMessage({
      type: 'settings-state',
      payload: this.lastState,
    } satisfies SettingsHostMessage);
    return 'posted';
  }

  navigate(section: SettingsSectionId): void {
    this.navigationRevision = nextRevision(this.navigationRevision);
    this.pendingNavigation = {
      type: 'settings-navigate',
      revision: this.navigationRevision,
      section,
    };
    this.replayNavigation();
  }

  async reveal(
    section: SettingsSectionId = 'general',
    revealContainer: () => PromiseLike<unknown> = () => vscode.commands.executeCommand(
      'workbench.view.extension.voiceInput',
    ),
  ): Promise<void> {
    this.navigate(section);
    if (this.view) {
      this.view.show(false);
      return;
    }
    this.revealRequested = true;
    await revealContainer();
    const resolvedView = this.view as vscode.WebviewView | undefined;
    if (resolvedView && this.revealRequested) {
      this.revealRequested = false;
      resolvedView.show(false);
    }
  }

  private replayState(): void {
    if (!this.browserReady || !this.lastState) return;
    void this.view?.webview.postMessage({
      type: 'settings-state',
      payload: this.lastState,
    } satisfies SettingsHostMessage);
  }

  private replayNavigation(): void {
    if (!this.browserReady || !this.pendingNavigation) return;
    void this.view?.webview.postMessage(this.pendingNavigation);
  }
}
