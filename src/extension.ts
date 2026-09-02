import type * as vscode from 'vscode';

import { activateVoiceInput } from './platform/runtimeCoordinator';

/** Thin VS Code entrypoint; composition and lifecycle ownership live in platform. */
export function activate(context: vscode.ExtensionContext): Promise<void> {
  return activateVoiceInput(context);
}

export function deactivate(): void {}
