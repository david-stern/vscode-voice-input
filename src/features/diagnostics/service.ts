import { spawn } from 'child_process';
import { existsSync } from 'fs';

import type { AudioDeviceService } from '../recording';
import type { CredentialService } from '../../config';

export type DiagnosticCheckId =
  | 'extension'
  | 'soniox'
  | 'deepseek'
  | 'microphone'
  | 'paste-helper'
  | 'workspace-trust';

export type DiagnosticCheckStatus = 'ok' | 'attention' | 'unavailable' | 'unknown';

export interface DiagnosticCheck {
  id: DiagnosticCheckId;
  status: DiagnosticCheckStatus;
}

export interface DiagnosticsResult {
  status: 'ready' | 'attention';
  checks: readonly DiagnosticCheck[];
  report: string;
}

export interface DiagnosticsServiceOptions {
  version: string;
  devices: Pick<AudioDeviceService, 'get'>;
  credentials?: Pick<CredentialService, 'status'>;
  isWorkspaceTrusted?(): boolean;
  log(...values: unknown[]): void;
  showLog(): void;
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  commandExists?(command: string, executable: string): Promise<boolean>;
  pathExists?(path: string): boolean;
}

/** Produces the existing local diagnostics report without including user data or credentials. */
export class DiagnosticsService {
  private readonly platform: NodeJS.Platform;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly commandExists: NonNullable<DiagnosticsServiceOptions['commandExists']>;
  private readonly pathExists: NonNullable<DiagnosticsServiceOptions['pathExists']>;
  private lastResult: DiagnosticsResult | undefined;

  constructor(private readonly options: DiagnosticsServiceOptions) {
    this.platform = options.platform ?? process.platform;
    this.environment = options.environment ?? process.env;
    this.commandExists = options.commandExists ?? defaultCommandExists;
    this.pathExists = options.pathExists ?? existsSync;
  }

  get result(): DiagnosticsResult | undefined {
    if (!this.lastResult) return undefined;
    return {
      status: this.lastResult.status,
      checks: this.lastResult.checks.map((check) => ({ ...check })),
      report: this.lastResult.report,
    };
  }

  async run(): Promise<DiagnosticsResult> {
    const result = await this.collect();
    this.options.showLog();
    return result;
  }

  async collect(): Promise<DiagnosticsResult> {
    const session = sessionCategory(this.environment.XDG_SESSION_TYPE);
    const wayland = presence(this.environment.WAYLAND_DISPLAY);
    const display = presence(this.environment.DISPLAY);
    const lookupCommand = this.platform === 'win32' ? 'where' : 'which';

    this.options.log('=== DIAGNOSTICS ===');
    this.options.log('version:', this.options.version);
    this.options.log('session:', session, 'WAYLAND_DISPLAY:', wayland, 'DISPLAY:', display);
    this.options.log(`paste helper checks (using ${lookupCommand}):`);
    let pasteHelperAvailable = false;
    for (const executable of this.executablesToCheck()) {
      const found = await this.commandExists(lookupCommand, executable);
      pasteHelperAvailable ||= found;
      this.options.log(`  ${executable}:`, found ? 'OK' : 'MISSING');
    }
    let microphoneStatus: DiagnosticCheckStatus = 'unavailable';
    try {
      const deviceCount = (await this.options.devices.get(true)).length;
      microphoneStatus = deviceCount > 0 ? 'ok' : 'attention';
      this.options.log('native audio devices:', deviceCount);
    } catch {
      this.options.log('native audio enumeration failed: unavailable');
    }
    if (this.platform !== 'darwin') {
      const socketExists = this.pathExists('/tmp/.ydotool_socket');
      this.options.log(
        'ydotool socket:',
        socketExists ? 'EXISTS' : 'MISSING',
      );
    }
    this.options.log('platform:', this.platform);
    this.options.log('=== END DIAGNOSTICS ===');
    const [soniox, deepseek] = await Promise.all([
      this.credentialCheck('soniox'),
      this.credentialCheck('deepseek'),
    ]);
    const checks: DiagnosticCheck[] = [
      { id: 'extension', status: 'ok' },
      { id: 'soniox', status: soniox },
      { id: 'deepseek', status: deepseek },
      { id: 'microphone', status: microphoneStatus },
      { id: 'paste-helper', status: pasteHelperAvailable ? 'ok' : 'unavailable' },
      {
        id: 'workspace-trust',
        status: this.options.isWorkspaceTrusted?.() === false ? 'attention' : 'ok',
      },
    ];
    const status = checks.every((check) => check.status === 'ok') ? 'ready' : 'attention';
    this.lastResult = {
      status,
      checks,
      report: createSanitizedReport(this.options.version, platformCategory(this.platform), checks),
    };
    return this.result as DiagnosticsResult;
  }

  open(): void {
    if (this.lastResult) this.options.showLog();
  }

  private executablesToCheck(): string[] {
    if (this.platform === 'darwin') return ['osascript', 'pbcopy', 'pbpaste'];
    if (this.platform === 'win32') return ['powershell', 'clip'];
    return ['wl-copy', 'wl-paste', 'wtype', 'ydotool', 'xdotool'];
  }

  private async credentialCheck(provider: 'soniox' | 'deepseek'): Promise<DiagnosticCheckStatus> {
    if (!this.options.credentials) return 'unknown';
    try {
      return (await this.options.credentials.status(provider)).configured ? 'ok' : 'attention';
    } catch {
      return 'unavailable';
    }
  }
}

function createSanitizedReport(
  version: string,
  platform: 'darwin' | 'linux' | 'win32' | 'other',
  checks: readonly DiagnosticCheck[],
): string {
  return [
    'Voice Input diagnostics',
    `version=${version}`,
    `platform=${platform}`,
    ...checks.map((check) => `${check.id}=${check.status}`),
  ].join('\n');
}

function platformCategory(platform: NodeJS.Platform): 'darwin' | 'linux' | 'win32' | 'other' {
  return platform === 'darwin' || platform === 'linux' || platform === 'win32'
    ? platform
    : 'other';
}

function presence(value: string | undefined): 'present' | 'absent' {
  return value ? 'present' : 'absent';
}

function sessionCategory(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return 'unknown';
  return ['wayland', 'x11', 'tty'].includes(normalized) ? normalized : 'other';
}

function defaultCommandExists(command: string, executable: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, [executable], { stdio: 'ignore' });
    child.on('exit', (code: number) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}
