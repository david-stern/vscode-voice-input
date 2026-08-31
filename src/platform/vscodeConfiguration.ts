import * as vscode from 'vscode';

import {
  CONFIGURATION_SECTION,
  SettingsRepository,
  type ConfigurationInspection,
  type ConfigurationPort,
} from '../config';

/** VS Code adapter for typed, serialized, global-only Voice Input settings. */
export class VsCodeConfigurationAdapter implements ConfigurationPort {
  get<T>(name: string, fallback: T): T {
    return this.configuration().get<T>(name, fallback);
  }

  inspect<T>(name: string): ConfigurationInspection<T> | undefined {
    return this.configuration().inspect<T>(name);
  }

  updateGlobal(name: string, value: unknown): Thenable<void> {
    return this.configuration().update(name, value, vscode.ConfigurationTarget.Global);
  }

  private configuration(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
  }
}

export function createSettingsRepository(): SettingsRepository {
  return new SettingsRepository(new VsCodeConfigurationAdapter());
}
