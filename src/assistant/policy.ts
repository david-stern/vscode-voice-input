import {
  revalidateTargetSnapshot,
  type ResolvedTargetKind,
  type TargetSnapshot,
} from './context';
import {
  policyExplanation as explanation,
  type PolicyExplanation,
} from './policyExplanations';

export type { PolicyExplanation, PolicyReason } from './policyExplanations';

export const SAFE_ASSISTANT_ACTIONS = [
  'write-here',
  'write-editor',
  'write-terminal',
  'write-chat',
  'repeat-last',
  'open-chat',
  'open-terminal',
  'open-settings',
  'request-send',
  'confirm-send',
  'stop-listening',
  'answer-only',
] as const;

export type SafeAssistantAction = (typeof SAFE_ASSISTANT_ACTIONS)[number];

export type MutationInstruction =
  | {
      kind: 'write';
      target: Exclude<ResolvedTargetKind, 'unknown'>;
      text: string;
      /** Always false for terminal insertion; it must never execute a command. */
      terminalAddNewLine: false;
      snapshot: TargetSnapshot;
    }
  | { kind: 'emit-enter'; snapshot: TargetSnapshot };

export type PolicyDecision<T> =
  | { allowed: true; instruction: T; explanation: PolicyExplanation }
  | { allowed: false; explanation: PolicyExplanation };

export interface TerminalTextTarget {
  sendText(text: string, shouldExecute: boolean): void;
}

export interface RepeatableAction {
  action: Extract<
    SafeAssistantAction,
    | 'write-here'
    | 'write-editor'
    | 'write-terminal'
    | 'write-chat'
    | 'open-chat'
    | 'open-terminal'
    | 'open-settings'
    | 'answer-only'
  >;
  text?: string;
}

export interface RepeatedAction extends RepeatableAction {
  /** Always the snapshot supplied to repeatLast, never the old snapshot. */
  snapshot: TargetSnapshot;
}

interface PendingSend {
  snapshot: TargetSnapshot;
  requestUtteranceId: string;
  expiresAt: number;
  requestedAt: number;
  preparedBySupportedChatApi: boolean;
}

interface RememberedAction {
  action: RepeatableAction;
  expiresAt: number;
}

export const MAX_REPEAT_AGE_MS = 5 * 60 * 1_000;
export const DEFAULT_SEND_CONFIRMATION_TTL_MS = 12_000;
export const MAX_ACTION_TEXT_LENGTH = 4_000;

export function isSafeAssistantAction(value: unknown): value is SafeAssistantAction {
  return (
    typeof value === 'string' &&
    (SAFE_ASSISTANT_ACTIONS as readonly string[]).includes(value)
  );
}

export function validateTerminalText(text: string): PolicyExplanation | null {
  const basicFailure = validateText(text);
  if (basicFailure) return basicFailure;
  if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(text)) {
    return explanation('unsafe-terminal-text');
  }
  return null;
}

/** The only supported terminal mutation; the second argument is always false. */
export function insertTerminalText(
  terminal: TerminalTextTarget,
  text: string,
  captured: TargetSnapshot,
  current: TargetSnapshot,
): PolicyDecision<{ kind: 'terminal-text-inserted' }> {
  const revalidated = revalidateTargetSnapshot(captured, current);
  if (!revalidated.valid) {
    return { allowed: false, explanation: explanation(revalidated.reason) };
  }
  if (revalidated.target !== 'terminal') {
    return { allowed: false, explanation: explanation('target-mismatch') };
  }
  const failure = validateTerminalText(text);
  if (failure) return { allowed: false, explanation: failure };
  terminal.sendText(text, false);
  return {
    allowed: true,
    instruction: { kind: 'terminal-text-inserted' },
    explanation: explanation('terminal-text-inserted'),
  };
}

export class SafeActionPolicy {
  private pendingSend: PendingSend | null = null;
  private rememberedAction: RememberedAction | null = null;
  private readonly usedConfirmationIds = new Set<string>();
  private readonly sendConfirmationTtlMs: number;
  private readonly repeatAgeMs: number;

  constructor(options: { sendConfirmationTtlMs?: number; repeatAgeMs?: number } = {}) {
    this.sendConfirmationTtlMs = boundedTtl(
      options.sendConfirmationTtlMs,
      DEFAULT_SEND_CONFIRMATION_TTL_MS,
      DEFAULT_SEND_CONFIRMATION_TTL_MS,
    );
    this.repeatAgeMs = boundedTtl(
      options.repeatAgeMs,
      MAX_REPEAT_AGE_MS,
      MAX_REPEAT_AGE_MS,
    );
  }

