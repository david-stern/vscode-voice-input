import type { CredentialService } from './credentials';
import { INSTALL_MARKER_STORAGE_KEY } from './contracts';
import type { GlobalStatePort } from './consent';
import type { SettingsRepository } from './settingsRepository';

export const INSTALL_MARKER_SCHEMA_VERSION = 1 as const;

export interface VoiceInputInstallMarker {
  schemaVersion: typeof INSTALL_MARKER_SCHEMA_VERSION;
  firstVersion: string;
  lastVersion: string;
}

export type TranscriptionMigrationResult =
  | { status: 'fresh-none'; provider: 'none' }
  | { status: 'upgrade-soniox'; provider: 'soniox' }
  | { status: 'upgrade-pending'; provider: 'legacy-soniox-pending' }
  | { status: 'retained'; provider: 'none' | 'soniox' | 'legacy-soniox-pending' };

export interface TranscriptionProviderMigrationOptions {
  state: GlobalStatePort;
  settings: Pick<SettingsRepository, 'read' | 'update' | 'hasExplicitGlobal'>;
  credentials: Pick<CredentialService, 'status'>;
  currentVersion: string;
  legacyInstallEvidence(): boolean;
}

/**
 * Idempotent local-only install/upgrade migration. A missing legacy credential
 * never becomes `none`; the user must explicitly repair or choose a provider.
 */
export class TranscriptionProviderMigration {
  private tail = Promise.resolve();

  constructor(private readonly options: TranscriptionProviderMigrationOptions) {}

  migrate(): Promise<TranscriptionMigrationResult> {
    const pending = this.tail.then(() => this.run(), () => this.run());
    this.tail = pending.then(() => undefined, () => undefined);
    return pending;
  }

  resolvePendingLocally(): Promise<TranscriptionMigrationResult> {
    const pending = this.tail.then(() => this.resolvePending(), () => this.resolvePending());
    this.tail = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private async run(): Promise<TranscriptionMigrationResult> {
    const marker = parseMarker(this.options.state.get<unknown>(INSTALL_MARKER_STORAGE_KEY, undefined));
    const explicitProvider = this.options.settings.hasExplicitGlobal('transcriptionProvider');
    const noInstallEvidence = !marker && !explicitProvider && !this.options.legacyInstallEvidence();
    let pendingPersisted = false;

    if (noInstallEvidence) {
      try {
        if (!(await this.options.credentials.status('soniox')).configured) {
          await this.options.settings.update({ transcriptionProvider: 'none' });
          await this.writeMarker(this.options.currentVersion);
          return { status: 'fresh-none', provider: 'none' };
        }
        // A legacy Soniox secret may be the only surviving upgrade evidence.
        await this.options.settings.update({ transcriptionProvider: 'legacy-soniox-pending' });
        pendingPersisted = true;
      } catch {
        await this.options.settings.update({ transcriptionProvider: 'legacy-soniox-pending' });
        await this.writeMarker('legacy');
        return { status: 'upgrade-pending', provider: 'legacy-soniox-pending' };
      }
    }

    if (!marker && !explicitProvider && !pendingPersisted) {
      // Persist fail-closed state before the asynchronous SecretStorage read.
      await this.options.settings.update({ transcriptionProvider: 'legacy-soniox-pending' });
    }
    const result = await this.resolvePending();
    await this.writeMarker(marker?.firstVersion ?? 'legacy');
    return result;
  }

  private async resolvePending(): Promise<TranscriptionMigrationResult> {
    const selected = this.options.settings.read().values.transcriptionProvider;
    if (selected !== 'legacy-soniox-pending') return { status: 'retained', provider: selected };
    try {
      if ((await this.options.credentials.status('soniox')).configured) {
        await this.options.settings.update({ transcriptionProvider: 'soniox' });
        return { status: 'upgrade-soniox', provider: 'soniox' };
      }
    } catch {
      // Unknown local credential availability remains pending and performs no network work.
    }
    return { status: 'upgrade-pending', provider: 'legacy-soniox-pending' };
  }

  private writeMarker(firstVersion: string): PromiseLike<void> {
    const marker: VoiceInputInstallMarker = {
      schemaVersion: INSTALL_MARKER_SCHEMA_VERSION,
      firstVersion: boundedVersion(firstVersion),
      lastVersion: boundedVersion(this.options.currentVersion),
    };
    return this.options.state.update(INSTALL_MARKER_STORAGE_KEY, marker);
  }
}

function parseMarker(value: unknown): VoiceInputInstallMarker | undefined {
  if (!plain(value) || Object.keys(value).sort().join(',') !== 'firstVersion,lastVersion,schemaVersion') {
    return undefined;
  }
  if (
    value.schemaVersion !== INSTALL_MARKER_SCHEMA_VERSION
    || !validVersion(value.firstVersion)
    || !validVersion(value.lastVersion)
  ) return undefined;
  return value as unknown as VoiceInputInstallMarker;
}

function boundedVersion(value: string): string {
  return validVersion(value) ? value : 'unknown';
}

function validVersion(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._+-]{1,64}$/u.test(value);
}

function plain(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
