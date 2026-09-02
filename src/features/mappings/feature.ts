import {
  CustomMappingExecutor,
  type CustomMapping,
  type MappingStorage,
} from '../../assistant';
import type { TargetSnapshot } from '../../assistant/context';
import type { MappingApprovalStore } from '../../agents';
import type { PendingBuiltinSummary } from '../../commands';
import type { AssistantMappingSummary, PendingAssistantAction } from '../../webview/protocol';
import type { Revision } from '../../webview/protocol';
import { registerAgentMappingTools } from './agentTools';
import {
  MappingManagementController,
  type MappingCollectionSnapshot,
  type MappingMutationResult,
  type VisibleMappingDraft,
} from './managementController';
import {
  PendingActionController,
  type Localize,
} from './pendingActionController';
import { MappingStore } from './store';
import type {
  MappingAgentToolHost,
  MappingDisposable,
  MappingExecutionHost,
  MappingManagementHost,
} from './ports';
import {
  routeVoiceMappingRequest,
  type BuiltinVoiceRequestPort,
} from './voiceRequestRouter';

export interface BuiltinVoiceIntegration extends BuiltinVoiceRequestPort {
  readonly pendingSummary: PendingBuiltinSummary | undefined;
  confirmPending(): Promise<void>;
  cancel(): void;
  dispose?(): void;
}

export interface MappingFeatureOptions {
  storage: MappingStorage;
  executionHost: MappingExecutionHost;
  managementHost: MappingManagementHost;
  agentToolHost: MappingAgentToolHost;
  localize: Localize;
  isWorkspaceTrusted(): boolean;
  approvals?: Pick<
    MappingApprovalStore,
    'state' | 'grant' | 'revoke' | 'recordExecution' | 'history'
  >;
  captureTarget(): TargetSnapshot;
  clearPendingSend(): void;
  speak(message: string): void;
  publish(): Promise<void> | void;
  builtins?: BuiltinVoiceIntegration;
  autoMode?: {
    snapshot(): { effective: boolean; epoch: number; fingerprint: string };
    onWillChange(listener: () => void): { dispose(): void };
  };
  targetFingerprint?(snapshot: TargetSnapshot): string;
}

/** Stable host facade for mapping storage, native management, voice authority and Agent tools. */
export class MappingFeature {
  private readonly store: MappingStore;
  private readonly executor: CustomMappingExecutor;
  private readonly pending: PendingActionController;
  private readonly management: MappingManagementController;

  constructor(private readonly options: MappingFeatureOptions) {
    this.store = new MappingStore(options.storage);
    this.executor = new CustomMappingExecutor(
      (id) => this.store.get(id),
      options.executionHost,
    );
    this.pending = new PendingActionController({
      store: this.store,
      executor: this.executor,
      isWorkspaceTrusted: options.isWorkspaceTrusted,
      captureTarget: options.captureTarget,
      clearPendingSend: options.clearPendingSend,
      speak: options.speak,
      publish: () => { void options.publish(); },
      localize: options.localize,
      autoMode: options.autoMode,
      targetFingerprint: options.targetFingerprint,
    });
    this.management = new MappingManagementController({
      store: this.store,
      host: options.managementHost,
      localize: options.localize,
      isWorkspaceTrusted: options.isWorkspaceTrusted,
      invalidatePending: () => this.pending.cancel(false),
      publish: options.publish,
      approvals: options.approvals,
    });
  }

  get pendingAction(): PendingAssistantAction | undefined {
    return this.pending.state;
  }

  get pendingBuiltin(): PendingBuiltinSummary | undefined {
    return this.options.builtins?.pendingSummary;
  }

  summary(): AssistantMappingSummary {
    return this.store.summary(this.options.isWorkspaceTrusted());
  }

  matchPhrase(postWakeText: string): CustomMapping | undefined {
    return this.store.matchPhrase(postWakeText);
  }

  /** Resolves an opaque mapping ID for local fingerprint-bound approval checks. */
  resolveMapping(id: string): CustomMapping | undefined {
    return this.store.get(id);
  }

  request(mapping: CustomMapping, snapshot: TargetSnapshot, utteranceId: string): void {
    this.pending.request(mapping, snapshot, utteranceId);
  }

  confirm(confirmationId: string): Promise<void> {
    return this.pending.confirm(confirmationId);
  }

  confirmIfPending(mappingId: string, confirmationId: string): Promise<void> | undefined {
    return this.pending.confirmIfPending(mappingId, confirmationId);
  }

  cancelIfPending(mappingId: string, announce = true): void {
    this.pending.cancelIfPending(mappingId, announce);
  }

  cancel(announce = false): void {
    this.pending.cancel(announce);
    this.options.builtins?.cancel();
  }

  confirmPendingBuiltin(): Promise<void> {
    return this.options.builtins?.confirmPending() ?? Promise.resolve();
  }

  routeVoiceRequest(
    postWakeText: string,
    snapshot: TargetSnapshot,
    utteranceId: string,
  ): Promise<{ handled: boolean; kind: 'confirmation' | 'mapping' | 'unmatched' }> {
    return routeVoiceMappingRequest(
      postWakeText,
      snapshot,
      utteranceId,
      this,
      this.options.builtins,
    );
  }

  manage(): Promise<void> {
    return this.management.manage();
  }

  settingsSnapshot(): MappingCollectionSnapshot {
    return this.management.snapshot();
  }

  settingsAdd(expectedRevision: Revision): Promise<MappingMutationResult> {
    return this.management.add(expectedRevision);
  }

  settingsEdit(id: string, expectedRevision: Revision): Promise<MappingMutationResult> {
    return this.management.edit(id, expectedRevision);
  }

  settingsAddVisible(
    draft: VisibleMappingDraft,
    expectedRevision: Revision,
  ): Promise<MappingMutationResult> {
    return this.management.addVisible(draft, expectedRevision);
  }

  settingsEditVisible(
    id: string,
    draft: VisibleMappingDraft,
    expectedRevision: Revision,
  ): Promise<MappingMutationResult> {
    return this.management.editVisible(id, draft, expectedRevision);
  }

  settingsToggleEnabled(id: string, expectedRevision: Revision): Promise<MappingMutationResult> {
    return this.management.toggleEnabled(id, expectedRevision);
  }

  settingsToggleAgentEnabled(
    id: string,
    expectedRevision: Revision,
  ): Promise<MappingMutationResult> {
    return this.management.toggleAgentEnabled(id, expectedRevision);
  }

  settingsDelete(id: string, expectedRevision: Revision): Promise<MappingMutationResult> {
    return this.management.delete(id, expectedRevision);
  }

  settingsSetAlwaysApproved(
    id: string,
    approved: boolean,
    expectedRevision: Revision,
  ): Promise<MappingMutationResult> {
    return this.management.setAlwaysApproved(id, approved, expectedRevision);
  }

  /** Browser-safe effective state only; persisted fingerprints never cross this facade. */
  settingsApprovalState(id: string): 'none' | 'approved' | 'revoked' {
    return this.options.approvals?.state(id) ?? 'none';
  }

  approvalHistory(): ReturnType<MappingApprovalStore['history']> {
    return this.options.approvals?.history() ?? [];
  }

  registerAgentTools(): MappingDisposable[] {
    return registerAgentMappingTools({
      store: this.store,
      executor: this.executor,
      localize: this.options.localize,
      host: this.options.agentToolHost,
      approvals: this.options.approvals,
    });
  }

  dispose(): void {
    this.pending.dispose();
    this.options.builtins?.dispose?.();
  }
}
