import type { ControlCenterHostMessage } from '../contracts';
import { element, sectionCard } from '../dom';
import type { ControlCenterStrings } from '../i18n';
import type { SystemSpeechPresentation } from '../systemSpeech';
import { renderMicrophoneCard, renderSystemTtsCard } from './setup';

export function renderVoiceRoute(
  container: HTMLElement,
  snapshot: Extract<ControlCenterHostMessage, { type: 'stateSnapshot' }>,
  strings: ControlCenterStrings,
  setupState: Extract<ControlCenterHostMessage, { type: 'setupState' }> | undefined,
  systemSpeech: SystemSpeechPresentation,
): void {
  const microphone = renderMicrophoneCard(setupState, strings);
  microphone.id = 'mic-control';

  const transcript = sectionCard(strings.final);
  const final = element('p', { id: 'final-transcript', className: 'transcript', text: '—' });
  final.setAttribute('aria-live', 'polite');
  transcript.append(final);
  if (snapshot.capabilities.streamingPartials) {
    const partialLabel = element('h3', { text: strings.partial });
    const partial = element('p', { id: 'partial-transcript', className: 'transcript partial', text: '—' });
    partial.setAttribute('aria-live', 'polite');
    transcript.prepend(partialLabel, partial);
  }

  const speech = renderSystemTtsCard(snapshot, setupState, systemSpeech, strings);
  container.replaceChildren(microphone, transcript, speech);
}
