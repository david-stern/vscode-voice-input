import assert from 'node:assert/strict';
import test from 'node:test';

import { SETTINGS_DEFAULTS, type SettingsSnapshot } from '../src/config';
import type { AudioDevice, RecorderHandle } from '../src/recorder/native';
import { AudioDeviceService } from '../src/features/recording/deviceService';
import { PushToTalkController } from '../src/features/recording/pushToTalkController';
import { TranscriptionService } from '../src/features/recording/transcriptionService';
import { ZeroSampleCaptureError } from '../src/recorder/capture';
import { audioDevicesFromNames, NoUsableAudioInputError } from '../src/recorder/devices';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function settingsSnapshot(audioDevice = ''): SettingsSnapshot {
  return {
    values: { ...SETTINGS_DEFAULTS, audioDevice },
    workspaceOverrides: [],
  };
}

function recordingController(options: {
  enumerate(): Promise<AudioDevice[]>;
  startRecorder(): Promise<RecorderHandle>;
  events: string[];
  audioDevice?: string;
  showError?(message: string, action?: string): Promise<string | undefined>;
  executeCommand?(command: string): Promise<void>;
  localize?(english: string, hebrew: string): string;
}): PushToTalkController {
  let audioDevice = options.audioDevice ?? '';
  const deviceService = new AudioDeviceService({
    settings: {
      read: () => settingsSnapshot(audioDevice),
      update: async (patch) => { audioDevice = patch.audioDevice ?? audioDevice; },
      migrateLegacyAudioDevice: async () => ({ status: 'not-needed' as const }),
    },
    enumerate: options.enumerate,
  });
  const transcriptions = new TranscriptionService({
    credentials: { use: async () => undefined },
    settings: { read: () => settingsSnapshot(audioDevice) },
    transcribe: async () => '',
  });
  return new PushToTalkController({
    devices: deviceService,
    transcriptions,
    settings: { read: () => settingsSnapshot() },
    history: { add: async () => ({ id: 'unused', text: '', lang: '', ts: 0 }) },
    status: {
      idle: () => options.events.push('idle'),
      recording: () => options.events.push('recording'),
      busy: (label) => options.events.push(`busy:${label}`),
      captureError: () => options.events.push('capture-error'),
    },
    ui: {
      showError: (message, action) => options.showError?.(message, action) ?? Promise.resolve(undefined),
      executeCommand: (command) => options.executeCommand?.(command) ?? Promise.resolve(),
    },
    publishHistory: () => {},
    stopAssistant: async () => {},
    isAssistantActive: () => false,
    isDeactivating: () => false,
    localize: options.localize ?? ((english) => english),
    startRecorder: options.startRecorder,
    injectText: async () => {},
    setTimer: () => 1 as unknown as ReturnType<typeof setTimeout>,
    clearTimer: () => {},
  });
}

