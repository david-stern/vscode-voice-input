import * as vscode from 'vscode';

import type { TargetSnapshot } from '../assistant/context';
import { voiceConfirmationArmed } from './builtinConfirmationGate';
import { promptTargetFingerprint } from './promptBinding';

export interface CustomActionConfirmationPorts {
  pendingAction(): { readonly id: string; readonly label: string } | undefined;
  confirmIfPending(pendingId: string, confirmationId: string): Promise<void> | undefined;
  nextConfirmationId(): string;
  panelGeneration(): number;
  captureTarget(): TargetSnapshot;
  localize(english: string, hebrew: string): string;
}

/**
 * Raises the native confirmation for a pending custom action.
 *
 * The native confirmation is itself the authorizing gesture, so it may be raised while
 * VS Code is unfocused: background listening exists exactly for that case. Focus is not
 * re-checked after the modal (it blurs its own window); instead the binding composed
 * before the modal — workspace trust, panel generation, the prompt target, and the
 * pending action identity — must still hold after it, and an accept faster than the
 * arming delay is treated as a stray keystroke.
 */
export async function confirmPendingCustomAction(
  ports: CustomActionConfirmationPorts,
): Promise<void> {
  const pending = ports.pendingAction();
  if (!pending) return;
  if (!vscode.workspace.isTrusted) return;
  const panelGeneration = ports.panelGeneration();
  const requestedTarget = promptTargetFingerprint(ports.captureTarget());
  const confirm = ports.localize('Run action', 'הפעלת פעולה');
  const openedAt = Date.now();
  const selected = await vscode.window.showWarningMessage(
    ports.localize(
      `Run “${pending.label}” in the current VS Code target?`,
      `להפעיל את „${pending.label}” ביעד הנוכחי של VS Code?`,
    ),
    { modal: true },
    confirm,
  );
  if (selected === confirm
    && voiceConfirmationArmed(Date.now() - openedAt)
    && vscode.workspace.isTrusted
    && panelGeneration === ports.panelGeneration()
    && requestedTarget === promptTargetFingerprint(ports.captureTarget())
    && ports.pendingAction()?.id === pending.id) {
    await ports.confirmIfPending(pending.id, ports.nextConfirmationId());
  }
}
