import * as vscode from 'vscode';

import {
  BUILTIN_CHAT_FOCUS_COMMAND,
  BUILTIN_CHAT_OPEN_COMMAND,
  builtInChatDraftArguments,
} from '../assistant/chat';
import type { TargetSnapshot } from '../assistant/context';
import {
  injectIntoEditor,
  injectIntoFocusedControl,
} from '../inject';
import { getProviderDescriptor } from '../inference';
import type {
  AssistantActionApprovalPreview,
  AssistantActionHost,
} from '../features/assistant/actionController';
import type { VsCodeTargetContext } from './targetContext';
import type { NativeLocalize } from './nativeLocalization';

/** VS Code mutations used by the target-safe assistant action controller. */
export class VsCodeAssistantActionHost implements AssistantActionHost {
  constructor(
    private readonly target: VsCodeTargetContext,
    private readonly localize: NativeLocalize = (english) => english,
  ) {}

  async confirmAgentAction(preview: AssistantActionApprovalPreview): Promise<boolean> {
    const approve = this.localize('Approve this action', 'אישור הפעולה');
    const provider = getProviderDescriptor(preview.proposal.provider).name;
    const confidence = `${Math.round(preview.proposal.confidence * 100)}%`;
    const expiresIn = Math.max(0, Math.ceil((preview.expiresAt - Date.now()) / 1_000));
    const selected = await vscode.window.showWarningMessage(
      [
        this.localize(`Agent: ${preview.agentName}`, `סוכן: ${preview.agentName}`),
        this.localize(`Provider/model: ${provider} / ${preview.proposal.model}`, `ספק/מודל: ${provider} / ${preview.proposal.model}`),
        this.localize(`Action: ${preview.proposal.action}`, `פעולה: ${preview.proposal.action}`),
        this.localize(`Reason: ${preview.proposal.reason}`, `סיבה: ${preview.proposal.reason}`),
        this.localize(`Confidence: ${confidence}`, `ביטחון: ${confidence}`),
        this.localize(`Exact target evidence: ${preview.proposal.targetEvidence}`, `ראיית יעד מדויקת: ${preview.proposal.targetEvidence}`),
        this.localize(`Permission: ${preview.permissionTier}`, `הרשאה: ${preview.permissionTier}`),
        this.localize(`Expires in: ${expiresIn}s`, `תוקף האישור יפוג בעוד: ${expiresIn} שניות`),
      ].join('\n'),
      { modal: true },
      approve,
    );
    return selected === approve;
  }

  async focusBuiltInChat(targetStillValid: () => boolean): Promise<boolean> {
    const commands = await vscode.commands.getCommands(true);
    if (!commands.includes(BUILTIN_CHAT_OPEN_COMMAND)) {
      throw new Error('The built-in VS Code chat focus command is unavailable.');
    }
    if (!targetStillValid()) return false;
    await this.target.duringTransition(async () => {
      await vscode.commands.executeCommand(BUILTIN_CHAT_OPEN_COMMAND);
      if (targetStillValid() && commands.includes(BUILTIN_CHAT_FOCUS_COMMAND)) {
        await vscode.commands.executeCommand(BUILTIN_CHAT_FOCUS_COMMAND);
      }
      await delay(120);
    });
    return targetStillValid();
  }

  async prepareBuiltInChatDraft(
    text: string,
    targetStillValid: () => boolean,
  ): Promise<TargetSnapshot | undefined> {
    const commands = await vscode.commands.getCommands(true);
    if (!commands.includes(BUILTIN_CHAT_OPEN_COMMAND)) {
      throw new Error('The built-in VS Code chat draft command is unavailable.');
    }
    if (!targetStillValid()) return undefined;
    await this.target.duringTransition(async () => {
      await vscode.commands.executeCommand(
        BUILTIN_CHAT_OPEN_COMMAND,
        builtInChatDraftArguments(text),
      );
      if (targetStillValid() && commands.includes(BUILTIN_CHAT_FOCUS_COMMAND)) {
        await vscode.commands.executeCommand(BUILTIN_CHAT_FOCUS_COMMAND);
      }
      await delay(120);
    });
    if (!targetStillValid()) return undefined;
    // Command success proves supported draft preparation, not third-party DOM focus.
    return this.target.capture();
  }

  async hasCommand(commandId: string): Promise<boolean> {
    return (await vscode.commands.getCommands(true)).includes(commandId);
  }

  executeCommand(commandId: string, ...args: unknown[]): Thenable<unknown> {
    return vscode.commands.executeCommand(commandId, ...args);
  }

  activeTerminal(): vscode.Terminal | undefined {
    return vscode.window.activeTerminal;
  }

  hasActiveEditor(): boolean {
    return vscode.window.activeTextEditor !== undefined;
  }

  async injectIntoEditor(text: string, targetStillValid: () => boolean): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    return editor && targetStillValid() ? injectIntoEditor(editor, text) : false;
  }

  injectIntoFocusedControl(
    text: string,
    targetStillValid: () => boolean,
  ): Promise<boolean> {
    return injectIntoFocusedControl(text, targetStillValid);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
