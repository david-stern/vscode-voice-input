import { normalizeMappingPhrase } from '../assistant/mappingValidation';
import { BUILTIN_COMMAND_CATALOG } from './catalog';
import type {
  BuiltinCommandDefinition,
  BuiltinMatchContext,
  BuiltinMatchResult,
  BuiltinSlotValues,
} from './contracts';
import { parseBuiltinSlot } from './slotParsers';

interface TemplateCandidate {
  definition: BuiltinCommandDefinition;
  phrase: string;
  slotRaw: string;
  specificity: number;
}

export function matchBuiltinCommand(
  utterance: string,
  context: BuiltinMatchContext,
  catalog: readonly BuiltinCommandDefinition[] = BUILTIN_COMMAND_CATALOG,
): BuiltinMatchResult {
  const normalized = normalizeMappingPhrase(utterance);
  if (!normalized) return { status: 'unmatched' };

  const exact = catalog.filter((definition) =>
    definition.slots.length === 0
    && allPhrases(definition).some((phrase) => normalizeMappingPhrase(phrase) === normalized),
  );
  if (exact.length > 0) return resolveExact(exact, context);

  const templates = catalog.flatMap((definition) => templateMatches(definition, utterance));
  if (templates.length === 0) return { status: 'unmatched' };
  const maximum = Math.max(...templates.map((candidate) => candidate.specificity));
  const mostSpecific = templates.filter((candidate) => candidate.specificity === maximum);
  const ids = new Set(mostSpecific.map((candidate) => candidate.definition.id));
  if (ids.size !== 1) return { status: 'ambiguous' };
  const candidate = mostSpecific[0];
  if (!context.isAvailable(candidate.definition)) return { status: 'unavailable' };
  const slot = candidate.definition.slots[0];
  if (!slot) return { status: 'invalid-slot' };
  const parsed = parseBuiltinSlot(slot, candidate.slotRaw, context);
  if (!parsed.ok) return { status: 'invalid-slot' };
  return {
    status: 'matched',
    definition: candidate.definition,
    slots: Object.freeze({ [slot.name]: parsed.value }) as BuiltinSlotValues,
  };
}

function resolveExact(
  definitions: readonly BuiltinCommandDefinition[],
  context: BuiltinMatchContext,
): BuiltinMatchResult {
  const ids = new Set(definitions.map((definition) => definition.id));
  if (ids.size !== 1) return { status: 'ambiguous' };
  const definition = definitions[0];
  if (!context.isAvailable(definition)) return { status: 'unavailable' };
  return { status: 'matched', definition, slots: Object.freeze({}) };
}

function templateMatches(
  definition: BuiltinCommandDefinition,
  utterance: string,
): TemplateCandidate[] {
  if (definition.slots.length !== 1) return [];
  const slot = definition.slots[0];
  const marker = `{${slot.name}}`;
  return allPhrases(definition).flatMap((phrase) => {
    const normalizedPhrase = phrase.normalize('NFKC');
    const index = normalizedPhrase.indexOf(marker);
    if (index < 0 || normalizedPhrase.indexOf(marker, index + marker.length) >= 0) return [];
    const before = normalizedPhrase.slice(0, index);
    const after = normalizedPhrase.slice(index + marker.length);
    const expression = new RegExp(`^${literalPattern(before)}(.+?)${literalPattern(after)}$`, 'iu');
    const matched = expression.exec(utterance.normalize('NFKC').trim());
    const slotRaw = matched?.[1]?.trim() ?? '';
    if (!slotRaw) return [];
    return [{
      definition,
      phrase,
      slotRaw,
      specificity: [...normalizeMappingPhrase(`${before}${after}`)].length,
    }];
  });
}

function literalPattern(value: string): string {
  return value.split(/(\s+)/u).map((part) =>
    /^\s+$/u.test(part) ? '\\s+' : part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'),
  ).join('');
}

function allPhrases(definition: BuiltinCommandDefinition): readonly string[] {
  return [...definition.phrases.en, ...definition.phrases.he];
}
