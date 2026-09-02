export type LegacySettingsLauncherMessage =
  | { type: 'settings-open-control-center'; route: 'home' | 'voice' | 'commands' | 'assistant' | 'privacy' | 'diagnostics' };

export function parseLegacySettingsLauncherMessage(value: unknown): LegacySettingsLauncherMessage | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const message = value as Record<string, unknown>;
  if (Object.keys(message).length !== 2 || message.type !== 'settings-open-control-center') return undefined;
  return ['home', 'voice', 'commands', 'assistant', 'privacy', 'diagnostics'].includes(message.route as string)
    ? message as LegacySettingsLauncherMessage
    : undefined;
}

/** The compatibility view contains one launcher, not a second Settings application. */
export function renderSettingsLauncher(
  root: HTMLElement,
  post: (message: LegacySettingsLauncherMessage) => void,
): void {
  const main = document.createElement('main');
  main.id = 'settings-launcher-main';
  const heading = document.createElement('h1');
  heading.textContent = 'Voice Input';
  const explanation = document.createElement('p');
  explanation.textContent = 'Settings are now managed in the Voice Input Control Center.';
  const open = document.createElement('button');
  open.type = 'button';
  open.textContent = 'Open Control Center';
  open.addEventListener('click', () => post({ type: 'settings-open-control-center', route: 'home' }));
  main.append(heading, explanation, open);
  root.replaceChildren(main);
}
