export type NativeLocalize = (english: string, hebrew: string) => string;

export const ASSISTANT_LISTENING_DISCLOSURE = Object.freeze({
  english: 'Assistant listening segments microphone audio locally. Silence that does not form a completed speech utterance stays local. Every completed speech utterance is sent to Soniox for transcription, and the wake phrase is checked only after Soniox returns the transcript. Listening starts only when you explicitly enable it.',
  hebrew: 'האזנת העוזר מחלקת את שמע המיקרופון למקטעים באופן מקומי. שקט שאינו יוצר אמירת דיבור שהושלמה נשאר מקומי. כל אמירת דיבור שהושלמה נשלחת ל־Soniox לתמלול, וביטוי ההפעלה נבדק רק לאחר ש־Soniox מחזיר את התמלול. ההאזנה מתחילה רק לאחר הפעלה מפורשת.',
});

/** One truthful disclosure reused by every native assistant-consent entry point. */
export function assistantListeningDisclosure(localize: NativeLocalize): string {
  return localize(
    ASSISTANT_LISTENING_DISCLOSURE.english,
    ASSISTANT_LISTENING_DISCLOSURE.hebrew,
  );
}
