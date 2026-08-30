import * as vscode from 'vscode';
import { spawn, spawnSync } from 'child_process';
import { pickTypeTool, runTool } from './keypaste';
import { log } from './log';

export type InjectionMode = 'auto' | 'editor-only' | 'clipboard-only' | 'paste-key' | 'type-key';

/**
 * Append-only insertion. Never replaces selection. Never submits chat.
 *
 * mode='auto' (default):
 *   1. Active tab is a text file → editor.edit at cursor (handles Unicode/RTL natively).
 *   2. Else → write to system clipboard (wl-copy preferred on Wayland — bypasses
 *      VSCode's clipboard sandbox) + simulate Ctrl+V via ydotool.
 *      Paste-key works for any text including Hebrew Unicode (only 2 physical
 *      keys are pressed — the chat input handles the paste from clipboard).
 */
export async function injectText(text: string, mode: InjectionMode = 'auto'): Promise<void> {
  if (!text) return;

  // Transcripts may contain sensitive content. Keep diagnostics useful without
  // retaining any text in logs.
  log('inject:', { mode, len: text.length });

  if (mode === 'editor-only') {
    const editor = vscode.window.activeTextEditor;
    if (editor) await appendAtCursor(editor, text);
    else vscode.window.showWarningMessage('Voice Input: no active editor.');
    return;
  }

  if (mode === 'clipboard-only') {
    await writeClipboard(text);
    notifyClip(text);
    return;
  }

  if (mode === 'type-key') {
    await directType(text);
    return;
  }

  if (mode === 'paste-key') {
    await clipboardPasteKey(text);
    return;
  }

  // mode === 'auto'
  const activeTab = vscode.window.tabGroups?.activeTabGroup?.activeTab;
  const tabKind = activeTab?.input?.constructor?.name ?? 'none';
  const editor = vscode.window.activeTextEditor;
  log('auto routing:', { tabKind, hasEditor: !!editor });

  const isText = activeTab?.input instanceof vscode.TabInputText;
  if (isText && editor) {
    await appendAtCursor(editor, text);
    return;
  }
  await clipboardPasteKey(text);
}

async function appendAtCursor(editor: vscode.TextEditor, text: string) {
  await editor.edit((eb) => {
    for (const sel of editor.selections) {
      const pos = sel.active;
      const insert = needsLeadingSpace(editor.document, pos) ? ' ' + text : text;
      eb.insert(pos, insert);
    }
  });
  log('editor.edit done');
}

function needsLeadingSpace(doc: vscode.TextDocument, pos: vscode.Position): boolean {
  if (pos.character === 0) return false;
  const prev = doc.getText(new vscode.Range(pos.translate(0, -1), pos));
  return prev.length > 0 && !/\s/.test(prev);
}

async function clipboardPasteKey(text: string) {
  const tool = await pickTypeTool();
  log('paste-key tool:', tool ? tool.bin : '(none)');

  // Save user's clipboard for later restoration.
  let prev = '';
  try {
    prev = await vscode.env.clipboard.readText();
  } catch (e) {
    log('clipboard.readText failed:', (e as Error).message);
  }

  await writeClipboard(text);

  if (!tool) {
    notifyClip(text, '(no key tool)');
    return;
  }

  // Simulated input is sent to the focused OS application. Do not risk
  // pasting a transcript into another app when VS Code has lost focus.
  if (!vscode.window.state.focused) {
    log('paste-key aborted: VS Code not focused');
    notifyClip(text, '(VS Code is not focused)');
    return;
  }

  // Wait for clipboard manager to settle. Wayland sometimes needs >100ms.
  await new Promise((r) => setTimeout(r, 200));

  if (!vscode.window.state.focused) {
    log('paste-key aborted after clipboard wait: VS Code not focused');
    notifyClip(text, '(VS Code is not focused)');
    return;
  }

  try {
    await runTool(tool, tool.pasteArgs());
    log('paste-key sent ok');
    vscode.window.setStatusBarMessage(
      '$(check) Voice: pasted.',
      3000,
    );
  } catch (e) {
    const msg = (e as Error).message;
    log('paste-key failed:', msg);
    vscode.window.setStatusBarMessage(
      `$(error) Voice: paste failed (${msg.slice(0, 60)}). Ctrl+V to paste.`,
      6000,
    );
  }

  setTimeout(() => void restoreClipboardIfUnchanged(prev, text), 1800);
}