  authorizeWrite(
    action: Extract<
      SafeAssistantAction,
      'write-here' | 'write-editor' | 'write-terminal' | 'write-chat'
    >,
    text: string,
    captured: TargetSnapshot,
    current: TargetSnapshot,
  ): PolicyDecision<MutationInstruction> {
    const revalidated = revalidateTargetSnapshot(captured, current);
    if (!revalidated.valid) {
      return { allowed: false, explanation: explanation(revalidated.reason) };
    }

    const expectedTarget = actionTarget(action, captured.resolvedTarget);
    if (expectedTarget === 'unknown' || expectedTarget !== revalidated.target) {
      return { allowed: false, explanation: explanation('target-mismatch') };
    }

    const textFailure =
      expectedTarget === 'terminal' ? validateTerminalText(text) : validateText(text);
    if (textFailure) return { allowed: false, explanation: textFailure };

    return {
      allowed: true,
      instruction: {
        kind: 'write',
        target: expectedTarget,
        text,
        terminalAddNewLine: false,
        snapshot: current,
      },
      explanation: explanation('action-authorized'),
    };
  }

  requestSend(
    snapshot: TargetSnapshot,
    requestUtteranceId: string,
    now = Date.now(),
  ): PolicyDecision<{ kind: 'pending-send'; expiresAt: number }> {
    this.pendingSend = null;
    if (!snapshot.vscodeFocused) {
      return { allowed: false, explanation: explanation('vscode-not-focused') };
    }
    if (
      snapshot.resolvedTarget !== 'chat' ||
      snapshot.focusedTarget !== 'chat' ||
      snapshot.activeTabIdentity === null
    ) {
      return { allowed: false, explanation: explanation('send-target-not-chat') };
    }
    const expiresAt = now + this.sendConfirmationTtlMs;
    this.pendingSend = {
      snapshot,
      requestUtteranceId,
      expiresAt,
      requestedAt: now,
      preparedBySupportedChatApi: false,
    };
    return {
      allowed: true,
      instruction: { kind: 'pending-send', expiresAt },
      explanation: explanation('send-confirmation-required'),
    };
  }

  /** Arms send only after VS Code's documented partial-query API prepared a draft. */
  requestPreparedChatSend(
    snapshot: TargetSnapshot,
    requestUtteranceId: string,
    now = Date.now(),
  ): PolicyDecision<{ kind: 'pending-send'; expiresAt: number }> {
    this.pendingSend = null;
    if (!snapshot.vscodeFocused || snapshot.activeTabIdentity === null) {
      return {
        allowed: false,
        explanation: explanation(snapshot.vscodeFocused ? 'target-unresolved' : 'vscode-not-focused'),
      };
    }
    const expiresAt = now + this.sendConfirmationTtlMs;
    this.pendingSend = {
      snapshot,
      requestUtteranceId,
      expiresAt,
      requestedAt: now,
      preparedBySupportedChatApi: true,
    };
    return {
      allowed: true,
      instruction: { kind: 'pending-send', expiresAt },
      explanation: explanation('send-confirmation-required'),
    };
  }

  confirmSend(
    current: TargetSnapshot,
    confirmationUtteranceId: string,
    now = Date.now(),
  ): PolicyDecision<MutationInstruction> {
    const pending = this.pendingSend;
    this.pendingSend = null;
    if (!pending) {
      return { allowed: false, explanation: explanation('no-pending-send') };
    }
    if (now > pending.expiresAt) {
      return { allowed: false, explanation: explanation('send-confirmation-expired') };
    }
    if (confirmationUtteranceId === pending.requestUtteranceId) {
      return { allowed: false, explanation: explanation('same-utterance-confirmation') };
    }
    if (now <= pending.requestedAt) {
      return { allowed: false, explanation: explanation('confirmation-not-later') };
    }
    if (this.usedConfirmationIds.has(confirmationUtteranceId)) {
      return { allowed: false, explanation: explanation('confirmation-replayed') };
    }
    this.rememberConfirmationId(confirmationUtteranceId);
    const revalidated = revalidateTargetSnapshot(pending.snapshot, current);
    if (!revalidated.valid) {
      return { allowed: false, explanation: explanation(revalidated.reason) };
    }
    if (!pending.preparedBySupportedChatApi && (
      revalidated.target !== 'chat' ||
      current.focusedTarget !== 'chat' ||
      current.activeTabIdentity === null
    )) {
      return { allowed: false, explanation: explanation('send-target-not-chat') };
    }
    return {
      allowed: true,
      instruction: { kind: 'emit-enter', snapshot: current },
      explanation: {
        ...explanation('send-confirmed'),
      },
    };
  }

