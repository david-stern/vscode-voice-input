import * as vscode from 'vscode';

import type { RecordingUiPort } from '../features/recording/pushToTalkController';

/** VS Code error/action adapter for push-to-talk recording. */
export class VsCodeRecordingUi implements RecordingUiPort {
  showError(message: string, action?: string): Thenable<string | undefined> {
    return action
      ? vscode.window.showErrorMessage(message, action)
      : vscode.window.showErrorMessage(message);
  }

  executeCommand(commandId: string): Thenable<unknown> {
    return vscode.commands.executeCommand(commandId);
  }
}
