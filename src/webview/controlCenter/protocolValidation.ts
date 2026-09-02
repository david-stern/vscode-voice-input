const MAX_ENVELOPE_BYTES = 64 * 1024;
const MAX_DEPTH = 4;
const MAX_NODES = 256;
const MAX_PROPERTIES = 128;
const MAX_ARRAY_ITEMS = 64;
const MAX_SCALARS = 100;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const AUTHORITY_KEYS = new Set([
  'confirmed',
  'approved',
  'receipt',
  'nonce',
  'effectiveautomode',
  'consentgranted',
  'outcome',
]);
const COMMAND_ID = /^[\x21-\x7E]{1,80}$/u;

export interface ControlCenterParserOptions {
  isKnownCommandId?: (commandId: string) => boolean;
}

export function inspectEnvelope(
  value: unknown,
  rejectAuthority: boolean,
): Record<string, unknown> | undefined {
  const root = plainRecord(value);
  if (!root) return undefined;
  const counts = { nodes: 0, properties: 0, items: 0, scalars: 0 };
  const seen = new Set<object>();
  if (!inspectValue(root, 1, counts, seen, rejectAuthority)) return undefined;
  try {
    const encoded = JSON.stringify(root);
    if (encoded === undefined || byteLength(encoded) > MAX_ENVELOPE_BYTES) return undefined;
  } catch {
    return undefined;
  }
  return root;
}

function inspectValue(
  value: unknown,
  depth: number,
  counts: { nodes: number; properties: number; items: number; scalars: number },
  seen: Set<object>,
  rejectAuthority: boolean,
): boolean {
  counts.nodes += 1;
  if (counts.nodes > MAX_NODES || depth > MAX_DEPTH) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))) {
    counts.scalars += 1;
    return counts.scalars <= MAX_SCALARS;
  }
  if (typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    counts.items += value.length;
    if (counts.items > MAX_ARRAY_ITEMS) return false;
    return value.every((item) => inspectValue(item, depth + 1, counts, seen, rejectAuthority));
  }
  if (!plainRecord(value)) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors);
  counts.properties += keys.length;
  if (counts.properties > MAX_PROPERTIES) return false;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !('value' in descriptor) || FORBIDDEN_KEYS.has(key)) return false;
    if (rejectAuthority && AUTHORITY_KEYS.has(key.toLocaleLowerCase('en-US'))) return false;
    if (!inspectValue(descriptor.value, depth + 1, counts, seen, rejectAuthority)) return false;
  }
  return true;
}

export function plainRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null
    ? value as Record<string, unknown>
    : undefined;
}

export function exact(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  return actual.length === keys.length && keys.every((key, index) => actual[index] === [...keys].sort()[index]);
}

export function optionalExact(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const keys = Object.keys(record);
  return required.every((key) => Object.hasOwn(record, key))
    && keys.every((key) => required.includes(key) || optional.includes(key));
}

export function isRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function isIntegerIn(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;
}

export function isCodePointString(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  if (typeof value !== 'string') return false;
  const length = codePointLength(value);
  return length >= minimum && length <= maximum;
}

export function codePointLength(value: string): number {
  return Array.from(value).length;
}

export function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function isPhraseList(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) return false;
  let total = 0;
  const unique = new Set<string>();
  for (const phrase of value) {
    if (!isCodePointString(phrase, 1, 120) || unique.has(phrase)) return false;
    unique.add(phrase);
    total += codePointLength(phrase);
  }
  return total <= 1200;
}

export function isCommandId(
  value: unknown,
  options: ControlCenterParserOptions,
): value is string {
  return typeof value === 'string'
    && COMMAND_ID.test(value)
    && (options.isKnownCommandId?.(value) ?? true);
}
