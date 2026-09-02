import { createHash } from 'node:crypto';
import * as vscode from 'vscode';

import type { TargetSnapshot } from '../assistant/context';
import {
  BUILTIN_COMMAND_CATALOG,
  BuiltinActionController,
  BuiltinCommandExecutor,
  BuiltinOverrideStore,
  applyBuiltinOverride,
  matchBuiltinCommand,
  type BuiltinActionDecision,
  type BuiltinCommandDefinition,
  type BuiltinMatchResult,
} from '../commands';
import type { AutoModeAuthorityCache } from '../config';
import type { BuiltinVoiceIntegration } from '../features/mappings';
import type { ControlCenterCommandRow } from '../webview/controlCenter/contracts';
import { filterBuiltinCommands } from './builtinCommandFilter';
import { VsCodeBuiltinCommandHost } from './vscodeBuiltinCommandHost';
import { VsCodeGitHost } from './vscodeGitHost';

export interface BuiltinVoiceCoordinatorOptions {
  storage: vscode.Memento;
  authority: AutoModeAuthorityCache;
  localize(english: string, hebrew: string): string;
  speak(message: string): void;
  publish(): Promise<void> | void;
  panelGeneration(): number;
}

/** Coordinates the fixed catalog, typed hosts, overrides and native confirmations. */
export class BuiltinVoiceCoordinator implements BuiltinVoiceIntegration {
  private readonly commandHost = new VsCodeBuiltinCommandHost();
  private readonly gitHost = new VsCodeGitHost();
  private readonly overrides: BuiltinOverrideStore;
  private readonly actions: BuiltinActionController;

  constructor(private readonly options: BuiltinVoiceCoordinatorOptions) {
    this.overrides = new BuiltinOverrideStore(options.storage);
    this.overrides.load();
    const executor = new BuiltinCommandExecutor(
      this.commandHost,
      this.gitHost,
      options.authority,
    );
    this.actions = new BuiltinActionController(executor, options.authority, {
      confirm: (definition) => this.confirmNative(definition),
    }, {
      contextFingerprint: () => this.authorityContextFingerprint(),
    });
  }

  get pendingSummary() { return this.actions.pendingSummary; }

  isKnownCommandId(commandId: string): boolean {
    return BUILTIN_COMMAND_CATALOG.some(({ id }) => id === commandId);
  }

  effectiveCatalog(): readonly BuiltinCommandDefinition[] {
    return BUILTIN_COMMAND_CATALOG.map((definition) => (
      applyBuiltinOverride(definition, this.overrides.get(definition.id))
    ));
  }

  async matchPhrase(postWakeText: string): Promise<BuiltinMatchResult> {
    const catalog = this.effectiveCatalog();
    const [workspaceFiles, existingRefs] = await Promise.all([
      this.commandHost.workspaceFileCandidates().catch(() => []),
      this.gitHost.existingRefs().catch(() => []),
    ]);
    const match = matchBuiltinCommand(postWakeText, {
      documentLineCount: vscode.window.activeTextEditor?.document.lineCount,
      workspaceFiles,
      existingRefs,
      isAvailable: (definition) => this.availableWithoutDispatch(definition),
    }, catalog);
    if (match.status !== 'matched') return match;
    const host = match.definition.category === 'git' ? this.gitHost : this.commandHost;
    return await host.isAvailable(match.definition) ? match : { status: 'unavailable' };
  }

  async request(
    match: Extract<BuiltinMatchResult, { status: 'matched' }>,
  ): Promise<void> {
    await this.announce(await this.actions.request(match));
  }

  async confirmPending(): Promise<void> {
    await this.announce(await this.actions.confirmPending());
  }

  cancel(): void { this.actions.cancel(); }
  dispose(): void { this.actions.dispose(); }

  async commandRows(filter: string, page: number): Promise<{
    filteredCount: number;
    rows: ControlCenterCommandRow[];
  }> {
    const language = this.options.localize('en', 'he') as 'en' | 'he';
    const filtered = filterBuiltinCommands(
      this.effectiveCatalog(), filter, language,
      (commandId) => this.overrides.get(commandId) !== undefined,
    );
    const selected = filtered.slice((page - 1) * 25, page * 25);
    const rows = await Promise.all(selected.map(async (definition) => ({
      commandId: definition.id,
      enabled: definition.enabledByDefault,
      availability: !definition.enabledByDefault
        ? 'blocked' as const
        : await this.hostFor(definition).isAvailable(definition)
          ? 'available' as const
          : 'unavailable' as const,
      overridden: this.overrides.get(definition.id) !== undefined,
      primaryPhrase: definition.phrases[language][0] ?? '',
      localizedLabel: definition.label[language],
      slotShortcutSummary: slotSummary(definition),
    })));
    return { filteredCount: filtered.length, rows };
  }

