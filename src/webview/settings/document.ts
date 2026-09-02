import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';

/** Creates the CSP-bound launcher-only compatibility document. */
export function renderSettingsDocument(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'settings.client.js'),
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'settingsLauncher.css'),
  );
  const nonce = randomBytes(18).toString('base64');
  const policy = [
    "default-src 'none'",
    `style-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "worker-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');

  return /* html */ `<!DOCTYPE html>
<html lang="en" dir="ltr">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${policy}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Voice Input Control Center</title>
    <link rel="stylesheet" href="${styleUri}" />
  </head>
  <body><div id="root"></div><script nonce="${nonce}" src="${scriptUri}"></script></body>
</html>`;
}
