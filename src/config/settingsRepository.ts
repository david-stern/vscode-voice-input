import {
  SETTINGS_DEFAULTS,
  SETTING_NAMES,
  normalizeSetting,
  type SettingName,
  type VoiceInputSettings,
} from './settings';
import {
  cloneProviderProfiles,
  type AssistantProviderSelection,
  type ProviderProfiles,
} from './providerProfiles';

export interface ConfigurationInspection<T> {
  defaultValue?: T;
  globalValue?: T;
  workspaceValue?: T;
  workspaceFolderValue?: T;
}

export interface ConfigurationPort {
  get<T>(name: string, fallback: T): T;
  inspect<T>(name: string): ConfigurationInspection<T> | undefined;
  updateGlobal(name: string, value: unknown): PromiseLike<void>;
}

export type WorkspaceOverrideSource = 'workspace' | 'workspace-folder';
export type WorkspaceOverrideSettingName = Exclude<SettingName, 'providerProfiles'>;

export interface WorkspaceOverride<
  K extends WorkspaceOverrideSettingName = WorkspaceOverrideSettingName,
> {
  name: K;
  source: WorkspaceOverrideSource;
  effectiveValue: VoiceInputSettings[K];
  globalValue: VoiceInputSettings[K];
}

export interface SettingsSnapshot {
  values: VoiceInputSettings;
  workspaceOverrides: readonly WorkspaceOverride[];
}

export interface AudioDeviceIdentity {
  id: string;
  label: string;
}

export type AudioDeviceMigrationResult =
  | { status: 'not-needed' }
  | { status: 'ambiguous' }
  | { status: 'migrated'; deviceId: string };

export type LegacyProviderMigrationResult =
  | { status: 'not-needed' }
  | {
      status: 'migrated';
      provider: AssistantProviderSelection;
      model: string;
    };

export interface DisposableListener {
  dispose(): void;
}

/** Owns typed reads and serialized global-only writes for the voiceInput section. */
export class SettingsRepository {
  private writeTail: Promise<void> = Promise.resolve();
  private providerMutationSequence = 0;
  private readonly pendingProviderMutations = new Set<number>();
  private readonly providerAuthorityListeners = new Set<() => void>();
  private legacyProviderMigrationComplete = false;

  constructor(private readonly configuration: ConfigurationPort) {}

  read(): SettingsSnapshot {
    const raw: Partial<Record<SettingName, unknown>> = {};
    for (const name of SETTING_NAMES) {
      raw[name] = isProviderProfileSetting(name)
        ? this.globalOrDefault(name)
        : this.configuration.get(name, SETTINGS_DEFAULTS[name]);
    }
    if (this.configuration.inspect<unknown>('assistantProvider')?.globalValue !== undefined) {
      raw.assistantIntelligence = normalizeSetting('assistantProvider', raw.assistantProvider) === 'off'
        ? 'off'
        : 'deepseek';
    }
    const values = readNormalized(raw);
    return {
      values,
      workspaceOverrides: this.readWorkspaceOverrides(values),
    };
  }

  get providerChangePending(): boolean {
    return this.pendingProviderMutations.size > 0;
  }

  get providerAuthorityRevision(): number {
    return this.providerMutationSequence;
  }

  onProviderAuthorityChanged(listener: () => void): DisposableListener {
    this.providerAuthorityListeners.add(listener);
    return { dispose: () => this.providerAuthorityListeners.delete(listener) };
  }

  update(patch: Partial<VoiceInputSettings>): Promise<void> {
    const requested = Object.entries(patch) as [SettingName, unknown][];
    if (patch.assistantProvider !== undefined && patch.assistantIntelligence === undefined) {
      requested.push([
        'assistantIntelligence',
        normalizeSetting('assistantProvider', patch.assistantProvider) === 'off' ? 'off' : 'deepseek',
      ]);
    } else if (patch.assistantIntelligence !== undefined && patch.assistantProvider === undefined) {
      requested.push([
        'assistantProvider',
        normalizeSetting('assistantIntelligence', patch.assistantIntelligence) === 'off'
          ? 'off'
          : 'deepseek',
      ]);
    }
    const changesProviderAuthority = requested.some(([name]) => isProviderAuthoritySetting(name));
    const mutation = changesProviderAuthority ? this.beginProviderMutation() : undefined;
    const pending = this.serialize(async () => {
      for (const [name, value] of requested) {
        if (!SETTING_NAMES.includes(name) || value === undefined) continue;
        await this.configuration.updateGlobal(name, normalizeSetting(name, value));
      }
    });
    return pending.finally(() => {
      if (mutation !== undefined) this.finishProviderMutation(mutation);
    });
  }