function dispatchingRecordingController(options: {
  events: string[];
  startRecorder(): Promise<RecorderHandle>;
  transcribe?(signal: AbortSignal): Promise<string>;
  addHistory?(): Promise<void>;
  publishHistory?(): Promise<void> | void;
  injectText?(): Promise<void>;
  showError?(message: string, action?: string): Promise<string | undefined>;
  executeCommand?(command: string): Promise<void>;
  localize?(english: string, hebrew: string): string;
}): PushToTalkController {
  const deviceService = new AudioDeviceService({
    settings: {
      read: () => settingsSnapshot(),
      update: async () => {},
      migrateLegacyAudioDevice: async () => ({ status: 'not-needed' as const }),
    },
    enumerate: async () => [{ id: 'mic-1', label: 'Microphone' }],
  });
  const transcriptions = new TranscriptionService({
    credentials: {
      use: async <T>(
        _provider: 'soniox' | 'deepseek',
        operation: (credential: string) => Promise<T>,
      ) => {
        options.events.push('credential');
        return operation('secret-value');
      },
    },
    settings: { read: () => settingsSnapshot() },
    transcribe: async (input) => {
      options.events.push('transcription');
      return options.transcribe?.(input.signal) ?? 'transcript';
    },
  });
  return new PushToTalkController({
    devices: deviceService,
    transcriptions,
    settings: { read: () => settingsSnapshot() },
    history: {
      add: async (text, lang) => {
        options.events.push('history');
        await options.addHistory?.();
        return { id: 'entry-1', text, lang, ts: 1 };
      },
    },
    status: {
      idle: () => options.events.push('idle'),
      recording: () => options.events.push('recording'),
      busy: (label) => options.events.push(`busy:${label}`),
      captureError: () => options.events.push('capture-error'),
    },
    ui: {
      showError: async (message, action) => {
        options.events.push('error');
        return options.showError?.(message, action);
      },
      executeCommand: async (command) => {
        options.events.push('command');
        await options.executeCommand?.(command);
      },
    },
    publishHistory: async () => {
      options.events.push('publish');
      await options.publishHistory?.();
    },
    stopAssistant: async () => {},
    isAssistantActive: () => false,
    isDeactivating: () => false,
    localize: options.localize ?? ((english) => english),
    startRecorder: options.startRecorder,
    injectText: async () => {
      options.events.push('inject');
      await options.injectText?.();
    },
    setTimer: () => 1 as unknown as ReturnType<typeof setTimeout>,
    clearTimer: () => {},
  });
}

test('a slower device scan cannot overwrite or migrate after a newer completion', async () => {
  const first = deferred<AudioDevice[]>();
  const second = deferred<AudioDevice[]>();
  const requests = [first, second];
  const migrated: string[][] = [];
  const settings = {
    read: () => settingsSnapshot(''),
    update: async () => {},
    migrateLegacyAudioDevice: async (devices: readonly AudioDevice[]) => {
      migrated.push(devices.map((device) => device.id));
      return { status: 'not-needed' as const };
    },
  };
  const service = new AudioDeviceService({
    settings,
    enumerate: () => requests.shift()!.promise,
  });

  const older = service.get(true);
  const newer = service.get(true);
  second.resolve([{ id: 'new', label: 'New microphone' }]);
  assert.deepEqual(await newer, [{ id: 'new', label: 'New microphone' }]);
  first.resolve([{ id: 'old', label: 'Old microphone' }]);

  assert.deepEqual(await older, [{ id: 'new', label: 'New microphone' }]);
  assert.deepEqual(service.cachedDevices, [{ id: 'new', label: 'New microphone' }]);
  assert.deepEqual(migrated, [['new']]);
});

test('an absent canonical WH-1000XM5 selection is stale, never an ambiguous legacy label', async () => {
  const [saved] = audioDevicesFromNames(['WH-1000XM5']);
  let configured = saved.id;
  let legacyMigrations = 0;
  const writes: string[] = [];
  const service = new AudioDeviceService({
    settings: {
      read: () => settingsSnapshot(configured),
      update: async (patch) => {
        if (patch.audioDevice === undefined) return;
        configured = patch.audioDevice;
        writes.push(configured);
      },
      migrateLegacyAudioDevice: async () => {
        legacyMigrations += 1;
        return { status: 'ambiguous' as const };
      },
    },
    enumerate: async () => audioDevicesFromNames(['Built-in Microphone']),
  });

  await service.get(true);

  assert.deepEqual(service.selectionStatus, {
    kind: 'stale',
    deviceId: saved.id,
    label: 'WH-1000XM5',
    matchingDevices: 0,
  });
  assert.equal(legacyMigrations, 0);
  await service.select('');
  assert.deepEqual(service.selectionStatus, { kind: 'default' });
  assert.deepEqual(writes, ['']);
});

