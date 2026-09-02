import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';

import type {
  ControlCenterPanelFactory,
  ControlCenterPanelPort,
} from '../features/controlCenter/controller';
import type { ControlCenterRegistrationHost } from '../features/controlCenter/registration';
import { CONTROL_CENTER_VIEW_TYPE } from '../webview/controlCenter/contracts';
import { renderControlCenterDocument } from '../webview/controlCenter/document';

const CONTROL_CENTER_ASSET_DIRECTORY = ['out', 'webview', 'controlCenter'] as const;

/** Creates/adopts VS Code panels with the exact closed asset and command-URI policy. */
export class VsCodeControlCenterPanelFactory implements ControlCenterPanelFactory {
  constructor(private readonly extensionUri: vscode.Uri) {}

  create(): ControlCenterPanelPort {
    const panel = vscode.window.createWebviewPanel(
      CONTROL_CENTER_VIEW_TYPE,
      'Voice Input Control Center',
      vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One,
      this.panelOptions(),
    );
    return this.prepare(panel);
  }

  adopt(panel: unknown): ControlCenterPanelPort {
    return this.prepare(panel as vscode.WebviewPanel);
  }

  private prepare(panel: vscode.WebviewPanel): ControlCenterPanelPort {
    const assetRoot = vscode.Uri.joinPath(this.extensionUri, ...CONTROL_CENTER_ASSET_DIRECTORY);
    panel.webview.options = {
      enableScripts: true,
      enableCommandUris: false,
      localResourceRoots: [assetRoot],
    };
    panel.webview.html = renderControlCenterDocument({
      cspSource: panel.webview.cspSource,
      scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(assetRoot, 'client.js')).toString(),
      styleUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(assetRoot, 'styles.css')).toString(),
      nonce: randomBytes(18).toString('base64'),
    });
    return {
      identity: panel,
      reveal: () => panel.reveal(panel.viewColumn, false),
      dispose: () => panel.dispose(),
      postMessage: (message) => panel.webview.postMessage(message),
      onMessage: (listener) => panel.webview.onDidReceiveMessage(listener),
      onDispose: (listener) => panel.onDidDispose(listener),
    };
  }

  private panelOptions(): vscode.WebviewPanelOptions & vscode.WebviewOptions {
    return {
      enableScripts: true,
      enableCommandUris: false,
      retainContextWhenHidden: false,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, ...CONTROL_CENTER_ASSET_DIRECTORY),
      ],
    };
  }
}

export class VsCodeControlCenterPersistence {
  constructor(private readonly state: vscode.Memento) {}

  get(key: string): unknown { return this.state.get(key); }
  update(key: string, value: unknown): Thenable<void> { return this.state.update(key, value); }
}

export class VsCodeControlCenterRegistrationHost implements ControlCenterRegistrationHost {
  registerCommand(
    commandId: string,
    callback: (route?: unknown, params?: unknown) => unknown,
  ): vscode.Disposable {
    return vscode.commands.registerCommand(commandId, callback);
  }

  registerSerializer(
    viewType: string,
    serializer: { deserializeWebviewPanel(panel: unknown, state: unknown): PromiseLike<void> | void },
  ): vscode.Disposable {
    return vscode.window.registerWebviewPanelSerializer(viewType, {
      deserializeWebviewPanel: (panel, state) => Promise.resolve(
        serializer.deserializeWebviewPanel(panel, state),
      ),
    });
  }
}
