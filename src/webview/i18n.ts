export type UiLang = 'he' | 'en';

export interface Strings {
  appTitle: string;
  recording: string;
  idle: string;
  encoding: string;
  transcribing: string;
  holdHint: string;
  pressKeyHint: string;
  history: string;
  noHistory: string;
  copy: string;
  copied: string;
  remove: string;
  clearAll: string;
  confirmClear: string;
  settings: string;
  settingsSpeechLang: string;
  settingsUiLang: string;
  settingsTtl: string;
  settingsModel: string;
  ttlForever: string;
  ttl1d: string;
  ttl7d: string;
  ttl30d: string;
  speechAuto: string;
  speechHebrew: string;
  speechEnglish: string;
  uiHebrew: string;
  uiEnglish: string;
  setApiKey: string;
  apiKeyMissing: string;
  errorLabel: string;
  settingsKey: string;
  changeKey: string;
  refresh: string;
  toToggle: string;
  settingsAudioDevice: string;
  audioDeviceDefault: string;
  audioDeviceScan: string;
  assistant: string;
  assistantEnabled: string;
  assistantDisabled: string;
  assistantListening: string;
  assistantReady: string;
  assistantWakePhrase: string;
  assistantWakePhraseHint: string;
  assistantDisclosure: string;
  assistantDisclosureAcknowledge: string;
  assistantPersona: string;
  personaTeacher: string;
  personaSecretary: string;
  personaFriend: string;
  personaTravelGuide: string;
  personaMathematician: string;
  personaPhilosopher: string;
  deepSeek: string;
  deepSeekReady: string;
  deepSeekMissing: string;
  deepSeekChecking: string;
  deepSeekError: string;
  deepSeekSetup: string;
  speechResponse: string;
  speechEnabled: string;
  speechVoice: string;
  speechSystemDefault: string;
  speechNoVoices: string;
  speechRate: string;
  speechStop: string;
  speechSpeaking: string;
  speechIdle: string;
  assistantTarget: string;
  assistantTargetUnknown: string;
  assistantPlanConfidence: string;
  deepSeekDisclosure: string;
  pendingSend: string;
  pendingSendExplain: string;
  pendingSendConfirm: string;
  pendingSendCancel: string;
}

