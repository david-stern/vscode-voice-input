import {
  CustomMappingRegistry,
  type CustomMapping,
  type CustomMappingDraft,
  type MappingStorage,
  type MappingTargetCatalog,
} from '../../assistant/mappings';
import type { AssistantMappingSummary } from '../../webview/protocol';

/**
 * Owns the persisted mapping registry and its fail-closed corruption flag.
 * All mutations continue to rotate authority IDs inside CustomMappingRegistry.
 */
export class MappingStore {
  private readonly registry: CustomMappingRegistry;
  private storageCorrupted: boolean;
  private observedState: string;

  constructor(storage: MappingStorage, options: { idFactory?: () => string } = {}) {
    this.registry = new CustomMappingRegistry(storage, options);
    this.storageCorrupted = this.registry.load().corrupted;
    this.observedState = this.serializeObservedState();
  }

  /** Re-read native storage so no mutation is based on a stale in-memory registry. */
  reload(): { changed: boolean; corrupted: boolean } {
    const loaded = this.registry.load();
    this.storageCorrupted = loaded.corrupted;
    const observedState = this.serializeObservedState();
    const changed = observedState !== this.observedState;
    this.observedState = observedState;
    return { changed, corrupted: this.storageCorrupted };
  }

  get corrupted(): boolean {
    return this.storageCorrupted;
  }

  list(): readonly CustomMapping[] {
    return this.registry.list();
  }

  get(id: string): CustomMapping | undefined {
    return this.registry.get(id);
  }

  matchPhrase(postWakeText: string): CustomMapping | undefined {
    return this.registry.matchPhrase(postWakeText);
  }

  summary(workspaceTrusted: boolean): AssistantMappingSummary {
    const mappings = this.registry.list();
    return {
      total: mappings.length,
      enabled: mappings.filter((mapping) => mapping.enabled).length,
      agentExposed: mappings.filter(
        (mapping) => mapping.enabled && mapping.agentEnabled,
      ).length,
      status: this.storageCorrupted
        ? 'error'
        : workspaceTrusted ? 'ready' : 'untrusted',
    };
  }

  async create(
    draft: CustomMappingDraft,
    catalog: MappingTargetCatalog,
  ): Promise<CustomMapping> {
    const saved = await this.registry.create(draft, catalog);
    this.storageCorrupted = false;
    this.observedState = this.serializeObservedState();
    return saved;
  }

  async replace(
    id: string,
    draft: CustomMappingDraft,
    catalog: MappingTargetCatalog,
  ): Promise<CustomMapping> {
    const saved = await this.registry.replace(id, draft, catalog);
    this.storageCorrupted = false;
    this.observedState = this.serializeObservedState();
    return saved;
  }

  async delete(id: string): Promise<void> {
    await this.registry.delete(id);
    this.storageCorrupted = false;
    this.observedState = this.serializeObservedState();
  }

  private serializeObservedState(): string {
    return JSON.stringify({
      corrupted: this.storageCorrupted,
      mappings: this.registry.list(),
    });
  }
}
