export const CONTROL_CENTER_VIEW_TYPE = 'voiceInput.controlCenter';

export const CONTROL_CENTER_ROUTES = [
  'home',
  'voice',
  'commands',
  'assistant',
  'privacy',
  'diagnostics',
] as const;

export type ControlCenterRoute = (typeof CONTROL_CENTER_ROUTES)[number];
export type ControlCenterRouteState =
  | 'loading'
  | 'empty'
  | 'not-configured'
  | 'configuring'
  | 'ready'
  | 'error'
  | 'recovery';

export interface ControlCenterDisplayState {
  route: ControlCenterRoute;
  filter?: string;
  page?: number;
}

export interface ControlCenterDeepLinkParams {
  filter?: string;
  page?: number;
  commandId?: string;
  setupStep?: number;
}

export interface ControlCenterDeepLink {
  route: ControlCenterRoute;
  params: ControlCenterDeepLinkParams;
}

export type ControlCenterFocusTarget =
  | { kind: 'route-h1' }
  | { kind: 'results-heading' }
  | { kind: 'pending-custom-review' }
  | { kind: 'command-row'; commandId: string }
  | {
      kind: 'trigger';
      trigger: 'auto-badge' | 'provider-card' | 'mic-control' | 'pending-review';
    };

export interface ControlCenterCapabilities {
  sttProvider: 'none' | 'soniox';
  sttState: 'not-configured' | 'configuring' | 'ready' | 'error';
  streamingPartials: boolean;
  systemTtsState: 'off' | 'configured-unverified' | 'ready' | 'unavailable' | 'error';
  localSpeechState: 'pending-not-available';
  remoteProcessing: boolean;
}

export interface ControlCenterCommandPage {
  pageIndex: number;
  pageSize: 25;
  filteredCount: number;
  pageRowCount: number;
  chunkCount: number;
}

export interface ControlCenterPendingReview {
  kind: 'builtin' | 'custom';
  displayLabel: string;
}

export interface ControlCenterSnapshotState extends ControlCenterDisplayState {
  routeState: ControlCenterRouteState;
  setupStep?: number;
  commandId?: string;
  language: 'he' | 'en';
  direction: 'rtl' | 'ltr';
  effectiveAutoMode: boolean;
  pendingReview?: ControlCenterPendingReview;
  commandPage?: ControlCenterCommandPage;
}

export interface ControlCenterCommandRow {
  commandId: string;
  enabled: boolean;
  availability: 'available' | 'unavailable' | 'blocked';
  overridden: boolean;
  primaryPhrase: string;
  localizedLabel: string;
  slotShortcutSummary: string;
}

export interface ControlCenterProjection {
  routeState: ControlCenterRouteState;
  language: 'he' | 'en';
  direction: 'rtl' | 'ltr';
  effectiveAutoMode: boolean;
  capabilities: ControlCenterCapabilities;
  pendingReview?: ControlCenterPendingReview;
}

export const DEFAULT_CONTROL_CENTER_CAPABILITIES: Readonly<ControlCenterCapabilities> = {
  sttProvider: 'none',
  sttState: 'not-configured',
  streamingPartials: false,
  systemTtsState: 'off',
  localSpeechState: 'pending-not-available',
  remoteProcessing: false,
};
