import type { AgentRegistry } from '../../agents';
import type {
  ConsentId,
  ProviderDisclosure,
  ProviderId,
  SettingName,
} from '../../config';
import type { SettingsViewState } from '../../webview/settings/protocol';

export interface SettingsViewPort {
  postState(state: Readonly<SettingsViewState>): unknown;
}

export interface SettingsNativeUi {
  confirmConsent(consent: ConsentId, disclosure?: Readonly<ProviderDisclosure>): PromiseLike<boolean>;
  openNativeSettings(setting?: SettingName): PromiseLike<unknown>;
  openKeybindings(): PromiseLike<unknown>;
  copyText(text: string): PromiseLike<void>;
}

export interface SettingsCredentialPort {
  credentialState(provider: ProviderId): SettingsViewState['transcription']['credential'];
  runSettingsOperation(
    provider: ProviderId,
    action: 'set' | 'replace' | 'clear',
    requestedRevision: number,
  ): Promise<'accepted' | 'stale'>;
}

export type SettingsAgentPort = Pick<
  AgentRegistry,
  | 'list'
  | 'get'
  | 'defaultId'
  | 'isCorrupted'
  | 'create'
  | 'edit'
  | 'duplicate'
  | 'setEnabled'
  | 'setDefault'
  | 'delete'
>;

export interface SettingsMappingSnapshot {
  revision: number;
  status: 'loading' | 'ready' | 'untrusted' | 'error';
  items: Array<Omit<SettingsViewState['mappings']['items'][number], 'approval' | 'permissionTier'>>;
}

export interface SettingsApprovalHistoryRecord {
  mappingId: string;
  decision: SettingsViewState['mappings']['approvalHistory'][number]['decision'];
  timestamp: number;
}

export interface SettingsMappingMutationResult {
  status: 'accepted' | 'stale' | 'cancelled' | 'not-found' | 'unchanged' | 'failed';
  snapshot: SettingsMappingSnapshot;
}

export interface SettingsMappingPort {
  settingsSnapshot(): SettingsMappingSnapshot;
  settingsAdd(revision: number): Promise<SettingsMappingMutationResult>;
  settingsEdit(id: string, revision: number): Promise<SettingsMappingMutationResult>;
  settingsToggleEnabled(id: string, revision: number): Promise<SettingsMappingMutationResult>;
  settingsToggleAgentEnabled(id: string, revision: number): Promise<SettingsMappingMutationResult>;
  settingsDelete(id: string, revision: number): Promise<SettingsMappingMutationResult>;
  settingsSetAlwaysApproved(
    id: string,
    approved: boolean,
    revision: number,
  ): Promise<SettingsMappingMutationResult>;
  settingsApprovalState(id: string): SettingsViewState['mappings']['items'][number]['approval'];
  approvalHistory(): readonly SettingsApprovalHistoryRecord[];
}
