import { spawn } from 'child_process';

export interface TypeTool {
  bin: string;
  // Build args to TYPE arbitrary text into the focused input.
  // For some platforms (e.g. macOS osascript) this is implemented via the
  // clipboard inside the platform-paste path, not as a separate command.
  typeArgs(text: string): string[];
  // Build args to send the platform's paste shortcut (Ctrl+V or Cmd+V).
  pasteArgs(): string[];
  // Extra environment variables (e.g. YDOTOOL_SOCKET).
  env?: NodeJS.ProcessEnv;
}

const YDOTOOL_SOCKET = '/tmp/.ydotool_socket';

function platform(): 'mac' | 'linux' | 'win' | 'other' {
  if (process.platform === 'darwin') return 'mac';
  if (process.platform === 'linux') return 'linux';
  if (process.platform === 'win32') return 'win';
  return 'other';
}

function isWayland(): boolean {
  return Boolean(process.env.WAYLAND_DISPLAY) || process.env.XDG_SESSION_TYPE === 'wayland';
}

async function which(bin: string): Promise<boolean> {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  return new Promise((resolve) => {
    const p = spawn(cmd, [bin], { stdio: 'ignore' });
    p.on('exit', (code) => resolve(code === 0));
    p.on('error', () => resolve(false));
  });
}

// macOS: osascript ships with the OS, no install required.
// `keystroke "v" using command down` triggers Cmd+V against the focused app.
// For direct typing, `keystroke <text>` types literal characters.
const TOOL_MAC: TypeTool = {
  bin: 'osascript',
  typeArgs: (text) => [
    '-e',
    `tell application "System Events" to keystroke ${asAppleScriptString(text)}`,
  ],
  pasteArgs: () => [
    '-e',
    'tell application "System Events" to keystroke "v" using command down',
  ],
};

// Windows: PowerShell ships with Windows. SendKeys.SendWait('^v') sends Ctrl+V
// to the foreground window. -NoProfile keeps startup fast.
const TOOL_WIN: TypeTool = {
  bin: 'powershell',
  typeArgs: (text) => [
    '-NoProfile',
    '-Command',
    `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(${asPwshSendKeysLiteral(text)})`,
  ],
  pasteArgs: () => [
    '-NoProfile',
    '-Command',
    "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')",
  ],
};

const TOOLS_WAYLAND: TypeTool[] = [
  // ydotool first on Wayland: works with GNOME/Mutter, wtype does not.
  {
    bin: 'ydotool',
    typeArgs: (text) => ['type', '--', text],
    pasteArgs: () => ['key', '29:1', '47:1', '47:0', '29:0'],
    env: { YDOTOOL_SOCKET },
  },
  {
    bin: 'wtype',
    typeArgs: (text) => ['--', text],
    pasteArgs: () => ['-M', 'ctrl', 'v', '-m', 'ctrl'],
  },
];

const TOOLS_X11: TypeTool[] = [
  {
    bin: 'xdotool',
    typeArgs: (text) => ['type', '--clearmodifiers', '--', text],
    pasteArgs: () => ['key', 'ctrl+v'],
  },
  {
    bin: 'ydotool',
    typeArgs: (text) => ['type', '--', text],
    pasteArgs: () => ['key', '29:1', '47:1', '47:0', '29:0'],
    env: { YDOTOOL_SOCKET },
  },
];

export async function pickTypeTool(): Promise<TypeTool | null> {
  if (platform() === 'mac') {
    return (await which('osascript')) ? TOOL_MAC : null;
  }
  if (platform() === 'win') {
    return (await which('powershell')) ? TOOL_WIN : null;
  }
  const list = isWayland() ? TOOLS_WAYLAND : TOOLS_X11;
  for (const c of list) {
    if (await which(c.bin)) return c;
  }
  return null;
}

export function runTool(tool: TypeTool, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, ...(tool.env ?? {}) };
    const p = spawn(tool.bin, args, { stdio: ['ignore', 'pipe', 'pipe'], env });
    let err = '';
    p.stderr?.on('data', (d: Buffer) => (err += d.toString()));
    p.on('error', (e) => reject(e));
    p.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${tool.bin} exit ${code}: ${err.trim()}`));
    });
  });
}

function asAppleScriptString(s: string): string {
  // AppleScript string literal: wrap in quotes, escape backslash and quotes.
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function asPwshSendKeysLiteral(s: string): string {
  // SendKeys treats {}+^%~()[] as control chars — wrap each in {}.
  // Single quotes wrap the PowerShell string; '' escapes a single quote.
  const escaped = s
    .replace(/'/g, "''")
    .replace(/([+^%~(){}\[\]])/g, '{$1}');
  return `'${escaped}'`;
}
