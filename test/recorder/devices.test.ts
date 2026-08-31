import assert from 'node:assert/strict';
import test from 'node:test';
import {
  audioDevicesFromNames,
  fallbackIndexForLoopbackDefault,
  isLoopbackMonitorName,
  NoUsableAudioInputError,
  parseAudioDeviceId,
  resolveAudioDeviceIndex,
} from '../../src/recorder/devices';

test('device IDs remain stable when distinct devices reorder', () => {
  const first = audioDevicesFromNames(['Built-in Mic', 'USB Mic', 'Webcam Mic']);
  const reordered = ['Webcam Mic', 'Built-in Mic', 'USB Mic'];

  assert.equal(resolveAudioDeviceIndex(first[1].id, reordered), 2);
  assert.equal(audioDevicesFromNames(reordered)[2].id, first[1].id);
});

test('recognizes obvious PulseAudio and PipeWire monitor source names', () => {
  assert.equal(isLoopbackMonitorName('alsa_output.pci.stereo.monitor'), true);
  assert.equal(isLoopbackMonitorName('Monitor of Built-in Audio'), true);
  assert.equal(isLoopbackMonitorName('MONITOR OF USB Headset'), true);
  assert.equal(isLoopbackMonitorName('Studio Monitor Microphone'), false);
});

test('Linux system default falls back from a hidden monitor to a real capture input', () => {
  const names = [
    'alsa_output.pci-0000_00_1f.3.analog-stereo.monitor',
    'alsa_input.usb-Sony_WH-1000XM5.mono-fallback',
  ];

  assert.equal(fallbackIndexForLoopbackDefault(names, names[0], 'linux'), 1);
  assert.equal(fallbackIndexForLoopbackDefault(names, names[0], 'darwin'), undefined);
  assert.equal(fallbackIndexForLoopbackDefault(names, names[1], 'linux'), undefined);
  assert.throws(
    () => fallbackIndexForLoopbackDefault([names[0]], names[0], 'linux'),
    NoUsableAudioInputError,
  );
});

test('duplicate names use stable occurrence numbers', () => {
  const devices = audioDevicesFromNames(['USB Mic', 'Other', 'USB Mic']);

  assert.notEqual(devices[0].id, devices[2].id);
  assert.deepEqual(parseAudioDeviceId(devices[2].id), { name: 'USB Mic', occurrence: 1 });
  assert.equal(resolveAudioDeviceIndex(devices[2].id, ['USB Mic', 'USB Mic', 'Other']), 1);
});

test('device IDs preserve Unicode names exactly', () => {
  const [device] = audioDevicesFromNames(['מיקרופון 🎙️ / USB']);
  assert.deepEqual(parseAudioDeviceId(device.id), {
    name: 'מיקרופון 🎙️ / USB',
    occurrence: 0,
  });
});

test('invalid, legacy, or missing IDs fail explicitly', () => {
  assert.throws(
    () => resolveAudioDeviceIndex('default', ['Mic']),
    /invalid or unsupported/,
  );

  const [saved] = audioDevicesFromNames(['Disconnected Mic']);
  assert.throws(
    () => resolveAudioDeviceIndex(saved.id, ['Current Mic']),
    /Selected audio device is unavailable: Disconnected Mic/,
  );
});
