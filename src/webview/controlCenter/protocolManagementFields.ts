import {
  CONTROL_CENTER_AGENT_TEMPLATES,
  CONTROL_CENTER_PLANNING_PROVIDERS,
  type ControlCenterAgentRow,
  type ControlCenterAgentTemplateId,
  type ControlCenterBrowserMessage,
  type ControlCenterCustomCommandRow,
  type ControlCenterHostMessage,
  type ControlCenterPlanningProvider,
  type ControlCenterPlanningProviderId,
  type ControlCenterPlanningProviderSelection,
} from './contracts';
import {
  exact,
  isCodePointString,
  isIntegerIn,
  isPhraseList,
  isRevision,
  plainRecord,
} from './protocolValidation';

const PROVIDERS = new Set<string>(CONTROL_CENTER_PLANNING_PROVIDERS);
const TEMPLATES = new Set<string>(CONTROL_CENTER_AGENT_TEMPLATES);
const AGENT_ID = /^agent_[A-Za-z0-9_-]{12,80}$/u;
const CUSTOM_COMMAND_ID = /^vm_[A-Za-z0-9_-]{22,64}$/u;
const TARGET_ID = /^\S{1,256}$/u;
const MODEL_ID = /^[A-Za-z0-9~][A-Za-z0-9._~:/@+-]{0,255}$/u;

export function parseManagementBrowserMessage(
  message: Record<string, unknown>,
): ControlCenterBrowserMessage | undefined {
  switch (message.type) {
    case 'setManagementPageIntent':
      return exact(message, ['type', 'revision', 'target', 'page'])
        && isRevision(message.revision)
        && (message.target === 'agents' || message.target === 'custom-commands')
        && isIntegerIn(message.page, 1, message.target === 'agents' ? 4 : 5)
        ? message as unknown as Extract<ControlCenterBrowserMessage, { type: 'setManagementPageIntent' }>
        : undefined;
    case 'planningProviderIntent':
      return parsePlanningProviderIntent(message);
    case 'agentManagementIntent':
      return parseAgentManagementIntent(message);
    case 'customCommandIntent':
      return parseCustomCommandIntent(message);
    default:
      return undefined;
  }
}

export function parseManagementHostMessage(
  message: Record<string, unknown>,
): ControlCenterHostMessage | undefined {
  switch (message.type) {
    case 'planningProviderState':
      return parsePlanningProviderState(message);
    case 'agentPageState':
      return parseAgentPageState(message);
    case 'customCommandPageState':
      return parseCustomCommandPageState(message);
    case 'customCommandDetails':
      return parseCustomCommandDetails(message);
    default:
      return undefined;
  }
}

function parsePlanningProviderIntent(
  message: Record<string, unknown>,
): Extract<ControlCenterBrowserMessage, { type: 'planningProviderIntent' }> | undefined {
  if (!isRevision(message.revision) || !isPlanningProviderSelection(message.provider)
    || typeof message.operation !== 'string') return undefined;
  if (message.operation === 'save-profile') {
    return exact(message, ['type', 'revision', 'provider', 'operation', 'enabled', 'model'])
      && message.provider !== 'off'
      && typeof message.enabled === 'boolean'
      && isModelId(message.model)
      ? message as unknown as Extract<ControlCenterBrowserMessage, { type: 'planningProviderIntent' }>
      : undefined;
  }
  const allowed = [
    'select', 'set-credential', 'replace-credential', 'clear-credential',
    'test', 'cancel-test', 'review-consent', 'revoke-consent',
  ];
  if (!exact(message, ['type', 'revision', 'provider', 'operation'])
    || !allowed.includes(message.operation)) return undefined;
  if (message.provider === 'off' && message.operation !== 'select') return undefined;
  return message as unknown as Extract<ControlCenterBrowserMessage, { type: 'planningProviderIntent' }>;
}

function parseAgentManagementIntent(
  message: Record<string, unknown>,
): Extract<ControlCenterBrowserMessage, { type: 'agentManagementIntent' }> | undefined {
  if (!isRevision(message.revision) || typeof message.operation !== 'string') return undefined;
  if (message.operation === 'create') {
    return exact(message, ['type', 'revision', 'operation', 'templateId'])
      && isAgentTemplateId(message.templateId)
      ? message as unknown as Extract<ControlCenterBrowserMessage, { type: 'agentManagementIntent' }>
      : undefined;
  }
  if (message.operation === 'update-profile') {
    return exact(message, ['type', 'revision', 'operation', 'id', 'provider', 'model'])
      && isAgentId(message.id)
      && isPlanningProviderId(message.provider)
      && isModelId(message.model)
      ? message as unknown as Extract<ControlCenterBrowserMessage, { type: 'agentManagementIntent' }>
      : undefined;
  }
  if (message.operation === 'set-enabled') {
    return exact(message, ['type', 'revision', 'operation', 'id', 'enabled'])
      && isAgentId(message.id)
      && typeof message.enabled === 'boolean'
      ? message as unknown as Extract<ControlCenterBrowserMessage, { type: 'agentManagementIntent' }>
      : undefined;
  }
  return ['set-default', 'duplicate', 'delete'].includes(message.operation)
    && exact(message, ['type', 'revision', 'operation', 'id'])
    && isAgentId(message.id)
    ? message as unknown as Extract<ControlCenterBrowserMessage, { type: 'agentManagementIntent' }>
    : undefined;
}

