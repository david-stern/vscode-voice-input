export interface BuiltinConfirmationPrecheck {
  workspaceTrusted: boolean;
}

export interface BuiltinConfirmationOutcome {
  accepted: boolean;
  /** Wall-clock time the modal was open, from just before it was raised to its resolution. */
  elapsedMs: number;
  workspaceTrusted: boolean;
  panelGeneration: number;
  capturedPanelGeneration: number;
}

/**
 * Minimum time a voice-raised confirmation modal must stay open before its affirmative
 * answer counts. The modal may appear while the user is typing in another application and
 * native dialogs default-focus the affirmative button, so a keystroke already in flight
 * (typically Enter) could land as a confirmation the user never read. An accept that
 * resolves faster than a human could plausibly read the prompt is treated as dismissal.
 */
export const VOICE_CONFIRMATION_ARMING_DELAY_MS = 500;

/** True once the modal was open long enough that an accept reflects a deliberate answer. */
export function voiceConfirmationArmed(elapsedMs: number): boolean {
  return elapsedMs >= VOICE_CONFIRMATION_ARMING_DELAY_MS;
}

/**
 * Gate for the native confirmation of a voice-triggered builtin command.
 *
 * Window focus is deliberately not an input. The assistant listens in the background,
 * so the user is expected to be in another application when a command is spoken; the
 * modal itself — which VS Code surfaces through the taskbar or dock — is the gesture
 * that authorizes the action. Workspace trust still gates every dispatch, and typing
 * into other applications stays protected by the separate target focus checks.
 */
export function allowsBuiltinConfirmationPrompt(precheck: BuiltinConfirmationPrecheck): boolean {
  return precheck.workspaceTrusted;
}

/** Trust, panel generation, and the arming delay are re-compared after the modal; focus never is. */
export function acceptsBuiltinConfirmation(outcome: BuiltinConfirmationOutcome): boolean {
  return outcome.accepted
    && voiceConfirmationArmed(outcome.elapsedMs)
    && outcome.workspaceTrusted
    && outcome.panelGeneration === outcome.capturedPanelGeneration;
}