test('a canonical device occurrence is repaired when exactly one same-named input remains', async () => {
  const previous = audioDevicesFromNames(['WH-1000XM5', 'WH-1000XM5'])[1];
  const [current] = audioDevicesFromNames(['WH-1000XM5']);
  let configured = previous.id;
  const writes: string[] = [];
  const service = new AudioDeviceService({
    settings: {
      read: () => settingsSnapshot(configured),
      update: async (patch) => {
        if (patch.audioDevice === undefined) return;
        configured = patch.audioDevice;
        writes.push(configured);
      },
      migrateLegacyAudioDevice: async () => {
        throw new Error('canonical IDs must not enter legacy migration');
      },
    },
    enumerate: async () => [current],
  });

  await service.get(true);

  assert.equal(configured, current.id);
  assert.deepEqual(writes, [current.id]);
  assert.deepEqual(service.selectionStatus, {
    kind: 'repaired',
    previousDeviceId: previous.id,
    deviceId: current.id,
    label: 'WH-1000XM5',
  });
});

test('canonical repair stays stale when a workspace override keeps the old effective ID', async () => {
  const previous = audioDevicesFromNames(['WH-1000XM5', 'WH-1000XM5'])[1];
  const [current] = audioDevicesFromNames(['WH-1000XM5']);
  const writes: string[] = [];
  const service = new AudioDeviceService({
    settings: {
      read: () => settingsSnapshot(previous.id),
      update: async (patch) => {
        if (patch.audioDevice !== undefined) writes.push(patch.audioDevice);
      },
      migrateLegacyAudioDevice: async () => {
        throw new Error('canonical IDs must not enter legacy migration');
      },
    },
    enumerate: async () => [current],
  });

  await service.get(true);

  assert.deepEqual(writes, [current.id]);
  assert.deepEqual(service.selectionStatus, {
    kind: 'stale',
    deviceId: previous.id,
    label: 'WH-1000XM5',
    matchingDevices: 1,
  });
});

test('a fresh cached scan is bypassed when the effective device setting changes externally', async () => {
  const [microphone] = audioDevicesFromNames(['Built-in Microphone']);
  let configured = '';
  let enumerations = 0;
  const service = new AudioDeviceService({
    settings: {
      read: () => settingsSnapshot(configured),
      update: async () => {},
      migrateLegacyAudioDevice: async () => ({ status: 'not-needed' as const }),
    },
    enumerate: async () => {
      enumerations += 1;
      return [microphone];
    },
    now: () => 1,
  });

  await service.get();
  configured = microphone.id;
  await service.get();

  assert.equal(enumerations, 2);
  assert.deepEqual(service.selectionStatus, {
    kind: 'available',
    deviceId: microphone.id,
    label: microphone.label,
  });
});

test('push-to-talk reports a stale saved microphone and offers device recovery', async () => {
  const [saved] = audioDevicesFromNames(['WH-1000XM5']);
  const messages: Array<{ message: string; action?: string }> = [];
  const commands: string[] = [];
  let recorderStarts = 0;
  const controller = recordingController({
    audioDevice: saved.id,
    enumerate: async () => audioDevicesFromNames(['Built-in Microphone']),
    startRecorder: async () => {
      recorderStarts += 1;
      return { outcome: new Promise(() => {}), stop: async () => null, cancel: () => {} };
    },
    events: [],
    showError: async (message, action) => {
      messages.push({ message, action });
      return action;
    },
    executeCommand: async (command) => { commands.push(command); },
  });

  await controller.start();

  assert.equal(recorderStarts, 0);
  assert.match(messages[0].message, /WH-1000XM5.*no longer available/u);
  assert.equal(messages[0].action, 'Select Device');
  assert.deepEqual(commands, ['voiceInput.selectAudioDevice']);
  assert.equal(controller.isRecording, false);
});

