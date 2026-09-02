import type {
  ControlCenterAgentRow,
  ControlCenterBrowserMessage,
  ControlCenterCommandRow,
  ControlCenterCustomCommandRow,
  ControlCenterDisplayState,
  ControlCenterFocusTarget,
  ControlCenterHostMessage,
  ControlCenterManagementPageProjection,
  ControlCenterPlanningProviderProjection,
  ControlCenterProjection,
} from '../../webview/controlCenter/contracts';

export interface ControlCenterDisposable { dispose(): void }

export interface ControlCenterPanelPort {
  readonly identity: object;
  reveal(): void;
  dispose(): void;
  postMessage(message: ControlCenterHostMessage): PromiseLike<boolean> | boolean;
  onMessage(listener: (message: unknown) => void): ControlCenterDisposable;
  onDispose(listener: () => void): ControlCenterDisposable;
}

export interface ControlCenterPanelFactory {
  create(): ControlCenterPanelPort;
  adopt(panel: unknown): ControlCenterPanelPort;
}

export interface ControlCenterPersistence {
  get(key: string): unknown;
  update(key: string, value: ControlCenterDisplayState): PromiseLike<void> | void;
}

export interface ControlCenterCommandPageProjection {
  filteredCount: number;
  rows: readonly ControlCenterCommandRow[];
}

export interface ControlCenterIntentResult {
  refresh?: boolean;
  focusTarget?: ControlCenterFocusTarget;
  commandDetails?: Omit<Extract<ControlCenterHostMessage, { type: 'commandDetails' }>, 'type' | 'revision'>;
  customCommandDetails?: Omit<Extract<ControlCenterHostMessage, { type: 'customCommandDetails' }>, 'type' | 'revision'>;
}

export interface ControlCenterStateSource {
  readProjection(display: Readonly<ControlCenterDisplayState>): PromiseLike<ControlCenterProjection> | ControlCenterProjection;
  readCommandPage(display: Readonly<ControlCenterDisplayState>): PromiseLike<ControlCenterCommandPageProjection> | ControlCenterCommandPageProjection;
  readPlanningProviders?(): PromiseLike<ControlCenterPlanningProviderProjection> | ControlCenterPlanningProviderProjection;
  readAgentPage?(page: number): PromiseLike<ControlCenterManagementPageProjection<ControlCenterAgentRow>> | ControlCenterManagementPageProjection<ControlCenterAgentRow>;
  readCustomCommandPage?(page: number): PromiseLike<ControlCenterManagementPageProjection<ControlCenterCustomCommandRow>> | ControlCenterManagementPageProjection<ControlCenterCustomCommandRow>;
  readSetupState?(): Omit<Extract<ControlCenterHostMessage, { type: 'setupState' }>, 'type' | 'revision'>;
  readDiagnosticsState?(): Omit<Extract<ControlCenterHostMessage, { type: 'diagnosticsState' }>, 'type' | 'revision'>;
  handleIntent?(message: Exclude<ControlCenterBrowserMessage, { type: 'ready' | 'ack' }>, display: Readonly<ControlCenterDisplayState>): PromiseLike<ControlCenterIntentResult | void> | ControlCenterIntentResult | void;
  invalidateAuthority?(): void;
  isKnownCommandId?(commandId: string): boolean;
  logRejected?(event: 'browser-message' | 'outbound-message' | 'command-page', reason: string): void;
}

export interface ControlCenterControllerOptions {
  factory: ControlCenterPanelFactory;
  persistence: ControlCenterPersistence;
  source?: ControlCenterStateSource;
}
