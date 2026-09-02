import type { SettingsFeature, SettingsViewPort } from '../features/settings';
import type {
  ControlCenterBrowserMessage,
} from '../webview/controlCenter/contracts';
import type {
  SettingsViewState,
  SettingsWebviewMessage,
} from '../webview/settings/protocol';

type PlanningProviderIntent = Extract<
  ControlCenterBrowserMessage,
  { type: 'planningProviderIntent' }
>;
type AgentManagementIntent = Extract<
  ControlCenterBrowserMessage,
  { type: 'agentManagementIntent' }
>;

/**
 * Adapts Control Center presentation intents to the existing revision-gated
 * Settings facade. Credentials and consent still cross native host prompts;
 * this bridge caches only the already allowlisted Settings projection.
 */
export class ControlCenterManagementBridge {
  readonly view: SettingsViewPort;
  private latestState: SettingsViewState | undefined;

  constructor(
    delegate: SettingsViewPort,
    private readonly feature: () => SettingsFeature | undefined,
  ) {
    this.view = {
      postState: (state) => {
        this.latestState = state;
        return delegate.postState(state);
      },
    };
  }

  async planningProvider(message: PlanningProviderIntent): Promise<void> {
    const state = await this.state();
    let routed: SettingsWebviewMessage | undefined;
    if (message.operation === 'select') {
      routed = {
        type: 'settings-provider-select',
        providerRevision: state.providers.revision,
        provider: message.provider,
      };
    } else if (message.provider !== 'off' && message.operation === 'save-profile'
      && message.enabled !== undefined && message.model !== undefined) {
      routed = {
        type: 'settings-provider-profile',
        providerRevision: state.providers.revision,
        provider: message.provider,
        enabled: message.enabled,
        model: message.model,
      };
    } else if (message.provider !== 'off') {
      const provider = state.providers.items.find(({ id }) => id === message.provider);
      if (!provider) return;
      if (message.operation === 'set-credential'
        || message.operation === 'replace-credential'
        || message.operation === 'clear-credential') {
        routed = {
          type: 'settings-provider-credential',
          operationRevision: nextRevision(provider.credential.operationRevision),
          provider: message.provider,
          action: message.operation === 'clear-credential'
            ? 'clear'
            : message.operation === 'replace-credential' ? 'replace' : 'set',
        };
      } else if (message.operation === 'test' || message.operation === 'cancel-test') {
        routed = {
          type: 'settings-provider-test',
          operationRevision: nextRevision(provider.test.operationRevision),
          provider: message.provider,
          action: message.operation === 'test' ? 'start' : 'cancel',
        };
      } else if (message.operation === 'review-consent'
        || message.operation === 'revoke-consent') {
        routed = {
          type: 'settings-consent-action',
          consentRevision: state.privacy.consentRevision,
          consent: message.provider,
          action: message.operation === 'review-consent' ? 'acknowledge' : 'revoke',
        };
      }
    }
    if (routed) await this.route(routed);
  }

  async agentManagement(message: AgentManagementIntent): Promise<void> {
    const state = await this.state();
    const agentRevision = state.agents.revision;
    let routed: SettingsWebviewMessage | undefined;
    if (message.operation === 'create' && message.templateId) {
      routed = { type: 'settings-agent-create', agentRevision, templateId: message.templateId };
    } else if (message.operation === 'update-profile'
      && message.id && message.provider && message.model) {
      routed = {
        type: 'settings-agent-update-profile',
        agentRevision,
        id: message.id,
        provider: message.provider,
        model: message.model,
      };
    } else if (message.operation === 'set-enabled'
      && message.id && message.enabled !== undefined) {
      routed = {
        type: 'settings-agent-set-enabled',
        agentRevision,
        id: message.id,
        enabled: message.enabled,
      };
    } else if (message.id && message.operation === 'set-default') {
      routed = { type: 'settings-agent-set-default', agentRevision, id: message.id };
    } else if (message.id && message.operation === 'duplicate') {
      routed = { type: 'settings-agent-duplicate', agentRevision, id: message.id };
    } else if (message.id && message.operation === 'delete') {
      routed = { type: 'settings-agent-delete', agentRevision, id: message.id };
    }
    if (routed) await this.route(routed);
  }

  private async state(): Promise<SettingsViewState> {
    const feature = this.feature();
    if (!feature) throw new Error('settings management is unavailable');
    if (!this.latestState) await feature.refresh();
    if (!this.latestState) throw new Error('settings projection is unavailable');
    return this.latestState;
  }

  private async route(message: SettingsWebviewMessage): Promise<void> {
    const feature = this.feature();
    if (!feature) throw new Error('settings management is unavailable');
    await feature.route(message);
  }
}

function nextRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError('settings operation revision cannot advance');
  }
  return value + 1;
}
