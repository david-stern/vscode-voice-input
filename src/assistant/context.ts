export const REQUESTED_TARGET_KINDS = [
  'here',
  'editor',
  'terminal',
  'chat',
] as const;

export type RequestedTargetKind = (typeof REQUESTED_TARGET_KINDS)[number];
export type ResolvedTargetKind =
  | Exclude<RequestedTargetKind, 'here'>
  | 'focused-control'
  | 'unknown';

/**
 * A bounded description of VS Code state. Callers supply VS Code API-derived
 * identities; this module never inspects a webview DOM or screen coordinates.
 */
export interface TargetSnapshot {
  requestedTarget: RequestedTargetKind;
  resolvedTarget: ResolvedTargetKind;
  /** The focus kind actually proven at capture, independent of the request. */
  focusedTarget: Exclude<ResolvedTargetKind, 'unknown'> | 'unknown';
  vscodeFocused: boolean;
  activeTabIdentity: string | null;
  activeEditorIdentity: string | null;
  activeTerminalIdentity: string | null;
  capturedAt: number;
}

export interface TargetProbe {
  requestedTarget: RequestedTargetKind;
  /**
   * The target known to hold focus. An active editor is deliberately not a
   * focus signal: an editor may remain active while a sidebar chat has focus.
   */
  focusedTarget: Exclude<ResolvedTargetKind, 'unknown'> | null;
  vscodeFocused: boolean;
  activeTabIdentity?: string | null;
  activeEditorIdentity?: string | null;
  activeTerminalIdentity?: string | null;
}

export type TargetRevalidationFailure =
  | 'vscode-not-focused'
  | 'target-unresolved'
  | 'target-kind-changed'
  | 'tab-changed'
  | 'editor-changed'
  | 'terminal-changed';

export type TargetRevalidation =
  | { valid: true; target: ResolvedTargetKind }
  | { valid: false; reason: TargetRevalidationFailure };

const MAX_IDENTITY_LENGTH = 512;

export function captureTargetSnapshot(probe: TargetProbe, now = Date.now()): TargetSnapshot {
  // VS Code does not expose the DOM focus of another extension's webview. A
  // caller may therefore identify the destination only as the generic focused
  // control. This is deliberately not a claim that an active editor is focused.
  const focusedTarget = probe.focusedTarget ?? 'focused-control';
  const resolvedTarget =
    probe.requestedTarget === 'here' ? focusedTarget : probe.requestedTarget;

  return {
    requestedTarget: probe.requestedTarget,
    resolvedTarget,
    focusedTarget,
    vscodeFocused: probe.vscodeFocused,
    activeTabIdentity: boundedIdentity(probe.activeTabIdentity),
    activeEditorIdentity: boundedIdentity(probe.activeEditorIdentity),
    activeTerminalIdentity: boundedIdentity(probe.activeTerminalIdentity),
    capturedAt: now,
  };
}

/** Revalidates the state that gives authority to mutate the selected target. */
export function revalidateTargetSnapshot(
  captured: TargetSnapshot,
  current: TargetSnapshot,
): TargetRevalidation {
  if (!captured.vscodeFocused || !current.vscodeFocused) {
    return { valid: false, reason: 'vscode-not-focused' };
  }
  if (captured.resolvedTarget === 'unknown' || current.resolvedTarget === 'unknown') {
    return { valid: false, reason: 'target-unresolved' };
  }
  if (captured.resolvedTarget !== current.resolvedTarget) {
    return { valid: false, reason: 'target-kind-changed' };
  }
  if (captured.activeTabIdentity !== current.activeTabIdentity) {
    return { valid: false, reason: 'tab-changed' };
  }

  switch (captured.resolvedTarget) {
    case 'editor':
      if (
        captured.activeEditorIdentity === null ||
        captured.activeEditorIdentity !== current.activeEditorIdentity
      ) {
        return { valid: false, reason: 'editor-changed' };
      }
      break;
    case 'terminal':
      if (
        captured.activeTerminalIdentity === null ||
        captured.activeTerminalIdentity !== current.activeTerminalIdentity
      ) {
        return { valid: false, reason: 'terminal-changed' };
      }
      break;
    case 'chat':
      // The supported VS Code API does not expose third-party webview DOM.
      // The active tab identity and resolved target are the safe boundary.
      break;
    case 'focused-control':
      // Active-tab identity and window focus are the strongest supported
      // public signals for an otherwise opaque focused control.
      break;
  }

  return { valid: true, target: captured.resolvedTarget };
}

function boundedIdentity(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, MAX_IDENTITY_LENGTH) : null;
}