test('stopping while stale-device recovery is open prevents its delayed command', async () => {
  const [saved] = audioDevicesFromNames(['WH-1000XM5']);
  const promptOpened = deferred<void>();
  const promptResult = deferred<string | undefined>();
  const commands: string[] = [];
  const controller = recordingController({
    audioDevice: saved.id,
    enumerate: async () => audioDevicesFromNames(['Built-in Microphone']),
    startRecorder: async () => {
      throw new Error('stale selection must stop before native capture');
    },
    events: [],
    showError: async () => {
      promptOpened.resolve(undefined);
      return promptResult.promise;
    },
    executeCommand: async (command) => { commands.push(command); },
  });

  const starting = controller.start();
  await promptOpened.promise;
  await controller.stop();
  promptResult.resolve('Select Device');
  await starting;

  assert.deepEqual(commands, []);
  assert.equal(controller.isRecording, false);
  assert.equal(controller.hasHandle, false);
});

test('an unsafe native default reports microphone selection instead of a generic start error', async () => {
  const messages: Array<{ message: string; action?: string }> = [];
  const commands: string[] = [];
  const controller = recordingController({
    enumerate: async () => audioDevicesFromNames(['Built-in Microphone']),
    startRecorder: async () => { throw new NoUsableAudioInputError(); },
    events: [],
    showError: async (message, action) => {
      messages.push({ message, action });
      return action;
    },
    executeCommand: async (command) => { commands.push(command); },
  });

  await controller.start();

  assert.match(messages[0].message, /system default is not a microphone input/u);
  assert.equal(messages[0].action, 'Select Device');
  assert.deepEqual(commands, ['voiceInput.selectAudioDevice']);
  assert.equal(controller.isRecording, false);
});

test('transcription keeps the credential inside the callback and uses typed settings', async () => {
  const seen: Array<Record<string, unknown>> = [];
  const service = new TranscriptionService({
    credentials: {
      use: async <T>(_provider: 'soniox' | 'deepseek', operation: (credential: string) => Promise<T>) =>
        operation('secret-value'),
    },
    settings: {
      read: () => ({
        ...settingsSnapshot(),
        values: {
          ...SETTINGS_DEFAULTS,
          languageHint: 'he',
          sttModel: 'stt-async-v4',
        },
      }),
    },
    transcribe: async (input) => {
      seen.push({
        apiKey: input.apiKey,
        model: input.model,
        languageHint: input.languageHint,
        aborted: input.signal.aborted,
      });
      return 'שלום';
    },
  });
  const operation = service.open('push-to-talk');

  const result = await operation.transcribe({ audio: new Uint8Array([1]), mime: 'audio/wav' });
  operation.dispose();

  assert.deepEqual(result, { status: 'completed', text: 'שלום' });
  assert.deepEqual(seen, [{
    apiKey: 'secret-value',
    model: 'stt-async-v4',
    languageHint: 'he',
    aborted: false,
  }]);
  assert.doesNotMatch(JSON.stringify(result), /secret-value/u);
});

test('aborting one transcription lane cancels its active operations', async () => {
  const service = new TranscriptionService({
    credentials: {
      use: async <T>(_provider: 'soniox' | 'deepseek', operation: (credential: string) => Promise<T>) =>
        operation('secret-value'),
    },
    settings: { read: () => settingsSnapshot() },
    transcribe: (input) => new Promise<string>((_resolve, reject) => {
      input.signal.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    }),
  });
  const operation = service.open('assistant');
  const pending = operation.transcribe({ audio: new Uint8Array([1]), mime: 'audio/wav' });

  service.abort('assistant');

  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(operation.signal.aborted, true);
  operation.dispose();
});

