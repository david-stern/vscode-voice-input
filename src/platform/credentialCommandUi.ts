import * as vscode from 'vscode';

import type { CredentialCommandUi } from '../features/commands/credentialController';
import type { ProviderDisclosure, ProviderId } from '../config';
import { getProviderDescriptor, type ProviderId as PlannerProviderId } from '../inference';
import type { NativeLocalize } from './nativeLocalization';

/** Native, password-masked credential and consent dialogs. */
export class VsCodeCredentialCommandUi implements CredentialCommandUi {
  constructor(private readonly localize: NativeLocalize) {}

  async confirmDeepSeekDisclosure(): Promise<boolean> {
    return this.confirmProviderDisclosure({
      provider: 'deepseek',
      providerName: 'DeepSeek',
      endpointHost: 'api.deepseek.com',
      locality: 'remote',
      fields: [
        'post-wake-request',
        'persona-and-bounded-user-agent-instructions',
        'locale',
        'minimal-target-kind-and-focus',
      ],
      excludes: [
        'screenshots',
        'files-and-selections',
        'clipboard',
        'terminal-and-chat-history',
        'mapping-arguments-and-tool-input',
      ],
    });
  }

  async confirmProviderDisclosure(disclosure: ProviderDisclosure): Promise<boolean> {
    const provider = disclosure.providerName;
    const action = this.localize(
      `I understand and enable ${provider}`,
      `הבנתי, יש להפעיל את ${provider}`,
    );
    const locality = disclosure.locality === 'local-loopback'
      ? this.localize(
        'The configured Ollama endpoint is loopback, so this request stays on this machine.',
        'נקודת הקצה של Ollama מוגדרת כלולאת משוב, ולכן הבקשה נשארת במחשב הזה.',
      )
      : this.localize(
        `The request leaves this machine and is sent to ${provider} at ${disclosure.endpointHost}.`,
        `הבקשה יוצאת מהמחשב ונשלחת אל ${provider} בכתובת ${disclosure.endpointHost}.`,
      );
    const accepted = await vscode.window.showWarningMessage(
      this.localize(
        `${provider} planning sends only the spoken request after the wake phrase, the selected persona and bounded user-authored agent instructions, interface locale, and minimal target kind/focus metadata. ${locality} It never sends screenshots, files, selections, clipboard content, terminal history, chat history, mapping arguments, or tool input.`,
        `התכנון של ${provider} שולח רק את הבקשה שנאמרה לאחר ביטוי ההפעלה, את הדמות שנבחרה והוראות סוכן מוגבלות באורך שנכתבו על ידי המשתמש, את שפת הממשק ומידע מזערי על סוג היעד והמיקוד. ${locality} הוא לעולם אינו שולח צילומי מסך, קבצים, בחירות, תוכן לוח, היסטוריית מסוף או צ׳אט, ארגומנטים של מיפויים או קלט לכלים.`,
      ),
      { modal: true },
      action,
    );
    return accepted === action;
  }

  async confirmCredentialClear(provider: ProviderId): Promise<boolean> {
    const label = providerLabel(provider);
    const action = this.localize(`Clear ${label} key`, `מחיקת המפתח של ${label}`);
    const selected = await vscode.window.showWarningMessage(
      this.localize(
        `Clear the saved ${label} API key?`,
        `למחוק את מפתח ה־API השמור של ${label}?`,
      ),
      { modal: true },
      action,
    );
    return selected === action;
  }

  promptSonioxKey(): Thenable<string | undefined> {
    return vscode.window.showInputBox({
      title: this.localize('Soniox API Key', 'מפתח API של Soniox'),
      prompt: this.localize(
        'Paste your Soniox API key. It is stored only in VS Code SecretStorage.',
        'יש להדביק את מפתח ה־API של Soniox. הוא נשמר רק באחסון הסודות של VS Code.',
      ),
      password: true,
      ignoreFocusOut: true,
    });
  }

  promptDeepSeekKey(): Thenable<string | undefined> {
    return this.promptProviderKey('deepseek');
  }

  promptProviderKey(provider: PlannerProviderId): Thenable<string | undefined> {
    const label = providerLabel(provider);
    return vscode.window.showInputBox({
      title: this.localize(`${label} credential`, `פרטי אימות של ${label}`),
      prompt: this.localize(
        `Paste your ${label} API key. It is stored only in VS Code SecretStorage.`,
        `יש להדביק את מפתח ה־API של ${label}. הוא נשמר רק באחסון הסודות של VS Code.`,
      ),
      password: true,
      ignoreFocusOut: true,
    });
  }

  async chooseDeepSeekAction(): Promise<'set' | 'clear' | undefined> {
    return this.chooseProviderAction('deepseek');
  }

  async chooseProviderAction(
    provider: PlannerProviderId,
  ): Promise<'set' | 'clear' | undefined> {
    const label = providerLabel(provider);
    const choice = await vscode.window.showQuickPick([
      {
        label: this.localize(
          `$(key) Replace ${label} API key`,
          `$(key) החלפת מפתח ה־API של ${label}`,
        ),
        action: 'set' as const,
      },
      {
        label: this.localize(
          `$(trash) Clear ${label} API key`,
          `$(trash) מחיקת מפתח ה־API של ${label}`,
        ),
        action: 'clear' as const,
      },
    ], {
      title: this.localize(`Voice Input: ${label} setup`, `Voice Input: הגדרת ${label}`),
    });
    return choice?.action;
  }

  showInformation(message: string): Thenable<string | undefined> {
    return vscode.window.showInformationMessage(message);
  }

  async offerSonioxSetup(): Promise<boolean> {
    const action = this.localize('Set API key', 'הגדרת מפתח API');
    const selected = await vscode.window.showInformationMessage(
      this.localize(
        'Voice Input is installed. Set your Soniox API key to begin.',
        'Voice Input הותקן. כדי להתחיל יש להגדיר מפתח API של Soniox.',
      ),
      action,
    );
    return selected === action;
  }
}

function providerLabel(provider: ProviderId): string {
  return provider === 'soniox' ? 'Soniox' : getProviderDescriptor(provider).name;
}
