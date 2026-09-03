import type { ControlCenterOperations } from './controlCenterOperations';
import type { ControlCenterStateCoordinatorOptions } from './controlCenterStateCoordinator';

type OperationsPort = NonNullable<ControlCenterStateCoordinatorOptions['operations']>;

/**
 * Late-bound operations port: the state coordinator is composed before the operations it
 * drives, so every call resolves through the reference and answers a safe idle projection
 * while the reference is still empty.
 */
export function controlCenterOperationsPort(
  source: Readonly<{ current?: ControlCenterOperations }>,
): OperationsPort {
  return {
    setupState: () => source.current?.setupState() ?? {
      microphoneState: 'untested', microphoneLabel: '', systemTtsEnabled: false,
      systemTtsVoiceIndex: -1, systemTtsRate: 1,
      stepStates: ['pending', 'pending', 'complete', 'pending'], recommendedStep: 1,
    },
    diagnosticsState: () => source.current?.diagnosticsState() ?? {
      status: 'idle', summary: '', checks: [], canOpen: false, canCopy: false,
    },
    systemTtsState: () => source.current?.systemTtsState() ?? 'off',
    microphone: (message) => source.current?.microphone(message) ?? Promise.resolve(),
    observeVoices: (voices) => source.current?.observeVoices(voices),
    systemTts: (message) => source.current?.systemTts(message) ?? Promise.resolve(),
    diagnostics: (message) => source.current?.diagnostics(message) ?? Promise.resolve(),
  };
}