test('push-to-talk stops assistant before capture and disposes the native handle once', async () => {
  const events: string[] = [];
  let cancelled = 0;
  const deviceService = new AudioDeviceService({
    settings: {
      read: () => settingsSnapshot(),
      update: async () => {},
      migrateLegacyAudioDevice: async () => ({ status: 'not-needed' as const }),
    },
    enumerate: async () => [{ id: 'mic-1', label: 'Microphone' }],
  });
  const transcriptions = new TranscriptionService({
    credentials: { use: async () => undefined },
    settings: { read: () => settingsSnapshot() },
    transcribe: async () => '',
  });
  const controller = new PushToTalkController({
    devices: deviceService,
    transcriptions,
    settings: { read: () => settingsSnapshot() },
    history: { add: async () => ({ id: 'unused', text: '', lang: '', ts: 0 }) },
    status: {
      idle: () => events.push('idle'),
      recording: () => events.push('recording'),
      busy: (label) => events.push(`busy:${label}`),
      captureError: () => events.push('capture-error'),
    },
    ui: {
      showError: async () => undefined,
      executeCommand: async () => undefined,
    },
    publishHistory: () => {},
    stopAssistant: async () => { events.push('assistant-stopped'); },
    isAssistantActive: () => true,
    isDeactivating: () => false,
    localize: (english) => english,
    startRecorder: async () => ({
      outcome: new Promise(() => {}),
      stop: async () => null,
      cancel: () => { cancelled += 1; },
    }),
    injectText: async () => {},
    setTimer: () => 1 as unknown as ReturnType<typeof setTimeout>,
    clearTimer: () => {},
  });

  await controller.start();
  controller.dispose();

  assert.deepEqual(events, ['assistant-stopped', 'recording']);
  assert.equal(cancelled, 1);
  assert.equal(controller.isRecording, false);
});

test('stop during a cold device scan invalidates the pending recorder start', async () => {
  const scan = deferred<AudioDevice[]>();
  const events: string[] = [];
  let recorderStarts = 0;
  const controller = recordingController({
    enumerate: () => scan.promise,
    startRecorder: async () => {
      recorderStarts += 1;
      return { outcome: new Promise(() => {}), stop: async () => null, cancel: () => {} };
    },
    events,
  });

  const starting = controller.start();
  await Promise.resolve();
  await controller.stop();
  scan.resolve([{ id: 'mic-1', label: 'Microphone' }]);
  await starting;

  assert.equal(recorderStarts, 0);
  assert.equal(controller.isRecording, false);
  assert.equal(controller.hasHandle, false);
  assert.deepEqual(events, ['idle']);
});

test('a second host toggle cancels a cold pending recorder start', async () => {
  const scan = deferred<AudioDevice[]>();
  const events: string[] = [];
  let recorderStarts = 0;
  const controller = recordingController({
    enumerate: () => scan.promise,
    startRecorder: async () => {
      recorderStarts += 1;
      return { outcome: new Promise(() => {}), stop: async () => null, cancel: () => {} };
    },
    events,
  });

  const starting = controller.toggle();
  await Promise.resolve();
  await controller.toggle();
  scan.resolve([{ id: 'mic-1', label: 'Microphone' }]);
  await starting;

  assert.equal(recorderStarts, 0);
  assert.equal(controller.isRecording, false);
  assert.equal(controller.hasHandle, false);
  assert.deepEqual(events, ['idle']);
});

test('a recorder created after stop is cancelled exactly once and never published', async () => {
  const recorder = deferred<RecorderHandle>();
  const requested = deferred<void>();
  const events: string[] = [];
  let cancellations = 0;
  let stops = 0;
  const controller = recordingController({
    enumerate: async () => [{ id: 'mic-1', label: 'Microphone' }],
    startRecorder: () => {
      requested.resolve();
      return recorder.promise;
    },
    events,
  });

  const starting = controller.start();
  await requested.promise;
  await controller.stop();
  recorder.resolve({
    outcome: new Promise(() => {}),
    stop: async () => { stops += 1; return null; },
    cancel: () => { cancellations += 1; },
  });
  await starting;

  assert.equal(cancellations, 1);
  assert.equal(stops, 0);
  assert.equal(controller.isRecording, false);
  assert.equal(controller.hasHandle, false);
  assert.deepEqual(events, ['idle']);
});

