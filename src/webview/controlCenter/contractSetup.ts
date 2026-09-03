export type ControlCenterMicrophoneProofState =
  | 'unselected'
  | 'untested'
  | 'testing'
  | 'signal-detected'
  | 'no-signal'
  | 'unavailable'
  | 'error';

export type ControlCenterSetupStepState = 'complete' | 'attention' | 'pending';
export type ControlCenterSetupStepStates = readonly [
  ControlCenterSetupStepState,
  ControlCenterSetupStepState,
  ControlCenterSetupStepState,
  ControlCenterSetupStepState,
];

export interface ControlCenterSetupState {
  microphoneState: ControlCenterMicrophoneProofState;
  microphoneLabel: string;
  systemTtsEnabled: boolean;
  systemTtsVoiceIndex: number;
  systemTtsRate: number;
  stepStates: ControlCenterSetupStepStates;
  recommendedStep: 1 | 2 | 3 | 4;
  /**
   * Host-owned voices appended after the browser-observed voices. They are present only
   * when a host speech fallback is available, and the browser renders the same merged
   * list the host indexes, so `systemTtsVoiceIndex` stays meaningful for both sides.
   */
  hostVoices?: ControlCenterObservedSystemVoice[];
  /**
   * Soniox voice ids, appended after `hostVoices` in the same effective list. Only ids
   * travel: the browser expands them to the same records the host indexes. They are
   * present only while Soniox is the selected provider and its machine/profile-local
   * remote-processing consent still holds, and the browser can never play one itself.
   */
  sonioxVoices?: string[];
}

export interface ControlCenterObservedSystemVoice {
  voiceUri: string;
  name: string;
  language: string;
  isDefault: boolean;
}

export const CONTROL_CENTER_DIAGNOSTIC_KINDS = [
  'microphone',
  'speech-to-text',
  'system-speech',
  'commands',
  'authority',
  'assistant',
] as const;

export type ControlCenterDiagnosticKind = (typeof CONTROL_CENTER_DIAGNOSTIC_KINDS)[number];
export type ControlCenterDiagnosticStatus = 'ready' | 'attention' | 'unavailable' | 'error';

export interface ControlCenterDiagnosticCheck {
  kind: ControlCenterDiagnosticKind;
  status: ControlCenterDiagnosticStatus;
  message: string;
}