  cancelPendingSend(): PolicyExplanation {
    this.pendingSend = null;
    return explanation('pending-send-cancelled');
  }

  getPendingSend(now = Date.now()): { expiresAt: number } | null {
    if (!this.pendingSend) return null;
    if (now > this.pendingSend.expiresAt) {
      this.pendingSend = null;
      return null;
    }
    return { expiresAt: this.pendingSend.expiresAt };
  }

  rememberLast(action: RepeatableAction, now = Date.now()): PolicyDecision<{ kind: 'remembered' }> {
    if (!isRepeatableAction(action)) {
      return { allowed: false, explanation: explanation('action-not-allowed') };
    }
    if (action.text !== undefined) {
      const failure = validateText(action.text);
      if (failure) return { allowed: false, explanation: failure };
    }
    if (action.action.startsWith('write-') && action.text === undefined) {
      return { allowed: false, explanation: explanation('empty-text') };
    }
    this.rememberedAction = {
      action: { ...action },
      expiresAt: now + this.repeatAgeMs,
    };
    return {
      allowed: true,
      instruction: { kind: 'remembered' },
      explanation: explanation('action-remembered'),
    };
  }

  repeatLast(
    current: TargetSnapshot,
    now = Date.now(),
  ): PolicyDecision<RepeatedAction> {
    const remembered = this.rememberedAction;
    if (!remembered) {
      return { allowed: false, explanation: explanation('no-repeatable-action') };
    }
    if (now > remembered.expiresAt) {
      this.rememberedAction = null;
      return { allowed: false, explanation: explanation('repeat-action-expired') };
    }
    if (!current.vscodeFocused || current.resolvedTarget === 'unknown') {
      return {
        allowed: false,
        explanation: explanation(
          current.vscodeFocused ? 'target-unresolved' : 'vscode-not-focused',
        ),
      };
    }

    const repeated: RepeatableAction = { ...remembered.action };
    if (repeated.action.startsWith('write-')) {
      repeated.action = writeActionFor(current.resolvedTarget);
      if (current.resolvedTarget === 'terminal' && repeated.text !== undefined) {
        const failure = validateTerminalText(repeated.text);
        if (failure) return { allowed: false, explanation: failure };
      }
    }
    return {
      allowed: true,
      instruction: { ...repeated, snapshot: current },
      explanation: explanation('action-authorized'),
    };
  }

  private rememberConfirmationId(id: string): void {
    this.usedConfirmationIds.add(id);
    if (this.usedConfirmationIds.size > 100) {
      const oldest = this.usedConfirmationIds.values().next().value as string | undefined;
      if (oldest) this.usedConfirmationIds.delete(oldest);
    }
  }
}

function validateText(text: string): PolicyExplanation | null {
  if (!text.trim()) return explanation('empty-text');
  if (text.length > MAX_ACTION_TEXT_LENGTH) return explanation('text-too-long');
  return null;
}

function actionTarget(
  action: Extract<
    SafeAssistantAction,
    'write-here' | 'write-editor' | 'write-terminal' | 'write-chat'
  >,
  here: ResolvedTargetKind,
): ResolvedTargetKind {
  if (action === 'write-here') return here;
  if (action === 'write-editor') return 'editor';
  if (action === 'write-terminal') return 'terminal';
  return 'chat';
}

function writeActionFor(
  target: Exclude<ResolvedTargetKind, 'unknown'>,
): Extract<SafeAssistantAction, 'write-here' | 'write-editor' | 'write-terminal' | 'write-chat'> {
  if (target === 'editor') return 'write-editor';
  if (target === 'terminal') return 'write-terminal';
  if (target === 'focused-control') return 'write-here';
  return 'write-chat';
}

function isRepeatableAction(value: unknown): value is RepeatableAction {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { action?: unknown; text?: unknown };
  const allowed: readonly RepeatableAction['action'][] = [
    'write-here',
    'write-editor',
    'write-terminal',
    'write-chat',
    'open-chat',
    'open-terminal',
    'open-settings',
    'answer-only',
  ];
  return (
    typeof candidate.action === 'string' &&
    allowed.includes(candidate.action as RepeatableAction['action']) &&
    (candidate.text === undefined || typeof candidate.text === 'string')
  );
}

function boundedTtl(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(value, maximum);
}
