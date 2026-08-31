import type {
  MappingCancellationToken,
  MappingExecutionHost,
  MappingStorage,
  MappingTargetCatalog,
} from '../../assistant';

export type { MappingExecutionHost, MappingStorage };

export interface MappingDisposable {
  dispose(): void;
}

export interface MappingPickItem {
  label: string;
  description?: string;
  detail?: string;
}

export interface MappingPickOptions {
  title?: string;
  placeHolder?: string;
  matchOnDescription?: boolean;
  matchOnDetail?: boolean;
}

export interface MappingInputOptions {
  title: string;
  prompt: string;
  value: string;
  ignoreFocusOut: boolean;
  validateInput?: (value: string) => string | undefined;
}

/** User interaction and target discovery required by the native mapping editor. */
export interface MappingManagementHost {
  pick<T extends MappingPickItem>(
    items: readonly T[],
    options: MappingPickOptions,
  ): Promise<T | undefined>;
  input(options: MappingInputOptions): Promise<string | undefined>;
  discoverTargets(): Promise<MappingTargetCatalog>;
  showError(message: string): Promise<void>;
  showInformation(message: string): Promise<void>;
  confirmWarning(message: string, confirmLabel: string): Promise<boolean>;
}

export interface MappingToolPreparation {
  invocationMessage: string;
  confirmationMessages?: {
    title: string;
    message: string;
  };
}

export interface MappingAgentToolHost {
  registerListTool(
    name: string,
    invoke: (input: unknown, token: MappingCancellationToken) => string,
  ): MappingDisposable;
  registerRunTool(
    name: string,
    handlers: {
      prepare(input: unknown): MappingToolPreparation;
      invoke(
        input: unknown,
        toolInvocationToken: unknown,
        cancellationToken: MappingCancellationToken,
      ): Promise<string>;
    },
  ): MappingDisposable;
}
