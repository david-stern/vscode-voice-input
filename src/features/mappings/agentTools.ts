import {
  DEFAULT_AGENT_MAPPING_PAGE_SIZE,
  MAX_AGENT_MAPPING_PAGE_SIZE,
  MAX_CUSTOM_MAPPINGS,
  paginateAgentMappings,
  serializeAgentMappingPage,
  mappingFingerprint,
  type CustomMappingExecutor,
} from '../../assistant';
import { mappingTargetId, type Localize } from './pendingActionController';
import type { MappingAgentToolHost, MappingDisposable } from './ports';
import type { MappingStore } from './store';
import type { MappingApprovalStore } from '../../agents';

export interface ListMappingsToolInput { cursor?: number; limit?: number }
export interface RunMappingToolInput { mappingId: string }

interface PreparedMappingBinding {
  fingerprint: string;
  expiresAt: number;
  ambiguous: boolean;
}

const PREPARED_MAPPING_TTL_MS = 30_000;

export function isListMappingsToolInput(value: unknown): value is ListMappingsToolInput {
  if (!isPlainRecord(value)) return false;
  if (Object.keys(value).some((key) => key !== 'cursor' && key !== 'limit')) return false;
  const cursor = value.cursor ?? 0;
  const limit = value.limit ?? DEFAULT_AGENT_MAPPING_PAGE_SIZE;
  return Number.isInteger(cursor) && Number(cursor) >= 0 && Number(cursor) <= MAX_CUSTOM_MAPPINGS
    && Number.isInteger(limit) && Number(limit) >= 1 && Number(limit) <= MAX_AGENT_MAPPING_PAGE_SIZE;
}

export function isRunMappingToolInput(value: unknown): value is RunMappingToolInput {
  if (!isPlainRecord(value)) return false;
  return Object.keys(value).length === 1
    && typeof value.mappingId === 'string'
    && /^vm_[A-Za-z0-9_-]{22,64}$/u.test(value.mappingId);
}

/** Registers the fixed list/run Agent surface around the shared single-flight executor. */
export function registerAgentMappingTools(options: {
  store: Pick<MappingStore, 'list' | 'get'>;
  executor: Pick<CustomMappingExecutor, 'execute'>;
  localize: Localize;
  host: MappingAgentToolHost;
  approvals?: Pick<MappingApprovalStore, 'state' | 'recordExecution'>;
}): MappingDisposable[] {
  const preparedMappings = new Map<string, PreparedMappingBinding>();
  const listErrorResult = (error: 'cancelled' | 'invalid-input' | 'result-too-large') =>
    JSON.stringify({ error, mappings: [], nextCursor: null, total: 0 });

  return [
    options.host.registerListTool('voice-input_listMappings', (input, token) => {
        if (token.isCancellationRequested) return listErrorResult('cancelled');
        if (!isListMappingsToolInput(input)) return listErrorResult('invalid-input');
        try {
          const page = paginateAgentMappings(
            options.store.list(),
            input.cursor ?? 0,
            input.limit ?? DEFAULT_AGENT_MAPPING_PAGE_SIZE,
          );
          return serializeAgentMappingPage(page);
        } catch {
          return listErrorResult('result-too-large');
        }
      }),
    options.host.registerRunTool('voice-input_runMapping', {
      prepare: (input) => {
        const candidate = isRunMappingToolInput(input)
          ? options.store.get(input.mappingId)
          : undefined;
        const mapping = candidate?.enabled && candidate.agentEnabled ? candidate : undefined;
        if (mapping) {
          const now = Date.now();
          const previous = preparedMappings.get(mapping.id);
          preparedMappings.set(mapping.id, {
            fingerprint: mappingFingerprint(mapping),
            expiresAt: now + PREPARED_MAPPING_TTL_MS,
            ambiguous: Boolean(previous && previous.expiresAt >= now),
          });
        } else if (isRunMappingToolInput(input)) {
          preparedMappings.delete(input.mappingId);
        }
        const target = mapping
          ? mappingTargetId(mapping)
          : options.localize('unavailable', 'לא זמין');
        const label = mapping?.label ?? options.localize('Unknown mapping', 'מיפוי לא ידוע');
        const confirmationMessages = mapping
          && options.approvals?.state(mapping.id) === 'approved'
          ? undefined
          : {
              title: options.localize(
                'Run a local VS Code action?',
                'להפעיל פעולת VS Code מקומית?',
              ),
              message: options.localize(
                `Voice Input will run “${label}”. Exact target: ${target}. Static input is the locally saved value and cannot be changed by the Agent.`,
                `Voice Input יפעיל את „${label}”. יעד מדויק: ${target}. הקלט הקבוע הוא הערך שנשמר מקומית ואינו ניתן לשינוי על ידי ה־Agent.`,
              ),
            };
        return {
          invocationMessage: options.localize(
            `Running approved Voice Input mapping “${label}”`,
            `מפעיל את מיפוי Voice Input המאושר „${label}”`,
          ),
          ...(confirmationMessages ? { confirmationMessages } : {}),
        };
      },
      invoke: async (input, toolInvocationToken, cancellationToken) => {
        if (!isRunMappingToolInput(input)) return 'invalid-input';
        const prepared = preparedMappings.get(input.mappingId);
        preparedMappings.delete(input.mappingId);
        const mapping = options.store.get(input.mappingId);
        if (!mapping || !mapping.enabled || !mapping.agentEnabled) return 'failed:mapping-not-found';
        if (!prepared || prepared.ambiguous || prepared.expiresAt < Date.now()) {
          return 'failed:preview-unavailable';
        }
        if (mappingFingerprint(mapping) !== prepared.fingerprint) {
          return 'failed:mapping-changed';
        }
        const approvalState = options.approvals?.state(input.mappingId) ?? 'none';
        if (approvalState === 'revoked') {
          return 'failed:approval-revoked';
        }
        const result = await options.executor.execute(input.mappingId, {
          source: 'agent',
          toolInvocationToken,
          cancellationToken,
          expectedFingerprint: prepared.fingerprint,
        });
        if (result.ok) {
          options.approvals?.recordExecution(input.mappingId, approvalState === 'approved');
          return 'success';
        }
        return result.reason === 'outcome-unknown-do-not-retry'
          ? 'outcome-unknown:action-may-have-run:do-not-retry-automatically'
          : `failed:${result.reason}`;
      },
    }),
  ];
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
