import { MAX_ACTION_TEXT_LENGTH } from './policy';

export const BUILTIN_CHAT_OPEN_COMMAND = 'workbench.action.chat.open';
export const BUILTIN_CHAT_FOCUS_COMMAND = 'workbench.action.chat.focusInput';
export const BUILTIN_CHAT_SUBMIT_COMMAND = 'workbench.action.chat.submit';

export interface BuiltInChatDraftArguments {
  query: string;
  isPartialQuery: true;
}

/** Build the documented, non-submitting VS Code Chat prefill arguments. */
export function builtInChatDraftArguments(text: string): BuiltInChatDraftArguments {
  if (!text.trim() || text.length > MAX_ACTION_TEXT_LENGTH) {
    throw new RangeError('chat draft must be non-empty and bounded');
  }
  return { query: text, isPartialQuery: true };
}
