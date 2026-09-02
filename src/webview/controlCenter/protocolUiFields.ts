import {
  CONTROL_CENTER_DIAGNOSTIC_KINDS,
  type ControlCenterBrowserMessage,
  type ControlCenterDiagnosticCheck,
  type ControlCenterHostMessage,
  type ControlCenterObservedSystemVoice,
  type ControlCenterSetupStepState,
  type ControlCenterSetupStepStates,
} from './contracts';
import {
  exact,
  isCodePointString,
  isIntegerIn,
  isRevision,
  plainRecord,
} from './protocolValidation';

const MICROPHONE_STATES = [
  'unselected', 'untested', 'testing', 'signal-detected',
  'no-signal', 'unavailable', 'error',
] as const;
const SETUP_STEP_STATES = new Set<ControlCenterSetupStepState>([
  'complete', 'attention', 'pending',
]);
const DIAGNOSTIC_KINDS = new Set<string>(CONTROL_CENTER_DIAGNOSTIC_KINDS);

export function parseUiBrowserMessage(
  message: Record<string, unknown>,
): ControlCenterBrowserMessage | undefined {
  switch (message.type) {
    case 'microphoneSetupIntent':
      return exact(message, ['type', 'revision', 'operation'])
        && isRevision(message.revision)
        && ['select-device', 'test-signal', 'stop-test'].includes(message.operation as string)
        ? message as unknown as Extract<ControlCenterBrowserMessage, { type: 'microphoneSetupIntent' }>
        : undefined;
    case 'systemTtsVoicesObservedIntent':
      return parseVoiceObservation(message);
    case 'systemTtsIntent':
      return parseSystemTtsIntent(message);
    case 'diagnosticsIntent':
      return exact(message, ['type', 'revision', 'operation', 'requestSequence'])
        && isRevision(message.revision)
        && isRevision(message.requestSequence)
        && ['run', 'open', 'copy'].includes(message.operation as string)
        ? message as unknown as Extract<ControlCenterBrowserMessage, { type: 'diagnosticsIntent' }>
        : undefined;
    default:
      return undefined;
  }
}

export function parseUiHostMessage(
  message: Record<string, unknown>,
): ControlCenterHostMessage | undefined {
  switch (message.type) {
    case 'setupState':
      return exact(message, [
        'type', 'revision', 'microphoneState', 'microphoneLabel',
        'systemTtsEnabled', 'systemTtsVoiceIndex', 'systemTtsRate',
        'stepStates', 'recommendedStep',
      ])
        && isRevision(message.revision)
        && MICROPHONE_STATES.includes(message.microphoneState as typeof MICROPHONE_STATES[number])
        && isCodePointString(message.microphoneLabel, 0, 120)
        && typeof message.systemTtsEnabled === 'boolean'
        && isIntegerIn(message.systemTtsVoiceIndex, -1, 19)
        && isSpeechRate(message.systemTtsRate)
        && isSetupStepStates(message.stepStates)
        && isIntegerIn(message.recommendedStep, 1, 4)
        && message.recommendedStep === recommendedSetupStep(message.stepStates)
        ? message as unknown as Extract<ControlCenterHostMessage, { type: 'setupState' }>
        : undefined;
    case 'diagnosticsState':
      return parseDiagnosticsState(message);
    default:
      return undefined;
  }
}

function isSetupStepStates(value: unknown): value is ControlCenterSetupStepStates {
  if (!Array.isArray(value) || value.length !== 4) return false;
  for (let index = 0; index < 4; index += 1) {
    if (!Object.hasOwn(value, index)
      || !SETUP_STEP_STATES.has(value[index] as ControlCenterSetupStepState)) return false;
  }
  return true;
}

function recommendedSetupStep(states: ControlCenterSetupStepStates): 1 | 2 | 3 | 4 {
  const firstUnfinished = states.findIndex((state) => state !== 'complete');
  return firstUnfinished < 0 ? 4 : firstUnfinished + 1 as 1 | 2 | 3 | 4;
}

