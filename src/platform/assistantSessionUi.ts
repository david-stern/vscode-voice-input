import * as vscode from 'vscode';

import type {
  AssistantResumeSuggestionChoice,
  AssistantSessionUiPort,
} from '../features/assistant/sessionController';
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

  /**
   * Non-modal discovery of background resume. It states the gates plainly and never
   * starts listening, prompts for consent or touches credentials by itself.
   */
  async suggestStartupResume(): Promise<AssistantResumeSuggestionChoice> {
    const enable = this.localize('Enable', 'הפעלה');
    const notNow = this.localize('Not now', 'לא עכשיו');
    const selected = await vscode.window.showInformationMessage(
      this.localize(
        'Voice Input: resume assistant listening automatically after startup? It resumes only when consent, the Soniox key, a microphone and workspace trust are already available.',
        'Voice Input: לחדש את האזנת העוזר אוטומטית לאחר ההפעלה? החידוש מתבצע רק כאשר ההסכמה, מפתח Soniox, מיקרופון ואמון במרחב העבודה כבר קיימים.',
      ),
      enable,
      notNow,
    );
    if (selected === enable) return 'enable';
    return selected === notNow ? 'dismiss' : 'ignored';
  }

  showError(message: string): Thenable<string | undefined> {
    return vscode.window.showErrorMessage(message);
  }

  executeCommand(commandId: string): Thenable<unknown> {
    return vscode.commands.executeCommand(commandId);
  }
}
