export const CUSTOM_MAPPING_STORAGE_KEY = 'voiceInput.customMappings';
export const CUSTOM_MAPPING_SCHEMA_VERSION = 1 as const;
export const MAX_CUSTOM_MAPPINGS = 50;
export const MAX_MAPPING_JSON_BYTES = 8 * 1024;
export const MAX_MAPPING_JSON_DEPTH = 4;
export const DEFAULT_MAPPING_CONFIRMATION_TTL_MS = 12_000;
export const DEFAULT_AGENT_MAPPING_PAGE_SIZE = 10;
export const MAX_AGENT_MAPPING_PAGE_SIZE = 20;
export const MAX_AGENT_MAPPING_RESULT_CHARS = 24_000;

export const MAPPING_ID_PATTERN = /^vm_[A-Za-z0-9_-]{22,64}$/u;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

interface MappingPresentation {
  label: string;
  description: string;
  phrases: string[];
  enabled: boolean;
  agentEnabled: boolean;
}

export interface CommandMappingDraft extends MappingPresentation {
  kind: 'command';
  commandId: string;
  args: JsonValue[];
}

export interface LanguageModelToolMappingDraft extends MappingPresentation {
  kind: 'language-model-tool';
  toolName: string;
  input: JsonObject;
}

export type CustomMappingDraft = CommandMappingDraft | LanguageModelToolMappingDraft;
export type CustomMapping = CustomMappingDraft & { id: string };

export interface CustomMappingPayload {
  schemaVersion: typeof CUSTOM_MAPPING_SCHEMA_VERSION;
  mappings: CustomMapping[];
}

export interface MappingTargetCatalog {
  commands: ReadonlySet<string>;
  tools: ReadonlySet<string>;
}

export interface AgentMappingSummary {
  mappingId: string;
  label: string;
  description: string;
}

export interface AgentMappingPage {
  mappings: AgentMappingSummary[];
  nextCursor: number | null;
  total: number;
}

export interface MappingStorage {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

export type MappingErrorCode =
  | 'invalid-payload'
  | 'invalid-id'
  | 'mapping-limit'
  | 'invalid-label'
  | 'invalid-description'
  | 'invalid-phrase'
  | 'reserved-phrase'
  | 'duplicate-phrase'
  | 'invalid-target'
  | 'target-unavailable'
  | 'invalid-json'
  | 'mapping-not-found'
  | 'storage-failed';

const ERROR_MESSAGES: Record<MappingErrorCode, { en: string; he: string }> = {
  'invalid-payload': {
    en: 'The saved custom-command data is invalid, so it was not loaded.',
    he: 'נתוני הפקודות המותאמות שנשמרו אינם תקינים, ולכן לא נטענו.',
  },
  'invalid-id': {
    en: 'The mapping identifier is invalid.',
    he: 'מזהה המיפוי אינו תקין.',
  },
  'mapping-limit': {
    en: `You can save up to ${MAX_CUSTOM_MAPPINGS} custom commands.`,
    he: `אפשר לשמור עד ${MAX_CUSTOM_MAPPINGS} פקודות מותאמות.`,
  },
  'invalid-label': {
    en: 'Enter a short, plain-text label for this command.',
    he: 'יש להזין שם קצר בטקסט פשוט לפקודה.',
  },
  'invalid-description': {
    en: 'The description is too long or contains unsafe characters.',
    he: 'התיאור ארוך מדי או כולל תווים לא בטוחים.',
  },
  'invalid-phrase': {
    en: 'Add one to eight short, plain-text voice phrases.',
    he: 'יש להוסיף בין ביטוי קולי קצר אחד לשמונה.',
  },
  'reserved-phrase': {
    en: 'That phrase is reserved for a built-in safety action.',
    he: 'הביטוי הזה שמור לפעולת בטיחות מובנית.',
  },
  'duplicate-phrase': {
    en: 'Each normalized voice phrase must be unique.',
    he: 'כל ביטוי קולי מנורמל חייב להיות ייחודי.',
  },
  'invalid-target': {
    en: 'Choose a public, non-recursive VS Code command or language-model tool.',
    he: 'יש לבחור פקודת VS Code או כלי מודל ציבוריים שאינם מפעילים את המיפוי מחדש.',
  },
  'target-unavailable': {
    en: 'The selected command or tool is not currently available.',
    he: 'הפקודה או הכלי שנבחרו אינם זמינים כעת.',
  },
  'invalid-json': {
    en: 'Static input must be small, plain JSON without templates or command links.',
    he: 'הקלט הקבוע חייב להיות JSON קטן ופשוט, ללא תבניות או קישורי פקודה.',
  },
  'mapping-not-found': {
    en: 'That mapping no longer exists.',
    he: 'המיפוי הזה כבר אינו קיים.',
  },
  'storage-failed': {
    en: 'The mapping could not be saved.',
    he: 'לא ניתן היה לשמור את המיפוי.',
  },
};

export class MappingError extends Error {
  readonly en: string;
  readonly he: string;

  constructor(readonly code: MappingErrorCode, cause?: unknown) {
    super(ERROR_MESSAGES[code].en, cause === undefined ? undefined : { cause });
    this.name = 'MappingError';
    this.en = ERROR_MESSAGES[code].en;
    this.he = ERROR_MESSAGES[code].he;
  }
}

export interface MappingLoadResult {
  mappings: readonly CustomMapping[];
  corrupted: boolean;
  error?: MappingError;
}

export type MappingCapabilityFailure =
  | 'no-pending-action'
  | 'confirmation-expired'
  | 'invalid-confirmation'
  | 'same-utterance-confirmation'
  | 'confirmation-not-later'
  | 'confirmation-replayed'
  | 'mapping-changed'
  | 'target-changed';

export type MappingCapabilityDecision =
  | { allowed: true; mappingId: string; fingerprint: string }
  | { allowed: false; reason: MappingCapabilityFailure };
