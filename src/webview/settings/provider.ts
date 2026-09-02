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
import { parseLegacySettingsLauncherMessage } from './launcher';
import { routeForLegacySection } from './state';

export interface LegacySettingsControlCenterLauncher {
  open(route: 'home' | 'voice' | 'commands' | 'assistant' | 'privacy' | 'diagnostics'): PromiseLike<void> | void;
}

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

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly controlCenter: LegacySettingsControlCenterLauncher = {
      open: (route) => vscode.commands.executeCommand('voiceInput.openControlCenter', route),
    },
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.browserReady = false;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'out', 'webview')],
    };
    view.webview.html = renderSettingsDocument(view.webview, this.extensionUri);
    view.webview.onDidReceiveMessage((raw: unknown) => {
      const launcherMessage = parseLegacySettingsLauncherMessage(raw);
      if (launcherMessage) {
        void this.controlCenter.open(launcherMessage.route);
        return;
      }
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

  async reveal(section: SettingsSectionId = 'general'): Promise<void> {
    const route = routeForLegacySection(section);
    const controlCenterRoute: 'home' | 'voice' | 'commands' | 'assistant' | 'privacy' | 'diagnostics' = {
      setup: 'home', home: 'home', conversation: 'voice', voice: 'voice',
      actions: 'commands', agents: 'assistant', providers: 'assistant',
      privacy: 'privacy', diagnostics: 'diagnostics',
    }[route] as 'home' | 'voice' | 'commands' | 'assistant' | 'privacy' | 'diagnostics';
    await this.controlCenter.open(controlCenterRoute);
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
