import * as vscode from 'vscode';

import type { SettingsRegistrationHost } from '../features/settings';

/** VS Code adapter for the behavior-tested Settings surface registration. */
export class VsCodeSettingsRegistrationHost implements SettingsRegistrationHost {
  registerView(
    viewType: string,
    provider: unknown,
    retainContextWhenHidden: boolean,
  ): vscode.Disposable {
    return vscode.window.registerWebviewViewProvider(
      viewType,
      provider as vscode.WebviewViewProvider,
      { webviewOptions: { retainContextWhenHidden } },
    );
  }

  registerCommand(commandId: string, callback: () => unknown): vscode.Disposable {
    return vscode.commands.registerCommand(commandId, callback);
  }

  revealViewContainer(containerId: string): Thenable<unknown> {
    return vscode.commands.executeCommand(`workbench.view.extension.${containerId}`);
  }
}
