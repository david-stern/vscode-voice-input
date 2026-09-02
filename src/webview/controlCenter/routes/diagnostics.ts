import { element, labelledButton, sectionCard } from '../dom';
import type { ControlCenterHostMessage } from '../contracts';
import type { ControlCenterStrings } from '../i18n';

export function renderDiagnosticsRoute(
  container: HTMLElement,
  strings: ControlCenterStrings,
  state?: Extract<ControlCenterHostMessage, { type: 'diagnosticsState' }>,
): void {
  const diagnostics = sectionCard(strings.routes.diagnostics.title, strings.routes.diagnostics.purpose);
  const run = labelledButton(strings.runDiagnostics, 'run-diagnostics');
  run.id = 'diagnostics-run';
  run.disabled = state?.status === 'running';
  run.setAttribute('aria-describedby', 'diagnostics-native-reason');
  const actions = element('div', { className: 'button-row' });
  actions.append(run);
  if (state?.canOpen) actions.append(labelledButton(
    strings.openDiagnostics,
    'open-diagnostics',
    'button secondary',
  ));
  if (state?.canCopy) actions.append(labelledButton(
    strings.copyDiagnostics,
    'copy-diagnostics',
    'button secondary',
  ));
  diagnostics.append(actions, element('p', {
    id: 'diagnostics-native-reason',
    className: 'muted',
    text: strings.diagnosticsNative,
  }));
  const result = sectionCard(strings.diagnosticsResults);
  result.setAttribute('aria-busy', String(state?.status === 'running'));
  const summary = element('p', {
    id: 'diagnostics-summary',
    className: state?.status === 'error' ? 'callout error' : 'callout neutral',
    text: state?.summary || strings.diagnosticsIdle,
  });
  summary.setAttribute(state?.status === 'error' ? 'role' : 'aria-live', state?.status === 'error' ? 'alert' : 'polite');
  result.append(summary);
  if (state?.checks.length) {
    const list = element('ul', { className: 'diagnostic-checks' });
    for (const check of state.checks) {
      const item = element('li', { className: `diagnostic-check ${check.status}` });
      item.append(
        element('strong', { text: strings.diagnosticKinds[check.kind] }),
        element('span', { className: 'badge', text: strings.diagnosticStatuses[check.status] }),
        element('p', { className: 'muted', text: check.message }),
      );
      list.append(item);
    }
    result.append(list);
  }
  container.replaceChildren(diagnostics, result);
}
