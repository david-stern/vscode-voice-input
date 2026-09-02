import {
  CONTROL_CENTER_ROUTES,
  type ControlCenterCapabilities,
  type ControlCenterCommandPage,
  type ControlCenterCommandRow,
  type ControlCenterFocusTarget,
  type ControlCenterPendingReview,
  type ControlCenterRoute,
  type ControlCenterSnapshotState,
} from './contracts';
import {
  exact,
  isCodePointString,
  isCommandId,
  isIntegerIn,
  optionalExact,
  plainRecord,
  type ControlCenterParserOptions,
} from './protocolValidation';

const ROUTES = new Set<ControlCenterRoute>(CONTROL_CENTER_ROUTES);

export function parseSnapshotState(
  value: unknown,
  options: ControlCenterParserOptions,
): ControlCenterSnapshotState | undefined {
  const state = plainRecord(value);
  if (!state || !optionalExact(state, [
    'route', 'routeState', 'language', 'direction', 'effectiveAutoMode',
  ], ['filter', 'page', 'setupStep', 'commandId', 'pendingReview', 'commandPage'])) return undefined;
  if (typeof state.route !== 'string' || !ROUTES.has(state.route as ControlCenterRoute)
    || !['loading', 'empty', 'not-configured', 'configuring', 'ready', 'error', 'recovery']
      .includes(state.routeState as string)
    || (state.language !== 'he' && state.language !== 'en')
    || (state.direction !== 'rtl' && state.direction !== 'ltr')
    || (state.language === 'he' && state.direction !== 'rtl')
    || (state.language === 'en' && state.direction !== 'ltr')
    || typeof state.effectiveAutoMode !== 'boolean'
    || (state.filter !== undefined && !isCodePointString(state.filter, 0, 200))
    || (state.page !== undefined && !isIntegerIn(state.page, 1, 4))
    || (state.setupStep !== undefined && !isIntegerIn(state.setupStep, 1, 4))
    || (state.commandId !== undefined && !isCommandId(state.commandId, options))) return undefined;
  const pendingReview = state.pendingReview === undefined ? undefined : parsePendingReview(state.pendingReview);
  const commandPage = state.commandPage === undefined ? undefined : parseCommandPage(state.commandPage);
  if ((state.pendingReview !== undefined && !pendingReview)
    || (state.commandPage !== undefined && !commandPage)
    || (state.route === 'commands') !== Boolean(commandPage)) return undefined;
  return state as unknown as ControlCenterSnapshotState;
}

function parseCommandPage(value: unknown): ControlCenterCommandPage | undefined {
  const page = plainRecord(value);
  if (!page || !exact(page, [
    'pageIndex', 'pageSize', 'filteredCount', 'pageRowCount', 'chunkCount',
  ])
    || !isIntegerIn(page.pageIndex, 1, 4)
    || page.pageSize !== 25
    || !isIntegerIn(page.filteredCount, 0, 100)
    || !isIntegerIn(page.pageRowCount, 0, 25)
    || !isIntegerIn(page.chunkCount, 0, 3)) return undefined;
  const totalPages = Math.max(1, Math.ceil(page.filteredCount / 25));
  const expectedRows = Math.min(25, Math.max(0, page.filteredCount - ((page.pageIndex - 1) * 25)));
  if (page.pageIndex > totalPages || page.pageRowCount !== expectedRows
    || page.chunkCount !== Math.ceil(page.pageRowCount / 10)) return undefined;
  return page as unknown as ControlCenterCommandPage;
}

export function parseCapabilities(value: unknown): ControlCenterCapabilities | undefined {
  const capabilities = plainRecord(value);
  return capabilities
    && exact(capabilities, [
      'sttProvider', 'sttState', 'streamingPartials', 'systemTtsState',
      'localSpeechState', 'remoteProcessing',
    ])
    && (capabilities.sttProvider === 'none' || capabilities.sttProvider === 'soniox')
    && ['not-configured', 'configuring', 'ready', 'error'].includes(capabilities.sttState as string)
    && typeof capabilities.streamingPartials === 'boolean'
    && ['off', 'configured-unverified', 'ready', 'unavailable', 'error']
      .includes(capabilities.systemTtsState as string)
    && capabilities.localSpeechState === 'pending-not-available'
    && typeof capabilities.remoteProcessing === 'boolean'
    ? capabilities as unknown as ControlCenterCapabilities
    : undefined;
}

function parsePendingReview(value: unknown): ControlCenterPendingReview | undefined {
  const review = plainRecord(value);
  return review && exact(review, ['kind', 'displayLabel'])
    && (review.kind === 'builtin' || review.kind === 'custom')
    && isCodePointString(review.displayLabel, 1, 120)
    ? review as unknown as ControlCenterPendingReview
    : undefined;
}

export function parseFocusTarget(
  value: unknown,
  options: ControlCenterParserOptions,
): ControlCenterFocusTarget | undefined {
  const target = plainRecord(value);
  if (!target || typeof target.kind !== 'string') return undefined;
  if (target.kind === 'route-h1' || target.kind === 'results-heading'
    || target.kind === 'pending-custom-review') {
    return exact(target, ['kind']) ? target as unknown as ControlCenterFocusTarget : undefined;
  }
  if (target.kind === 'command-row') {
    return exact(target, ['kind', 'commandId']) && isCommandId(target.commandId, options)
      ? target as unknown as ControlCenterFocusTarget
      : undefined;
  }
  if (target.kind === 'trigger') {
    return exact(target, ['kind', 'trigger'])
      && ['auto-badge', 'provider-card', 'mic-control', 'pending-review'].includes(target.trigger as string)
      ? target as unknown as ControlCenterFocusTarget
      : undefined;
  }
  return undefined;
}

export function parseCommandRow(
  value: unknown,
  options: ControlCenterParserOptions,
): ControlCenterCommandRow | undefined {
  const row = plainRecord(value);
  return row && exact(row, [
    'commandId', 'enabled', 'availability', 'overridden',
    'primaryPhrase', 'localizedLabel', 'slotShortcutSummary',
  ])
    && isCommandId(row.commandId, options)
    && typeof row.enabled === 'boolean'
    && ['available', 'unavailable', 'blocked'].includes(row.availability as string)
    && typeof row.overridden === 'boolean'
    && isCodePointString(row.primaryPhrase, 0, 120)
    && isCodePointString(row.localizedLabel, 0, 120)
    && isCodePointString(row.slotShortcutSummary, 0, 240)
    ? row as unknown as ControlCenterCommandRow
    : undefined;
}
