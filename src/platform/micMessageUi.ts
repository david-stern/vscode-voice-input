import * as vscode from 'vscode';

import type { MicMessageUiPort } from '../features/commands/micMessageRouter';
import { assistantListeningDisclosure, type NativeLocalize } from './nativeLocalization';

/** VS Code adapter for clipboard, commands and microphone-view confirmations. */
export class VsCodeMicMessageUi implements MicMessageUiPort {
  constructor(private readonly localize: NativeLocalize) {}

  writeClipboard(text: string): Thenable<void> {
    return vscode.env.clipboard.writeText(text);
  }

  executeCommand(commandId: string, ...args: unknown[]): Thenable<unknown> {
    return vscode.commands.executeCommand(commandId, ...args);
  }

  async confirmHistoryClear(): Promise<boolean> {
    const action = this.localize('Clear', 'מחיקה');
    const accepted = await vscode.window.showWarningMessage(
      this.localize(
        'Clear all voice input history?',
        'למחוק את כל היסטוריית הקלט הקולי?',
      ),
      { modal: true },
      action,
    );
    return accepted === action;
  }

  async confirmAssistantDisclosure(): Promise<boolean> {
    const action = this.localize('I understand', 'הבנתי');
    const accepted = await vscode.window.showWarningMessage(
      assistantListeningDisclosure(this.localize),
      { modal: true },
      action,
    );
    return accepted === action;
  }
}
