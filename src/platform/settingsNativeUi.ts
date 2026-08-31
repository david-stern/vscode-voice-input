import * as vscode from 'vscode';

import type { ConsentId, ProviderDisclosure, SettingName } from '../config';
import { providerConsentPrompt, type SettingsNativeUi } from '../features/settings';
import { assistantListeningDisclosure, type NativeLocalize } from './nativeLocalization';

/** Native confirmations and VS Code-owned navigation for the Settings controller. */
export class VsCodeSettingsNativeUi implements SettingsNativeUi {
  constructor(
    private readonly extensionId: string,
    private readonly localize: NativeLocalize,
  ) {}

  async confirmConsent(
    consent: ConsentId,
    disclosure?: Readonly<ProviderDisclosure>,
  ): Promise<boolean> {
    if (consent !== 'assistant-listening') {
      if (!disclosure || disclosure.provider !== consent) return false;
      const prompt = providerConsentPrompt(disclosure, this.localize);
      const selected = await vscode.window.showWarningMessage(
        prompt.message,
        { modal: true },
        prompt.action,
      );
      return selected === prompt.action;
    }
    const action = this.localize(
      'I understand and enable listening',
      'הבנתי, יש להפעיל האזנה',
    );
    const selected = await vscode.window.showWarningMessage(
      assistantListeningDisclosure(this.localize),
      { modal: true },
      action,
    );
    return selected === action;
  }

  openNativeSettings(setting?: SettingName): Thenable<unknown> {
    const query = setting ? `@id:voiceInput.${setting}` : `@ext:${this.extensionId}`;
    return vscode.commands.executeCommand('workbench.action.openSettings', query);
  }

  openKeybindings(): Thenable<unknown> {
    return vscode.commands.executeCommand('workbench.action.openGlobalKeybindings', 'voiceInput');
  }

  copyText(text: string): Thenable<void> {
    return vscode.env.clipboard.writeText(text);
  }
}
