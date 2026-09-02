import type { ControlCenterHostMessage } from '../contracts';
import { labelledButton, sectionCard } from '../dom';
import type { ControlCenterStrings } from '../i18n';

export function renderPrivacyRoute(
  container: HTMLElement,
  snapshot: Extract<ControlCenterHostMessage, { type: 'stateSnapshot' }>,
  strings: ControlCenterStrings,
): void {
  const auto = sectionCard(snapshot.state.effectiveAutoMode ? strings.autoActive : strings.enableAuto, strings.autoWarning);
  auto.append(snapshot.state.effectiveAutoMode
    ? labelledButton(strings.disableAuto, 'disable-auto', 'button danger')
    : labelledButton(strings.enableAuto, 'explain-auto'));
  const provider = sectionCard(
    strings.remoteProcessing,
    snapshot.capabilities.remoteProcessing ? strings.sonioxConfigured : strings.notConfigured,
  );
  container.replaceChildren(auto, provider);
}