test('cancel and dispose invalidate an in-flight native start and clean its late handle once', async () => {
  for (const action of ['cancel', 'dispose'] as const) {
    const recorder = deferred<RecorderHandle>();
    const requested = deferred<void>();
    const events: string[] = [];
    let cancellations = 0;
    let stops = 0;
    const controller = recordingController({
      enumerate: async () => [{ id: 'mic-1', label: 'Microphone' }],
      startRecorder: () => {
        requested.resolve();
        return recorder.promise;
      },
      events,
    });

    const starting = controller.start();
    await requested.promise;
    if (action === 'cancel') await controller.cancel();
    else controller.dispose();
    recorder.resolve({
      outcome: new Promise(() => {}),
      stop: async () => { stops += 1; return null; },
      cancel: () => { cancellations += 1; },
    });
    await starting;

    assert.equal(cancellations, 1, action);
    assert.equal(stops, 0, action);
    assert.equal(controller.isRecording, false, action);
    assert.equal(controller.hasHandle, false, action);
    assert.doesNotMatch(events.join(','), /recording/u, action);
  }
});

test('concurrent start calls share one pending start and publish one recorder', async () => {
  const scan = deferred<AudioDevice[]>();
  const events: string[] = [];
  let recorderStarts = 0;
  let cancellations = 0;
  const controller = recordingController({
    enumerate: () => scan.promise,
    startRecorder: async () => {
      recorderStarts += 1;
      return {
        outcome: new Promise(() => {}),
        stop: async () => null,
        cancel: () => { cancellations += 1; },
      };
    },
    events,
  });

  const first = controller.start();
  const second = controller.start();
  await second;
  scan.resolve([{ id: 'mic-1', label: 'Microphone' }]);
  await first;

  assert.equal(recorderStarts, 1);
  assert.equal(controller.isRecording, true);
  assert.equal(controller.hasHandle, true);
  assert.deepEqual(events, ['recording']);
  controller.dispose();
  assert.equal(cancellations, 1);
});

test('cancel and dispose invalidate a stop before it can open a transcription', async () => {
  for (const action of ['cancel', 'dispose'] as const) {
    const stopped = deferred<{ wav: Uint8Array; mime: 'audio/wav' } | null>();
    const stopStarted = deferred<void>();
    const events: string[] = [];
    let cancellations = 0;
    let stops = 0;
    const controller = dispatchingRecordingController({
      events,
      startRecorder: async () => ({
        outcome: new Promise(() => {}),
        stop: () => {
          stops += 1;
          stopStarted.resolve();
          return stopped.promise;
        },
        cancel: () => { cancellations += 1; },
      }),
    });

    await controller.start();
    const stopping = controller.stop();
    await stopStarted.promise;
    const cancelling = action === 'cancel'
      ? controller.cancel()
      : (controller.dispose(), Promise.resolve());
    stopped.resolve({ wav: new Uint8Array(2_048), mime: 'audio/wav' });
    await Promise.all([stopping, cancelling]);

    assert.equal(stops, 1, action);
    assert.equal(cancellations, 1, action);
    assert.equal(controller.isRecording, false, action);
    assert.equal(controller.hasHandle, false, action);
    assert.deepEqual(
      events.filter((event) => ['credential', 'transcription', 'history', 'publish', 'inject'].includes(event)),
      [],
      action,
    );
  }
});

test('cancel and dispose abort an active transcription and discard its late result', async () => {
  for (const action of ['cancel', 'dispose'] as const) {
    const transcriptionStarted = deferred<AbortSignal>();
    const transcriptionResult = deferred<string>();
    const events: string[] = [];
    const controller = dispatchingRecordingController({
      events,
      startRecorder: async () => ({
        outcome: new Promise(() => {}),
        stop: async () => ({ wav: new Uint8Array(2_048), mime: 'audio/wav' }),
        cancel: () => {},
      }),
      transcribe: (signal) => {
        transcriptionStarted.resolve(signal);
        return transcriptionResult.promise;
      },
    });

    await controller.start();
    const stopping = controller.stop();
    const signal = await transcriptionStarted.promise;
    const cancelling = action === 'cancel'
      ? controller.cancel()
      : (controller.dispose(), Promise.resolve());
    assert.equal(signal.aborted, true, action);
    transcriptionResult.resolve('late transcript');
    await Promise.all([stopping, cancelling]);

    assert.deepEqual(
      events.filter((event) => ['history', 'publish', 'inject'].includes(event)),
      [],
      action,
    );
  }
});