  /**
   * Copies the legacy DeepSeek selection into provider-neutral settings once.
   * It changes no credential or consent identity and performs no provider call.
   */
  migrateLegacyDeepSeekProvider(): Promise<LegacyProviderMigrationResult> {
    return this.serialize(async () => {
      const providerInspection = this.configuration.inspect<unknown>('assistantProvider');
      const profilesInspection = this.configuration.inspect<unknown>('providerProfiles');
      const providerAlreadyExplicit = providerInspection?.globalValue !== undefined;
      const profilesAlreadyExplicit = profilesInspection?.globalValue !== undefined;
      if (
        this.legacyProviderMigrationComplete
        || providerAlreadyExplicit && profilesAlreadyExplicit
      ) {
        this.legacyProviderMigrationComplete = true;
        return { status: 'not-needed' };
      }

      const legacyMode = normalizeSetting(
        'assistantIntelligence',
        this.configuration.get('assistantIntelligence', SETTINGS_DEFAULTS.assistantIntelligence),
      );
      const legacyModel = normalizeSetting(
        'deepSeekModel',
        this.configuration.get('deepSeekModel', SETTINGS_DEFAULTS.deepSeekModel),
      );
      const provider: AssistantProviderSelection = providerAlreadyExplicit
        ? normalizeSetting('assistantProvider', providerInspection?.globalValue)
        : legacyMode === 'off' ? 'off' : 'deepseek';
      const profiles: ProviderProfiles = profilesAlreadyExplicit
        ? normalizeSetting('providerProfiles', profilesInspection?.globalValue)
        : cloneProviderProfiles(SETTINGS_DEFAULTS.providerProfiles);
      const migratedProfiles: ProviderProfiles = Object.freeze({
        ...profiles,
        deepseek: Object.freeze({
          ...profiles.deepseek,
          model: profilesAlreadyExplicit ? profiles.deepseek.model : legacyModel,
        }),
      });
      const mutation = this.beginProviderMutation();
      try {
        if (!profilesAlreadyExplicit) {
          await this.configuration.updateGlobal('providerProfiles', migratedProfiles);
        }
        if (!providerAlreadyExplicit) {
          await this.configuration.updateGlobal('assistantProvider', provider);
        }
        this.legacyProviderMigrationComplete = true;
      } finally {
        this.finishProviderMutation(mutation);
      }
      return { status: 'migrated', provider, model: legacyModel };
    });
  }

  migrateLegacyAudioDevice(devices: readonly AudioDeviceIdentity[]): Promise<AudioDeviceMigrationResult> {
    return this.serialize(async () => {
      const configured = normalizeSetting(
        'audioDevice',
        this.configuration.get('audioDevice', SETTINGS_DEFAULTS.audioDevice),
      );
      if (!configured || devices.some((device) => device.id === configured)) {
        return { status: 'not-needed' };
      }

      const matches = devices.filter((device) => device.label === configured);
      if (matches.length !== 1) return { status: 'ambiguous' };

      await this.configuration.updateGlobal('audioDevice', matches[0].id);
      return { status: 'migrated', deviceId: matches[0].id };
    });
  }

  private readWorkspaceOverrides(values: VoiceInputSettings): WorkspaceOverride[] {
    const overrides: WorkspaceOverride[] = [];
    for (const name of SETTING_NAMES) {
      // Provider profiles are a structured host-only value and are projected by
      // provider cards, never as an arbitrary browser-visible override object.
      if (name === 'providerProfiles') continue;
      const inspection = this.configuration.inspect<unknown>(name);
      if (!inspection) continue;
      const folderValue = inspection.workspaceFolderValue;
      const workspaceValue = inspection.workspaceValue;
      const source: WorkspaceOverrideSource | undefined = folderValue !== undefined
        ? 'workspace-folder'
        : workspaceValue !== undefined ? 'workspace' : undefined;
      if (!source) continue;

      const globalRaw = inspection.globalValue ?? inspection.defaultValue ?? SETTINGS_DEFAULTS[name];
      const globalValue = normalizeSetting(name, globalRaw);
      const effectiveValue = values[name];
      overrides.push({ name, source, effectiveValue, globalValue } as WorkspaceOverride);
    }
    return overrides;
  }

  private globalOrDefault<K extends 'assistantProvider' | 'providerProfiles'>(
    name: K,
  ): VoiceInputSettings[K] {
    const inspection = this.configuration.inspect<unknown>(name);
    return normalizeSetting(
      name,
      inspection?.globalValue ?? inspection?.defaultValue ?? SETTINGS_DEFAULTS[name],
    );
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.writeTail.then(operation, operation);
    this.writeTail = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private beginProviderMutation(): number {
    if (this.providerMutationSequence >= Number.MAX_SAFE_INTEGER) {
      throw new RangeError('provider authority revision cannot advance');
    }
    const mutation = ++this.providerMutationSequence;
    this.pendingProviderMutations.add(mutation);
    this.notifyProviderAuthorityChanged();
    return mutation;
  }

  private finishProviderMutation(mutation: number): void {
    if (!this.pendingProviderMutations.delete(mutation)) return;
    this.notifyProviderAuthorityChanged();
  }

  private notifyProviderAuthorityChanged(): void {
    for (const listener of [...this.providerAuthorityListeners]) {
      try {
        listener();
      } catch {
        // Authority closes regardless of observer failures.
      }
    }
  }
}

function readNormalized(raw: Partial<Record<SettingName, unknown>>): VoiceInputSettings {
  const result = {
    ...SETTINGS_DEFAULTS,
    providerProfiles: cloneProviderProfiles(SETTINGS_DEFAULTS.providerProfiles),
  } as VoiceInputSettings;
  for (const name of SETTING_NAMES) setNormalized(result, name, raw[name]);
  return result;
}

function isProviderAuthoritySetting(name: SettingName): boolean {
  return name === 'assistantProvider'
    || name === 'providerProfiles'
    || name === 'assistantIntelligence'
    || name === 'deepSeekModel';
}

function isProviderProfileSetting(
  name: SettingName,
): name is 'assistantProvider' | 'providerProfiles' {
  return name === 'assistantProvider' || name === 'providerProfiles';
}

function setNormalized<K extends SettingName>(
  target: VoiceInputSettings,
  name: K,
  value: unknown,
): void {
  target[name] = normalizeSetting(name, value);
}
