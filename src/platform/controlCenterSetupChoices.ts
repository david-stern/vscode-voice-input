import {
  CONTROL_CENTER_SETUP_CHOICES_STORAGE_KEY,
  type GlobalStatePort,
} from '../config';

const SCHEMA_VERSION = 1 as const;
export type SetupSttDecision = 'pending' | 'none' | 'soniox';
export type SetupTtsDecision = 'pending' | 'off' | 'system';

export interface ControlCenterSetupChoiceSnapshot {
  schemaVersion: typeof SCHEMA_VERSION;
  stt: SetupSttDecision;
  tts: SetupTtsDecision;
}

const DEFAULT_CHOICES: ControlCenterSetupChoiceSnapshot = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  stt: 'pending',
  tts: 'pending',
});

/** Non-authorizing global-state record of explicit setup choices only. */
export class ControlCenterSetupChoices {
  private current: ControlCenterSetupChoiceSnapshot;
  private tail = Promise.resolve();

  constructor(private readonly state: GlobalStatePort) {
    this.current = parseChoices(state.get<unknown>(
      CONTROL_CENTER_SETUP_CHOICES_STORAGE_KEY,
      undefined,
    ));
  }

  snapshot(): ControlCenterSetupChoiceSnapshot {
    return Object.freeze({ ...this.current });
  }

  recordStt(stt: Exclude<SetupSttDecision, 'pending'>): Promise<void> {
    return this.update({ stt });
  }

  recordTts(tts: Exclude<SetupTtsDecision, 'pending'>): Promise<void> {
    return this.update({ tts });
  }

  private update(patch: Partial<Pick<ControlCenterSetupChoiceSnapshot, 'stt' | 'tts'>>): Promise<void> {
    const operation = async () => {
      const next: ControlCenterSetupChoiceSnapshot = Object.freeze({ ...this.current, ...patch });
      await this.state.update(CONTROL_CENTER_SETUP_CHOICES_STORAGE_KEY, next);
      this.current = next;
    };
    const pending = this.tail.then(operation, operation);
    this.tail = pending.then(() => undefined, () => undefined);
    return pending;
  }
}

function parseChoices(value: unknown): ControlCenterSetupChoiceSnapshot {
  let descriptors: PropertyDescriptorMap;
  try {
    if (!plain(value)) return DEFAULT_CHOICES;
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch { return DEFAULT_CHOICES; }
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== 3
    || keys.some((key) => typeof key !== 'string')
    || (keys as string[]).sort().join(',') !== 'schemaVersion,stt,tts'
    || !dataDescriptor(descriptors.schemaVersion)
    || !dataDescriptor(descriptors.stt)
    || !dataDescriptor(descriptors.tts)
    || descriptors.schemaVersion.value !== SCHEMA_VERSION
    || !['pending', 'none', 'soniox'].includes(descriptors.stt.value as string)
    || !['pending', 'off', 'system'].includes(descriptors.tts.value as string)) {
    return DEFAULT_CHOICES;
  }
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    stt: descriptors.stt.value as SetupSttDecision,
    tts: descriptors.tts.value as SetupTtsDecision,
  });
}

function dataDescriptor(value: PropertyDescriptor | undefined): value is PropertyDescriptor & { value: unknown } {
  return value !== undefined && Object.hasOwn(value, 'value');
}

function plain(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
