export const DEFAULT_WAKE_PHRASES = [
  'hey assistant',
  'okay assistant',
  'ok assistant',
  'assistant',
  'hey codex',
  'okay codex',
  'ok codex',
  'codex',
  'היי עוזר',
  'היי עוזרת',
  'אוקיי עוזר',
  'אוקיי עוזרת',
  'עוזר',
  'עוזרת',
  'היי קודקס',
  'אוקיי קודקס',
  'קודקס',
] as const;

export type AssistantAction =
  | 'stop-listening'
  | 'open-chat'
  | 'open-terminal'
  | 'open-settings'
  | 'confirm-send'
  | 'repeat-last';

export type AssistantIntent =
  | { kind: 'action'; action: AssistantAction }
  | { kind: 'paste'; text: string; submit: false };

export type AssistantParseResult =
  | { wakeDetected: false; intent: null }
  | {
      wakeDetected: true;
      wakePhrase: string;
      postWakeText: string;
      intent: AssistantIntent;
    };

export interface AssistantParserOptions {
  wakePhrases?: readonly string[];
}

const ACTION_PHRASES: Readonly<Record<AssistantAction, readonly string[]>> = {
  'stop-listening': [
    'stop listening',
    'stop',
    'תפסיק להקשיב',
    'תפסיקי להקשיב',
    'הפסק להקשיב',
    'הפסיקי להקשיב',
    'עצור האזנה',
    'עצרי האזנה',
    'עצור',
    'עצרי',
  ],
  'open-chat': [
    'open chat',
    'show chat',
    "פתח צ'אט",
    "פתח את הצ'אט",
    "פתחי צ'אט",
    "פתחי את הצ'אט",
  ],
  'open-terminal': [
    'open terminal',
    'show terminal',
    'פתח טרמינל',
    'פתח את הטרמינל',
    'פתח מסוף',
    'פתח את המסוף',
    'פתחי טרמינל',
    'פתחי את הטרמינל',
    'פתחי מסוף',
    'פתחי את המסוף',
  ],
  'open-settings': [
    'open settings',
    'show settings',
    'פתח הגדרות',
    'פתח את ההגדרות',
    'פתחי הגדרות',
    'פתחי את ההגדרות',
  ],
  'confirm-send': [
    'confirm send',
    'send it',
    'yes send',
    'אשר שליחה',
    'אשרי שליחה',
    'כן שלח',
    'כן שלחי',
    'שלח עכשיו',
    'שלחי עכשיו',
  ],
  'repeat-last': [
    'repeat last',
    'do that again',
    'write that again',
    'חזור על הפעולה',
    'חזרי על הפעולה',
    'כתוב שוב',
    'כתבי שוב',
  ],
};

/**
 * A custom mapping may only be confirmed by one of these local-only phrases.
 * They deliberately are not part of AssistantAction/DeepSeek's vocabulary:
 * the extension must consume them only when a custom action is pending.
 */
export const CONFIRM_CUSTOM_ACTION_PHRASES = [
  'confirm action',
  'yes do it',
  'אשר פעולה',
  'אשרי פעולה',
  'כן בצע',
  'כן בצעי',
] as const;

/** Voice mappings must not shadow any built-in or confirmation phrase. */
export const RESERVED_ASSISTANT_PHRASES = [
  ...Object.values(ACTION_PHRASES).flat(),
  ...CONFIRM_CUSTOM_ACTION_PHRASES,
] as const;

export function isConfirmCustomActionPhrase(text: string): boolean {
  const normalized = normalizeCommand(text);
  return CONFIRM_CUSTOM_ACTION_PHRASES.some(
    (phrase) => normalizeCommand(phrase) === normalized,
  );
}

/**
 * Parses a transcript only when it starts with an explicit wake phrase.
 * Commands are exact, allowlisted phrases. Everything else is paste-only and
 * carries `submit: false`, so consumers cannot interpret it as an arbitrary
 * command or automatically send it.
 */
export function parseAssistantText(
  text: string,
  options: AssistantParserOptions = {},
): AssistantParseResult {
  const wakeMatch = findWakePhrase(text, options.wakePhrases ?? DEFAULT_WAKE_PHRASES);
  if (!wakeMatch) return { wakeDetected: false, intent: null };

  const postWakeText = trimWakeSeparator(text.slice(wakeMatch.length));
  const normalizedCommand = normalizeCommand(postWakeText);
  for (const [action, phrases] of Object.entries(ACTION_PHRASES) as [
    AssistantAction,
    readonly string[],
  ][]) {
    if (phrases.some((phrase) => normalizeCommand(phrase) === normalizedCommand)) {
      return {
        wakeDetected: true,
        wakePhrase: wakeMatch.phrase,
        postWakeText,
        intent: { kind: 'action', action },
      };
    }
  }

  return {
    wakeDetected: true,
    wakePhrase: wakeMatch.phrase,
    postWakeText,
    intent: { kind: 'paste', text: postWakeText, submit: false },
  };
}

function findWakePhrase(
  text: string,
  wakePhrases: readonly string[],
): { phrase: string; length: number } | undefined {
  const leadingWhitespace = text.length - text.trimStart().length;
  const candidate = text.slice(leadingWhitespace);
  const sorted = [...wakePhrases]
    .map((phrase) => phrase.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const phrase of sorted) {
    const prefix = candidate.slice(0, phrase.length);
    if (prefix.normalize('NFKC').toLowerCase() !== phrase.normalize('NFKC').toLowerCase()) continue;
    const next = candidate.slice(phrase.length, phrase.length + 1);
    if (next && !/[\s,.:;!?\-–—]/u.test(next)) continue;
    return { phrase: prefix, length: leadingWhitespace + phrase.length };
  }
  return undefined;
}

function trimWakeSeparator(text: string): string {
  return text.replace(/^[\s,.:;!?\-–—]+/u, '').trim();
}

function normalizeCommand(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’׳`]/gu, "'")
    .replace(/[\s\p{P}\p{S}]+$/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}
