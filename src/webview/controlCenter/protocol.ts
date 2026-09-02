import {
  CONTROL_CENTER_ROUTES,
  type ControlCenterBrowserMessage,
  type ControlCenterCommandRow,
  type ControlCenterDeepLink,
  type ControlCenterDeepLinkParams,
  type ControlCenterDisplayState,
  type ControlCenterHostMessage,
  type ControlCenterRoute,
} from './contracts';
import {
  parseCapabilities,
  parseCommandRow,
  parseFocusTarget,
  parseSnapshotState,
} from './protocolHostFields';
import {
  parseManagementBrowserMessage,
  parseManagementHostMessage,
} from './protocolManagementFields';
import { parseUiBrowserMessage, parseUiHostMessage } from './protocolUiFields';
import {
  byteLength,
  exact,
  inspectEnvelope,
  isCodePointString,
  isCommandId,
  isIntegerIn,
  isPhraseList,
  isRevision,
  optionalExact,
  plainRecord,
  type ControlCenterParserOptions,
} from './protocolValidation';

const ROUTES = new Set<ControlCenterRoute>(CONTROL_CENTER_ROUTES);
const OPERATION_ID = /^[A-Za-z0-9_-]{1,64}$/u;

export type { ControlCenterParserOptions } from './protocolValidation';

export function parseControlCenterBrowserMessage(
  value: unknown,
  options: ControlCenterParserOptions = {},
): ControlCenterBrowserMessage | undefined {
  const message = inspectEnvelope(value, true);
  if (!message || typeof message.type !== 'string') return undefined;
  const revision = message.revision;
  switch (message.type) {
    case 'ready':
      return exact(message, ['type', 'lastAppliedRevision'])
        && (message.lastAppliedRevision === null || isRevision(message.lastAppliedRevision))
        ? { type: 'ready', lastAppliedRevision: message.lastAppliedRevision }
        : undefined;
    case 'ack':
      return exact(message, ['type', 'revision']) && isRevision(revision)
        ? { type: 'ack', revision }
        : undefined;
    case 'navigateIntent': {
      if (!optionalExact(message, ['type', 'revision', 'route'], ['params']) || !isRevision(revision)) {
        return undefined;
      }
      if (typeof message.route !== 'string') return undefined;
      if (!ROUTES.has(message.route as ControlCenterRoute)) {
        return { type: 'navigateIntent', revision, route: 'home' };
      }
      const params = parseParams(message.params, options);
      if (message.params !== undefined && !params) return undefined;
      return params
        ? { type: 'navigateIntent', revision, route: message.route as ControlCenterRoute, params }
        : { type: 'navigateIntent', revision, route: message.route as ControlCenterRoute };
    }
    case 'setFilterIntent':
      return exact(message, ['type', 'revision', 'filter'])
        && isRevision(revision)
        && isCodePointString(message.filter, 0, 200)
        ? { type: 'setFilterIntent', revision, filter: message.filter }
        : undefined;
    case 'setPageIntent':
      return exact(message, ['type', 'revision', 'page'])
        && isRevision(revision)
        && isIntegerIn(message.page, 1, 4)
        ? { type: 'setPageIntent', revision, page: message.page }
        : undefined;
    case 'openPendingReviewIntent':
    case 'requestAutoEnableIntent':
    case 'disableAutoIntent':
      return exact(message, ['type', 'revision']) && isRevision(revision)
        ? { type: message.type, revision }
        : undefined;
    case 'pendingReviewIntent':
      return exact(message, ['type', 'revision', 'decision'])
        && isRevision(revision)
        && (message.decision === 'request-native-confirmation' || message.decision === 'cancel')
        ? { type: 'pendingReviewIntent', revision, decision: message.decision }
        : undefined;
    case 'openOverlayIntent':
      return exact(message, ['type', 'revision', 'kind'])
        && isRevision(revision)
        && [
          'command-details', 'provider-details', 'narrow-nav',
          'auto-explanation', 'action-preview',
        ].includes(message.kind as string)
        ? {
          type: 'openOverlayIntent',
          revision,
          kind: message.kind as Extract<ControlCenterBrowserMessage, { type: 'openOverlayIntent' }>['kind'],
        }
        : undefined;
    case 'closeOverlayIntent':
      return exact(message, ['type', 'revision', 'reason'])
        && isRevision(revision)
        && ['close', 'escape', 'cancel', 'save'].includes(message.reason as string)
        ? {
          type: 'closeOverlayIntent',
          revision,
          reason: message.reason as Extract<ControlCenterBrowserMessage, { type: 'closeOverlayIntent' }>['reason'],
        }
        : undefined;
    case 'providerSetupIntent':
      return exact(message, ['type', 'revision', 'provider', 'request'])
        && isRevision(revision)
        && (message.provider === 'none' || message.provider === 'soniox')
        && ['select', 'configure-secret', 'request-remote-consent', 'test', 'revoke']
          .includes(message.request as string)
        ? {
          type: 'providerSetupIntent',
          revision,
          provider: message.provider,
          request: message.request as Extract<ControlCenterBrowserMessage, { type: 'providerSetupIntent' }>['request'],
        }
        : undefined;
    case 'micIntent':
      return exact(message, ['type', 'revision', 'action'])
        && isRevision(revision)
        && ['start', 'stop', 'test'].includes(message.action as string)
        ? {
          type: 'micIntent',
          revision,
          action: message.action as Extract<ControlCenterBrowserMessage, { type: 'micIntent' }>['action'],
        }
        : undefined;
    case 'commandEditIntent':
      return parseCommandEditIntent(message, options);
    case 'microphoneSetupIntent':
    case 'systemTtsVoicesObservedIntent':
    case 'systemTtsIntent':
    case 'diagnosticsIntent':
      return parseUiBrowserMessage(message);
    case 'setManagementPageIntent':
    case 'planningProviderIntent':
    case 'agentManagementIntent':
    case 'customCommandIntent':
      return parseManagementBrowserMessage(message);
    default:
      return undefined;
  }
}

