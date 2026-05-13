import * as vscode from 'vscode';

let channel: vscode.OutputChannel | null = null;

export function getChannel(): vscode.OutputChannel {
  if (!channel) channel = vscode.window.createOutputChannel('Voice Input');
  return channel;
}

export function log(...parts: unknown[]) {
  const ts = new Date().toISOString().slice(11, 23);
  const line = parts
    .map((p) => (typeof p === 'string' ? p : JSON.stringify(p)))
    .join(' ');
  getChannel().appendLine(`[${ts}] ${line}`);
}

export function show() {
  getChannel().show(true);
}
