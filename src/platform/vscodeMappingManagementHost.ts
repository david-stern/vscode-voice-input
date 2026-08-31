import * as vscode from 'vscode';

import type { MappingTargetCatalog } from '../assistant';
import type {
  MappingInputOptions,
  MappingManagementHost,
  MappingPickItem,
  MappingPickOptions,
} from '../features/mappings';

/** VS Code dialogs and discovery used by the otherwise host-neutral mapping editor. */
export class VsCodeMappingManagementHost implements MappingManagementHost {
  async pick<T extends MappingPickItem>(
    items: readonly T[],
    options: MappingPickOptions,
  ): Promise<T | undefined> {
    return vscode.window.showQuickPick(items, options);
  }

  async input(options: MappingInputOptions): Promise<string | undefined> {
    return vscode.window.showInputBox(options);
  }

  async discoverTargets(): Promise<MappingTargetCatalog> {
    const commands = await vscode.commands.getCommands(true);
    const tools = vscode.lm.tools.map((tool) => tool.name);
    return { commands: new Set(commands), tools: new Set(tools) };
  }

  async showError(message: string): Promise<void> {
    await vscode.window.showErrorMessage(message);
  }

  async showInformation(message: string): Promise<void> {
    await vscode.window.showInformationMessage(message);
  }

  async confirmWarning(message: string, confirmLabel: string): Promise<boolean> {
    const selected = await vscode.window.showWarningMessage(
      message,
      { modal: true },
      confirmLabel,
    );
    return selected === confirmLabel;
  }
}
