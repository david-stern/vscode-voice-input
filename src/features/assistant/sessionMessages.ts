import { ASSISTANT_SAMPLE_RATE } from '../../assistant';

export type AssistantSessionMessageKey =
  | 'streaming-failed'
  | 'sample-rate'
  | 'start-failed'
  | 'credential-lost'
  | 'consent-revoked'
  | 'capture-error'
  | 'capture-limit'
  | 'capture-restart-failed'
  | 'queue-overflow'
  | 'audio-backlog'
  | 'audio-failed'
  | 'planning-failed'
  | 'transcription-failed';

/** Every listening stop is announced with one fixed, content-free bilingual message. */
const MESSAGES: Readonly<Record<AssistantSessionMessageKey, readonly [string, string]>> =
  Object.freeze({
    'streaming-failed': [
      'Voice Input assistant stopped because remote transcription failed safely.',
      'Voice Input: העוזר הופסק בבטחה מפני שהתמלול המרוחק נכשל.',
    ],
    'sample-rate': [
      `Voice Input assistant requires ${ASSISTANT_SAMPLE_RATE} Hz audio.`,
      `Voice Input: העוזר דורש שמע בקצב ${ASSISTANT_SAMPLE_RATE} הרץ.`,
    ],
    'start-failed': [
      'Voice Input assistant could not start safely.',
      'Voice Input: לא ניתן היה להפעיל את העוזר באופן בטוח.',
    ],
    'credential-lost': [
      'Voice Input assistant stopped because the Soniox API key is no longer available.',
      'Voice Input: העוזר הופסק מפני שמפתח ה-API של Soniox אינו זמין עוד.',
    ],
    'consent-revoked': [
      'Voice Input assistant stopped because listening consent was revoked.',
      'Voice Input: העוזר הופסק מפני שהסכמת ההאזנה בוטלה.',
    ],
    'capture-error': [
      'Voice Input assistant stopped because microphone capture failed safely.',
      'Voice Input: ההאזנה של העוזר הופסקה בבטחה בגלל שגיאת מיקרופון.',
    ],
    'capture-limit': [
      'Voice Input assistant stopped because microphone capture failed.',
      'Voice Input: ההאזנה של העוזר הופסקה בגלל שגיאת מיקרופון.',
    ],
    'capture-restart-failed': [
      'Voice Input assistant stopped because microphone capture could not restart safely.',
      'Voice Input: העוזר הופסק מפני שלא ניתן היה לחדש את קליטת המיקרופון בבטחה.',
    ],
    'queue-overflow': [
      'Voice Input assistant stopped: transcription queue overflow.',
      'Voice Input: העוזר הופסק מפני שתור התמלול התמלא.',
    ],
    'audio-backlog': [
      'Voice Input assistant stopped: audio processing could not keep up.',
      'Voice Input: העוזר הופסק מפני שעיבוד השמע לא עמד בקצב.',
    ],
    'audio-failed': [
      'Voice Input assistant stopped because local audio processing failed safely.',
      'Voice Input: העוזר הופסק בבטחה בגלל שגיאה בעיבוד השמע המקומי.',
    ],
    'planning-failed': [
      'Voice Input assistant stopped because planning failed safely.',
      'Voice Input: העוזר הופסק בבטחה בגלל שגיאת תכנון.',
    ],
    'transcription-failed': [
      'Voice Input assistant stopped because transcription failed safely.',
      'Voice Input: העוזר הופסק בבטחה בגלל שגיאת תמלול.',
    ],
  });

export function assistantSessionMessage(
  key: AssistantSessionMessageKey,
  localize: (english: string, hebrew: string) => string,
): string {
  const [english, hebrew] = MESSAGES[key];
  return localize(english, hebrew);
}
