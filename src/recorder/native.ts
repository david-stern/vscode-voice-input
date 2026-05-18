import { ChildProcess, spawn, spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

export interface RecorderHandle {
  stop(): Promise<{ wav: Uint8Array; mime: 'audio/wav' } | null>;
  cancel(): void;
}

interface ToolSpec {
  bin: string;
  argsFor(outFile: string): string[];
  // Some tools need a clean signal to flush WAV header (ffmpeg: SIGINT).
  stopSignal: NodeJS.Signals;
}

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

const FFMPEG_LINUX: ToolSpec = {
  bin: 'ffmpeg',
  argsFor: (out) => [
    '-loglevel', 'error',
    '-f', 'pulse',
    '-i', readDevice() || 'default',
    '-ar', '16000',
    '-ac', '1',
    '-acodec', 'pcm_s16le',
    '-y',
    out,
  ],
  stopSignal: 'SIGINT',
};

const FFMPEG_MAC: ToolSpec = {
  bin: 'ffmpeg',
  argsFor: (out) => [
    '-loglevel', 'error',
    '-f', 'avfoundation',
    '-i', readDevice() || ':0',
    '-ar', '16000',
    '-ac', '1',
    '-acodec', 'pcm_s16le',
    '-y',
    out,
  ],
  stopSignal: 'SIGINT',
};

const FFMPEG_WIN: ToolSpec = {
  bin: 'ffmpeg',
  argsFor: (out) => {
    const dev = readDevice() || detectWindowsAudioDevice() || 'Microphone';
    return [
      '-loglevel', 'error',
      '-f', 'dshow',
      '-i', `audio=${dev}`,
      '-ar', '16000',
      '-ac', '1',
      '-acodec', 'pcm_s16le',
      '-y',
      out,
    ];
  },
  // Windows ffmpeg does not respond cleanly to SIGINT; write 'q' to stdin
  // would be cleaner but Node spawn for Windows ffmpeg is finicky. SIGTERM
  // forces stop; the WAV header may need fix-up via -movflags faststart
  // (we use raw PCM in WAV which is robust against truncation).
  stopSignal: 'SIGTERM',
};

const TOOLS: ToolSpec[] = isMac
  ? [
      FFMPEG_MAC,
      {
        bin: 'rec',
        argsFor: (out) => [
          '-q',
          '-r', '16000',
          '-c', '1',
          '-b', '16',
          '-e', 'signed-integer',
          out,
        ],
        stopSignal: 'SIGINT',
      },
    ]
  : isWin
  ? [FFMPEG_WIN]
  : [
      FFMPEG_LINUX,
      {
        bin: 'parecord',
        argsFor: (out) => [
          '--rate=16000',
          '--channels=1',
          '--format=s16le',
          '--file-format=wav',
          out,
        ],
        stopSignal: 'SIGTERM',
      },
      {
        bin: 'arecord',
        argsFor: (out) => [
          '-q',
          '-f', 'S16_LE',
          '-r', '16000',
          '-c', '1',
          '-t', 'wav',
          out,
        ],
        stopSignal: 'SIGTERM',
      },
    ];

function readDevice(): string {
  try {
    return vscode.workspace.getConfiguration('voiceInput').get<string>('audioDevice', '').trim();
  } catch {
    return '';
  }
}

// ── Audio device enumeration ─────────────────────────────────────────────────

export interface AudioDevice {
  /** Identifier passed to the recorder (the -i argument value). */
  id: string;
  /** Human-readable label shown in the QuickPick. */
  label: string;
}

/** Run a process and collect stdout (or stderr when captureStderr=true). */
function runCapture(bin: string, args: string[], captureStderr = false): Promise<string> {
  return new Promise((resolve) => {
    const p = spawn(bin, args, {
      stdio: captureStderr ? ['ignore', 'ignore', 'pipe'] : ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    let out = '';
    const stream = captureStderr ? p.stderr : p.stdout;
    stream?.on('data', (d: Buffer) => { out += d.toString(); });
    p.on('error', () => resolve(''));
    p.on('close', () => resolve(out));
  });
}

async function listLinuxDevices(): Promise<AudioDevice[]> {
  // PulseAudio / PipeWire: pactl list sources short
  const raw = await runCapture('pactl', ['list', 'sources', 'short']);
  if (raw.trim()) {
    const devices: AudioDevice[] = [];
    for (const line of raw.split('\n')) {
      const parts = line.trim().split('\t');
      if (parts.length < 2) continue;
      const name = parts[1]?.trim();
      if (!name || name.endsWith('.monitor')) continue; // skip loopback monitors
      const label = name
        .replace(/^alsa_(input|output)\./, '')
        .replace(/\.\S+$/, '')
        .replace(/_/g, ' ')
        .trim();
      devices.push({ id: name, label: label || name });
    }
    if (devices.length > 0) return devices;
  }
  // Fallback: ALSA arecord -l
  const alsa = await runCapture('arecord', ['-l']);
  if (alsa.trim()) {
    const devices: AudioDevice[] = [];
    const re = /card (\d+)[^[]*\[([^\]]+)\][^,]*,\s*device (\d+):/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(alsa))) {
      devices.push({ id: `hw:${m[1]},${m[3]}`, label: m[2].trim() });
    }
    return devices;
  }
  return [];
}

async function listMacDevices(): Promise<AudioDevice[]> {
  const stderr = await runCapture(
    'ffmpeg',
    ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', ''],
    true,
  );
  const devices: AudioDevice[] = [];
  let inAudio = false;
  for (const line of stderr.split('\n')) {
    if (/AVFoundation audio devices/i.test(line)) { inAudio = true; continue; }
    if (/AVFoundation video devices/i.test(line)) break;
    if (!inAudio) continue;
    const m = line.match(/\[(\d+)\]\s+(.+)/);
    if (m) devices.push({ id: `:${m[1]}`, label: m[2].trim() });
  }
  return devices;
}

async function listWindowsDevices(): Promise<AudioDevice[]> {
  const stderr = await runCapture(
    'ffmpeg',
    ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'],
    true,
  );
  const devices: AudioDevice[] = [];
  const audioRe = /"([^"]+)"\s+\(audio\)/g;
  let m: RegExpExecArray | null;
  while ((m = audioRe.exec(stderr))) {
    devices.push({ id: m[1], label: m[1] });
  }
  return devices;
}

