import * as vscode from 'vscode';

export type WebviewClientKind = 'microphone' | 'settings';

/** Internal smoke-only observation; exposes two booleans and no application state. */
export class VsCodeWebviewReadinessObservation implements vscode.Disposable {
  private readonly ready = { microphone: false, settings: false };
  private readonly registration = vscode.commands.registerCommand(
    'voiceInput.internal.webviewReadiness',
    () => Object.freeze({ ...this.ready }),
  );

  mark(kind: WebviewClientKind): void {
    this.ready[kind] = true;
  }

  dispose(): void {
    this.registration.dispose();
  }
}
