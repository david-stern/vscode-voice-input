import type {
  ControlCenterCommandRow,
  ControlCenterHostMessage,
} from './contracts';
import { CONTROL_CENTER_STRINGS } from './i18n';
import { renderAssistantRoute } from './routes/assistant';
import { renderCommandsRoute } from './routes/commands';
import { renderDiagnosticsRoute } from './routes/diagnostics';
import { renderHomeRoute } from './routes/home';
import { renderPrivacyRoute } from './routes/privacy';
import { renderVoiceRoute } from './routes/voice';
import { createControlCenterShell, updateShellRoute, type ControlCenterShell } from './shell';
import type { SystemSpeechPresentation } from './systemSpeech';

export interface ControlCenterManagementResources {
  providers?: Extract<ControlCenterHostMessage, { type: 'planningProviderState' }>;
  agents?: Extract<ControlCenterHostMessage, { type: 'agentPageState' }>;
  customCommands?: Extract<ControlCenterHostMessage, { type: 'customCommandPageState' }>;
  customCommandDetails?: Extract<ControlCenterHostMessage, { type: 'customCommandDetails' }>;
  setup?: Extract<ControlCenterHostMessage, { type: 'setupState' }>;
  diagnostics?: Extract<ControlCenterHostMessage, { type: 'diagnosticsState' }>;
  systemSpeech?: SystemSpeechPresentation;
}

const EMPTY_SYSTEM_SPEECH: Readonly<SystemSpeechPresentation> = {
  voices: [],
  previewState: 'idle',
};

export class ControlCenterView {
  private shell: ControlCenterShell | undefined;

  constructor(private readonly root: HTMLElement) {}

  render(
    snapshot: Extract<ControlCenterHostMessage, { type: 'stateSnapshot' }>,
    rows: readonly ControlCenterCommandRow[] = [],
    resources: ControlCenterManagementResources = {},
  ): ControlCenterShell {
    const strings = CONTROL_CENTER_STRINGS[snapshot.state.language];
    document.documentElement.lang = snapshot.state.language;
    document.documentElement.dir = snapshot.state.direction;
    document.title = `${strings.routes[snapshot.state.route].title} — ${strings.product}`;
    if (!this.shell) this.shell = createControlCenterShell(this.root, strings);
    const shell = this.shell;
    shell.brand.textContent = strings.product;
    shell.menu.textContent = strings.menu;
    shell.navigation.setAttribute('aria-label', strings.product);
    updateShellRoute(shell, snapshot.state.route, strings);
    shell.auto.hidden = !snapshot.state.effectiveAutoMode;
    shell.auto.textContent = strings.autoActive;
    shell.providerStatus.textContent = providerStatus(snapshot, strings);
    switch (snapshot.state.route) {
      case 'home': renderHomeRoute(
        shell.content, snapshot, strings, resources.setup,
        resources.systemSpeech ?? EMPTY_SYSTEM_SPEECH,
      ); break;
      case 'voice': renderVoiceRoute(
        shell.content, snapshot, strings, resources.setup,
        resources.systemSpeech ?? EMPTY_SYSTEM_SPEECH,
      ); break;
      case 'commands': renderCommandsRoute(
        shell.content, snapshot, rows, strings,
        resources.customCommands, resources.customCommandDetails,
      ); break;
      case 'assistant': renderAssistantRoute(shell.content, snapshot, strings, resources.providers, resources.agents); break;
      case 'privacy': renderPrivacyRoute(shell.content, snapshot, strings); break;
      case 'diagnostics': renderDiagnosticsRoute(shell.content, strings, resources.diagnostics); break;
    }
    return shell;
  }

  get currentShell(): ControlCenterShell | undefined { return this.shell; }
}

function providerStatus(
  snapshot: Extract<ControlCenterHostMessage, { type: 'stateSnapshot' }>,
  strings: (typeof CONTROL_CENTER_STRINGS)['en'],
): string {
  if (snapshot.capabilities.sttProvider === 'soniox' && snapshot.capabilities.sttState === 'ready') {
    return strings.sonioxConfigured;
  }
  if (snapshot.capabilities.systemTtsState === 'ready'
    || snapshot.capabilities.systemTtsState === 'configured-unverified') return strings.systemVoice;
  return strings.notConfigured;
}
