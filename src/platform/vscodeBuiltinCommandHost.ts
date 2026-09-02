import { createHash } from 'node:crypto';
import * as vscode from 'vscode';

import type {
  BuiltinCommandDefinition,
  BuiltinCommandHost,
  BuiltinSlotValues,
  BuiltinTargetSnapshot,
  WorkspaceFileCandidate,
} from '../commands';
import { BuiltinTargetChangedError, MAX_FILE_CANDIDATES } from '../commands';

/** Public VS Code API/allowlisted-command adapter. It registers no commands. */
export class VsCodeBuiltinCommandHost implements BuiltinCommandHost {
  async captureTarget(definition: BuiltinCommandDefinition): Promise<BuiltinTargetSnapshot> {
    return this.currentSnapshot(definition);
  }

  private currentSnapshot(definition: BuiltinCommandDefinition): BuiltinTargetSnapshot {
    const editor = vscode.window.activeTextEditor;
    const payload = {
      commandId: definition.id,
      workspaceTrusted: vscode.workspace.isTrusted,
      remoteName: vscode.env.remoteName ?? null,
      workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.toString()).sort(),
      editor: editor ? {
        uri: editor.document.uri.toString(),
        version: editor.document.version,
        lineCount: editor.document.lineCount,
        selections: editor.selections.map((selection) => [
          selection.anchor.line,
          selection.anchor.character,
          selection.active.line,
          selection.active.character,
        ]),
      } : null,
    };
    return {
      fingerprint: digest(payload),
      workspaceTrusted: payload.workspaceTrusted,
      ...(vscode.env.remoteName === undefined ? {} : { remoteName: vscode.env.remoteName }),
    };
  }

  async isAvailable(definition: BuiltinCommandDefinition): Promise<boolean> {
    if (!vscode.workspace.isTrusted) return false;
    if (definition.availability.remote === false && vscode.env.remoteName !== undefined) return false;
    if (definition.executorId === 'api.editor.find') {
      return vscode.window.activeTextEditor !== undefined
        && (await vscode.commands.getCommands(true)).includes('editor.actions.findWithArgs');
    }
    if (definition.executorId.startsWith('api.editor.')) {
      return vscode.window.activeTextEditor !== undefined;
    }
    if (definition.executorId === 'api.workspace.find') {
      return (vscode.workspace.workspaceFolders?.length ?? 0) > 0
        && (await vscode.commands.getCommands(true)).includes('workbench.action.findInFiles');
    }
    const required = definition.availability.requiredCommand;
    return !required || (await vscode.commands.getCommands(true)).includes(required);
  }

  async workspaceFileCandidates(): Promise<readonly WorkspaceFileCandidate[]> {
    const uris = await vscode.workspace.findFiles(
      '**/*',
      '**/{.git,node_modules,out,dist}/**',
      MAX_FILE_CANDIDATES + 1,
    );
    if (uris.length > MAX_FILE_CANDIDATES) return [];
    return uris.map((uri) => {
      const relativePath = vscode.workspace.asRelativePath(uri, false).replace(/\\/gu, '/');
      return Object.freeze({
        id: uri.toString(),
        label: relativePath.split('/').pop() ?? relativePath,
        relativePath,
      });
    });
  }

  async execute(
    definition: BuiltinCommandDefinition,
    slots: BuiltinSlotValues,
    expectedTargetFingerprint: string,
  ): Promise<void> {
    if (this.currentSnapshot(definition).fingerprint !== expectedTargetFingerprint) {
      throw new BuiltinTargetChangedError();
    }
    switch (definition.executorId) {
      case 'api.editor.openWorkspaceFile':
        await this.openWorkspaceFile(slots.file);
        return;
      case 'api.editor.goToLine':
        this.goToLine(slots.line);
        return;
      case 'api.editor.find':
        await vscode.commands.executeCommand('editor.actions.findWithArgs', {
          searchString: requireString(slots.query),
        });
        return;
      case 'api.workspace.find':
        await vscode.commands.executeCommand('workbench.action.findInFiles', {
          query: requireString(slots.query),
        });
        return;
      default:
        if (definition.availability.requiredCommand !== definition.executorId) {
          throw new TypeError('unknown builtin executor');
        }
        await vscode.commands.executeCommand(definition.executorId);
    }
  }

  private async openWorkspaceFile(value: unknown): Promise<void> {
    if (!plainFileCandidate(value)) throw new TypeError('invalid workspace file slot');
    const current = await this.workspaceFileCandidates();
    const candidate = current.find((entry) =>
      entry.id === value.id
      && entry.relativePath === value.relativePath
      && entry.label === value.label,
    );
    if (!candidate) throw new TypeError('workspace file changed');
    const uri = vscode.Uri.parse(candidate.id, true);
    if (!vscode.workspace.getWorkspaceFolder(uri)) throw new TypeError('file outside workspace');
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
  }

  private goToLine(value: unknown): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || typeof value !== 'number' || !Number.isSafeInteger(value)) {
      throw new TypeError('invalid line slot');
    }
    if (value < 1 || value > editor.document.lineCount) throw new RangeError('line changed');
    const position = new vscode.Position(value - 1, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }
}

function requireString(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new TypeError('invalid string slot');
  return value;
}

function plainFileCandidate(value: unknown): value is WorkspaceFileCandidate {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === 'id,label,relativePath'
    && typeof (value as WorkspaceFileCandidate).id === 'string'
    && typeof (value as WorkspaceFileCandidate).label === 'string'
    && typeof (value as WorkspaceFileCandidate).relativePath === 'string';
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
