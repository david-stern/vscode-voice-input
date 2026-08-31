import * as vscode from 'vscode';

import type { AssistantSessionUiPort } from '../features/assistant/sessionController';
import {
  ASSISTANT_LISTENING_DISCLOSURE,
  type NativeLocalize,
} from './nativeLocalization';

/** VS Code dialogs used by the explicit assistant-listening lifecycle. */
export class VsCodeAssistantSessionUi implements AssistantSessionUiPort {
  constructor(private readonly localize: NativeLocalize) {}

  async confirmListeningDisclosure(): Promise<boolean> {
    const action = this.localize('Start listening', 'התחלת האזנה');
    const accepted = await vscode.window.showWarningMessage(
      this.localize(
        `${ASSISTANT_LISTENING_DISCLOSURE.english} Actions stay on a closed safety list. Built-in chat submission is possible only after a separate confirmation within 12 seconds.`,
        `${ASSISTANT_LISTENING_DISCLOSURE.hebrew} הפעולות נשארות ברשימת בטיחות סגורה. שליחה לצ׳אט המובנה אפשרית רק לאחר אישור נפרד בתוך 12 שניות.`,
      ),
      { modal: true },
      action,
    );
    return accepted === action;
  }

  async showMissingSonioxCredential(): Promise<boolean> {
    const action = this.localize('Set now', 'הגדרה עכשיו');
    const selected = await vscode.window.showErrorMessage(
      this.localize(
        'Voice Input: The Soniox API key is not configured.',
        'Voice Input: מפתח ה־API של Soniox אינו מוגדר.',
      ),
      action,
    );
    return selected === action;
  }

  showError(message: string): Thenable<string | undefined> {
    return vscode.window.showErrorMessage(message);
  }

  executeCommand(commandId: string): Thenable<unknown> {
    return vscode.commands.executeCommand(commandId);
  }
}