/** Enumerate available audio input devices for the current platform. */
export async function listAudioDevices(): Promise<AudioDevice[]> {
  try {
    if (isMac) return await listMacDevices();
    if (isWin) return await listWindowsDevices();
    return await listLinuxDevices();
  } catch {
    return [];
  }
}

let _winDevCached: string | null = null;
function detectWindowsAudioDevice(): string {
  if (_winDevCached !== null) return _winDevCached;
  // Run `ffmpeg -list_devices true -f dshow -i dummy` and parse audio device
  // names from stderr. First audio device wins.
  try {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], {
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: 5000,
    });
    const stderr = (r.stderr ?? Buffer.from('')).toString();
    // ffmpeg lists devices like: [dshow @ ...] "Microphone (Realtek)" (audio)
    const audioRe = /"([^"]+)"\s+\(audio\)/g;
    let m: RegExpExecArray | null;
    let firstAudio = '';
    while ((m = audioRe.exec(stderr))) {
      if (!firstAudio) firstAudio = m[1];
    }
    _winDevCached = firstAudio;
    return firstAudio;
  } catch {
    _winDevCached = '';
    return '';
  }
}

async function which(bin: string): Promise<boolean> {
  // Linux/Mac: `which`. Windows: `where.exe` is the equivalent — both are
  // launched via spawn so we try both.
  const cmd = isWin ? 'where' : 'which';
  return new Promise((resolve) => {
    const p = spawn(cmd, [bin], { stdio: 'ignore' });
    p.on('exit', (code) => resolve(code === 0));
    p.on('error', () => resolve(false));
  });
}

export async function pickTool(): Promise<ToolSpec | null> {
  for (const t of TOOLS) {
    if (await which(t.bin)) return t;
  }
  return null;
}

export async function startRecorder(): Promise<RecorderHandle> {
  const tool = await pickTool();
  if (!tool) {
    const hint = isMac
      ? 'Install ffmpeg (brew install ffmpeg) or sox (brew install sox).'
      : isWin
      ? 'Install ffmpeg from https://ffmpeg.org/download.html and add to PATH (or use winget install Gyan.FFmpeg).'
      : 'Install one of: ffmpeg, parecord (pulseaudio-utils), arecord (alsa-utils).';
    throw new Error(`No audio recorder found. ${hint}`);
  }

  const outFile = path.join(
    os.tmpdir(),
    `voiceinput-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`,
  );

  let proc: ChildProcess | null = spawn(tool.bin, tool.argsFor(outFile), {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let stderr = '';
  proc.stderr?.on('data', (d: Buffer) => {
    stderr += d.toString();
    if (stderr.length > 4096) stderr = stderr.slice(-2048);
  });

  let exitedEarly = false;
  let earlyExitCode: number | null = null;
  proc.on('exit', (code) => {
    exitedEarly = proc !== null;
    earlyExitCode = code;
  });

  // Give recorder a moment to fail fast (e.g. no audio source).
  await new Promise((r) => setTimeout(r, 200));
  if (exitedEarly) {
    proc = null;
    throw new Error(
      `Recorder ${tool.bin} exited immediately (code=${earlyExitCode}). ${stderr.slice(0, 400) || ''}`.trim(),
    );
  }

  return {
    async stop() {
      if (!proc) return null;
      const p = proc;
      proc = null;

      const exited = new Promise<void>((resolve) => {
        p.once('exit', () => resolve());
      });

      // ffmpeg shuts down most cleanly when given 'q' on stdin — preserves
      // WAV header timestamps. Works on all platforms when stdin is a pipe.
      try {
        if (tool.bin === 'ffmpeg' && p.stdin && !p.stdin.destroyed) {
          p.stdin.write('q');
          p.stdin.end();
        } else {
          p.kill(tool.stopSignal);
        }
      } catch {
        try { p.kill(tool.stopSignal); } catch { /* */ }
      }

      await Promise.race([
        exited,
        new Promise<void>((r) => setTimeout(() => r(), 2500)),
      ]);

      try {
        const wav = await fs.readFile(outFile);
        return { wav: new Uint8Array(wav), mime: 'audio/wav' as const };
      } finally {
        fs.unlink(outFile).catch(() => {});
      }
    },
    cancel() {
      if (!proc) return;
      const p = proc;
      proc = null;
      try { p.kill('SIGKILL'); } catch { /* */ }
      fs.unlink(outFile).catch(() => {});
    },
  };
}
