import type { ControlCenterRoute } from './contracts';
import type {
  ControlCenterDiagnosticKind,
  ControlCenterDiagnosticStatus,
  ControlCenterMicrophoneProofState,
  ControlCenterSetupStepState,
} from './contracts';
import type { SystemSpeechPreviewState } from './systemSpeech';

export interface ControlCenterStrings {
  product: string;
  skip: string;
  menu: string;
  close: string;
  cancel: string;
  routes: Record<ControlCenterRoute, { title: string; purpose: string }>;
  status: string;
  notConfigured: string;
  sonioxConfigured: string;
  remoteProcessing: string;
  systemVoice: string;
  systemVoiceUnavailable: string;
  localPending: string;
  autoActive: string;
  disableAuto: string;
  enableAuto: string;
  autoWarning: string;
  continueNative: string;
  setup: string;
  setupStep: string;
  setupSteps: readonly [string, string, string, string];
  setupStepStatuses: Record<ControlCenterSetupStepState, string>;
  setupCurrent: string;
  setupAllComplete: string;
  microphoneProof: string;
  microphoneProofHelp: string;
  microphoneStates: Record<ControlCenterMicrophoneProofState, string>;
  selectedMicrophone: string;
  selectMicrophone: string;
  testSignal: string;
  stopSignalTest: string;
  sonioxSetupHelp: string;
  leaveSpeechOff: string;
  speechOutputMode: string;
  speechOff: string;
  speechSystem: string;
  systemVoiceSelect: string;
  systemVoiceDefault: string;
  systemVoiceRate: string;
  previewVoice: string;
  stopPreview: string;
  noSystemVoices: string;
  systemVoicePreviewText: string;
  previewStates: Record<SystemSpeechPreviewState, string>;
  commandsReviewHelp: string;
  reviewCommands: string;
  reviewAuthority: string;
  searchCommands: string;
  clearFilters: string;
  enabledOnly: string;
  changedOnly: string;
  previous: string;
  next: string;
  edit: string;
  enabled: string;
  unavailable: string;
  noResults: string;
  configureSoniox: string;
  providerDetails: string;
  runDiagnostics: string;
  pendingReview: string;
  review: string;
  partial: string;
  final: string;
  categories: readonly [string, string, string, string, string, string, string];
  customCommands: string;
  customName: string;
  customPhrases: string;
  credentialsNative: string;
  diagnosticsNative: string;
  diagnosticsIdle: string;
  diagnosticsResults: string;
  openDiagnostics: string;
  copyDiagnostics: string;
  diagnosticKinds: Record<ControlCenterDiagnosticKind, string>;
  diagnosticStatuses: Record<ControlCenterDiagnosticStatus, string>;
  loading: string;
  resetDefault: string;
  save: string;
  disabled: string;
  enable: string;
  disable: string;
  deleteAction: string;
  managementLoading: string;
  speechProvider: string;
  planningProviders: string;
  planningProvidersHelp: string;
  selectedProvider: string;
  providerOff: string;
  providersEmpty: string;
  providerEnabled: string;
  providerDisabled: string;
  providerRemote: string;
  providerLoopback: string;
  providerModel: string;
  providerSave: string;
  credentialSet: string;
  credentialReplace: string;
  credentialClear: string;
  providerTest: string;
  providerCancelTest: string;
  consentReview: string;
  consentRevoke: string;
  agents: string;
  agentsHelp: string;
  agentsEmpty: string;
  agentTemplate: string;
  agentTemplates: readonly [string, string, string, string, string, string];
  agentCreate: string;
  agentSave: string;
  agentEnabled: string;
  agentDisabled: string;
  agentDefault: string;
  agentInstructionsConfigured: string;
  agentInstructionsEmpty: string;
  agentEnable: string;
  agentDisable: string;
  agentMakeDefault: string;
  agentDuplicate: string;
  agentDelete: string;
  customCommandsHelp: string;
  customCommandsEmpty: string;
  addCustom: string;
  customNativeFlow: string;
  customDescription: string;
  customKind: string;
  customKindCommand: string;
  customKindTool: string;
  customTarget: string;
  customEnabled: string;
  customAgentEnabled: string;
  customSave: string;
  customCancelEdit: string;
  customEditHeading: string;
  customFormError: string;
  agentAvailable: string;
  agentPrivate: string;
  phrasesRequired: string;
  sonioxCredentialConfigure: string;
  sonioxCredentialReplace: string;
  sonioxConsentReview: string;
  sonioxTest: string;
  sonioxRevoke: string;
  actionPreviewTitle: string;
  actionPreviewWarning: string;
  keepPending: string;
  cancelPendingAction: string;
  confirmPendingNative: string;
}

