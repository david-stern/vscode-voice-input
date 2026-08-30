export interface AudioDevice {
  /** Stable, versioned identifier persisted in VS Code configuration. */
  id: string;
  /** Human-readable name reported by PvRecorder. */
  label: string;
}

const DEVICE_ID_PREFIX = 'pvrecorder:v1:';

/** PulseAudio/PipeWire monitor sources play output audio rather than microphones. */
export function isLoopbackMonitorName(name: string): boolean {
  return /(?:\.monitor\b|\bmonitor\s+of\b)/i.test(name);
}

function encodeName(name: string): string {
  return Buffer.from(name, 'utf8').toString('base64url');
}

function decodeName(encoded: string): string | null {
  try {
    const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
    return encodeName(decoded) === encoded ? decoded : null;
  } catch {
    return null;
  }
}

/** Build stable IDs from the exact device name plus its duplicate occurrence. */
export function audioDevicesFromNames(names: readonly string[]): AudioDevice[] {
  const occurrences = new Map<string, number>();
  return names.map((name) => {
    const occurrence = occurrences.get(name) ?? 0;
    occurrences.set(name, occurrence + 1);
    return {
      id: `${DEVICE_ID_PREFIX}${occurrence}:${encodeName(name)}`,
      label: name,
    };
  });
}

export interface ParsedAudioDeviceId {
  name: string;
  occurrence: number;
}

/** Parse only canonical Voice Input device IDs from the current ID version. */
export function parseAudioDeviceId(id: string): ParsedAudioDeviceId | null {
  if (!id.startsWith(DEVICE_ID_PREFIX)) return null;
  const payload = id.slice(DEVICE_ID_PREFIX.length);
  const separator = payload.indexOf(':');
  if (separator <= 0) return null;

  const occurrenceText = payload.slice(0, separator);
  if (!/^(0|[1-9]\d*)$/.test(occurrenceText)) return null;
  const name = decodeName(payload.slice(separator + 1));
  if (name === null) return null;

  const occurrence = Number(occurrenceText);
  if (!Number.isSafeInteger(occurrence)) return null;
  return { name, occurrence };
}

/** Resolve a saved ID against the current order without falling back silently. */
export function resolveAudioDeviceIndex(id: string, names: readonly string[]): number {
  const parsed = parseAudioDeviceId(id);
  if (!parsed) {
    throw new Error(`Saved audio device ID is invalid or unsupported: ${id}`);
  }

  let occurrence = 0;
  for (let index = 0; index < names.length; index += 1) {
    if (names[index] !== parsed.name) continue;
    if (occurrence === parsed.occurrence) return index;
    occurrence += 1;
  }

  throw new Error(
    `Selected audio device is unavailable: ${parsed.name} (occurrence ${parsed.occurrence + 1}). ` +
    'Choose another device in Voice Input settings.',
  );
}
