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