export const STRINGS: Record<UiLang, Strings> = {
  he: {
    appTitle: 'קלט קולי',
    recording: 'מקליט...',
    idle: 'מוכן',
    encoding: 'מקודד...',
    transcribing: 'מתמלל...',
    holdHint: 'לחץ והחזק כדי להקליט',
    pressKeyHint: 'או הקש',
    toToggle: 'לטוגל',
    history: 'היסטוריית דיבור',
    noHistory: 'אין הקלטות עדיין',
    copy: 'העתק',
    copied: 'הועתק',
    remove: 'מחק',
    clearAll: 'מחק הכל',
    confirmClear: 'למחוק את כל ההיסטוריה?',
    settings: 'הגדרות',
    settingsSpeechLang: 'שפת דיבור',
    settingsUiLang: 'שפת ממשק',
    settingsTtl: 'שמירת היסטוריה',
    settingsModel: 'מודל Soniox',
    ttlForever: 'לתמיד',
    ttl1d: 'יום',
    ttl7d: '7 ימים',
    ttl30d: '30 יום',
    speechAuto: 'אוטומטי',
    speechHebrew: 'עברית',
    speechEnglish: 'אנגלית',
    uiHebrew: 'עברית',
    uiEnglish: 'אנגלית',
    setApiKey: 'הגדר מפתח Soniox',
    apiKeyMissing: 'מפתח SONIOX_API_KEY חסר',
    errorLabel: 'שגיאה',
    settingsKey: 'קיצור הקלטה',
    changeKey: 'שנה...',
    refresh: 'רענן',
    settingsAudioDevice: 'מקור שמע',
    audioDeviceDefault: 'ברירת מחדל של המערכת',
    audioDeviceScan: 'סרוק',
    assistant: 'עוזר קולי',
    assistantEnabled: 'הפעלת העוזר הקולי',
    assistantDisabled: 'העוזר הקולי כבוי',
    assistantListening: 'העוזר הקולי מאזין',
    assistantReady: 'העוזר הקולי מוכן',
    assistantWakePhrase: 'ביטוי הפעלה',
    assistantWakePhraseHint: 'למשל: היי עוזר',
    assistantDisclosure: 'כאשר העוזר הקולי מאזין, מקטעי דיבור שהושלמו נשלחים ל‑Soniox לתמלול. ביטוי ההפעלה נבדק לאחר התמלול; שקט נשאר מקומי.',
    assistantDisclosureAcknowledge: 'הבנתי',
    assistantPersona: 'מצב העוזר',
    personaTeacher: 'מורה / מרצה',
    personaSecretary: 'מזכירה',
    personaFriend: 'חבר',
    personaTravelGuide: 'מדריך טיולים',
    personaMathematician: 'מתמטיקאי',
    personaPhilosopher: 'פילוסוף',
    deepSeek: 'עיבוד חכם באמצעות DeepSeek',
    deepSeekReady: 'DeepSeek מוגדר ומוכן',
    deepSeekMissing: 'DeepSeek עדיין לא מוגדר',
    deepSeekChecking: 'בודק את הגדרת DeepSeek…',
    deepSeekError: 'לא ניתן להשתמש ב‑DeepSeek כרגע',
    deepSeekSetup: 'הגדר DeepSeek',
    speechResponse: 'תשובה קולית',
    speechEnabled: 'העוזר יענה בקול',
    speechVoice: 'קול',
    speechSystemDefault: 'קול ברירת המחדל של המערכת',
    speechNoVoices: 'לא נמצאו קולות במערכת',
    speechRate: 'מהירות דיבור',
    speechStop: 'הפסק דיבור',
    speechSpeaking: 'העוזר מדבר כעת',
    speechIdle: 'העוזר אינו מדבר',
    assistantTarget: 'יעד הפעולה',
    assistantTargetUnknown: 'עדיין לא זוהה יעד פעיל',
    assistantPlanConfidence: 'ביטחון בתוכנית',
    deepSeekDisclosure: 'DeepSeek אופציונלי. לאחר הסכמה נפרדת הוא מקבל רק את הבקשה שלאחר ביטוי ההפעלה, מצב העוזר, שפת הממשק ומידע יעד מינימלי. לא נשלחים צילום מסך, קבצים, בחירה, לוח, היסטוריית מסוף או היסטוריית צ׳אט.',
    pendingSend: 'ממתין לאישור שליחה',
    pendingSendExplain: 'העוזר הכין את הטקסט, אך לא ישלח אותו לפני אישורך.',
    pendingSendConfirm: 'אשר ושלח',
    pendingSendCancel: 'בטל',
  },
  en: {
    appTitle: 'Voice Input',
    recording: 'Recording...',
    idle: 'Ready',
    encoding: 'Encoding...',
    transcribing: 'Transcribing...',
    holdHint: 'Hold to record',
    pressKeyHint: 'or press',
    toToggle: 'to toggle',
    history: 'History',
    noHistory: 'No recordings yet',
    copy: 'Copy',
    copied: 'Copied',
    remove: 'Delete',
    clearAll: 'Clear all',
    confirmClear: 'Clear all history?',
    settings: 'Settings',
    settingsSpeechLang: 'Speech language',
    settingsUiLang: 'UI language',
    settingsTtl: 'Keep history',
    settingsModel: 'Soniox model',
    ttlForever: 'Forever',
    ttl1d: '1 day',
    ttl7d: '7 days',
    ttl30d: '30 days',
    speechAuto: 'Auto',
    speechHebrew: 'Hebrew',
    speechEnglish: 'English',
    uiHebrew: 'Hebrew',
    uiEnglish: 'English',
    setApiKey: 'Set Soniox API key',
    apiKeyMissing: 'SONIOX_API_KEY not set',
    errorLabel: 'Error',
    settingsKey: 'Recording shortcut',
    changeKey: 'Change...',
    refresh: 'Refresh',
    settingsAudioDevice: 'Audio device',
    audioDeviceDefault: 'System default',
    audioDeviceScan: 'Scan',
    assistant: 'Voice assistant',
    assistantEnabled: 'Enable voice assistant',
    assistantDisabled: 'Voice assistant is off',
    assistantListening: 'Voice assistant is listening',
    assistantReady: 'Voice assistant is ready',
    assistantWakePhrase: 'Wake phrase',
    assistantWakePhraseHint: 'For example: Hey Assistant',
    assistantDisclosure: 'When the voice assistant is listening, completed speech segments are sent to Soniox for transcription. The wake phrase is checked after transcription; silence stays local.',
    assistantDisclosureAcknowledge: 'I understand',
    assistantPersona: 'Assistant mode',
    personaTeacher: 'Teacher / lecturer',
    personaSecretary: 'Secretary',
    personaFriend: 'Friend',
    personaTravelGuide: 'Travel guide',
    personaMathematician: 'Mathematician',
    personaPhilosopher: 'Philosopher',
    deepSeek: 'Smart processing with DeepSeek',
    deepSeekReady: 'DeepSeek is configured and ready',
    deepSeekMissing: 'DeepSeek is not configured yet',
    deepSeekChecking: 'Checking the DeepSeek setup…',
    deepSeekError: 'DeepSeek is currently unavailable',
    deepSeekSetup: 'Set up DeepSeek',
    speechResponse: 'Spoken response',
    speechEnabled: 'Let the assistant answer aloud',
    speechVoice: 'Voice',
    speechSystemDefault: 'System default voice',
    speechNoVoices: 'No system voices were found',
    speechRate: 'Speaking rate',
    speechStop: 'Stop speaking',
    speechSpeaking: 'The assistant is speaking',
    speechIdle: 'The assistant is not speaking',
    assistantTarget: 'Action target',
    assistantTargetUnknown: 'No active target has been detected yet',
    assistantPlanConfidence: 'Plan confidence',
    deepSeekDisclosure: 'DeepSeek is optional. After separate consent it receives only the post-wake request, assistant mode, UI language, and minimal target metadata. Screenshots, files, selections, clipboard, terminal history, and chat history are never sent.',
    pendingSend: 'Waiting for send approval',
    pendingSendExplain: 'The assistant prepared this text but will not send it without your approval.',
    pendingSendConfirm: 'Approve and send',
    pendingSendCancel: 'Cancel',
  },
};
