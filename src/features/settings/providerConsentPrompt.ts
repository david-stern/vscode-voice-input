import type { ProviderDisclosure } from '../../config';

export type SettingsConsentLocalize = (english: string, hebrew: string) => string;

/** Provider-specific native disclosure copy; the browser never receives this authority prompt. */
export function providerConsentPrompt(
  disclosure: Readonly<ProviderDisclosure>,
  localize: SettingsConsentLocalize,
): { action: string; message: string } {
  const provider = disclosure.providerName;
  const action = localize(
    `I understand and enable ${provider}`,
    `הבנתי, יש להפעיל את ${provider}`,
  );
  const destination = disclosure.locality === 'local-loopback'
    ? localize(
        'The configured endpoint is loopback, so the request stays on this computer.',
        'נקודת הקצה שהוגדרה היא לולאת משוב, ולכן הבקשה נשארת במחשב הזה.',
      )
    : localize(
        `The request leaves this computer for ${provider} at ${disclosure.endpointHost}.`,
        `הבקשה יוצאת מהמחשב אל ${provider} בכתובת ${disclosure.endpointHost}.`,
      );
  const message = localize(
    `${provider} planning sends only the post-wake request, persona and bounded user-authored agent instructions, interface locale, and minimal target kind/focus metadata. ${destination} It never sends screenshots, files, selections, clipboard content, terminal or chat history, mapping arguments, or tool input.`,
    `התכנון של ${provider} שולח רק את הבקשה שלאחר ביטוי ההפעלה, דמות והוראות סוכן מוגבלות באורך שנכתבו בידי המשתמש, שפת ממשק ומידע מזערי על סוג היעד והמיקוד. ${destination} הוא לעולם אינו שולח צילומי מסך, קבצים, בחירות, תוכן לוח, היסטוריית מסוף או צ׳אט, ארגומנטים של מיפויים או קלט לכלים.`,
  );
  return { action, message };
}
