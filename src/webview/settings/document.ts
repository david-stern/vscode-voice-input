import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';

import { SETTINGS_VIEW_STYLES } from './styles';

/** Creates the CSP-bound document for the browser-only Settings client. */
export function renderSettingsDocument(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'settings.client.js'),
  );
  const nonce = randomBytes(18).toString('base64');
  const policy = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  return /* html */ `<!DOCTYPE html>
<html lang="en" dir="ltr">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${policy}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Voice Input Settings</title>
    <style>${SETTINGS_VIEW_STYLES}</style>
  </head>
  <body><div id="root"></div><script nonce="${nonce}" src="${scriptUri}"></script></body>
</html>`;
}