export const CONTROL_CENTER_STRINGS: Record<'en' | 'he', ControlCenterStrings> = {
  en: {
    product: 'Voice Input Control Center', skip: 'Skip to content', menu: 'Menu', close: 'Close',
    cancel: 'Cancel', status: 'Status', notConfigured: 'Not configured',
    sonioxConfigured: 'Soniox configured — remote processing', remoteProcessing: 'Remote processing',
    systemVoice: 'System voice — temporary and OS-dependent',
    systemVoiceUnavailable: 'System voice unavailable — no OS voice found',
    localPending: 'Offline/local speech is planned and pending, but it is not included or available in this version. System voices are OS-provided and may be unavailable.',
    autoActive: 'AUTO is active', disableAuto: 'Disable AUTO immediately', enableAuto: 'Enable AUTO',
    autoWarning: 'AUTO can skip extension-owned confirmations for valid commands. VS Code safety prompts remain in force.',
    continueNative: 'Continue to VS Code confirmation', setup: 'Complete setup', setupStep: 'Step',
    setupSteps: ['Microphone and signal', 'Speech-to-text', 'System speech output', 'Commands and authority'],
    setupStepStatuses: { complete: 'Complete', attention: 'Needs attention', pending: 'Pending' },
    setupCurrent: 'Current',
    setupAllComplete: 'All four setup steps are complete.',
    microphoneProof: 'Microphone signal proof',
    microphoneProofHelp: 'Choose an input and run a test. Readiness requires detected non-zero audio, not device discovery alone.',
    microphoneStates: {
      unselected: 'Choose a microphone before testing.',
      untested: 'Microphone selected — signal has not been tested.',
      testing: 'Listening for a non-zero microphone signal…',
      'signal-detected': 'Non-zero microphone signal detected.',
      'no-signal': 'No microphone signal was detected. Check the input and try again.',
      unavailable: 'Microphone testing is unavailable on this system.',
      error: 'The microphone test stopped safely with an error.',
    },
    selectedMicrophone: 'Selected input', selectMicrophone: 'Choose microphone',
    testSignal: 'Test microphone signal', stopSignalTest: 'Stop signal test',
    sonioxSetupHelp: 'Soniox sends microphone audio for remote processing only after explicit selection, credential setup, and native consent.',
    leaveSpeechOff: 'Leave speech-to-text off', speechOutputMode: 'Speech output',
    speechOff: 'Off', speechSystem: 'System voice', systemVoiceSelect: 'Operating-system voice',
    systemVoiceDefault: 'System default voice', systemVoiceRate: 'Speaking rate',
    previewVoice: 'Preview system voice', stopPreview: 'Stop preview',
    noSystemVoices: 'No operating-system voices were observed. No fallback was selected.',
    systemVoicePreviewText: 'Voice Input system voice preview.',
    previewStates: {
      idle: 'Preview is ready.', speaking: 'Playing the system voice preview.',
      completed: 'Preview playback finished.', cancelled: 'Preview playback stopped.',
      error: 'The system voice preview could not be played.',
    },
    commandsReviewHelp: 'Review all 100 built-in commands and the confirmation boundary. AUTO remains off until a separate native confirmation.',
    reviewCommands: 'Review built-in commands', reviewAuthority: 'Review authority and AUTO',
    searchCommands: 'Search commands', clearFilters: 'Clear filters',
    enabledOnly: 'Enabled only', changedOnly: 'Changed from default', previous: 'Previous', next: 'Next',
    edit: 'Edit', enabled: 'Enabled', unavailable: 'Unavailable', noResults: 'No matching commands',
    configureSoniox: 'Configure Soniox', providerDetails: 'Provider details', runDiagnostics: 'Run diagnostics',
    pendingReview: 'Pending review', review: 'Review in Commands', partial: 'Partial', final: 'Final',
    categories: ['Editing', 'Selection & cursor', 'Files & tabs', 'Search & navigation', 'Code & refactor', 'Panels, debug & tests', 'Git'],
    customCommands: 'Custom commands', customName: 'Name', customPhrases: 'Phrases',
    credentialsNative: 'Credentials are entered only in a VS Code-owned prompt.',
    diagnosticsNative: 'Diagnostics run through the Extension Host and never upload audio implicitly.',
    diagnosticsIdle: 'Diagnostics have not run yet.', diagnosticsResults: 'Diagnostic results',
    openDiagnostics: 'Open diagnostic output', copyDiagnostics: 'Copy safe summary',
    diagnosticKinds: {
      microphone: 'Microphone', 'speech-to-text': 'Speech-to-text',
      'system-speech': 'System speech', commands: 'Commands', authority: 'Authority', assistant: 'Assistant',
    },
    diagnosticStatuses: {
      ready: 'Ready', attention: 'Needs attention', unavailable: 'Unavailable', error: 'Error',
    },
    loading: 'Loading…', resetDefault: 'Reset to default', save: 'Save', disabled: 'Disabled',
    enable: 'Enable', disable: 'Disable', deleteAction: 'Delete', managementLoading: 'Loading management state…',
    speechProvider: 'Speech-to-text provider', planningProviders: 'Planning provider profiles',
    planningProvidersHelp: 'Select and manage the reasoning providers used by your agents. Credentials always open in a VS Code-owned prompt.',
    selectedProvider: 'Selected planning provider', providerOff: 'Off', providersEmpty: 'No planning providers are available.',
    providerEnabled: 'Provider profile enabled', providerDisabled: 'Provider profile disabled',
    providerRemote: 'Remote provider', providerLoopback: 'Loopback provider', providerModel: 'Model identifier',
    providerSave: 'Save provider profile', credentialSet: 'Set credential', credentialReplace: 'Replace credential',
    credentialClear: 'Clear credential', providerTest: 'Test connection', providerCancelTest: 'Cancel connection test',
    consentReview: 'Review remote-processing consent',
    consentRevoke: 'Revoke consent', agents: 'Agents', agentsHelp: 'Manage each agent’s provider, model, availability, and default role.',
    agentsEmpty: 'No agents are available.', agentTemplate: 'Agent template',
    agentTemplates: ['Teacher / lecturer', 'Secretary', 'Friend', 'Tour guide', 'Mathematician', 'Philosopher'],
    agentCreate: 'Create from template', agentSave: 'Save provider and model', agentEnabled: 'Enabled',
    agentDisabled: 'Disabled', agentDefault: 'Default agent', agentInstructionsConfigured: 'Host instructions configured',
    agentInstructionsEmpty: 'No host instructions configured', agentEnable: 'Enable agent', agentDisable: 'Disable agent',
    agentMakeDefault: 'Make default', agentDuplicate: 'Duplicate agent', agentDelete: 'Delete agent',
    customCommandsHelp: 'Add and manage custom voice commands with the visible, host-validated form.',
    customCommandsEmpty: 'No custom commands are configured.', addCustom: 'Add custom command',
    customNativeFlow: 'Phrases and the allowed target are reviewed here; credentials and authority remain host-owned.',
    customDescription: 'Description (optional)', customKind: 'Allowed action type',
    customKindCommand: 'VS Code command', customKindTool: 'Language-model tool',
    customTarget: 'Allowed target identifier', customEnabled: 'Command enabled',
    customAgentEnabled: 'Available to Agent Mode', customSave: 'Save custom command',
    customCancelEdit: 'Cancel editing', customEditHeading: 'Edit custom command',
    customFormError: 'Complete the name, 1–20 unique phrases, and one valid target identifier.',
    agentAvailable: 'Available to Agent Mode', agentPrivate: 'Hidden from Agent Mode',
    phrasesRequired: 'Enter 1 to 20 unique phrases, one per line.',
    sonioxCredentialConfigure: 'Configure Soniox credential', sonioxCredentialReplace: 'Replace Soniox credential',
    sonioxConsentReview: 'Review remote-processing consent', sonioxTest: 'Test Soniox configuration',
    sonioxRevoke: 'Revoke Soniox consent',
    actionPreviewTitle: 'Review pending action',
    actionPreviewWarning: 'This preview grants nothing. Continuing closes it before VS Code asks for a separate native confirmation.',
    keepPending: 'Keep pending', cancelPendingAction: 'Cancel pending action',
    confirmPendingNative: 'Continue to native confirmation',
    routes: {
      home: { title: 'Home', purpose: 'See what is ready and the next safe step.' },
      voice: { title: 'Voice & Microphone', purpose: 'Check microphone, transcription, and system speech capabilities.' },
      commands: { title: 'Commands', purpose: 'Search and manage the bounded command catalog.' },
      assistant: { title: 'Assistant & Providers', purpose: 'Choose a provider and review its capabilities.' },
      privacy: { title: 'Privacy & Safety', purpose: 'See remote processing and automation boundaries.' },
      diagnostics: { title: 'Diagnostics', purpose: 'Understand why a capability is unavailable.' },
    },
  },
  he: {
    product: 'מרכז הבקרה של Voice Input', skip: 'דילוג לתוכן', menu: 'תפריט', close: 'סגירה',
    cancel: 'ביטול', status: 'מצב', notConfigured: 'לא מוגדר',
    sonioxConfigured: 'Soniox מוגדר — עיבוד מרוחק', remoteProcessing: 'עיבוד מרוחק',
    systemVoice: 'קול מערכת — זמני ותלוי במערכת ההפעלה',
    systemVoiceUnavailable: 'קול המערכת אינו זמין — לא נמצא קול של מערכת ההפעלה',
    localPending: 'דיבור לא־מקוון/מקומי מתוכנן ובהמתנה, אך אינו כלול ואינו זמין בגרסה זו. קולות המערכת מסופקים על־ידי מערכת ההפעלה וייתכן שלא יהיו זמינים.',
    autoActive: 'AUTO פעיל', disableAuto: 'כיבוי AUTO מיידי', enableAuto: 'הפעלת AUTO',
    autoWarning: 'AUTO יכול לדלג על אישורי ההרחבה לפקודות תקינות. הנחיות הבטיחות של VS Code נשארות פעילות.',
    continueNative: 'המשך לאישור של VS Code', setup: 'השלמת הגדרה', setupStep: 'שלב',
    setupSteps: ['מיקרופון ואות', 'המרת דיבור לטקסט', 'פלט קולי של המערכת', 'פקודות וסמכות'],
    setupStepStatuses: { complete: 'הושלם', attention: 'דורש תשומת לב', pending: 'ממתין' },
    setupCurrent: 'נוכחי',
    setupAllComplete: 'כל ארבעת שלבי ההגדרה הושלמו.',
    microphoneProof: 'הוכחת אות מהמיקרופון',
    microphoneProofHelp: 'יש לבחור קלט ולהריץ בדיקה. מוכנות דורשת אודיו שאינו אפס, ולא רק איתור התקן.',
    microphoneStates: {
      unselected: 'יש לבחור מיקרופון לפני הבדיקה.',
      untested: 'המיקרופון נבחר — האות עדיין לא נבדק.',
      testing: 'מאזין לאות מיקרופון שאינו אפס…',
      'signal-detected': 'זוהה אות מיקרופון שאינו אפס.',
      'no-signal': 'לא זוהה אות מהמיקרופון. יש לבדוק את הקלט ולנסות שוב.',
      unavailable: 'בדיקת המיקרופון אינה זמינה במערכת זו.',
      error: 'בדיקת המיקרופון נעצרה בבטחה עם שגיאה.',
    },
    selectedMicrophone: 'קלט נבחר', selectMicrophone: 'בחירת מיקרופון',
    testSignal: 'בדיקת אות המיקרופון', stopSignalTest: 'עצירת בדיקת האות',
    sonioxSetupHelp: 'Soniox שולח אודיו מהמיקרופון לעיבוד מרוחק רק אחרי בחירה מפורשת, הגדרת פרטי גישה והסכמה מקורית.',
    leaveSpeechOff: 'השארת דיבור לטקסט כבוי', speechOutputMode: 'פלט קולי',
    speechOff: 'כבוי', speechSystem: 'קול מערכת', systemVoiceSelect: 'קול של מערכת ההפעלה',
    systemVoiceDefault: 'קול ברירת המחדל של המערכת', systemVoiceRate: 'קצב דיבור',
    previewVoice: 'השמעת תצוגה מקדימה', stopPreview: 'עצירת התצוגה המקדימה',
    noSystemVoices: 'לא זוהו קולות של מערכת ההפעלה. לא נבחרה חלופה שקטה.',
    systemVoicePreviewText: 'תצוגה מקדימה של קול המערכת עבור Voice Input.',
    previewStates: {
      idle: 'התצוגה המקדימה מוכנה.', speaking: 'תצוגת קול המערכת מתנגנת.',
      completed: 'השמעת התצוגה המקדימה הסתיימה.', cancelled: 'השמעת התצוגה המקדימה נעצרה.',
      error: 'לא ניתן להשמיע את תצוגת קול המערכת.',
    },
    commandsReviewHelp: 'יש לעבור על כל 100 הפקודות המובנות ועל גבול האישורים. AUTO נשאר כבוי עד אישור מקורי נפרד.',
    reviewCommands: 'בדיקת הפקודות המובנות', reviewAuthority: 'בדיקת סמכות ו־AUTO',
    searchCommands: 'חיפוש פקודות', clearFilters: 'ניקוי מסננים',
    enabledOnly: 'פעילות בלבד', changedOnly: 'שונו מברירת המחדל', previous: 'הקודם', next: 'הבא',
    edit: 'עריכה', enabled: 'פעילה', unavailable: 'לא זמינה', noResults: 'לא נמצאו פקודות',
    configureSoniox: 'הגדרת Soniox', providerDetails: 'פרטי ספק', runDiagnostics: 'הרצת אבחון',
    pendingReview: 'ממתין לבדיקה', review: 'בדיקה במסך פקודות', partial: 'זמני', final: 'סופי',
    categories: ['עריכה', 'בחירה וסמן', 'קבצים ולשוניות', 'חיפוש וניווט', 'קוד ו־refactor', 'פאנלים, debug ובדיקות', 'Git'],
    customCommands: 'פקודות מותאמות', customName: 'שם', customPhrases: 'ביטויים',
    credentialsNative: 'פרטי גישה מוזנים רק בהנחיה שבבעלות VS Code.',
    diagnosticsNative: 'האבחון רץ דרך מארח ההרחבה ולעולם אינו מעלה אודיו באופן משתמע.',
    diagnosticsIdle: 'האבחון עדיין לא הורץ.', diagnosticsResults: 'תוצאות אבחון',
    openDiagnostics: 'פתיחת פלט האבחון', copyDiagnostics: 'העתקת סיכום בטוח',
    diagnosticKinds: {
      microphone: 'מיקרופון', 'speech-to-text': 'דיבור לטקסט',
      'system-speech': 'קול מערכת', commands: 'פקודות', authority: 'סמכות', assistant: 'עוזר',
    },
    diagnosticStatuses: {
      ready: 'מוכן', attention: 'דורש תשומת לב', unavailable: 'לא זמין', error: 'שגיאה',
    },
    loading: 'בטעינה…', resetDefault: 'איפוס לברירת המחדל', save: 'שמירה', disabled: 'מושבתת',
    enable: 'הפעלה', disable: 'השבתה', deleteAction: 'מחיקה', managementLoading: 'מצב הניהול בטעינה…',
    speechProvider: 'ספק המרת דיבור לטקסט', planningProviders: 'פרופילים של ספקי תכנון',
    planningProvidersHelp: 'בחירה וניהול של ספקי ההסקה שבהם משתמשים הסוכנים. פרטי גישה נפתחים תמיד בהנחיה שבבעלות VS Code.',
    selectedProvider: 'ספק תכנון נבחר', providerOff: 'כבוי', providersEmpty: 'אין ספקי תכנון זמינים.',
    providerEnabled: 'פרופיל הספק פעיל', providerDisabled: 'פרופיל הספק מושבת',
    providerRemote: 'ספק מרוחק', providerLoopback: 'ספק loopback', providerModel: 'מזהה מודל',
    providerSave: 'שמירת פרופיל ספק', credentialSet: 'הגדרת פרטי גישה', credentialReplace: 'החלפת פרטי גישה',
    credentialClear: 'ניקוי פרטי גישה', providerTest: 'בדיקת חיבור', providerCancelTest: 'ביטול בדיקת חיבור',
    consentReview: 'בדיקת הסכמה לעיבוד מרוחק',
    consentRevoke: 'ביטול הסכמה', agents: 'סוכנים', agentsHelp: 'ניהול הספק, המודל, הזמינות וברירת המחדל של כל סוכן.',
    agentsEmpty: 'אין סוכנים זמינים.', agentTemplate: 'תבנית סוכן',
    agentTemplates: ['מורה / מרצה', 'מזכיר או מזכירה', 'חבר או חברה', 'מדריך או מדריכה', 'מתמטיקאי או מתמטיקאית', 'פילוסוף או פילוסופית'],
    agentCreate: 'יצירה מתבנית', agentSave: 'שמירת ספק ומודל', agentEnabled: 'פעיל',
    agentDisabled: 'מושבת', agentDefault: 'סוכן ברירת מחדל', agentInstructionsConfigured: 'הוראות המארח הוגדרו',
    agentInstructionsEmpty: 'לא הוגדרו הוראות במארח', agentEnable: 'הפעלת סוכן', agentDisable: 'השבתת סוכן',
    agentMakeDefault: 'הגדרה כברירת מחדל', agentDuplicate: 'שכפול סוכן', agentDelete: 'מחיקת סוכן',
    customCommandsHelp: 'הוספה וניהול של פקודות קוליות מותאמות בטופס הגלוי והמאומת של המארח.',
    customCommandsEmpty: 'לא הוגדרו פקודות מותאמות.', addCustom: 'הוספת פקודה מותאמת',
    customNativeFlow: 'הביטויים והיעד המותר נבדקים כאן; פרטי גישה וסמכות נשארים בבעלות המארח.',
    customDescription: 'תיאור (רשות)', customKind: 'סוג פעולה מותר',
    customKindCommand: 'פקודת VS Code', customKindTool: 'כלי של מודל שפה',
    customTarget: 'מזהה יעד מותר', customEnabled: 'הפקודה פעילה',
    customAgentEnabled: 'זמינה למצב Agent', customSave: 'שמירת פקודה מותאמת',
    customCancelEdit: 'ביטול העריכה', customEditHeading: 'עריכת פקודה מותאמת',
    customFormError: 'יש להשלים שם, בין ביטוי ייחודי אחד ל־20 ומזהה יעד תקין אחד.',
    agentAvailable: 'זמין למצב Agent', agentPrivate: 'מוסתר ממצב Agent',
    phrasesRequired: 'יש להזין בין ביטוי ייחודי אחד ל־20, ביטוי אחד בכל שורה.',
    sonioxCredentialConfigure: 'הגדרת פרטי גישה ל־Soniox', sonioxCredentialReplace: 'החלפת פרטי גישה ל־Soniox',
    sonioxConsentReview: 'בדיקת הסכמה לעיבוד מרוחק', sonioxTest: 'בדיקת הגדרת Soniox',
    sonioxRevoke: 'ביטול ההסכמה ל־Soniox',
    actionPreviewTitle: 'בדיקת פעולה ממתינה',
    actionPreviewWarning: 'התצוגה הזו אינה מעניקה סמכות. המשך סוגר אותה לפני ש־VS Code מבקש אישור מקורי נפרד.',
    keepPending: 'השארה בהמתנה', cancelPendingAction: 'ביטול הפעולה הממתינה',
    confirmPendingNative: 'המשך לאישור מקורי',
    routes: {
      home: { title: 'בית', purpose: 'לראות מה מוכן ומהו הצעד הבטוח הבא.' },
      voice: { title: 'קול ומיקרופון', purpose: 'בדיקת יכולות המיקרופון, התמלול וקול המערכת.' },
      commands: { title: 'פקודות', purpose: 'חיפוש וניהול של קטלוג הפקודות המוגבל.' },
      assistant: { title: 'עוזר וספקים', purpose: 'בחירת ספק ובדיקת היכולות שלו.' },
      privacy: { title: 'פרטיות ובטיחות', purpose: 'גבולות העיבוד המרוחק והאוטומציה.' },
      diagnostics: { title: 'אבחון', purpose: 'להבין מדוע יכולת אינה זמינה.' },
    },
  },
};
