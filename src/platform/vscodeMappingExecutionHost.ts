import * as vscode from 'vscode';

import type {
  JsonObject,
  JsonValue,
  MappingCancellationToken,
  MappingExecutionHost,
} from '../assistant';

/** VS Code runtime adapter for the fail-closed custom mapping executor. */
export class VsCodeMappingExecutionHost implements MappingExecutionHost {
  isWorkspaceTrusted(): boolean {
    return vscode.workspace.isTrusted;
  }

  async getCommandIds(): Promise<readonly string[]> {
    return vscode.commands.getCommands(true);
  }

  getToolNames(): readonly string[] {
    return vscode.lm.tools.map((tool) => tool.name);
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
