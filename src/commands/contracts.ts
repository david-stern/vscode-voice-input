export const BUILTIN_COMMAND_CATEGORIES = Object.freeze([
  'editing',
  'cursor-selection',
  'files-tabs-groups',
  'search-navigation',
  'code-refactor',
  'panels-debug-tests',
  'git',
] as const);

export type BuiltinCommandCategory = (typeof BUILTIN_COMMAND_CATEGORIES)[number];
export type BuiltinRiskTier = 'automatic' | 'confirmation-required';
export type BuiltinSlotKind =
  | 'line'
  | 'workspaceFile'
  | 'query'
  | 'commitMessage'
  | 'existingRef'
  | 'newRef';

export interface LocalizedText {
  en: string;
  he: string;
}

export interface LocalizedPhrases {
  en: readonly string[];
  he: readonly string[];
}

export interface BuiltinSlotDefinition {
  name: string;
  kind: BuiltinSlotKind;
  required: true;
}

export interface BuiltinAvailability {
  minimumVscodeVersion: '1.99.0';
  localTrustedOnly: boolean;
  remote: false | 'supported';
  requiredCommand?: string;
}

export interface BuiltinCommandDefinition {
  id: `voiceInput.builtin.${string}`;
  category: BuiltinCommandCategory;
  label: Readonly<LocalizedText>;
  description: Readonly<LocalizedText>;
  phrases: Readonly<LocalizedPhrases>;
  slots: readonly Readonly<BuiltinSlotDefinition>[];
  executorId: string;
  enabledByDefault: boolean;
  riskTier: BuiltinRiskTier;
  availability: Readonly<BuiltinAvailability>;
  fallback: 'none';
}

export interface WorkspaceFileCandidate {
  /** Opaque host-owned identity. It may be a URI string but never browser-authored. */
  id: string;
  label: string;
  relativePath: string;
}

export interface BuiltinSlotContext {
  documentLineCount?: number;
  workspaceFiles?: readonly WorkspaceFileCandidate[];
  existingRefs?: readonly string[];
}

export type BuiltinSlotValue = number | string | WorkspaceFileCandidate;
export type BuiltinSlotValues = Readonly<Record<string, BuiltinSlotValue>>;

export type BuiltinMatchResult =
  | {
      status: 'matched';
      definition: BuiltinCommandDefinition;
      slots: BuiltinSlotValues;
    }
  | {
      status: 'unmatched' | 'ambiguous' | 'invalid-slot' | 'unavailable';
    };

export interface BuiltinMatchContext extends BuiltinSlotContext {
  isAvailable(definition: BuiltinCommandDefinition): boolean;
}

export interface BuiltinTargetSnapshot {
  fingerprint: string;
  workspaceTrusted: boolean;
  remoteName?: string;
}

export interface PreparedBuiltinExecution {
  definition: BuiltinCommandDefinition;
  slots: BuiltinSlotValues;
  targetFingerprint: string;
  definitionFingerprint: string;
}

export type BuiltinExecutionFailure =
  | 'workspace-untrusted'
  | 'remote-unavailable'
  | 'cancelled'
  | 'busy'
  | 'target-unavailable'
  | 'target-changed'
  | 'authority-changed'
  | 'definition-changed'
  | 'invalid-slot'
  | 'partial'
  | 'outcome-unknown-do-not-retry'
  | 'execution-failed';

export type BuiltinExecutionResult =
  | { ok: true; commandId: string }
  | { ok: false; reason: BuiltinExecutionFailure };

export interface BuiltinCancellationToken {
  readonly isCancellationRequested: boolean;
}

export interface BuiltinExecutionAuthorityPort {
  snapshot(): { effective: boolean; epoch: number; fingerprint: string };
}

export interface BuiltinCommandHost {
  captureTarget(definition: BuiltinCommandDefinition): Promise<BuiltinTargetSnapshot>;
  isAvailable(definition: BuiltinCommandDefinition): Promise<boolean>;
  execute(
    definition: BuiltinCommandDefinition,
    slots: BuiltinSlotValues,
    expectedTargetFingerprint: string,
  ): PromiseLike<void>;
}

export type GitCommandHost = BuiltinCommandHost;

export interface BuiltinOverride {
  enabled?: boolean;
  label?: Readonly<LocalizedText>;
  description?: Readonly<LocalizedText>;
  phrases?: Readonly<LocalizedPhrases>;
}

export interface BuiltinOverrideStorage {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}
