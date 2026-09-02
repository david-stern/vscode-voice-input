export type UiLang = 'he' | 'en';

export interface Strings {
  appTitle: string;
  recording: string;
  idle: string;
  micStartAction: string;
  micStopAction: string;
  encoding: string;
  transcribing: string;
  holdHint: string;
  pressKeyHint: string;
  history: string;
  noHistory: string;
  copy: string;
  copied: string;
  copySuccess: string;
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
  providerHeading: string;
  providerReady: string;
  providerMissing: string;
  providerConsentRequired: string;
  providerChecking: string;
  providerError: string;
  providerManage: string;
  providerOff: string;
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
  providerDisclosure: string;
  pendingSend: string;
  pendingSendExplain: string;
  pendingSendConfirm: string;
  pendingSendCancel: string;
  customMappings: string;
  customMappingsCount: string;
  customMappingsAgentExposed: string;
  customMappingsStatusReady: string;
  customMappingsStatusUntrusted: string;
  customMappingsStatusError: string;
  customMappingsManage: string;
  pendingAction: string;
  pendingActionExplain: string;
  pendingActionTarget: string;
  pendingActionConfirm: string;
  pendingActionCancel: string;
}

export const STRINGS: Record<UiLang, Strings> = {
  he: {
    appTitle: 'קלט קולי',
    recording: 'מקליט...',
    idle: 'מוכן',
    micStartAction: 'התחל הקלטה',
    micStopAction: 'עצור הקלטה',
    encoding: 'מקודד...',
    transcribing: 'מתמלל...',
    holdHint: 'לחץ והחזק כדי להקליט',
    pressKeyHint: 'או הקש',
    toToggle: 'לטוגל',
    history: 'היסטוריית דיבור',
    noHistory: 'אין הקלטות עדיין',
    copy: 'העתק',
    copied: 'הועתק',
    copySuccess: 'רשומת ההיסטוריה הועתקה.',
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
    providerHeading: 'ספק הסקה נבחר',
    providerReady: 'הספק שנבחר מוגדר ומוכן',
    providerMissing: 'הספק שנבחר עדיין אינו מוגדר',
    providerConsentRequired: 'יש לאשר את גילוי הספק שנבחר',
    providerChecking: 'בודק את הספק שנבחר…',
    providerError: 'לא ניתן להשתמש כעת בספק שנבחר',
    providerManage: 'נהל ספק ומודל',
    providerOff: 'כבוי',
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
    providerDisclosure: 'ספק הסקה הוא אופציונלי. כאשר ספק מרוחק פעיל ולאחר הסכמה נפרדת, הוא מקבל רק את הבקשה שלאחר ביטוי ההפעלה, הוראות סוכן מוגבלות, שפת הממשק ומידע יעד מינימלי. לא נשלחים צילום מסך, קבצים, בחירה, לוח, היסטוריית מסוף או היסטוריית צ׳אט.',
    pendingSend: 'ממתין לאישור שליחה',
    pendingSendExplain: 'העוזר הכין את הטקסט, אך לא ישלח אותו לפני אישורך.',
    pendingSendConfirm: 'אשר ושלח',
    pendingSendCancel: 'בטל',
    customMappings: 'פקודות קוליות מותאמות',
    customMappingsCount: 'פקודות פעילות',
    customMappingsAgentExposed: 'זמינות לסוכן',
    customMappingsStatusReady: 'מוכנות להפעלה באישור נפרד',
    customMappingsStatusUntrusted: 'הפעלה חסומה עד שתסמוך על סביבת העבודה',
    customMappingsStatusError: 'לא ניתן לטעון את הפקודות המותאמות',
    customMappingsManage: 'ניהול פקודות',
    pendingAction: 'ממתין לאישור פעולה',
    pendingActionExplain: 'הפקודה לא תופעל לפני אישורך. בדוק את השם ואת יעד הפעולה המדויק.',
    pendingActionTarget: 'יעד פעולה מדויק',
    pendingActionConfirm: 'אשר והפעל',
    pendingActionCancel: 'בטל',
  },
  en: {
    appTitle: 'Voice Input',
    recording: 'Recording...',
    idle: 'Ready',
    micStartAction: 'Start recording',
    micStopAction: 'Stop recording',
    encoding: 'Encoding...',
    transcribing: 'Transcribing...',
    holdHint: 'Hold to record',
    pressKeyHint: 'or press',
    toToggle: 'to toggle',
    history: 'History',
    noHistory: 'No recordings yet',
    copy: 'Copy',
    copied: 'Copied',
    copySuccess: 'History entry copied.',
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
    providerHeading: 'Selected reasoning provider',
    providerReady: 'The selected provider is configured and ready',
    providerMissing: 'The selected provider is not configured yet',
    providerConsentRequired: 'Acknowledge the selected provider disclosure',
    providerChecking: 'Checking the selected provider…',
    providerError: 'The selected provider is currently unavailable',
    providerManage: 'Manage provider and model',
    providerOff: 'Off',
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
    providerDisclosure: 'Reasoning is optional. When a remote provider is enabled and separately consented, it receives only the post-wake request, bounded agent instructions, UI language, and minimal target metadata. Screenshots, files, selections, clipboard, terminal history, and chat history are never sent.',
    pendingSend: 'Waiting for send approval',
    pendingSendExplain: 'The assistant prepared this text but will not send it without your approval.',
    pendingSendConfirm: 'Approve and send',
    pendingSendCancel: 'Cancel',
    customMappings: 'Custom voice commands',
    customMappingsCount: 'Active mappings',
    customMappingsAgentExposed: 'Available to Agent',
    customMappingsStatusReady: 'Ready to run with separate approval',
    customMappingsStatusUntrusted: 'Running is blocked until you trust this workspace',
    customMappingsStatusError: 'Custom mappings could not be loaded',
    customMappingsManage: 'Manage mappings',
    pendingAction: 'Waiting for action approval',
    pendingActionExplain: 'The command will not run until you approve it. Check the name and exact action target.',
    pendingActionTarget: 'Exact action target',
    pendingActionConfirm: 'Approve and run',
    pendingActionCancel: 'Cancel',
  },
};
