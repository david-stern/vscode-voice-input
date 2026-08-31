export interface SettingsRegistrationDisposable {
  dispose(): unknown;
}

export interface SettingsRegistrationHost {
  registerView(
    viewType: string,
    provider: unknown,
    retainContextWhenHidden: boolean,
  ): SettingsRegistrationDisposable;
  registerCommand(commandId: string, callback: () => unknown): SettingsRegistrationDisposable;
  revealViewContainer(containerId: string): PromiseLike<unknown>;
}

export interface SettingsRevealPort {
  reveal(section?: 'general', revealContainer?: () => PromiseLike<unknown>): Promise<void>;
}

/** Registers the stable Settings view/command pair through a behavior-testable host port. */
export function registerSettingsSurface(
  host: SettingsRegistrationHost,
  provider: SettingsRevealPort,
): SettingsRegistrationDisposable[] {
  return [
    host.registerView('voiceInput.settingsView', provider, true),
    host.registerCommand('voiceInput.openSettings', () => provider.reveal(
      'general',
      () => host.revealViewContainer('voiceInput'),
    )),
  ];
}