export function parseControlCenterHostMessage(
  value: unknown,
  options: ControlCenterParserOptions = {},
): ControlCenterHostMessage | undefined {
  const message = inspectEnvelope(value, false);
  if (!message || typeof message.type !== 'string' || !isRevision(message.revision)) return undefined;
  const revision = message.revision;
  switch (message.type) {
    case 'stateSnapshot': {
      if (!optionalExact(message, ['type', 'revision', 'state', 'capabilities'], ['focusTarget'])) {
        return undefined;
      }
      const state = parseSnapshotState(message.state, options);
      const capabilities = parseCapabilities(message.capabilities);
      const focusTarget = message.focusTarget === undefined
        ? undefined
        : parseFocusTarget(message.focusTarget, options);
      if (!state || !capabilities || (message.focusTarget !== undefined && !focusTarget)) return undefined;
      return focusTarget
        ? { type: 'stateSnapshot', revision, state, capabilities, focusTarget }
        : { type: 'stateSnapshot', revision, state, capabilities };
    }
    case 'commandPageChunk': {
      if (!exact(message, ['type', 'revision', 'chunkIndex', 'chunkCount', 'rows'])
        || !isIntegerIn(message.chunkIndex, 1, 3)
        || !isIntegerIn(message.chunkCount, 1, 3)
        || message.chunkIndex > message.chunkCount
        || !Array.isArray(message.rows)
        || message.rows.length < 1
        || message.rows.length > 10) return undefined;
      const rows = message.rows.map((row) => parseCommandRow(row, options));
      if (rows.some((row) => row === undefined)) return undefined;
      return {
        type: 'commandPageChunk',
        revision,
        chunkIndex: message.chunkIndex,
        chunkCount: message.chunkCount,
        rows: rows as ControlCenterCommandRow[],
      };
    }
    case 'commandDetails': {
      if (!exact(message, [
        'type', 'revision', 'commandId', 'phrases', 'slotSummary', 'executorLabel', 'enabled',
      ])
        || !isCommandId(message.commandId, options)
        || !isPhraseList(message.phrases)
        || !isCodePointString(message.slotSummary, 0, 240)
        || !isCodePointString(message.executorLabel, 0, 240)
        || typeof message.enabled !== 'boolean') return undefined;
      return {
        type: 'commandDetails', revision, commandId: message.commandId,
        phrases: message.phrases, slotSummary: message.slotSummary,
        executorLabel: message.executorLabel, enabled: message.enabled,
      };
    }
    case 'planningProviderState':
    case 'agentPageState':
    case 'customCommandPageState':
    case 'customCommandDetails':
      return parseManagementHostMessage(message);
    case 'setupState':
    case 'diagnosticsState':
      return parseUiHostMessage(message);
    case 'statusUpdate': {
      if (!optionalExact(message, [
        'type', 'revision', 'operationId', 'channel', 'phase', 'message',
      ], ['percent'])
        || typeof message.operationId !== 'string'
        || !OPERATION_ID.test(message.operationId)
        || !['progress', 'success', 'error'].includes(message.channel as string)
        || !['idle', 'starting', 'running', 'finalizing', 'complete', 'failed', 'cancelled']
          .includes(message.phase as string)
        || !isCodePointString(message.message, 0, 240)
        || (message.percent !== undefined && !isIntegerIn(message.percent, 0, 100))) return undefined;
      return message as unknown as Extract<ControlCenterHostMessage, { type: 'statusUpdate' }>;
    }
    case 'transcriptUpdate':
      return exact(message, ['type', 'revision', 'operationId', 'sequence', 'kind', 'text'])
        && typeof message.operationId === 'string'
        && OPERATION_ID.test(message.operationId)
        && isRevision(message.sequence)
        && (message.kind === 'partial' || message.kind === 'final')
        && isCodePointString(message.text, 0, 4000)
        && byteLength(message.text) <= 16 * 1024
        ? message as unknown as Extract<ControlCenterHostMessage, { type: 'transcriptUpdate' }>
        : undefined;
    case 'focusReturn': {
      if (!exact(message, ['type', 'revision', 'target'])) return undefined;
      const target = parseFocusTarget(message.target, options);
      return target ? { type: 'focusReturn', revision, target } : undefined;
    }
    default:
      return undefined;
  }
}

