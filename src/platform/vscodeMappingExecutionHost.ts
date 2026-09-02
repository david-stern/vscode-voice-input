import * as vscode from 'vscode';

import type {
  JsonObject,
  JsonValue,
  MappingCancellationToken,
  MappingExecutionHost,
} from '../assistant';

/** VS Code runtime adapter for the fail-closed custom mapping executor. */
export class VsCodeMappingExecutionHost implements MappingExecutionHost {
  constructor(
    private readonly authority?: {
      snapshot(): { effective: boolean; epoch: number; fingerprint: string };
    },
    private readonly targetFingerprint?: () => string,
  ) {}

  isWorkspaceTrusted(): boolean {
    return vscode.workspace.isTrusted;
  }

  async getCommandIds(): Promise<readonly string[]> {
    return vscode.commands.getCommands(true);
  }

  getToolNames(): readonly string[] {
    return vscode.lm.tools.map((tool) => tool.name);
  }

  getAuthoritySnapshot() {
    return this.authority?.snapshot() ?? {
      effective: false,
      epoch: 0,
      fingerprint: 'mapping:unconfigured',
    };
  }

  getTargetFingerprint(): string {
    return this.targetFingerprint?.() ?? 'mapping:unconfigured';
  }

  executeCommand(commandId: string, ...args: JsonValue[]): PromiseLike<unknown> {
    return vscode.commands.executeCommand(commandId, ...args);
  }

  invokeTool(
    toolName: string,
    invocation: { input: JsonObject; toolInvocationToken: unknown | undefined },
    token?: MappingCancellationToken,
  ): PromiseLike<unknown> {
    return vscode.lm.invokeTool(
      toolName,
      {
        input: invocation.input,
        toolInvocationToken:
          invocation.toolInvocationToken as vscode.ChatParticipantToolToken | undefined,
      },
      token as vscode.CancellationToken | undefined,
    );
  }
}