function parseCustomCommandIntent(
  message: Record<string, unknown>,
): Extract<ControlCenterBrowserMessage, { type: 'customCommandIntent' }> | undefined {
  if (!isRevision(message.revision) || typeof message.operation !== 'string') return undefined;
  if (message.operation === 'add') {
    return exact(message, [
      'type', 'revision', 'operation', 'label', 'description', 'phrases',
      'kind', 'targetId', 'enabled', 'agentEnabled',
    ])
      && validCustomDraft(message)
      ? message as unknown as Extract<ControlCenterBrowserMessage, { type: 'customCommandIntent' }>
      : undefined;
  }
  if (message.operation === 'open') {
    return exact(message, ['type', 'revision', 'operation', 'id', 'requestSequence'])
      && isCustomCommandId(message.id)
      && isRevision(message.requestSequence)
      ? message as unknown as Extract<ControlCenterBrowserMessage, { type: 'customCommandIntent' }>
      : undefined;
  }
  if (message.operation === 'edit') {
    return exact(message, [
      'type', 'revision', 'operation', 'id', 'label', 'description', 'phrases',
      'kind', 'targetId', 'enabled', 'agentEnabled',
    ])
      && isCustomCommandId(message.id)
      && validCustomDraft(message)
      ? message as unknown as Extract<ControlCenterBrowserMessage, { type: 'customCommandIntent' }>
      : undefined;
  }
  if (message.operation === 'set-enabled') {
    return exact(message, ['type', 'revision', 'operation', 'id', 'enabled'])
      && isCustomCommandId(message.id)
      && typeof message.enabled === 'boolean'
      ? message as unknown as Extract<ControlCenterBrowserMessage, { type: 'customCommandIntent' }>
      : undefined;
  }
  return message.operation === 'delete'
    && exact(message, ['type', 'revision', 'operation', 'id'])
    && isCustomCommandId(message.id)
    ? message as unknown as Extract<ControlCenterBrowserMessage, { type: 'customCommandIntent' }>
    : undefined;
}

function validCustomDraft(message: Record<string, unknown>): boolean {
  return isCodePointString(message.label, 1, 80)
    && isCodePointString(message.description, 0, 240)
    && isPhraseList(message.phrases)
    && (message.kind === 'command' || message.kind === 'language-model-tool')
    && typeof message.targetId === 'string'
    && TARGET_ID.test(message.targetId)
    && typeof message.enabled === 'boolean'
    && typeof message.agentEnabled === 'boolean';
}

function parsePlanningProviderState(
  message: Record<string, unknown>,
): Extract<ControlCenterHostMessage, { type: 'planningProviderState' }> | undefined {
  if (!exact(message, ['type', 'revision', 'selectedProvider', 'items'])
    || !isRevision(message.revision)
    || !isPlanningProviderSelection(message.selectedProvider)
    || !Array.isArray(message.items)
    || message.items.length > 8) return undefined;
  const items = message.items.map(parsePlanningProvider);
  if (items.some((item) => !item) || !unique(items.map((item) => item?.id))) return undefined;
  if (message.selectedProvider !== 'off'
    && !items.some((item) => item?.id === message.selectedProvider)) return undefined;
  return { type: 'planningProviderState', revision: message.revision,
    selectedProvider: message.selectedProvider, items: items as ControlCenterPlanningProvider[] };
}

function parsePlanningProvider(value: unknown): ControlCenterPlanningProvider | undefined {
  const item = plainRecord(value);
  return item && exact(item, [
    'id', 'name', 'enabled', 'model', 'locality', 'credentialRequired',
    'credentialConfigured', 'consentRequired', 'consentAcknowledged',
  ])
    && isPlanningProviderId(item.id)
    && isCodePointString(item.name, 1, 80)
    && typeof item.enabled === 'boolean'
    && isModelId(item.model)
    && (item.locality === 'local-loopback' || item.locality === 'remote')
    && typeof item.credentialRequired === 'boolean'
    && typeof item.credentialConfigured === 'boolean'
    && typeof item.consentRequired === 'boolean'
    && typeof item.consentAcknowledged === 'boolean'
    ? item as unknown as ControlCenterPlanningProvider
    : undefined;
}