export function sanitizeControlCenterDisplayState(value: unknown): ControlCenterDisplayState {
  const state = plainRecord(value);
  const route = state && typeof state.route === 'string' && ROUTES.has(state.route as ControlCenterRoute)
    ? state.route as ControlCenterRoute
    : 'home';
  const filter = state && isCodePointString(state.filter, 0, 200) ? state.filter : undefined;
  const page = state && isIntegerIn(state.page, 1, 4) ? state.page : undefined;
  return {
    route,
    ...(filter === undefined ? {} : { filter }),
    ...(page === undefined ? {} : { page }),
  };
}

export function normalizeControlCenterDeepLink(
  routeValue: unknown,
  paramsValue?: unknown,
  options: ControlCenterParserOptions = {},
): ControlCenterDeepLink {
  const mappedRoute = mapLegacyRoute(routeValue);
  if (!mappedRoute) return { route: 'home', params: Object.create(null) as ControlCenterDeepLinkParams };
  const inspectedParams = paramsValue === undefined ? undefined : inspectEnvelope(paramsValue, true);
  if (paramsValue !== undefined && !inspectedParams) {
    return { route: 'home', params: Object.create(null) as ControlCenterDeepLinkParams };
  }
  const params = parseParams(inspectedParams, options);
  if (!params) return { route: 'home', params: Object.create(null) as ControlCenterDeepLinkParams };
  return { route: mappedRoute, params };
}

export function nextControlCenterRevision(revision: number): number {
  if (!isRevision(revision) || revision >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError('Control Center revision cannot advance');
  }
  return revision + 1;
}

export function isControlCenterRevision(value: unknown): value is number {
  return isRevision(value);
}

function parseCommandEditIntent(
  message: Record<string, unknown>,
  options: ControlCenterParserOptions,
): Extract<ControlCenterBrowserMessage, { type: 'commandEditIntent' }> | undefined {
  if (!isRevision(message.revision) || !isCommandId(message.commandId, options)) return undefined;
  if (message.operation === 'open') {
    return exact(message, ['type', 'revision', 'commandId', 'operation', 'requestSequence'])
      && isRevision(message.requestSequence)
      ? message as unknown as Extract<ControlCenterBrowserMessage, { type: 'commandEditIntent' }>
      : undefined;
  }
  if (message.operation === 'reset') {
    return exact(message, ['type', 'revision', 'commandId', 'operation'])
      ? message as unknown as Extract<ControlCenterBrowserMessage, { type: 'commandEditIntent' }>
      : undefined;
  }
  if (message.operation === 'set-enabled') {
    return exact(message, ['type', 'revision', 'commandId', 'operation', 'value'])
      && typeof message.value === 'boolean'
      ? message as unknown as Extract<ControlCenterBrowserMessage, { type: 'commandEditIntent' }>
      : undefined;
  }
  return message.operation === 'replace-phrases'
    && exact(message, ['type', 'revision', 'commandId', 'operation', 'value'])
    && isPhraseList(message.value)
    ? message as unknown as Extract<ControlCenterBrowserMessage, { type: 'commandEditIntent' }>
    : undefined;
}

function parseParams(
  value: unknown,
  options: ControlCenterParserOptions,
): ControlCenterDeepLinkParams | undefined {
  if (value === undefined) return Object.create(null) as ControlCenterDeepLinkParams;
  const params = plainRecord(value);
  if (!params || Object.keys(params).length > 4
    || !Object.keys(params).every((key) => ['filter', 'page', 'commandId', 'setupStep'].includes(key))) {
    return undefined;
  }
  if (params.filter !== undefined && !isCodePointString(params.filter, 0, 200)) return undefined;
  if (params.page !== undefined && !isIntegerIn(params.page, 1, 4)) return undefined;
  if (params.commandId !== undefined && !isCommandId(params.commandId, options)) return undefined;
  if (params.setupStep !== undefined && !isIntegerIn(params.setupStep, 1, 4)) return undefined;
  return {
    ...(params.filter === undefined ? {} : { filter: params.filter }),
    ...(params.page === undefined ? {} : { page: params.page }),
    ...(params.commandId === undefined ? {} : { commandId: params.commandId }),
    ...(params.setupStep === undefined ? {} : { setupStep: params.setupStep }),
  };
}

function mapLegacyRoute(value: unknown): ControlCenterRoute | undefined {
  if (typeof value !== 'string') return undefined;
  if (ROUTES.has(value as ControlCenterRoute)) return value as ControlCenterRoute;
  switch (value) {
    case 'setup':
    case 'general':
      return 'home';
    case 'conversation':
    case 'speech':
    case 'microphone':
      return 'voice';
    case 'actions':
    case 'mappings':
      return 'commands';
    case 'agents':
    case 'providers':
    case 'assistant':
      return 'assistant';
    default:
      return undefined;
  }
}
