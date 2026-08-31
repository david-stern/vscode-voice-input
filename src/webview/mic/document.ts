import * as vscode from 'vscode';
import { MIC_VIEW_STYLES } from './styles';

/** Creates the CSP-bound, browser-only document used by the microphone view. */
export function renderMicDocument(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'mic.client.js'));
  const nonce = createNonce();
  const contentSecurityPolicy = ["default-src 'none'", `style-src ${webview.cspSource} 'unsafe-inline'`, `script-src 'nonce-${nonce}'`, `img-src ${webview.cspSource} data:`].join('; ');
  return /* html */ `<!DOCTYPE html>
<html lang="he" dir="rtl"><head><meta charset="UTF-8" /><meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Voice Input</title><style>${MIC_VIEW_STYLES}</style></head><body><div id="root"></div><script nonce="${nonce}" src="${scriptUri}"></script></body></html>`;
}

function createNonce(): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let index = 0; index < 32; index += 1) nonce += characters.charAt(Math.floor(Math.random() * characters.length));
  return nonce;
}
