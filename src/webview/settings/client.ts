import { renderSettingsLauncher, type LegacySettingsLauncherMessage } from './launcher';

declare const acquireVsCodeApi: () => {
  postMessage(message: LegacySettingsLauncherMessage | { type: 'settings-ready' }): void;
};

const root = document.getElementById('root');
if (!root) throw new Error('Settings launcher root is missing');
const vscode = acquireVsCodeApi();
renderSettingsLauncher(root, (message) => vscode.postMessage(message));
vscode.postMessage({ type: 'settings-ready' });
