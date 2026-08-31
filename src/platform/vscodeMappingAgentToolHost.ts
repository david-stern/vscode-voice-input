import * as vscode from 'vscode';

import type {
  MappingAgentToolHost,
  MappingDisposable,
  MappingToolPreparation,
} from '../features/mappings';

/** Registers the two fixed Agent tools and translates their text-only results. */
export class VsCodeMappingAgentToolHost implements MappingAgentToolHost {
  registerListTool(
    name: string,
    invoke: (input: unknown, token: vscode.CancellationToken) => string,
  ): MappingDisposable {
    return vscode.lm.registerTool(name, {
      invoke: (invocation, token) => this.result(invoke(invocation.input, token)),
    });
  }

  registerRunTool(
    name: string,
    handlers: {
      prepare(input: unknown): MappingToolPreparation;
      invoke(
        input: unknown,
        toolInvocationToken: unknown,
        cancellationToken: vscode.CancellationToken,
      ): Promise<string>;
    },
  ): MappingDisposable {
    return vscode.lm.registerTool(name, {
      prepareInvocation: (invocation) => handlers.prepare(invocation.input),
      invoke: async (invocation, token) => this.result(await handlers.invoke(
        invocation.input,
        invocation.toolInvocationToken,
        token,
      )),
    });
  }

  private result(text: string): vscode.LanguageModelToolResult {
    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
  }
}
