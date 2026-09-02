import { BUILTIN_COMMAND_BY_ID } from './catalog';
import type {
  BuiltinCommandDefinition,
  BuiltinOverride,
  BuiltinOverrideStorage,
  LocalizedPhrases,
  LocalizedText,
} from './contracts';

export const BUILTIN_OVERRIDE_STORAGE_KEY = 'voiceInput.builtinCommandOverrides.v1';
export const BUILTIN_OVERRIDE_SCHEMA_VERSION = 1 as const;

interface OverridePayload {
  schemaVersion: typeof BUILTIN_OVERRIDE_SCHEMA_VERSION;
  overrides: Record<string, BuiltinOverride>;
}

export class BuiltinOverrideStore {
  private overrides = new Map<string, BuiltinOverride>();

  constructor(private readonly storage: BuiltinOverrideStorage) {}

  load(): { corrupted: boolean; count: number } {
    try {
      this.overrides = parsePayload(this.storage.get<unknown>(BUILTIN_OVERRIDE_STORAGE_KEY));
      return { corrupted: false, count: this.overrides.size };
    } catch {
      this.overrides.clear();
      return { corrupted: true, count: 0 };
    }
  }

  get(commandId: string): BuiltinOverride | undefined {
    const found = this.overrides.get(commandId);
    return found ? cloneOverride(found) : undefined;
  }

  list(): ReadonlyMap<string, BuiltinOverride> {
    return new Map([...this.overrides].map(([id, value]) => [id, cloneOverride(value)]));
  }

  async set(commandId: string, raw: unknown): Promise<void> {
    if (!BUILTIN_COMMAND_BY_ID.has(commandId)) throw new TypeError('unknown builtin command');
    const override = parseOverride(raw);
    const next = new Map(this.overrides);
    if (Object.keys(override).length === 0) next.delete(commandId);
    else next.set(commandId, override);
    await this.persist(next);
  }

  async reset(commandId: string): Promise<void> {
    if (!BUILTIN_COMMAND_BY_ID.has(commandId)) throw new TypeError('unknown builtin command');
    const next = new Map(this.overrides);
    next.delete(commandId);
    await this.persist(next);
  }

  private async persist(next: ReadonlyMap<string, BuiltinOverride>): Promise<void> {
    const payload: OverridePayload = {
      schemaVersion: BUILTIN_OVERRIDE_SCHEMA_VERSION,
      overrides: Object.fromEntries([...next].map(([id, value]) => [id, cloneOverride(value)])),
    };
    await this.storage.update(BUILTIN_OVERRIDE_STORAGE_KEY, payload);
    this.overrides = new Map([...next].map(([id, value]) => [id, cloneOverride(value)]));
  }
}

export function applyBuiltinOverride(
  definition: BuiltinCommandDefinition,
  override: BuiltinOverride | undefined,
): BuiltinCommandDefinition {
  if (!override) return definition;
  return Object.freeze({
    ...definition,
    enabledByDefault: override.enabled ?? definition.enabledByDefault,
    label: override.label ?? definition.label,
    description: override.description ?? definition.description,
    phrases: override.phrases ?? definition.phrases,
  });
}

function parsePayload(value: unknown): Map<string, BuiltinOverride> {
  if (value === undefined) return new Map();
  if (!plain(value) || value.schemaVersion !== 1 || !plain(value.overrides)) throw new TypeError();
  if (Object.keys(value).length !== 2 || Object.keys(value.overrides).length > 100) throw new TypeError();
  const result = new Map<string, BuiltinOverride>();
  for (const [id, raw] of Object.entries(value.overrides)) {
    if (!BUILTIN_COMMAND_BY_ID.has(id)) throw new TypeError();
    result.set(id, parseOverride(raw));
  }
  return result;
}

function parseOverride(value: unknown): BuiltinOverride {
  if (!plain(value)) throw new TypeError();
  const allowed = new Set(['enabled', 'label', 'description', 'phrases']);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new TypeError();
  const enabled = value.enabled === undefined ? undefined : boolean(value.enabled);
  const label = value.label === undefined ? undefined : localizedText(value.label, 120);
  const description = value.description === undefined
    ? undefined
    : localizedText(value.description, 240, true);
  const phrases = value.phrases === undefined ? undefined : localizedPhrases(value.phrases);
  return {
    ...(enabled === undefined ? {} : { enabled }),
    ...(label === undefined ? {} : { label }),
    ...(description === undefined ? {} : { description }),
    ...(phrases === undefined ? {} : { phrases }),
  };
}

function localizedText(value: unknown, maximum: number, allowEmpty = false): LocalizedText {
  if (!plain(value) || Object.keys(value).sort().join(',') !== 'en,he') throw new TypeError();
  return Object.freeze({
    en: text(value.en, maximum, allowEmpty),
    he: text(value.he, maximum, allowEmpty),
  });
}

function localizedPhrases(value: unknown): LocalizedPhrases {
  if (!plain(value) || Object.keys(value).sort().join(',') !== 'en,he') throw new TypeError();
  const parse = (raw: unknown): readonly string[] => {
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 20) throw new TypeError();
    const phrases = raw.map((entry) => text(entry, 120));
    if (phrases.reduce((total, phrase) => total + [...phrase].length, 0) > 1_200) throw new TypeError();
    if (new Set(phrases.map((phrase) => phrase.toLocaleLowerCase('en-US'))).size !== phrases.length) {
      throw new TypeError();
    }
    return Object.freeze(phrases);
  };
  return Object.freeze({ en: parse(value.en), he: parse(value.he) });
}

function text(value: unknown, maximum: number, allowEmpty = false): string {
  if (typeof value !== 'string') throw new TypeError();
  const normalized = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if ((!allowEmpty && !normalized) || [...normalized].length > maximum || /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(normalized)) {
    throw new TypeError();
  }
  return normalized;
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new TypeError();
  return value;
}

function cloneOverride(value: BuiltinOverride): BuiltinOverride {
  return JSON.parse(JSON.stringify(value)) as BuiltinOverride;
}

function plain(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