test('cancel followed by dispose cancels an in-flight stopping handle exactly once', async () => {
  const stopped = deferred<{ wav: Uint8Array; mime: 'audio/wav' } | null>();
  const stopStarted = deferred<void>();
  const events: string[] = [];
  let cancellations = 0;
  let stops = 0;
  const controller = dispatchingRecordingController({
    events,
    startRecorder: async () => ({
      outcome: new Promise(() => {}),
      stop: () => {
        stops += 1;
        stopStarted.resolve();
        return stopped.promise;
      },
      cancel: () => { cancellations += 1; },
    }),
  });

  await controller.start();
  const stopping = controller.stop();
  await stopStarted.promise;
  const cancelling = controller.cancel();
  controller.dispose();
  stopped.resolve({ wav: new Uint8Array(2_048), mime: 'audio/wav' });
  await Promise.all([stopping, cancelling]);

  assert.equal(cancellations, 1);
  assert.equal(stops, 1);
  assert.equal(events.includes('transcription'), false);
});

test('cancellation during history persistence prevents publication and injection', async () => {
  const historyStarted = deferred<void>();
  const releaseHistory = deferred<void>();
  const events: string[] = [];
  const controller = dispatchingRecordingController({
    events,
    startRecorder: async () => ({
      outcome: new Promise(() => {}),
      stop: async () => ({ wav: new Uint8Array(2_048), mime: 'audio/wav' }),
      cancel: () => {},
    }),
    addHistory: async () => {
      historyStarted.resolve();
      await releaseHistory.promise;
    },
  });

  await controller.start();
  const stopping = controller.stop();
  await historyStarted.promise;
  const cancelling = controller.cancel();
  releaseHistory.resolve();
  await Promise.all([stopping, cancelling]);

  assert.equal(events.filter((event) => event === 'history').length, 1);
  assert.equal(events.includes('publish'), false);
  assert.equal(events.includes('inject'), false);
});

test('cancellation during history publication prevents text injection', async () => {
  const publicationStarted = deferred<void>();
  const releasePublication = deferred<void>();
  const events: string[] = [];
  const controller = dispatchingRecordingController({
    events,
    startRecorder: async () => ({
      outcome: new Promise(() => {}),
      stop: async () => ({ wav: new Uint8Array(2_048), mime: 'audio/wav' }),
      cancel: () => {},
    }),
    publishHistory: async () => {
      publicationStarted.resolve();
      await releasePublication.promise;
    },
  });

  await controller.start();
  const stopping = controller.stop();
  await publicationStarted.promise;
  const cancelling = controller.cancel();
  releasePublication.resolve();
  await Promise.all([stopping, cancelling]);

  assert.equal(events.filter((event) => event === 'publish').length, 1);
  assert.equal(events.includes('inject'), false);
});

test('an in-flight stop is joined and blocks a replacement start until finalization', async () => {
  const firstStopped = deferred<{ wav: Uint8Array; mime: 'audio/wav' } | null>();
  const firstStopStarted = deferred<void>();
  const events: string[] = [];
  let recorderStarts = 0;
  const controller = dispatchingRecordingController({
    events,
    startRecorder: async () => {
      recorderStarts += 1;
      if (recorderStarts === 1) {
        return {
          outcome: new Promise(() => {}),
          stop: () => {
            firstStopStarted.resolve();
            return firstStopped.promise;
          },
          cancel: () => {},
        };
      }
      return {
        outcome: new Promise(() => {}),
        stop: async () => null,
        cancel: () => {},
      };
    },
  });

  await controller.start();
  const firstStop = controller.stop();
  await firstStopStarted.promise;
  const joinedStop = controller.stop();
  await controller.start();

  assert.equal(recorderStarts, 1);
  assert.equal(events.includes('idle'), false);

  firstStopped.resolve(null);
  await Promise.all([firstStop, joinedStop]);
  await controller.start();

  assert.equal(recorderStarts, 2);
  controller.dispose();
});

