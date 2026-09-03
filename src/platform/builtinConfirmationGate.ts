export interface BuiltinConfirmationPrecheck {
  workspaceTrusted: boolean;
}

export interface BuiltinConfirmationOutcome {
  accepted: boolean;
  workspaceTrusted: boolean;
  panelGeneration: number;
  capturedPanelGeneration: number;
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

/** Trust and panel generation are re-compared after the modal; focus never is. */
export function acceptsBuiltinConfirmation(outcome: BuiltinConfirmationOutcome): boolean {
  return outcome.accepted
    && outcome.workspaceTrusted
    && outcome.panelGeneration === outcome.capturedPanelGeneration;
}