function parseAgentPageState(
  message: Record<string, unknown>,
): Extract<ControlCenterHostMessage, { type: 'agentPageState' }> | undefined {
  if (!validPage(message, 8, 32) || !Array.isArray(message.items)) return undefined;
  const items = message.items.map(parseAgentRow);
  if (items.some((item) => !item) || !unique(items.map((item) => item?.id))) return undefined;
  return message as unknown as Extract<ControlCenterHostMessage, { type: 'agentPageState' }>;
}

function parseAgentRow(value: unknown): ControlCenterAgentRow | undefined {
  const item = plainRecord(value);
  return item && exact(item, [
    'id', 'name', 'description', 'provider', 'model',
    'enabled', 'isDefault', 'instructionsConfigured',
  ])
    && isAgentId(item.id)
    && isCodePointString(item.name, 1, 80)
    && isCodePointString(item.description, 0, 400)
    && isPlanningProviderId(item.provider)
    && isModelId(item.model)
    && typeof item.enabled === 'boolean'
    && typeof item.isDefault === 'boolean'
    && typeof item.instructionsConfigured === 'boolean'
    ? item as unknown as ControlCenterAgentRow
    : undefined;
}

function parseCustomCommandPageState(
  message: Record<string, unknown>,
): Extract<ControlCenterHostMessage, { type: 'customCommandPageState' }> | undefined {
  if (!validPage(message, 10, 50) || !Array.isArray(message.items)) return undefined;
  const items = message.items.map(parseCustomCommandRow);
  if (items.some((item) => !item) || !unique(items.map((item) => item?.id))) return undefined;
  return message as unknown as Extract<ControlCenterHostMessage, { type: 'customCommandPageState' }>;
}

function parseCustomCommandDetails(
  message: Record<string, unknown>,
): Extract<ControlCenterHostMessage, { type: 'customCommandDetails' }> | undefined {
  if (!exact(message, [
    'type', 'revision', 'id', 'label', 'description', 'phrases',
    'kind', 'targetId', 'enabled', 'agentEnabled',
  ])
    || !isRevision(message.revision)
    || !isCustomCommandId(message.id)
    || !validCustomDraft(message)) return undefined;
  return message as unknown as Extract<ControlCenterHostMessage, { type: 'customCommandDetails' }>;
}

function parseCustomCommandRow(value: unknown): ControlCenterCustomCommandRow | undefined {
  const item = plainRecord(value);
  return item && exact(item, [
    'id', 'label', 'description', 'kind', 'targetId', 'enabled', 'agentEnabled',
  ])
    && isCustomCommandId(item.id)
    && isCodePointString(item.label, 1, 80)
    && isCodePointString(item.description, 0, 240)
    && (item.kind === 'command' || item.kind === 'language-model-tool')
    && typeof item.targetId === 'string'
    && TARGET_ID.test(item.targetId)
    && typeof item.enabled === 'boolean'
    && typeof item.agentEnabled === 'boolean'
    ? item as unknown as ControlCenterCustomCommandRow
    : undefined;
}

function validPage(message: Record<string, unknown>, pageSize: 8 | 10, maximum: 32 | 50): boolean {
  if (!exact(message, [
    'type', 'revision', 'pageIndex', 'pageSize', 'totalCount', 'pageRowCount', 'items',
  ])
    || !isRevision(message.revision)
    || message.pageSize !== pageSize
    || !isIntegerIn(message.totalCount, 0, maximum)
    || !isIntegerIn(message.pageIndex, 1, maximum / pageSize)
    || !isIntegerIn(message.pageRowCount, 0, pageSize)
    || !Array.isArray(message.items)
    || message.items.length !== message.pageRowCount) return false;
  const pages = Math.max(1, Math.ceil(message.totalCount / pageSize));
  const expected = Math.min(pageSize, Math.max(0, message.totalCount - ((message.pageIndex - 1) * pageSize)));
  return message.pageIndex <= pages && message.pageRowCount === expected;
}

function isPlanningProviderSelection(value: unknown): value is ControlCenterPlanningProviderSelection {
  return value === 'off' || isPlanningProviderId(value);
}

function isPlanningProviderId(value: unknown): value is ControlCenterPlanningProviderId {
  return typeof value === 'string' && PROVIDERS.has(value);
}

function isAgentTemplateId(value: unknown): value is ControlCenterAgentTemplateId {
  return typeof value === 'string' && TEMPLATES.has(value);
}

function isAgentId(value: unknown): value is string {
  return typeof value === 'string' && AGENT_ID.test(value);
}

function isCustomCommandId(value: unknown): value is string {
  return typeof value === 'string' && CUSTOM_COMMAND_ID.test(value);
}

function isModelId(value: unknown): value is string {
  return typeof value === 'string' && MODEL_ID.test(value);
}

function unique(values: readonly (string | undefined)[]): boolean {
  return values.every((value): value is string => Boolean(value))
    && new Set(values).size === values.length;
}
