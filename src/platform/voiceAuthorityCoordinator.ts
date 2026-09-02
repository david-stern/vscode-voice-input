import { createHash } from 'node:crypto';
import * as vscode from 'vscode';

import {
  AUTO_MODE_CONSENT_VERSION,
  AutoModeAuthorityCache,
  AutoModeService,
  SONIOX_REMOTE_CONSENT_VERSION,
  SonioxRemoteConsentService,
  TranscriptionProviderMigration,
  enableAutoModeWithNativePrompt,
  requestSonioxConsentWithNativePrompt,
  type CredentialService,
  type SettingsRepository,
} from '../config';
import { TranscriptionService } from '../features/recording';
import { SpeechProviderRegistry } from '../speech/providerRegistry';
import type { AssistantTargetPort } from '../features/assistant';
import { createSonioxWebSocketTransportFactory } from '../providers';

const AUTO_POLICY_FINGERPRINT = 'voice-input-auto-policy-v1';

export interface VoiceAuthorityCoordinatorOptions {
  context: vscode.ExtensionContext;
  settings: SettingsRepository;
  credentials: CredentialService;
  legacyGlobalStateKeys: readonly string[];
  target: AssistantTargetPort;
  panelGeneration(): number;
  localize(english: string, hebrew: string): string;
  publish(): Promise<void> | void;
  onAutoEffective(effective: boolean): void;
  log(message: string): void;
}

/** Owns local receipts and the provider registry; no browser receives authority fields. */
export class VoiceAuthorityCoordinator implements vscode.Disposable {
  readonly autoService: AutoModeService;
  readonly autoAuthority: AutoModeAuthorityCache;
  readonly sonioxConsent: SonioxRemoteConsentService;
  readonly speechProviders: SpeechProviderRegistry;
  readonly transcriptions: TranscriptionService;
  private subscriptions: { dispose(): void }[] = [];
  private selectedProvider: ReturnType<SettingsRepository['read']>['values']['transcriptionProvider'];
  private sonioxCredentialEpoch = -1;
  private sonioxCredentialRefreshGeneration = 0;
  private coordinatorAutoWrite = 0;

  constructor(private readonly options: VoiceAuthorityCoordinatorOptions) {
    this.selectedProvider = options.settings.read().values.transcriptionProvider;
    this.autoService = new AutoModeService(
      options.context.globalState,
      options.context.secrets,
    );
    this.autoAuthority = new AutoModeAuthorityCache(this.autoService);
    this.sonioxConsent = new SonioxRemoteConsentService(
      options.context.globalState,
      options.context.secrets,
      () => ({
        selection: options.settings.read().values.transcriptionProvider,
        profileIdentity: options.context.globalStorageUri.toString(true),
        credentialRevision: this.sonioxCredentialEpoch,
        focused: vscode.window.state.focused,
        panelGeneration: options.panelGeneration(),
      }),
    );
    this.speechProviders = new SpeechProviderRegistry({
      selection: {
        read: () => options.settings.read().values.transcriptionProvider,
        onDidChange: (listener) => options.settings.onProviderAuthorityChanged(listener),
      },
      authority: this.sonioxConsent,
      credentials: options.credentials,
      configuration: () => {
        const settings = options.settings.read().values;
        return { model: settings.sttModel, languageHint: settings.languageHint };
      },
      transportFactory: createSonioxWebSocketTransportFactory(),
    });
    this.transcriptions = new TranscriptionService({ registry: this.speechProviders });
  }

  async initialize(): Promise<void> {
    const migration = new TranscriptionProviderMigration({
      state: this.options.context.globalState,
      settings: this.options.settings,
      credentials: this.options.credentials,
      currentVersion: String(this.options.context.extension.packageJSON.version),
      legacyInstallEvidence: () => this.legacyInstallEvidence(),
    });
    try {
      const result = await migration.migrate();
      this.options.log(`transcription provider migration: ${result.status}`);
    } catch {
      this.options.log('transcription provider migration failed safely');
    }
    this.selectedProvider = this.options.settings.read().values.transcriptionProvider;
    this.subscriptions = [
      this.autoService.onWillChange(() => {
        this.options.onAutoEffective(false);
        void this.options.publish();
      }),
      this.options.credentials.onDidInvalidate((event) => {
        if (event.provider === 'soniox') {
          void this.refreshSonioxCredentialEpoch().then(() => this.options.publish());
          void this.sonioxConsent.revoke();
        }
      }),
      this.options.settings.onProviderAuthorityChanged(() => this.settingsChanged()),
      vscode.window.onDidChangeWindowState(() => this.sonioxConsent.invalidatePendingPrompt()),
      vscode.window.onDidChangeActiveTextEditor(() => this.sonioxConsent.invalidatePendingPrompt()),
      vscode.window.onDidChangeTextEditorSelection(() => this.sonioxConsent.invalidatePendingPrompt()),
    ];
    await this.refreshSonioxCredentialEpoch();
    if (!this.options.settings.read().values.autoMode || !vscode.workspace.isTrusted) {
      await this.autoService.disable();
    }
    await this.refreshAuto();
  }

