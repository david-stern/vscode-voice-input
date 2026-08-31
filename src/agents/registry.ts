import { randomBytes } from 'node:crypto';

import { normalizePersonaId } from '../assistant/personas';
import {
  DEFAULT_PROVIDER_PROFILES,
  normalizeAssistantProvider,
  normalizeProviderModel,
  normalizeProviderProfiles,
} from '../config/providerProfiles';
import {
  AGENT_ID_PATTERN,
  AGENT_SCHEMA_VERSION,
  AGENT_STORAGE_KEY,
  MAX_AGENTS,
  AgentError,
  type AgentLoadResult,
  type AgentPayload,
  type AgentRecord,
  type AgentStorage,
  type LegacyAgentSettings,
} from './contracts';
import { builtinAgentTemplates } from './templates';
import {
  cloneAgent,
  normalizeAgentName,
  validateAgentDraft,
  validateAgentPayload,
} from './validation';

export interface AgentRegistryOptions {
  idFactory?: () => string;
  legacySettings?: () => LegacyAgentSettings;
}

export interface AgentRegistryDisposable {
  dispose(): void;
}

/** Validated, serialized, secret-free personal-agent registry. */
export class AgentRegistry {
  private agents: AgentRecord[] = [];
  private defaultAgentId: string | undefined;
  private loaded = false;
  private corrupted = false;
  private mutationTail: Promise<void> = Promise.resolve();
  private readonly idFactory: () => string;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly storage: AgentStorage,
    private readonly options: AgentRegistryOptions = {},
  ) {
    this.idFactory = options.idFactory ?? generateAgentId;
  }

  onWillChange(listener: () => void): AgentRegistryDisposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  load(): AgentLoadResult {
    const raw = this.storage.get<unknown>(AGENT_STORAGE_KEY);
    if (raw === undefined) {
      const migrated = this.migrateTemplates(this.options.legacySettings?.());
      this.agents = migrated.agents;
      this.defaultAgentId = migrated.defaultAgentId;
      this.loaded = true;
      this.corrupted = false;
      return this.result(true, false);
    }
    try {
      const payload = validateAgentPayload(raw);
      this.agents = payload.agents.map(cloneAgent);
      this.defaultAgentId = payload.defaultAgentId ?? undefined;
      this.loaded = true;
      this.corrupted = false;
      return this.result(false, false);
    } catch (error) {
      const agentError = error instanceof AgentError
        ? error
        : new AgentError('invalid-payload', error);
      this.agents = [];
      this.defaultAgentId = undefined;
      this.loaded = true;
      this.corrupted = true;
      return { ...this.result(false, true), error: agentError };
    }
  }

  async initialize(): Promise<AgentLoadResult> {
    const loaded = this.load();
    if (!loaded.migrated) return loaded;
    await this.persist(this.agents, this.defaultAgentId);
    return this.result(true, false);
  }

  list(): readonly AgentRecord[] {
    this.ensureLoaded();
    return this.agents.map(cloneAgent);
  }

  get(id: string): AgentRecord | undefined {
    this.ensureLoaded();
    const agent = this.agents.find((candidate) => candidate.id === id);
    return agent ? cloneAgent(agent) : undefined;
  }

  getDefault(): AgentRecord | undefined {
    this.ensureLoaded();
    if (!this.defaultAgentId) return undefined;
    const agent = this.agents.find(({ id }) => id === this.defaultAgentId);
    return agent?.enabled ? cloneAgent(agent) : undefined;
  }

  get defaultId(): string | undefined {
    this.ensureLoaded();
    return this.defaultAgentId;
  }

  get isCorrupted(): boolean {
    this.ensureLoaded();
    return this.corrupted;
  }

  create(value: unknown): Promise<AgentRecord> {
    return this.serialize(async () => {
      this.ensureMutable();
      if (this.agents.length >= MAX_AGENTS) throw new AgentError('agent-limit');
      const draft = validateAgentDraft(value);
      this.assertUniqueName(draft.name);
      const agent = { id: this.nextId(), ...draft };
      const defaultAgentId = this.defaultAgentId ?? (agent.enabled ? agent.id : undefined);
      await this.persist([...this.agents, agent], defaultAgentId);
      return cloneAgent(agent);
    });
  }

  edit(id: string, value: unknown): Promise<AgentRecord> {
    return this.serialize(async () => {
      this.ensureMutable();
      const index = this.indexOf(id);
      const draft = validateAgentDraft(value);
      this.assertUniqueName(draft.name, id);
      const updated = { id, ...draft };
      const next = [...this.agents];
      next[index] = updated;
      const defaultAgentId = !updated.enabled && this.defaultAgentId === id
        ? firstEnabledId(next, id)
        : this.defaultAgentId;
      await this.persist(next, defaultAgentId);
      return cloneAgent(updated);
    });
  }

  duplicate(id: string): Promise<AgentRecord> {
    return this.serialize(async () => {
      this.ensureMutable();
      if (this.agents.length >= MAX_AGENTS) throw new AgentError('agent-limit');
      const source = this.agents[this.indexOf(id)];
      const draft = validateAgentDraft({
        name: this.copyName(source.name),
        description: source.description,
        provider: source.provider,
        model: source.model,
        persona: source.persona,
        instructions: source.instructions,
        speech: source.speech,
        ...(source.fallback ? { fallback: source.fallback } : {}),
        enabled: source.enabled,
        templateId: undefined,
      });
      const copy = { id: this.nextId(), ...draft };
      await this.persist([...this.agents, copy], this.defaultAgentId);
      return cloneAgent(copy);
    });
  }

  setEnabled(id: string, enabled: boolean): Promise<AgentRecord> {
    return this.serialize(async () => {
      this.ensureMutable();
      const index = this.indexOf(id);
      const updated = { ...this.agents[index], enabled };
      const next = [...this.agents];
      next[index] = updated;
      const defaultAgentId = !enabled && this.defaultAgentId === id
        ? firstEnabledId(next, id)
        : this.defaultAgentId ?? (enabled ? id : undefined);
      await this.persist(next, defaultAgentId);
      return cloneAgent(updated);
    });
  }

  delete(id: string): Promise<void> {
    return this.serialize(async () => {
      this.ensureMutable();
      this.indexOf(id);
      const next = this.agents.filter((agent) => agent.id !== id);
      const defaultAgentId = this.defaultAgentId === id
        ? firstEnabledId(next)
        : this.defaultAgentId;
      await this.persist(next, defaultAgentId);
    });
  }

  setDefault(id: string): Promise<AgentRecord> {
    return this.serialize(async () => {
      this.ensureMutable();
      const agent = this.agents[this.indexOf(id)];
      if (!agent.enabled) throw new AgentError('agent-disabled');
      await this.persist(this.agents, id);
      return cloneAgent(agent);
    });
  }

  private ensureLoaded(): void {
    if (!this.loaded) this.load();
  }

  private ensureMutable(): void {
    this.ensureLoaded();
    if (this.corrupted) throw new AgentError('invalid-payload');
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    this.notifyWillChange();
    const pending = this.mutationTail.then(operation, operation);
    this.mutationTail = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private async persist(next: readonly AgentRecord[], defaultAgentId: string | undefined): Promise<void> {
    const payload: AgentPayload = {
      schemaVersion: AGENT_SCHEMA_VERSION,
      defaultAgentId: defaultAgentId ?? null,
      agents: next.map(cloneAgent),
    };
    try {
      await this.storage.update(AGENT_STORAGE_KEY, payload);
    } catch (error) {
      throw new AgentError('storage-failed', error);
    }
    this.agents = payload.agents.map(cloneAgent);
    this.defaultAgentId = payload.defaultAgentId ?? undefined;
    this.corrupted = false;
  }

  private migrateTemplates(legacy: LegacyAgentSettings | undefined): {
    agents: AgentRecord[];
    defaultAgentId: string;
  } {
    const templates = builtinAgentTemplates();
    const profiles = normalizeProviderProfiles(legacy?.providerProfiles ?? DEFAULT_PROVIDER_PROFILES);
    const requested = normalizeAssistantProvider(
      legacy?.assistantProvider
        ?? (legacy?.assistantIntelligence === 'off' ? 'deepseek' : legacy?.assistantIntelligence),
    );
    const provider = requested === 'off' ? 'deepseek' : requested;
    const persona = normalizePersonaId(legacy?.assistantPersona);
    const defaultTemplateIndex = Math.max(0, templates.findIndex(({ persona: id }) => id === persona));
    const agents = templates.map((template, index) => {
      const model = provider === 'deepseek'
        ? normalizeProviderModel(legacy?.deepSeekModel, profiles[provider].model)
        : profiles[provider].model;
      return {
        id: `agent_builtin_${template.templateId?.replace(/-/gu, '_')}`,
        ...template,
        ...(index === defaultTemplateIndex ? { provider, model, persona } : {}),
      } as AgentRecord;
    });
    return { agents, defaultAgentId: agents[defaultTemplateIndex].id };
  }

  private result(migrated: boolean, corrupted: boolean): AgentLoadResult {
    return {
      agents: this.agents.map(cloneAgent),
      defaultAgentId: this.defaultAgentId,
      migrated,
      corrupted,
    };
  }

  private indexOf(id: string): number {
    const index = this.agents.findIndex((agent) => agent.id === id);
    if (index < 0) throw new AgentError('agent-not-found');
    return index;
  }

  private assertUniqueName(name: string, ignoredId?: string): void {
    const normalized = normalizeAgentName(name);
    if (this.agents.some(
      (agent) => agent.id !== ignoredId && normalizeAgentName(agent.name) === normalized,
    )) throw new AgentError('duplicate-name');
  }

  private copyName(name: string): string {
    for (let index = 1; index <= MAX_AGENTS; index += 1) {
      const suffix = index === 1 ? ' copy' : ` copy ${index}`;
      const candidate = `${name.slice(0, Math.max(1, 80 - suffix.length))}${suffix}`;
      if (!this.agents.some((agent) => normalizeAgentName(agent.name) === normalizeAgentName(candidate))) {
        return candidate;
      }
    }
    throw new AgentError('duplicate-name');
  }

  private nextId(): string {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const id = this.idFactory();
      if (!AGENT_ID_PATTERN.test(id)) throw new AgentError('invalid-id');
      if (!this.agents.some((agent) => agent.id === id)) return id;
    }
    throw new AgentError('invalid-id');
  }

  private notifyWillChange(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // Pending authority remains revoked even if a listener fails.
      }
    }
  }
}

function firstEnabledId(agents: readonly AgentRecord[], ignoredId?: string): string | undefined {
  return agents.find((agent) => agent.enabled && agent.id !== ignoredId)?.id;
}

function generateAgentId(): string {
  return `agent_${randomBytes(18).toString('base64url')}`;
}
