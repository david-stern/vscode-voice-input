import type { TargetRevalidationFailure } from './context';

export interface PolicyExplanation {
  code: PolicyReason;
  en: string;
  he: string;
}

export type PolicyReason =
  | TargetRevalidationFailure
  | 'action-not-allowed'
  | 'target-mismatch'
  | 'unsafe-terminal-text'
  | 'empty-text'
  | 'text-too-long'
  | 'send-target-not-chat'
  | 'send-confirmation-required'
  | 'send-confirmation-expired'
  | 'same-utterance-confirmation'
  | 'confirmation-not-later'
  | 'confirmation-replayed'
  | 'no-pending-send'
  | 'pending-send-cancelled'
  | 'no-repeatable-action'
  | 'repeat-action-expired'
  | 'action-authorized'
  | 'terminal-text-inserted'
  | 'action-remembered'
  | 'send-confirmed';

export function policyExplanation(code: PolicyReason): PolicyExplanation {
  const messages: Record<PolicyReason, { en: string; he: string }> = {
    'vscode-not-focused': {
      en: 'I stopped because VS Code is no longer focused.',
      he: 'עצרתי מפני ש־VS Code כבר אינו ממוקד.',
    },
    'target-unresolved': {
      en: 'I could not safely identify the focused editor, terminal, or chat.',
      he: 'לא הצלחתי לזהות בבטחה עורך, מסוף או צ׳אט ממוקדים.',
    },
    'target-kind-changed': {
      en: 'I stopped because the focused target changed while I was working.',
      he: 'עצרתי מפני שהיעד הממוקד השתנה בזמן שעבדתי.',
    },
    'tab-changed': {
      en: 'I stopped because the active tab changed.',
      he: 'עצרתי מפני שהלשונית הפעילה השתנתה.',
    },
    'editor-changed': {
      en: 'I stopped because the active editor changed.',
      he: 'עצרתי מפני שהעורך הפעיל השתנה.',
    },
    'terminal-changed': {
      en: 'I stopped because the active terminal changed.',
      he: 'עצרתי מפני שהמסוף הפעיל השתנה.',
    },
    'action-not-allowed': {
      en: 'I refused an action outside the assistant allowlist.',
      he: 'סירבתי לפעולה שאינה ברשימת הפעולות המותרות של העוזר.',
    },
    'target-mismatch': {
      en: 'I stopped because the requested destination does not match the focused target.',
      he: 'עצרתי מפני שהיעד המבוקש אינו תואם לרכיב הממוקד.',
    },
    'unsafe-terminal-text': {
      en: 'I did not place this in the terminal because it contains a line break or control character.',
      he: 'לא הכנסתי את הטקסט למסוף מפני שהוא כולל מעבר שורה או תו בקרה.',
    },
    'empty-text': { en: 'There is no text to write.', he: 'אין טקסט לכתיבה.' },
    'text-too-long': {
      en: 'I stopped because the requested text is too long.',
      he: 'עצרתי מפני שהטקסט המבוקש ארוך מדי.',
    },
    'send-target-not-chat': {
      en: 'I can request sending only in a clearly identified chat.',
      he: 'אפשר לבקש שליחה רק בצ׳אט שזוהה בבירור.',
    },
    'send-confirmation-required': {
      en: 'The action is prepared; sending still requires a separate confirmation.',
      he: 'הפעולה מוכנה; שליחה עדיין דורשת אישור נפרד.',
    },
    'send-confirmation-expired': {
      en: 'I did not send because the confirmation window expired.',
      he: 'לא שלחתי מפני שחלון האישור פג.',
    },
    'same-utterance-confirmation': {
      en: 'I did not send because confirmation must be a separate spoken request.',
      he: 'לא שלחתי מפני שהאישור חייב להיות בקשה קולית נפרדת.',
    },
    'confirmation-not-later': {
      en: 'I did not send because confirmation must happen after the send request.',
      he: 'לא שלחתי מפני שהאישור חייב להגיע לאחר בקשת השליחה.',
    },
    'confirmation-replayed': {
      en: 'I did not send because that confirmation was already used.',
      he: 'לא שלחתי מפני שהאישור הזה כבר שימש לשליחה קודמת.',
    },
    'no-pending-send': {
      en: 'There is no pending message to send.',
      he: 'אין הודעה שממתינה לשליחה.',
    },
    'pending-send-cancelled': {
      en: 'I cancelled the pending send request.',
      he: 'ביטלתי את בקשת השליחה הממתינה.',
    },
    'no-repeatable-action': {
      en: 'There is no recent action to repeat.',
      he: 'אין פעולה אחרונה שאפשר לחזור עליה.',
    },
    'repeat-action-expired': {
      en: 'I forgot the previous action because more than five minutes passed.',
      he: 'שכחתי את הפעולה הקודמת מפני שעברו יותר מחמש דקות.',
    },
    'action-authorized': {
      en: 'The target is still focused and the requested action is allowed.',
      he: 'היעד עדיין ממוקד והפעולה המבוקשת מותרת.',
    },
    'terminal-text-inserted': {
      en: 'I placed the text in the terminal without running it.',
      he: 'הכנסתי את הטקסט למסוף בלי להריץ אותו.',
    },
    'action-remembered': {
      en: 'I kept this action in memory for up to five minutes so it can be repeated safely.',
      he: 'שמרתי את הפעולה בזיכרון למשך עד חמש דקות כדי שאפשר יהיה לחזור עליה בבטחה.',
    },
    'send-confirmed': {
      en: 'The separate confirmation matched the same chat, so sending is now allowed.',
      he: 'האישור הנפרד תאם לאותו צ׳אט, ולכן השליחה מותרת כעת.',
    },
  };
  return { code, ...messages[code] };
}
