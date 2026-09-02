import { normalizeMappingPhrase } from '../assistant/mappingValidation';
import type {
  BuiltinSlotContext,
  BuiltinSlotDefinition,
  BuiltinSlotValue,
  WorkspaceFileCandidate,
} from './contracts';

export const MAX_QUERY_CODE_POINTS = 256;
export const MAX_COMMIT_MESSAGE_CODE_POINTS = 500;
export const MAX_NEW_REF_CODE_POINTS = 128;
export const MAX_FILE_CANDIDATES = 500;
export const MAX_REF_CANDIDATES = 500;

const CONTROL_OR_BIDI = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const NEW_REF_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._/-]{0,126}[A-Za-z0-9])?$/u;

export type SlotParseResult =
  | { ok: true; value: BuiltinSlotValue }
  | { ok: false };

export function parseBuiltinSlot(
  definition: BuiltinSlotDefinition,
  raw: string,
  context: BuiltinSlotContext,
): SlotParseResult {
  switch (definition.kind) {
    case 'line':
      return parseLine(raw, context.documentLineCount);
    case 'workspaceFile':
      return parseWorkspaceFile(raw, context.workspaceFiles);
    case 'query':
      return parseQuery(raw);
    case 'commitMessage':
      return parseCommitMessage(raw);
    case 'existingRef':
      return parseExistingRef(raw, context.existingRefs);
    case 'newRef':
      return parseNewRef(raw);
  }
}

export function parseLine(raw: string, lineCount: number | undefined): SlotParseResult {
  if (!/^[1-9][0-9]{0,8}$/u.test(raw.trim())) return { ok: false };
  const value = Number(raw.trim());
  if (
    typeof lineCount !== 'number'
    || !Number.isSafeInteger(lineCount)
    || lineCount < 1
    || value > lineCount
  ) return { ok: false };
  return { ok: true, value };
}

export function parseQuery(raw: string): SlotParseResult {
  const value = normalizeBoundedText(raw, MAX_QUERY_CODE_POINTS, true);
  return value === undefined ? { ok: false } : { ok: true, value };
}

export function parseCommitMessage(raw: string): SlotParseResult {
  const value = raw.normalize('NFKC').trim();
  if (
    !value
    || codePointLength(value) > MAX_COMMIT_MESSAGE_CODE_POINTS
    || CONTROL_OR_BIDI.test(value)
    || /[\r\n]/u.test(value)
  ) return { ok: false };
  return { ok: true, value };
}

export function parseNewRef(raw: string): SlotParseResult {
  const value = raw.normalize('NFKC').trim();
  if (
    !value
    || codePointLength(value) > MAX_NEW_REF_CODE_POINTS
    || !NEW_REF_PATTERN.test(value)
    || value.includes('..')
    || value.includes('//')
    || value.includes('@{')
    || value.startsWith('.')
    || value.endsWith('.')
    || value.endsWith('/')
    || value.endsWith('.lock')
    || value.split('/').some((part) => !part || part.startsWith('.') || part.endsWith('.'))
  ) return { ok: false };
  return { ok: true, value };
}

export function parseExistingRef(
  raw: string,
  candidates: readonly string[] | undefined,
): SlotParseResult {
  if (!candidates || candidates.length < 1 || candidates.length > MAX_REF_CANDIDATES) {
    return { ok: false };
  }
  const wanted = normalizeMappingPhrase(raw);
  const matches = candidates.filter((candidate) =>
    codePointLength(candidate) <= MAX_NEW_REF_CODE_POINTS
    && normalizeMappingPhrase(candidate) === wanted,
  );
  return matches.length === 1 ? { ok: true, value: matches[0] } : { ok: false };
}

export function parseWorkspaceFile(
  raw: string,
  candidates: readonly WorkspaceFileCandidate[] | undefined,
): SlotParseResult {
  if (!candidates || candidates.length < 1 || candidates.length > MAX_FILE_CANDIDATES) {
    return { ok: false };
  }
  const wanted = normalizeMappingPhrase(raw);
  const matches = candidates.filter((candidate) => {
    if (!validCandidate(candidate)) return false;
    const basename = candidate.relativePath.split('/').pop() ?? candidate.relativePath;
    return [candidate.label, candidate.relativePath, basename]
      .some((value) => normalizeMappingPhrase(value) === wanted);
  });
  return matches.length === 1 ? { ok: true, value: { ...matches[0] } } : { ok: false };
}

function normalizeBoundedText(
  raw: string,
  maximumCodePoints: number,
  allowSpaces: boolean,
): string | undefined {
  const value = raw.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (
    !value
    || codePointLength(value) > maximumCodePoints
    || CONTROL_OR_BIDI.test(value)
    || (!allowSpaces && /\s/u.test(value))
  ) return undefined;
  return value;
}

function validCandidate(candidate: WorkspaceFileCandidate): boolean {
  return Boolean(
    normalizeBoundedText(candidate.id, 1024, true)
    && normalizeBoundedText(candidate.label, 256, true)
    && normalizeBoundedText(candidate.relativePath, 1024, true),
  );
}

function codePointLength(value: string): number {
  return [...value].length;
}