function parseVoiceObservation(
  message: Record<string, unknown>,
): Extract<ControlCenterBrowserMessage, { type: 'systemTtsVoicesObservedIntent' }> | undefined {
  if (!exact(message, ['type', 'revision', 'voices'])
    || !isRevision(message.revision)
    || !Array.isArray(message.voices)
    || message.voices.length > 20) return undefined;
  const voices = message.voices.map(parseObservedVoice);
  if (voices.some((voice) => !voice)) return undefined;
  const identifiers = voices.map((voice) => voice?.voiceUri);
  if (new Set(identifiers).size !== identifiers.length) return undefined;
  return {
    type: 'systemTtsVoicesObservedIntent',
    revision: message.revision,
    voices: voices as ControlCenterObservedSystemVoice[],
  };
}

function parseObservedVoice(value: unknown): ControlCenterObservedSystemVoice | undefined {
  const voice = plainRecord(value);
  return voice
    && exact(voice, ['voiceUri', 'name', 'language', 'isDefault'])
    && isCodePointString(voice.voiceUri, 1, 512)
    && isCodePointString(voice.name, 1, 120)
    && isCodePointString(voice.language, 0, 40)
    && typeof voice.isDefault === 'boolean'
    ? voice as unknown as ControlCenterObservedSystemVoice
    : undefined;
}

function parseSystemTtsIntent(
  message: Record<string, unknown>,
): Extract<ControlCenterBrowserMessage, { type: 'systemTtsIntent' }> | undefined {
  if (!isRevision(message.revision)) return undefined;
  if (message.operation === 'set-enabled') {
    return exact(message, ['type', 'revision', 'operation', 'enabled'])
      && typeof message.enabled === 'boolean'
      ? message as unknown as Extract<ControlCenterBrowserMessage, { type: 'systemTtsIntent' }>
      : undefined;
  }
  if (message.operation === 'set-voice') {
    return exact(message, ['type', 'revision', 'operation', 'voiceIndex'])
      && isIntegerIn(message.voiceIndex, -1, 19)
      ? message as unknown as Extract<ControlCenterBrowserMessage, { type: 'systemTtsIntent' }>
      : undefined;
  }
  return message.operation === 'set-rate'
    && exact(message, ['type', 'revision', 'operation', 'rate'])
    && isSpeechRate(message.rate)
    ? message as unknown as Extract<ControlCenterBrowserMessage, { type: 'systemTtsIntent' }>
    : undefined;
}

function parseDiagnosticsState(
  message: Record<string, unknown>,
): Extract<ControlCenterHostMessage, { type: 'diagnosticsState' }> | undefined {
  if (!exact(message, [
    'type', 'revision', 'status', 'summary', 'checks', 'canOpen', 'canCopy',
  ])
    || !isRevision(message.revision)
    || !['idle', 'running', 'ready', 'error'].includes(message.status as string)
    || !isCodePointString(message.summary, 0, 240)
    || !Array.isArray(message.checks)
    || message.checks.length > 8
    || typeof message.canOpen !== 'boolean'
    || typeof message.canCopy !== 'boolean') return undefined;
  const checks = message.checks.map(parseDiagnosticCheck);
  if (checks.some((check) => !check)) return undefined;
  return { ...message, checks } as unknown as Extract<ControlCenterHostMessage, { type: 'diagnosticsState' }>;
}

function parseDiagnosticCheck(value: unknown): ControlCenterDiagnosticCheck | undefined {
  const check = plainRecord(value);
  return check
    && exact(check, ['kind', 'status', 'message'])
    && typeof check.kind === 'string'
    && DIAGNOSTIC_KINDS.has(check.kind)
    && ['ready', 'attention', 'unavailable', 'error'].includes(check.status as string)
    && isCodePointString(check.message, 0, 240)
    ? check as unknown as ControlCenterDiagnosticCheck
    : undefined;
}

function isSpeechRate(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0.5
    && value <= 2;
}
