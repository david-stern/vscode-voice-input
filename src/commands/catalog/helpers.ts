import type {
  BuiltinCommandCategory,
  BuiltinCommandDefinition,
  BuiltinRiskTier,
  BuiltinSlotDefinition,
} from '../contracts';

export interface CatalogRow {
  suffix: string;
  en: string;
  he: string;
  command: string;
  risk?: BuiltinRiskTier;
  slot?: BuiltinSlotDefinition;
  remote?: false;
}

export function definitions(
  category: BuiltinCommandCategory,
  rows: readonly CatalogRow[],
): readonly BuiltinCommandDefinition[] {
  return Object.freeze(rows.map((row) => Object.freeze({
    id: `voiceInput.builtin.${row.suffix}` as const,
    category,
    label: Object.freeze({ en: row.en, he: row.he }),
    description: Object.freeze({
      en: `Run ${row.en}.`,
      he: `הפעלת ${row.he}.`,
    }),
    phrases: Object.freeze({ en: Object.freeze([row.en]), he: Object.freeze([row.he]) }),
    slots: Object.freeze(row.slot ? [Object.freeze(row.slot)] : []),
    executorId: row.command,
    enabledByDefault: true,
    riskTier: row.risk ?? 'automatic',
    availability: Object.freeze({
      minimumVscodeVersion: '1.99.0' as const,
      localTrustedOnly: true,
      remote: row.remote ?? 'supported' as const,
      ...(row.command.startsWith('api.') || row.command.startsWith('git.')
        ? {}
        : { requiredCommand: row.command }),
    }),
    fallback: 'none' as const,
  })));
}

export const slot = (name: string, kind: BuiltinSlotDefinition['kind']): BuiltinSlotDefinition => ({
  name,
  kind,
  required: true,
});
