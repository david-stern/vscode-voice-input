import * as vscode from 'vscode';

import type { SettingsRepository } from '../config';
import type {
  CommandRegistrationPort,
  CommandRegistrationDisposable,
} from '../features/commands';
import type { AudioDeviceService } from '../features/recording';
import type { HostStatePublisher } from '../features/state';
import type { HistoryStore } from '../history';
import {
  PROVIDER_DESCRIPTORS,
  type ProviderId,
} from '../inference';
import type { ConnectionTestResult } from '../providers';
import type { NativeLocalize } from './nativeLocalization';

export class VsCodeCommandRegistrationHost implements CommandRegistrationPort {
  registerCommand(commandId: string, callback: () => unknown): CommandRegistrationDisposable {
    return vscode.commands.registerCommand(commandId, callback);
  }
}

export interface VsCodeCommandWorkflowOptions {
  settings: Pick<SettingsRepository, 'read'>;
  devices: Pick<AudioDeviceService, 'get' | 'select'>;
  history: Pick<HistoryStore, 'clear'>;
  state: Pick<HostStatePublisher, 'pushHistory'>;
  configureProvider(provider: ProviderId): PromiseLike<void>;
  testProvider(provider: ProviderId, signal?: AbortSignal): PromiseLike<ConnectionTestResult>;
  localize: NativeLocalize;
}

/** Owns VS Code-native command dialogs while feature registration stays host-neutral. */
export class VsCodeCommandWorkflows {
  constructor(private readonly options: VsCodeCommandWorkflowOptions) {}

  async selectAudioDevice(): Promise<void> {
    const devices = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: this.text(
          'Voice Input: Scanning audio devices…',
          'Voice Input: סריקת התקני שמע…',
        ),
      },
      () => this.options.devices.get(true),
    );

    if (devices.length === 0) {
      await vscode.window.showErrorMessage(this.text(
        'Voice Input: No audio input sources found. Make sure a microphone is connected.',
        'Voice Input: לא נמצאו מקורות קלט שמע. יש לוודא שמיקרופון מחובר.',
      ));
      return;
    }

    interface DeviceItem extends vscode.QuickPickItem { deviceId: string; }
    const currentDevice = this.options.settings.read().values.audioDevice;
    const items: DeviceItem[] = [
      {
        label: this.text('$(circle-slash) System default', '$(circle-slash) ברירת המחדל של המערכת'),
        description: this.text(
          'Let the operating system choose the default microphone',
          'מערכת ההפעלה תבחר את מיקרופון ברירת המחדל',
        ),
        deviceId: '',
        picked: !currentDevice,
      },
      ...devices.map((device) => ({
        label: `$(device-microphone) ${device.label}`,
        description: device.id,
        deviceId: device.id,
        picked: device.id === currentDevice,
      })),
    ];
    const selected = await vscode.window.showQuickPick(items, {
      title: this.text('Select Audio Input Device', 'בחירת התקן קלט שמע'),
      placeHolder: this.text('Choose a microphone…', 'בחירת מיקרופון…'),
      matchOnDescription: true,
    });
    if (!selected) return;

    await this.options.devices.select(selected.deviceId);
    const friendlyName = selected.deviceId
      ? `“${selected.label.replace(/^\$\([^)]+\)\s*/, '')}”`
      : this.text('the system default', 'ברירת המחדל של המערכת');
    await vscode.window.showInformationMessage(this.text(
      `Voice Input: Audio device set to ${friendlyName}.`,
      `Voice Input: התקן השמע הוגדר ל־${friendlyName}.`,
    ));
  }

  async clearHistory(): Promise<void> {
    const action = this.text('Clear history', 'מחיקת ההיסטוריה');
    const selected = await vscode.window.showWarningMessage(
      this.text(
        'Clear all voice input history?',
        'למחוק את כל היסטוריית הקלט הקולי?',
      ),
      { modal: true },
      action,
    );
    if (selected !== action) return;
    await this.options.history.clear();
    await this.options.state.pushHistory();
  }

  async manageAssistantProvider(): Promise<void> {
    const provider = await this.chooseProvider(
      this.text('Manage Assistant Provider', 'ניהול ספק העוזר'),
    );
    if (provider) await this.options.configureProvider(provider);
  }

  async testAssistantProvider(): Promise<void> {
    const provider = await this.chooseProvider(
      this.text('Test Assistant Provider', 'בדיקת ספק העוזר'),
    );
    if (!provider) return;
    const descriptor = PROVIDER_DESCRIPTORS.find(({ id }) => id === provider)!;
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        cancellable: true,
        title: this.text(
          `Voice Input: Testing ${descriptor.name}…`,
          `Voice Input: בדיקת ${descriptor.name}…`,
        ),
      },
      async (_progress, cancellation) => {
        const controller = new AbortController();
        if (cancellation.isCancellationRequested) controller.abort();
        const subscription = cancellation.onCancellationRequested(() => controller.abort());
        try {
          return await this.options.testProvider(provider, controller.signal);
        } finally {
          subscription.dispose();
        }
      },
    );
    const [english, hebrew] = connectionResultText(descriptor.name, result.category);
    if (result.category === 'connected') await vscode.window.showInformationMessage(this.text(english, hebrew));
    else await vscode.window.showWarningMessage(this.text(english, hebrew));
  }

  private chooseProvider(title: string): Thenable<ProviderId | undefined> {
    const settings = this.options.settings.read().values;
    return vscode.window.showQuickPick(
      PROVIDER_DESCRIPTORS.map((provider) => ({
        label: `${provider.id === settings.assistantProvider ? '$(check) ' : ''}${provider.name}`,
        description: settings.providerProfiles[provider.id].model,
        provider: provider.id,
      })),
      { title, matchOnDescription: true },
    ).then((choice) => choice?.provider);
  }

  private text(english: string, hebrew: string): string {
    return this.options.localize(english, hebrew);
  }
}

function connectionResultText(
  provider: string,
  category: ConnectionTestResult['category'],
): readonly [string, string] {
  switch (category) {
    case 'connected': return [`Voice Input: ${provider} is connected.`, `Voice Input: החיבור אל ${provider} תקין.`];
    case 'not-configured': return [`Voice Input: ${provider} is not configured.`, `Voice Input: ${provider} אינו מוגדר.`];
    case 'consent-required': return [`Voice Input: Review and accept the ${provider} disclosure first.`, `Voice Input: תחילה יש לעיין ולאשר את גילוי הנאות של ${provider}.`];
    case 'unauthorized': return [`Voice Input: ${provider} rejected the credential.`, `Voice Input: ${provider} דחה את פרטי האימות.`];
    case 'rate-limited': return [`Voice Input: ${provider} is rate-limiting requests.`, `Voice Input: ${provider} מגביל כעת את קצב הבקשות.`];
    case 'timed-out': return [`Voice Input: ${provider} connection test timed out.`, `Voice Input: זמן בדיקת החיבור אל ${provider} הסתיים.`];
    case 'cancelled': return [`Voice Input: ${provider} connection test was cancelled.`, `Voice Input: בדיקת החיבור אל ${provider} בוטלה.`];
    case 'rejected': return [`Voice Input: ${provider} is disabled or rejected the test.`, `Voice Input: ${provider} מושבת או דחה את הבדיקה.`];
    case 'unavailable': return [`Voice Input: ${provider} is unavailable.`, `Voice Input: ${provider} אינו זמין.`];
  }
}
