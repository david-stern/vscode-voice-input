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
}

export const STRINGS: Record<UiLang, Strings> = {
  he: {
    appTitle: 'קלט קולי',
    recording: 'מקליט...',
    idle: 'מוכן',
    encoding: 'מקודד...',
    transcribing: 'מתמלל...',
    holdHint: 'לחץ והחזק כדי להקליט',
    pressKeyHint: 'או הקש Alt+M לטוגל',
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
  },
  en: {
    appTitle: 'Voice Input',
    recording: 'Recording...',
    idle: 'Ready',
    encoding: 'Encoding...',
    transcribing: 'Transcribing...',
    holdHint: 'Hold to record',
    pressKeyHint: 'or press Alt+M to toggle',
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
  },
};