test('zero-sample capture reports localized microphone recovery without transcribing', async () => {
  const events: string[] = [];
  const prompts: Array<{ message: string; action?: string }> = [];
  const commands: string[] = [];
  const controller = dispatchingRecordingController({
    events,
    startRecorder: async () => ({
      outcome: new Promise(() => {}),
      stop: async () => ({ wav: new Uint8Array(44), mime: 'audio/wav' }),
      cancel: () => {},
    }),
    showError: async (message, action) => {
      prompts.push({ message, action });
      return action;
    },
    executeCommand: async (command) => { commands.push(command); },
    localize: (_english, hebrew) => hebrew,
  });

  await controller.start();
  await controller.stop();

  assert.match(prompts[0].message, /לא קיבל דגימות שמע/u);
  assert.equal(prompts[0].action, 'בחירת התקן');
  assert.deepEqual(commands, ['voiceInput.selectAudioDevice']);
  assert.equal(events.includes('transcription'), false);
  assert.equal(events.includes('history'), false);
  assert.equal(events.includes('inject'), false);
  assert.deepEqual(events, ['recording', 'busy:מקודד', 'error', 'command', 'idle']);
});

test('native zero-sample errors use the same actionable recovery path', async () => {
  const events: string[] = [];
  const messages: string[] = [];
  const controller = dispatchingRecordingController({
    events,
    startRecorder: async () => ({
      outcome: new Promise(() => {}),
      stop: async () => { throw new ZeroSampleCaptureError('PipeWire default'); },
      cancel: () => {},
    }),
    showError: async (message) => {
      messages.push(message);
      return undefined;
    },
  });

  await controller.start();
  await controller.stop();

  assert.match(messages[0], /received no audio samples/u);
  assert.equal(events.includes('transcription'), false);
});

test('cancelling while zero-sample recovery is open prevents its delayed command', async () => {
  const events: string[] = [];
  const promptOpened = deferred<void>();
  const promptResult = deferred<string | undefined>();
  const commands: string[] = [];
  const controller = dispatchingRecordingController({
    events,
    startRecorder: async () => ({
      outcome: new Promise(() => {}),
      stop: async () => ({ wav: new Uint8Array(44), mime: 'audio/wav' }),
      cancel: () => {},
    }),
    showError: async () => {
      promptOpened.resolve(undefined);
      return promptResult.promise;
    },
    executeCommand: async (command) => { commands.push(command); },
  });

  await controller.start();
  const stopping = controller.stop();
  await promptOpened.promise;
  const cancelling = controller.cancel();
  promptResult.resolve('Select Device');
  await Promise.all([stopping, cancelling]);

  assert.deepEqual(commands, []);
  assert.equal(events.includes('transcription'), false);
  assert.equal(controller.isRecording, false);
});

test('normal stop still transcribes, persists, publishes, and injects once', async () => {
  const events: string[] = [];
  const controller = dispatchingRecordingController({
    events,
    startRecorder: async () => ({
      outcome: new Promise(() => {}),
      stop: async () => ({ wav: new Uint8Array(2_048), mime: 'audio/wav' }),
      cancel: () => {},
    }),
  });

  await controller.start();
  await controller.stop();

  assert.deepEqual(events, [
    'recording',
    'busy:encoding',
    'busy:transcribing',
    'credential',
    'transcription',
    'history',
    'publish',
    'inject',
    'idle',
  ]);
});
