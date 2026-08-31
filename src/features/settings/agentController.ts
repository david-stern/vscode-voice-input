import { builtinAgentTemplates } from '../../agents';
import type { SettingsWebviewMessage } from '../../webview/settings/protocol';
import type { SettingsAgentPort } from './ports';
import type { SettingsStatePublisher } from './statePublisher';

type AgentMessage = Extract<
  SettingsWebviewMessage,
  {
    type:
      | 'settings-agent-create'
      | 'settings-agent-update-profile'
      | 'settings-agent-duplicate'
      | 'settings-agent-set-enabled'
      | 'settings-agent-set-default'
      | 'settings-agent-delete';
  }
>;

export interface SettingsAgentControllerOptions {
  agents: SettingsAgentPort;
  state: SettingsStatePublisher;
  publishMic(): Promise<void> | void;
}

/** Revision-gated agent mutations; raw instructions never cross the webview boundary. */
export class SettingsAgentController {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly options: SettingsAgentControllerOptions) {}

  handle(message: AgentMessage): Promise<void> {
    const run = async () => {
      if (message.agentRevision !== this.options.state.currentAgentRevision) {
        await this.rejectStale();
        return;
      }
      await this.mutate(message);
      this.options.state.agentChanged();
      this.options.state.showNotice('success', 'agent-updated');
      await Promise.all([this.options.state.refresh(), this.options.publishMic()]);
    };
    const pending = this.tail.then(run, run);
    this.tail = pending.then(() => undefined, () => undefined);
    return pending.catch(async () => {
      this.options.state.showNotice('error', 'operation-failed');
      await this.options.state.refresh();
    });
  }

  private async mutate(message: AgentMessage): Promise<void> {
    switch (message.type) {
      case 'settings-agent-create': {
        const source = this.options.agents.list().find(({ templateId }) => (
          templateId === message.templateId
        ));
        if (source) {
          await this.options.agents.duplicate(source.id);
          return;
        }
        const template = builtinAgentTemplates().find(({ templateId }) => (
          templateId === message.templateId
        ));
        if (!template) throw new Error('agent-template-missing');
        await this.options.agents.create(template);
        return;
      }
      case 'settings-agent-update-profile': {
        const existing = this.options.agents.get(message.id);
        if (!existing) throw new Error('agent-not-found');
        const fallback = existing.fallback
          && (existing.fallback.provider !== message.provider || existing.fallback.model !== message.model)
          ? { fallback: existing.fallback }
          : {};
        await this.options.agents.edit(message.id, {
          name: existing.name,
          description: existing.description,
          provider: message.provider,
          model: message.model,
          persona: existing.persona,
          instructions: existing.instructions,
          speech: existing.speech,
          ...fallback,
          enabled: existing.enabled,
          ...(existing.templateId ? { templateId: existing.templateId } : {}),
        });
        return;
      }
      case 'settings-agent-duplicate':
        await this.options.agents.duplicate(message.id);
        return;
      case 'settings-agent-set-enabled':
        await this.options.agents.setEnabled(message.id, message.enabled);
        return;
      case 'settings-agent-set-default':
        await this.options.agents.setDefault(message.id);
        return;
      case 'settings-agent-delete':
        await this.options.agents.delete(message.id);
    }
  }

  private async rejectStale(): Promise<void> {
    this.options.state.showNotice('warning', 'stale-state');
    await this.options.state.refresh();
  }
}
