import { randomBytes } from 'node:crypto';

import {
  CUSTOM_MAPPING_SCHEMA_VERSION,
  CUSTOM_MAPPING_STORAGE_KEY,
  MAPPING_ID_PATTERN,
  MAX_CUSTOM_MAPPINGS,
  MappingError,
  type CustomMapping,
  type CustomMappingPayload,
  type MappingLoadResult,
  type MappingStorage,
  type MappingTargetCatalog,
} from './mappingTypes';
import {
  cloneMapping,
  findMappingByPhrase,
  isUnavailableTargetRiskReduction,
  normalizeMappingPhrase,
  validateCustomMappingPayload,
  validateDraft,
} from './mappingValidation';

export class CustomMappingRegistry {
  private mappings: CustomMapping[] = [];
  private readonly idFactory: () => string;

  constructor(
    private readonly storage: MappingStorage,
    options: { idFactory?: () => string } = {},
  ) {
    this.idFactory = options.idFactory ?? generateMappingId;
  }

  load(): MappingLoadResult {
    const raw = this.storage.get<unknown>(CUSTOM_MAPPING_STORAGE_KEY);
    if (raw === undefined) {
      this.mappings = [];
      return { mappings: [], corrupted: false };
    }
    try {
      const payload = validateCustomMappingPayload(raw);
      this.mappings = payload.mappings.map(cloneMapping);
      return { mappings: this.list(), corrupted: false };
    } catch (error) {
      const mappingError = error instanceof MappingError
        ? error
        : new MappingError('invalid-payload', error);
      this.mappings = [];
      return { mappings: [], corrupted: true, error: mappingError };
    }
  }

  list(): readonly CustomMapping[] {
    return this.mappings.map(cloneMapping);
  }

  get(id: string): CustomMapping | undefined {
    const found = this.mappings.find((mapping) => mapping.id === id);
    return found ? cloneMapping(found) : undefined;
  }

  matchPhrase(postWakeText: string): CustomMapping | undefined {
    return findMappingByPhrase(this.mappings, postWakeText);
  }

  async create(draft: unknown, catalog: MappingTargetCatalog): Promise<CustomMapping> {
    if (this.mappings.length >= MAX_CUSTOM_MAPPINGS) throw new MappingError('mapping-limit');
    const validated = validateDraft(draft, catalog);
    this.assertUniquePhrases(validated.phrases);
    const mapping = { id: this.nextId(), ...validated } as CustomMapping;
    await this.persist([...this.mappings, mapping]);
    return cloneMapping(mapping);
  }

  /** Every edit is an atomic delete-and-create with a fresh authority ID. */
  async replace(
    previousId: string,
    draft: unknown,
    catalog: MappingTargetCatalog,
  ): Promise<CustomMapping> {
    const index = this.mappings.findIndex((mapping) => mapping.id === previousId);
    if (index < 0) throw new MappingError('mapping-not-found');
    const previous = this.mappings[index];
    const validated = validateDraft(draft, undefined);
    const targetAvailable = validated.kind === 'command'
      ? catalog.commands.has(validated.commandId)
      : catalog.tools.has(validated.toolName);
    if (!targetAvailable && !isUnavailableTargetRiskReduction(previous, validated)) {
      throw new MappingError('target-unavailable');
    }
    this.assertUniquePhrases(validated.phrases, previousId);
    const replacement = { id: this.nextId(), ...validated } as CustomMapping;
    const next = [...this.mappings];
    next[index] = replacement;
    await this.persist(next);
    return cloneMapping(replacement);
  }

  async delete(id: string): Promise<void> {
    const next = this.mappings.filter((mapping) => mapping.id !== id);
    if (next.length === this.mappings.length) throw new MappingError('mapping-not-found');
    await this.persist(next);
  }

  private assertUniquePhrases(phrases: readonly string[], ignoredId?: string): void {
    const existing = new Set(
      this.mappings
        .filter((mapping) => mapping.id !== ignoredId)
        .flatMap((mapping) => mapping.phrases.map(normalizeMappingPhrase)),
    );
    for (const phrase of phrases) {
      const normalized = normalizeMappingPhrase(phrase);
      if (existing.has(normalized)) throw new MappingError('duplicate-phrase');
      existing.add(normalized);
    }
  }

  private nextId(): string {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const id = this.idFactory();
      if (!MAPPING_ID_PATTERN.test(id)) throw new MappingError('invalid-id');
      if (!this.mappings.some((mapping) => mapping.id === id)) return id;
    }
    throw new MappingError('invalid-id');
  }

  private async persist(next: readonly CustomMapping[]): Promise<void> {
    const payload: CustomMappingPayload = {
      schemaVersion: CUSTOM_MAPPING_SCHEMA_VERSION,
      mappings: next.map(cloneMapping),
    };
    try {
      await this.storage.update(CUSTOM_MAPPING_STORAGE_KEY, payload);
    } catch (error) {
      throw new MappingError('storage-failed', error);
    }
    this.mappings = payload.mappings.map(cloneMapping);
  }
}

function generateMappingId(): string {
  return `vm_${randomBytes(18).toString('base64url')}`;
}
