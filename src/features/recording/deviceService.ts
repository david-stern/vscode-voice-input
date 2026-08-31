import type { SettingsRepository } from '../../config';
import type { AudioDevice } from '../../recorder/native';
import { parseAudioDeviceId } from '../../recorder/devices';

const DEFAULT_CACHE_TTL_MS = 5_000;

export interface DeviceServiceOptions {
  settings: Pick<SettingsRepository, 'read' | 'update' | 'migrateLegacyAudioDevice'>;
  enumerate(): Promise<AudioDevice[]>;
  now?: () => number;
  cacheTtlMs?: number;
}

export type AudioDeviceSelectionStatus =
  | { kind: 'default' }
  | { kind: 'available'; deviceId: string; label: string }
  | {
    kind: 'repaired';
    previousDeviceId: string;
    deviceId: string;
    label: string;
  }
  | {
    kind: 'stale';
    deviceId: string;
    label: string;
    matchingDevices: number;
  }
  | { kind: 'legacy-migrated'; previousValue: string; deviceId: string; label: string }
  | { kind: 'legacy-ambiguous'; value: string };

/** Owns bounded native-device caching, legacy-label migration and stale-scan suppression. */
export class AudioDeviceService {
  private readonly now: () => number;
  private readonly cacheTtlMs: number;
  private cache: {
    devices: AudioDevice[];
    timestamp: number;
    configuredDeviceId: string;
  } | undefined;
  private lastSelectionStatus: AudioDeviceSelectionStatus | undefined;
  private revision = 0;

  constructor(private readonly options: DeviceServiceOptions) {
    this.now = options.now ?? Date.now;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  }

  get configuredDeviceId(): string {
    return this.options.settings.read().values.audioDevice;
  }

  get cachedDevices(): readonly AudioDevice[] {
    return this.cache?.devices.map((device) => ({ ...device })) ?? [];
  }

  get hasCachedResult(): boolean {
    return this.cache !== undefined;
  }

  /** Configuration state from the latest authoritative device scan. */
  get selectionStatus(): AudioDeviceSelectionStatus | undefined {
    return this.lastSelectionStatus ? { ...this.lastSelectionStatus } : undefined;
  }

  async get(forceRefresh = false): Promise<AudioDevice[]> {
    const now = this.now();
    if (
      !forceRefresh
      && this.cache
      && now - this.cache.timestamp < this.cacheTtlMs
      && this.cache.configuredDeviceId === this.configuredDeviceId
    ) {
      return this.clone(this.cache.devices);
    }

    const operationRevision = ++this.revision;
    const devices = await this.options.enumerate();
    if (operationRevision !== this.revision) return this.clone(this.cache?.devices ?? []);

    const selectionStatus = await this.reconcileConfiguredDevice(devices);
    if (operationRevision !== this.revision) return this.clone(this.cache?.devices ?? []);

    this.cache = {
      devices: this.clone(devices),
      timestamp: this.now(),
      configuredDeviceId: this.configuredDeviceId,
    };
    this.lastSelectionStatus = selectionStatus;
    return this.clone(this.cache.devices);
  }

  async select(deviceId: string): Promise<void> {
    // A settings mutation invalidates an in-flight scan's authority to publish.
    this.revision += 1;
    await this.options.settings.update({ audioDevice: deviceId });
    const effectiveDeviceId = this.configuredDeviceId;
    if (this.cache) this.cache.configuredDeviceId = effectiveDeviceId;
    const selected = this.cache?.devices.find((device) => device.id === effectiveDeviceId);
    this.lastSelectionStatus = !effectiveDeviceId
      ? { kind: 'default' }
      : selected
        ? { kind: 'available', deviceId: selected.id, label: selected.label }
        : this.unresolvedSelection(effectiveDeviceId);
  }

  invalidate(): void {
    this.revision += 1;
    this.cache = undefined;
    this.lastSelectionStatus = undefined;
  }

  private async reconcileConfiguredDevice(
    devices: readonly AudioDevice[],
  ): Promise<AudioDeviceSelectionStatus> {
    const configured = this.configuredDeviceId;
    if (!configured) {
      await this.options.settings.migrateLegacyAudioDevice(devices);
      return { kind: 'default' };
    }

    const exact = devices.find((device) => device.id === configured);
    if (exact) return { kind: 'available', deviceId: exact.id, label: exact.label };

    const canonical = parseAudioDeviceId(configured);
    if (canonical) {
      const matching = devices.filter((device) => device.label === canonical.name);
      if (matching.length === 1) {
        const repaired = matching[0];
        await this.options.settings.update({ audioDevice: repaired.id });
        if (this.configuredDeviceId !== repaired.id) {
          return {
            kind: 'stale',
            deviceId: configured,
            label: canonical.name,
            matchingDevices: matching.length,
          };
        }
        return {
          kind: 'repaired',
          previousDeviceId: configured,
          deviceId: repaired.id,
          label: repaired.label,
        };
      }
      return {
        kind: 'stale',
        deviceId: configured,
        label: canonical.name,
        matchingDevices: matching.length,
      };
    }

    const migration = await this.options.settings.migrateLegacyAudioDevice(devices);
    if (migration.status === 'migrated') {
      const migrated = devices.find((device) => device.id === migration.deviceId);
      return {
        kind: 'legacy-migrated',
        previousValue: configured,
        deviceId: migration.deviceId,
        label: migrated?.label ?? configured,
      };
    }
    if (migration.status === 'ambiguous') {
      return { kind: 'legacy-ambiguous', value: configured };
    }

    // The backing configuration may have changed while the serialized migration ran.
    const current = this.configuredDeviceId;
    if (!current) return { kind: 'default' };
    const currentDevice = devices.find((device) => device.id === current);
    return currentDevice
      ? { kind: 'available', deviceId: currentDevice.id, label: currentDevice.label }
      : this.unresolvedSelection(current);
  }

  private unresolvedSelection(deviceId: string): AudioDeviceSelectionStatus {
    const canonical = parseAudioDeviceId(deviceId);
    return canonical
      ? {
        kind: 'stale',
        deviceId,
        label: canonical.name,
        matchingDevices: 0,
      }
      : { kind: 'legacy-ambiguous', value: deviceId };
  }

  private clone(devices: readonly AudioDevice[]): AudioDevice[] {
    return devices.map((device) => ({ id: device.id, label: device.label }));
  }
}
