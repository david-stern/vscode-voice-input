import type {
  AssistantResumeSuggestionChoice,
  AssistantSessionUiPort,
  AssistantSettingsPort,
} from './sessionContracts';

export interface AssistantResumeSuggestionOptions {
  settings: AssistantSettingsPort;
  ui: Pick<AssistantSessionUiPort, 'suggestStartupResume'>;
  /** The manual start that triggered the offer must still own the session. */
  isCurrent(): boolean;
}

export type AssistantResumeSuggestionOutcome =
  | 'unsupported'
  | 'already-decided'
  | 'enabled'
  | 'declined'
  | 'ignored';

/**
 * Offers background resume once, after an explicit manual start. It never prompts
 * for consent, credentials or capture, and both explicit answers are persisted so
 * the offer is not repeated.
 */
export async function offerAssistantResumeOnStartup(
  options: AssistantResumeSuggestionOptions,
): Promise<AssistantResumeSuggestionOutcome> {
  const { settings } = options;
  const suggest = options.ui.suggestStartupResume?.bind(options.ui);
  if (!suggest || !settings.update) return 'unsupported';
  let alreadyDecided: boolean;
  try {
    alreadyDecided = settings.read().values.assistantResumeOnStartup
      || settings.hasExplicitGlobal?.('assistantResumeOnStartup') === true;
  } catch {
    return 'unsupported';
  }
  if (alreadyDecided) return 'already-decided';

  let choice: AssistantResumeSuggestionChoice;
  try {
    choice = await suggest();
  } catch {
    return 'ignored';
  }
  if (choice === 'ignored' || !options.isCurrent()) return 'ignored';
  const enable = choice === 'enable';
  try {
    await settings.update({ assistantResumeOnStartup: enable });
  } catch {
    // The preference stays at its previous value; listening is unaffected.
  }
  return enable ? 'enabled' : 'declined';
}
