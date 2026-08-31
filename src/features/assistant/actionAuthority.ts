import { createHash } from 'node:crypto';

import type { TargetSnapshot, ResolvedTargetKind } from '../../assistant/context';
import type { DeepSeekPlan } from '../../assistant/deepseek';
import type { AgentActionKind } from '../../agents';

export function authorityAction(
  action: DeepSeekPlan['action'],
  captured: TargetSnapshot,
): AgentActionKind {
  switch (action) {
    case 'answer-only':
    case 'stop-listening':
      return 'answer';
    case 'write-here':
      if (captured.resolvedTarget === 'editor') return 'file-change';
      return writeHereMayTargetTerminal(captured) ? 'terminal' : 'draft';
    case 'write-editor':
      return 'file-change';
    case 'write-chat':
    case 'request-send':
      return 'draft';
    case 'confirm-send':
      return 'send';
    case 'open-terminal':
    case 'write-terminal':
      return 'terminal';
    case 'open-chat':
    case 'open-settings':
    case 'repeat-last':
      return 'command';
  }
}

export function writeHereMayTargetTerminal(snapshot: TargetSnapshot): boolean {
  return snapshot.resolvedTarget === 'terminal'
    || (
      snapshot.resolvedTarget === 'focused-control'
      && snapshot.activeTerminalIdentity !== null
    );
}

export function requestedTargetLabel(
  target: DeepSeekPlan['target'] | ResolvedTargetKind,
): ResolvedTargetKind {
  if (target === 'current') return 'focused-control';
  if (target === 'none') return 'unknown';
  return target;
}

export function actionTargetLabel(
  target: ResolvedTargetKind,
  localize: (english: string, hebrew: string) => string,
): string {
  const labels: Record<ResolvedTargetKind, readonly [string, string]> = {
    'focused-control': ['Focused VS Code control', 'הרכיב הממוקד ב־VS Code'],
    editor: ['Active editor', 'העורך הפעיל'],
    terminal: ['Active terminal', 'המסוף הפעיל'],
    chat: ['Built-in VS Code chat', 'הצ׳אט המובנה של VS Code'],
    unknown: ['Unknown target', 'יעד לא ידוע'],
  };
  return localize(...labels[target]);
}

export function actionTargetEvidence(
  plan: DeepSeekPlan,
  snapshot: TargetSnapshot,
  localize: (english: string, hebrew: string) => string,
): string {
  const requested = plan.target === 'none' || plan.target === 'current'
    ? snapshot.resolvedTarget
    : plan.target;
  return `${actionTargetLabel(requestedTargetLabel(requested), localize)} · ${targetAuthorityFingerprint(snapshot)}`;
}

export function successfulActionFeedback(plan: DeepSeekPlan, outcome: string): string {
  const reason = plan.reason.trim();
  return reason ? `${outcome} ${reason}` : outcome;
}

export function targetAuthorityFingerprint(snapshot: TargetSnapshot): string {
  const parts = [
    snapshot.requestedTarget,
    snapshot.resolvedTarget,
    snapshot.focusedTarget,
    snapshot.vscodeFocused ? 'focused' : 'blurred',
    snapshot.activeTabIdentity ?? '-',
    snapshot.activeEditorIdentity ?? '-',
    snapshot.activeTerminalIdentity ?? '-',
  ];
  return createHash('sha256').update(parts.join('\u001f')).digest('hex');
}
