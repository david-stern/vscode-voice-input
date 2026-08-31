export interface ExtensionManifestWithKeybindings {
  contributes?: {
    keybindings?: Array<{ command: string; key?: string; mac?: string }>;
  };
}

/** Best-effort display of the package default; VS Code exposes no public override query. */
export function detectToggleRecordingKeybinding(
  manifest: ExtensionManifestWithKeybindings,
  platform: NodeJS.Platform = process.platform,
): string {
  const keybinding = manifest.contributes?.keybindings?.find(
    (candidate) => candidate.command === 'voiceInput.toggleRecording',
  );
  if (!keybinding) return 'Alt+M';
  const raw = (platform === 'darwin' ? keybinding.mac : keybinding.key)
    ?? keybinding.key
    ?? 'alt+m';
  return raw
    .split('+')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('+');
}