async function directType(text: string) {
  // Character injection tools depend on the active keyboard layout. Clipboard
  // paste preserves Hebrew and other RTL Unicode text exactly.
  if (containsRtlText(text)) {
    log('direct type redirected to clipboard paste for RTL text');
    await clipboardPasteKey(text);
    return;
  }

  const tool = await pickTypeTool();
  if (!tool) {
    await writeClipboard(text);
    notifyClip(text, '(no type tool)');
    return;
  }
  log('direct type via', tool.bin);
  await new Promise((r) => setTimeout(r, 80));
  try {
    await runTool(tool, tool.typeArgs(text));
  } catch {
    await clipboardPasteKey(text);
  }
}

async function writeClipboard(text: string): Promise<void> {
  // The VS Code clipboard API is the most reliable path on Windows. In
  // particular it avoids code-page conversion through clip.exe.
  if (process.platform === 'win32') {
    try {
      await vscode.env.clipboard.writeText(text);
      log('clipboard via vscode.env on Windows ok');
      return;
    } catch (e) {
      log('vscode clipboard on Windows failed, falling back:', (e as Error).message);
    }
  }
  if (process.platform === 'darwin' && hasPbcopy()) {
    try {
      await spawnPipe('pbcopy', [], text);
      log('clipboard via pbcopy ok');
      return;
    } catch (e) {
      log('pbcopy failed, falling back:', (e as Error).message);
    }
  }
  if (process.platform === 'win32' && hasClipExe()) {
    try {
      await spawnPipe('clip', [], text);
      log('clipboard via clip.exe ok');
      return;
    } catch (e) {
      log('clip.exe failed, falling back:', (e as Error).message);
    }
  }
  if (hasWlCopy()) {
    try {
      await spawnPipe('wl-copy', [], text);
      log('clipboard via wl-copy ok');
      return;
    } catch (e) {
      log('wl-copy failed, falling back:', (e as Error).message);
    }
  }
  await vscode.env.clipboard.writeText(text);
  log('clipboard via vscode.env ok');
}

async function restoreClipboardIfUnchanged(previous: string, voiceText: string): Promise<void> {
  try {
    // Preserve a clipboard change the user (or another application) made after
    // the voice paste. This comparison intentionally happens at restore time.
    if ((await vscode.env.clipboard.readText()) !== voiceText) {
      log('clipboard changed; skipping restore');
      return;
    }
    await writeClipboard(previous);
    log('clipboard restored');
  } catch (e) {
    log('clipboard restore check failed:', (e as Error).message);
  }
}

function spawnPipe(bin: string, args: string[], input: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    p.stderr?.on('data', (d: Buffer) => (err += d.toString()));
    p.on('error', reject);
    p.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${bin} exit ${code}: ${err}`));
    });
    p.stdin.end(input);
  });
}

let _pbcopyChecked = false;
let _pbcopyOk = false;
function hasPbcopy(): boolean {
  if (!_pbcopyChecked) {
    _pbcopyChecked = true;
    try {
      const p = spawnSync('which', ['pbcopy'], { stdio: 'ignore' });
      _pbcopyOk = p.status === 0;
    } catch {
      _pbcopyOk = false;
    }
    log('pbcopy available:', _pbcopyOk);
  }
  return _pbcopyOk;
}

let _clipChecked = false;
let _clipOk = false;
function hasClipExe(): boolean {
  if (!_clipChecked) {
    _clipChecked = true;
    try {
      const p = spawnSync('where', ['clip'], { stdio: 'ignore' });
      _clipOk = p.status === 0;
    } catch {
      _clipOk = false;
    }
    log('clip.exe available:', _clipOk);
  }
  return _clipOk;
}

let _wlCopyChecked = false;
let _wlCopyOk = false;
function hasWlCopy(): boolean {
  if (!_wlCopyChecked) {
    _wlCopyChecked = true;
    try {
      // synchronous check via a fast spawn
      const p = spawnSync('which', ['wl-copy'], { stdio: 'ignore' });
      _wlCopyOk = p.status === 0;
    } catch {
      _wlCopyOk = false;
    }
    log('wl-copy available:', _wlCopyOk);
  }
  return _wlCopyOk;
}

function containsRtlText(text: string): boolean {
  // Hebrew, Arabic, Syriac, Thaana and presentation/bidi controls use RTL
  // directionality and should never be sent through layout-dependent typing.
  return /[\u0590-\u08FF\u200F\u202B\u202E\u2067\u2068\uFB1D-\uFEFC]/u.test(text);
}

function notifyClip(_text: string, suffix = '') {
  vscode.window.setStatusBarMessage(
    `Voice Input: copied — Ctrl+V to paste ${suffix}`,
    6000,
  );
}
