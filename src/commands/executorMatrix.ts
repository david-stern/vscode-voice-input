import { BUILTIN_COMMAND_CATALOG } from './catalog';

export interface ExecutorMatrixEntry {
  commandId: string;
  executorId: string;
  kind: 'vscode-command' | 'host-api' | 'git-api';
  remote: false | 'supported';
  shellFallback: 'none';
  rejectionAfterDispatch: 'unknown-do-not-retry';
  partialPossible: boolean;
}

const PARTIAL_GIT = new Set([
  'git.commitAll',
  'git.pull',
  'git.sync',
  'git.addDirtyResources',
  'git.unstageIndexedResources',
]);

export const EXECUTOR_MATRIX: readonly ExecutorMatrixEntry[] = Object.freeze(
  BUILTIN_COMMAND_CATALOG.map((definition) => Object.freeze({
    commandId: definition.id,
    executorId: definition.executorId,
    kind: definition.executorId.startsWith('git.')
      ? 'git-api' as const
      : definition.executorId.startsWith('api.')
        ? 'host-api' as const
        : 'vscode-command' as const,
    remote: definition.availability.remote,
    shellFallback: 'none' as const,
    rejectionAfterDispatch: 'unknown-do-not-retry' as const,
    partialPossible: PARTIAL_GIT.has(definition.executorId),
  })),
);
