import type {
  ControlCenterCapabilities,
  ControlCenterCommandRow,
  ControlCenterDeepLinkParams,
  ControlCenterFocusTarget,
  ControlCenterRoute,
  ControlCenterSnapshotState,
} from './contractCore';
import type {
  ControlCenterAgentRow,
  ControlCenterAgentTemplateId,
  ControlCenterCustomCommandDetails,
  ControlCenterCustomCommandDraft,
  ControlCenterCustomCommandRow,
  ControlCenterPlanningProvider,
  ControlCenterPlanningProviderId,
  ControlCenterPlanningProviderSelection,
} from './contractManagement';
import type {
  ControlCenterDiagnosticCheck,
  ControlCenterObservedSystemVoice,
  ControlCenterSetupState,
} from './contractSetup';

export type ControlCenterBrowserMessage =
  | { type: 'ready'; lastAppliedRevision: number | null }
  | { type: 'ack'; revision: number }
  | {
      type: 'navigateIntent';
      revision: number;
      route: ControlCenterRoute;
      params?: ControlCenterDeepLinkParams;
    }
  | { type: 'setFilterIntent'; revision: number; filter: string }
  | { type: 'setPageIntent'; revision: number; page: number }
  | { type: 'openPendingReviewIntent'; revision: number }
  | {
      type: 'pendingReviewIntent';
      revision: number;
      decision: 'request-native-confirmation' | 'cancel';
    }
  | {
      type: 'openOverlayIntent';
      revision: number;
      kind:
        | 'command-details'
        | 'provider-details'
        | 'narrow-nav'
        | 'auto-explanation'
        | 'action-preview';
    }
  | {
      type: 'closeOverlayIntent';
      revision: number;
      reason: 'close' | 'escape' | 'cancel' | 'save';
    }
  | { type: 'requestAutoEnableIntent'; revision: number }
  | { type: 'disableAutoIntent'; revision: number }
  | {
      type: 'providerSetupIntent';
      revision: number;
      provider: 'none' | 'soniox';
      request: 'select' | 'configure-secret' | 'request-remote-consent' | 'test' | 'revoke';
    }
  | { type: 'micIntent'; revision: number; action: 'start' | 'stop' | 'test' }
  | {
      type: 'microphoneSetupIntent';
      revision: number;
      operation: 'select-device' | 'test-signal' | 'stop-test';
    }
  | {
      type: 'systemTtsVoicesObservedIntent';
      revision: number;
      voices: ControlCenterObservedSystemVoice[];
    }
  | {
      type: 'systemTtsIntent';
      revision: number;
      operation: 'set-enabled';
      enabled: boolean;
    }
  | {
      type: 'systemTtsIntent';
      revision: number;
      operation: 'set-voice';
      voiceIndex: number;
    }
  | {
      type: 'systemTtsIntent';
      revision: number;
      operation: 'set-rate';
      rate: number;
    }
  | {
      type: 'commandEditIntent';
      revision: number;
      commandId: string;
      operation: 'open';
      requestSequence: number;
    }
  | {
      type: 'commandEditIntent';
      revision: number;
      commandId: string;
      operation: 'set-enabled';
      value: boolean;
    }
  | {
      type: 'commandEditIntent';
      revision: number;
      commandId: string;
      operation: 'replace-phrases';
      value: string[];
    }
  | {
      type: 'commandEditIntent';
      revision: number;
      commandId: string;
      operation: 'reset';
    }
  | {
      type: 'setManagementPageIntent';
      revision: number;
      target: 'agents' | 'custom-commands';
      page: number;
    }
  | {
      type: 'planningProviderIntent';
      revision: number;
      provider: ControlCenterPlanningProviderSelection;
      operation:
        | 'select'
        | 'save-profile'
        | 'set-credential'
        | 'replace-credential'
        | 'clear-credential'
        | 'test'
        | 'cancel-test'
        | 'review-consent'
        | 'revoke-consent';
      enabled?: boolean;
      model?: string;
    }
  | {
      type: 'agentManagementIntent';
      revision: number;
      operation:
        | 'create'
        | 'update-profile'
        | 'set-enabled'
        | 'set-default'
        | 'duplicate'
        | 'delete';
      id?: string;
      templateId?: ControlCenterAgentTemplateId;
      provider?: ControlCenterPlanningProviderId;
      model?: string;
      enabled?: boolean;
    }
  | {
      type: 'customCommandIntent';
      revision: number;
      operation: 'open';
      id: string;
      requestSequence: number;
    }
  | ({
      type: 'customCommandIntent';
      revision: number;
      operation: 'add';
    } & ControlCenterCustomCommandDraft)
  | ({
      type: 'customCommandIntent';
      revision: number;
      operation: 'edit';
      id: string;
    } & ControlCenterCustomCommandDraft)
  | {
      type: 'customCommandIntent';
      revision: number;
      operation: 'set-enabled';
      id: string;
      enabled: boolean;
    }
  | {
      type: 'customCommandIntent';
      revision: number;
      operation: 'delete';
      id: string;
    }
  | {
      type: 'diagnosticsIntent';
      revision: number;
      operation: 'run' | 'open' | 'copy';
      requestSequence: number;
    };

export type ControlCenterHostMessage =
  | {
      type: 'stateSnapshot';
      revision: number;
      state: ControlCenterSnapshotState;
      capabilities: ControlCenterCapabilities;
      focusTarget?: ControlCenterFocusTarget;
    }
  | {
      type: 'commandPageChunk';
      revision: number;
      chunkIndex: number;
      chunkCount: number;
      rows: ControlCenterCommandRow[];
    }
  | {
      type: 'commandDetails';
      revision: number;
      commandId: string;
      phrases: string[];
      slotSummary: string;
      executorLabel: string;
      enabled: boolean;
    }
  | {
      type: 'planningProviderState';
      revision: number;
      selectedProvider: ControlCenterPlanningProviderSelection;
      items: ControlCenterPlanningProvider[];
    }
  | {
      type: 'agentPageState';
      revision: number;
      pageIndex: number;
      pageSize: 8;
      totalCount: number;
      pageRowCount: number;
      items: ControlCenterAgentRow[];
    }
  | {
      type: 'customCommandPageState';
      revision: number;
      pageIndex: number;
      pageSize: 10;
      totalCount: number;
      pageRowCount: number;
      items: ControlCenterCustomCommandRow[];
    }
  | ({
      type: 'customCommandDetails';
      revision: number;
    } & ControlCenterCustomCommandDetails)
  | ({
      type: 'setupState';
      revision: number;
    } & ControlCenterSetupState)
  | {
      type: 'diagnosticsState';
      revision: number;
      status: 'idle' | 'running' | 'ready' | 'error';
      summary: string;
      checks: ControlCenterDiagnosticCheck[];
      canOpen: boolean;
      canCopy: boolean;
    }
  | {
      type: 'statusUpdate';
      revision: number;
      operationId: string;
      channel: 'progress' | 'success' | 'error';
      phase: 'idle' | 'starting' | 'running' | 'finalizing' | 'complete' | 'failed' | 'cancelled';
      message: string;
      percent?: number;
    }
  | {
      type: 'transcriptUpdate';
      revision: number;
      operationId: string;
      sequence: number;
      kind: 'partial' | 'final';
      text: string;
    }
  | { type: 'focusReturn'; revision: number; target: ControlCenterFocusTarget };
