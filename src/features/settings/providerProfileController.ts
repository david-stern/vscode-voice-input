import type { SettingsRepository, VoiceInputSettings } from '../../config';
import type { SettingsWebviewMessage } from '../../webview/settings/protocol';
import type { SettingsStatePublisher } from './statePublisher';

type ProviderProfileMessage = Extract<
  SettingsWebviewMessage,
  { type: 'settings-provider-select' | 'settings-provider-profile' }
>;

export interface SettingsProviderProfileControllerOptions {
  settings: Pick<SettingsRepository, 'read' | 'update'>;
  state: SettingsStatePublisher;
  beginIntelligenceChange(): number;
  finishIntelligenceChange(token: number): void;
  publishMic(): Promise<void> | void;
}

/** Safe provider selection/profile writer: the browser can never replace an endpoint. */
export class SettingsProviderProfileController {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly options: SettingsProviderProfileControllerOptions) {}

  handle(message: ProviderProfileMessage): Promise<void> {
    const run = async () => {
      if (message.providerRevision !== this.options.state.currentProviderRevision) {
        await this.rejectStale();
        return;
      }
      const patch = message.type === 'settings-provider-select'
        ? { assistantProvider: message.provider }
        : this.profilePatch(message);
      const intelligenceToken = this.options.beginIntelligenceChange();
      try {
        await this.options.settings.update(patch);
      } finally {
        this.options.finishIntelligenceChange(intelligenceToken);
      }
      this.options.state.settingsChanged();
      this.options.state.providerChanged();
      this.options.state.showNotice('success', 'provider-updated');
      await Promise.all([this.options.state.refresh(), this.options.publishMic()]);
    };
    const pending = this.tail.then(run, run);
    this.tail = pending.then(() => undefined, () => undefined);
    return pending.catch(async () => {
      this.options.state.showNotice('error', 'operation-failed');
      await this.options.state.refresh();
    });
  }

  private profilePatch(
    message: Extract<ProviderProfileMessage, { type: 'settings-provider-profile' }>,
  ): Partial<VoiceInputSettings> {
    const profiles = this.options.settings.read().values.providerProfiles;
    return {
      providerProfiles: {
        ...profiles,
        [message.provider]: {
          ...profiles[message.provider],
          enabled: message.enabled,
          model: message.model,
        },
      },
    };
  }

  private async rejectStale(): Promise<void> {
    this.options.state.showNotice('warning', 'stale-state');
    await this.options.state.refresh();
  }
}