  commandDetails(commandId: string) {
    const definition = this.effectiveCatalog().find(({ id }) => id === commandId);
    if (!definition) return undefined;
    const language = this.options.localize('en', 'he') as 'en' | 'he';
    return {
      commandId: definition.id,
      phrases: [...definition.phrases[language]],
      slotSummary: slotSummary(definition),
      executorLabel: definition.category === 'git' ? 'VS Code Git API' : 'VS Code API',
      enabled: definition.enabledByDefault,
    };
  }

  async edit(
    commandId: string,
    operation: 'set-enabled' | 'replace-phrases' | 'reset',
    value?: boolean | string[],
  ): Promise<void> {
    const definition = this.effectiveCatalog().find(({ id }) => id === commandId);
    if (!definition) throw new TypeError('unknown builtin command');
    if (operation === 'reset') {
      await this.overrides.reset(commandId);
    } else if (operation === 'set-enabled' && typeof value === 'boolean') {
      await this.overrides.set(commandId, { ...this.overrides.get(commandId), enabled: value });
    } else if (operation === 'replace-phrases' && Array.isArray(value)) {
      const language = this.options.localize('en', 'he') as 'en' | 'he';
      await this.overrides.set(commandId, {
        ...this.overrides.get(commandId),
        phrases: { ...definition.phrases, [language]: value },
      });
    } else {
      throw new TypeError('invalid builtin command edit');
    }
    this.cancel();
    await this.options.publish();
  }

  private hostFor(definition: BuiltinCommandDefinition) {
    return definition.category === 'git' ? this.gitHost : this.commandHost;
  }

  private availableWithoutDispatch(definition: BuiltinCommandDefinition): boolean {
    return definition.enabledByDefault
      && vscode.workspace.isTrusted
      && !(vscode.env.remoteName && definition.availability.remote === false);
  }

  private authorityContextFingerprint(): string {
    const panelGeneration = this.options.panelGeneration();
    if (!Number.isSafeInteger(panelGeneration) || panelGeneration < 0) return '';
    return createHash('sha256').update(JSON.stringify({
      panelGeneration,
      workspaceTrusted: vscode.workspace.isTrusted,
      windowFocused: vscode.window.state.focused,
    })).digest('hex');
  }

  private async confirmNative(definition: BuiltinCommandDefinition): Promise<boolean> {
    if (!vscode.workspace.isTrusted || !vscode.window.state.focused) return false;
    const panelGeneration = this.options.panelGeneration();
    const confirm = this.options.localize('Run command', 'הפעלת פקודה');
    const selected = await vscode.window.showWarningMessage(
      this.options.localize(
        `Run “${definition.label.en}” in the current VS Code target?`,
        `להפעיל את „${definition.label.he}” ביעד הנוכחי של VS Code?`,
      ),
      { modal: true },
      confirm,
    );
    return selected === confirm
      && vscode.workspace.isTrusted
      && vscode.window.state.focused
      && panelGeneration === this.options.panelGeneration();
  }

  private async announce(decision: BuiltinActionDecision): Promise<void> {
    if (decision.status === 'confirmation-required') {
      this.options.speak(this.options.localize(
        `“${decision.summary.label.en}” needs your separate native confirmation.`,
        `„${decision.summary.label.he}” דורשת אישור נפרד בחלון מקורי.`,
      ));
    } else if (decision.status === 'executed') {
      this.options.speak(decision.result.ok
        ? this.options.localize('Command completed.', 'הפקודה הושלמה.')
        : this.options.localize(
          `Command stopped safely (${decision.result.reason}).`,
          `הפקודה הופסקה בבטחה (${decision.result.reason}).`,
        ));
    } else {
      this.options.speak(this.options.localize(
        'The command is not available for the current target.',
        'הפקודה אינה זמינה עבור היעד הנוכחי.',
      ));
    }
    await this.options.publish();
  }
}

export function targetFingerprint(snapshot: TargetSnapshot): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

function slotSummary(definition: BuiltinCommandDefinition): string {
  return definition.slots.map(({ name, kind }) => `${name}: ${kind}`).join(', ');
}
