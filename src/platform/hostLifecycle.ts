import * as vscode from 'vscode';

import {
  createHostInvalidationController,
  type HostLifecycleOptions,
} from '../features/commands';

/** Registers VS Code events around the host-neutral invalidation controller. */
export function registerVsCodeHostLifecycle(
  options: HostLifecycleOptions,
): vscode.Disposable[] {
  const controller = createHostInvalidationController(options);
  return [
    vscode.workspace.onDidChangeConfiguration((event) => {
      controller.configurationChanged(
        event.affectsConfiguration('voiceInput'),
        event.affectsConfiguration('voiceInput.audioDevice'),
      );
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => controller.workspaceTrustGranted()),
    vscode.window.onDidChangeWindowState((state) => controller.windowFocusChanged(state.focused)),
    vscode.window.tabGroups.onDidChangeTabs(() => controller.targetChanged()),
    vscode.window.onDidChangeActiveTextEditor(() => controller.targetChanged()),
    vscode.window.onDidChangeActiveTerminal(() => controller.targetChanged()),
  ];
}