  async enableAuto(): Promise<boolean> {
    const enable = this.options.localize('Enable Auto Mode', 'הפעלת מצב Auto');
    const enabled = await enableAutoModeWithNativePrompt(
      this.autoService,
      this.autoContext(),
      {
        confirmEnable: async () => await vscode.window.showWarningMessage(
          this.options.localize(
            'Auto Mode lets enabled built-in and custom voice actions run without Voice Input confirmation. Workspace trust, validation, target rechecks, and VS Code/Git prompts remain enforced.',
            'מצב Auto מאפשר לפעולות קוליות מובנות ומותאמות שהופעלו לרוץ ללא אישור של Voice Input. אמון סביבת העבודה, אימות, בדיקות יעד והודעות VS Code/Git נשארים בתוקף.',
          ),
          { modal: true },
          enable,
        ) === enable,
      },
      () => this.autoContext(),
    );
    if (enabled) await this.writeAutoRequest(true);
    await this.refreshAuto();
    return enabled;
  }

  async disableAuto(): Promise<void> {
    await this.autoService.disable();
    await this.writeAutoRequest(false);
    await this.refreshAuto();
  }

  async requestSonioxConsent(): Promise<boolean> {
    const confirm = this.options.localize('Allow remote processing', 'אישור עיבוד מרוחק');
    const granted = await requestSonioxConsentWithNativePrompt(this.sonioxConsent, {
      confirmRemoteProcessing: async () => await vscode.window.showWarningMessage(
        this.options.localize(
          'Soniox transcription sends microphone audio to Soniox for remote processing. Allow this on this machine and VS Code profile?',
          'תמלול Soniox שולח שמע מהמיקרופון אל Soniox לעיבוד מרוחק. לאפשר זאת במחשב ובפרופיל VS Code הזה?',
        ),
        { modal: true },
        confirm,
      ) === confirm,
    });
    await this.options.publish();
    return granted;
  }

  async selectProvider(provider: 'none' | 'soniox'): Promise<void> {
    if (this.options.settings.read().values.transcriptionProvider !== provider) {
      await this.sonioxConsent.revoke();
      await this.options.settings.update({ transcriptionProvider: provider });
    }
    await this.options.publish();
  }

  async revokeSonioxConsent(): Promise<void> {
    await this.sonioxConsent.revoke();
    await this.options.publish();
  }

  async refreshAuto(): Promise<void> {
    const snapshot = await this.autoAuthority.refresh(this.autoContext());
    this.options.onAutoEffective(snapshot.effective);
    await this.options.publish();
  }

  configurationChanged(): void {
    this.settingsChanged();
  }

  workspaceContextChanged(): void {
    this.sonioxConsent.invalidatePendingPrompt();
    void this.refreshAuto();
  }

  dispose(): void {
    for (const subscription of this.subscriptions.splice(0)) subscription.dispose();
    this.transcriptions.abortAll();
    this.speechProviders.dispose();
    this.sonioxConsent.dispose();
    this.autoAuthority.dispose();
  }

  private settingsChanged(): void {
    const current = this.options.settings.read().values.transcriptionProvider;
    if (current !== this.selectedProvider) {
      this.selectedProvider = current;
      void this.sonioxConsent.revoke();
    }
    if (!this.options.settings.read().values.autoMode && this.coordinatorAutoWrite === 0) {
      void this.autoService.disable();
    }
    void this.refreshAuto();
  }

  private autoContext() {
    const target = this.options.target.capture();
    return {
      workspaceTrusted: vscode.workspace.isTrusted,
      consentVersion: AUTO_MODE_CONSENT_VERSION,
      policyFingerprint: AUTO_POLICY_FINGERPRINT,
      targetFingerprint: createHash('sha256').update(JSON.stringify({
        target,
        focused: vscode.window.state.focused,
        panelGeneration: this.options.panelGeneration(),
        consentVersion: SONIOX_REMOTE_CONSENT_VERSION,
      })).digest('hex'),
    };
  }

  private legacyInstallEvidence(): boolean {
    if (this.options.legacyGlobalStateKeys.some((key) => key.startsWith('voiceInput.'))) {
      return true;
    }
    return this.options.settings.hasExplicitGlobal('sttModel')
      || this.options.settings.hasExplicitGlobal('assistantSpeechEnabled')
      || this.options.settings.hasExplicitGlobal('assistantSpeechVoiceUri')
      || this.options.settings.hasExplicitGlobal('audioDevice');
  }

  private async writeAutoRequest(value: boolean): Promise<void> {
    this.coordinatorAutoWrite += 1;
    try {
      await this.options.settings.update({ autoMode: value });
    } finally {
      this.coordinatorAutoWrite -= 1;
    }
  }

  private async refreshSonioxCredentialEpoch(): Promise<void> {
    const generation = nextCredentialEpoch(this.sonioxCredentialRefreshGeneration);
    this.sonioxCredentialRefreshGeneration = generation;
    this.sonioxCredentialEpoch = -1;
    try {
      const revision = await this.options.credentials.persistentRevision('soniox');
      if (generation === this.sonioxCredentialRefreshGeneration) {
        this.sonioxCredentialEpoch = revision;
      }
    } catch {
      if (generation === this.sonioxCredentialRefreshGeneration) {
        this.options.log('Soniox credential epoch unavailable; remote consent remains closed');
      }
    }
  }
}

function nextCredentialEpoch(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER
    ? value + 1
    : -1;
}
