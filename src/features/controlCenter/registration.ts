import type { ControlCenterDisposable } from './controller';
import type { ControlCenterController } from './controller';
import { CONTROL_CENTER_VIEW_TYPE } from '../../webview/controlCenter/contracts';

export const OPEN_CONTROL_CENTER_COMMAND = 'voiceInput.openControlCenter';

export interface ControlCenterRegistrationHost {
  registerCommand(
    commandId: string,
    callback: (route?: unknown, params?: unknown) => unknown,
  ): ControlCenterDisposable;
  registerSerializer(
    viewType: string,
    serializer: { deserializeWebviewPanel(panel: unknown, state: unknown): PromiseLike<void> | void },
  ): ControlCenterDisposable;
}

/** Registration contract consumed by coordinator-owned activation wiring. */
export function registerControlCenterSurface(
  host: ControlCenterRegistrationHost,
  controller: Pick<ControlCenterController, 'createOrShow' | 'adoptOrCreate'>,
): ControlCenterDisposable[] {
  return [
    host.registerCommand(OPEN_CONTROL_CENTER_COMMAND, (route, params) => (
      controller.createOrShow(route, params)
    )),
    host.registerSerializer(CONTROL_CENTER_VIEW_TYPE, {
      deserializeWebviewPanel: (panel) => controller.adoptOrCreate(panel),
    }),
  ];
}
