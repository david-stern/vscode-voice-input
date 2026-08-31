import * as vscode from 'vscode';

import {
  captureTargetSnapshot,
  type RequestedTargetKind,
  type ResolvedTargetKind,
  type TargetSnapshot,
} from '../assistant/context';

/** Captures opaque VS Code target identity and scopes intentional chat-focus transitions. */
export class VsCodeTargetContext {
  private readonly terminalIdentities = new WeakMap<vscode.Terminal, string>();
  private nextTerminalIdentity = 1;
  private transitionDepth = 0;

  get isTransitioning(): boolean {
    return this.transitionDepth > 0;
  }

  capture(
    requestedTarget: RequestedTargetKind = 'here',
    provenFocus: Exclude<ResolvedTargetKind, 'unknown'> | null = null,
  ): TargetSnapshot {
    return captureTargetSnapshot({
      requestedTarget,
      focusedTarget: provenFocus,
      vscodeFocused: vscode.window.state.focused,
      activeTabIdentity: this.activeTabIdentity(),
      activeEditorIdentity: this.editorIdentity(),
      activeTerminalIdentity: this.terminalIdentity(vscode.window.activeTerminal),
    });
  }

  forRequestedTarget(
    snapshot: TargetSnapshot,
    requestedTarget: Exclude<RequestedTargetKind, 'here'>,
  ): TargetSnapshot {
    return { ...snapshot, requestedTarget, resolvedTarget: requestedTarget };
  }

  async duringTransition<T>(operation: () => Promise<T>): Promise<T> {
    this.transitionDepth += 1;
    try {
      return await operation();
    } finally {
      this.transitionDepth -= 1;
    }
  }

  private terminalIdentity(terminal: vscode.Terminal | undefined): string | null {
    if (!terminal) return null;
    let identity = this.terminalIdentities.get(terminal);
    if (!identity) {
      identity = `terminal-${this.nextTerminalIdentity++}`;
      this.terminalIdentities.set(terminal, identity);
    }
    return identity;
  }

  private activeTabIdentity(): string | null {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (!tab) return null;
    const input = tab.input;
    if (input instanceof vscode.TabInputText) return `text:${input.uri.toString(true)}`;
    if (input instanceof vscode.TabInputTextDiff) {
      return `diff:${input.original.toString(true)}:${input.modified.toString(true)}`;
    }
    if (input instanceof vscode.TabInputNotebook) return `notebook:${input.uri.toString(true)}`;
    const inputType = typeof input === 'object' && input !== null
      ? (input as { constructor?: { name?: string } }).constructor?.name ?? 'unknown'
      : typeof input;
    return `${inputType}:${tab.label}`.slice(0, 512);
  }

  private editorIdentity(editor = vscode.window.activeTextEditor): string | null {
    if (!editor) return null;
    return `${editor.document.uri.toString(true)}:${editor.viewColumn ?? 0}`;
  }
}
