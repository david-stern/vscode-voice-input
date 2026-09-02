import type {
  ControlCenterHostMessage,
  ControlCenterMicrophoneProofState,
  ControlCenterSetupState,
} from '../contracts';
import { element, labelledButton, mixedText, sectionCard } from '../dom';
import type { ControlCenterStrings } from '../i18n';
import type { SystemSpeechPresentation } from '../systemSpeech';

type Snapshot = Extract<ControlCenterHostMessage, { type: 'stateSnapshot' }>;
type SetupState = Extract<ControlCenterHostMessage, { type: 'setupState' }>;

export function renderSetupWorkflow(
  snapshot: Snapshot,
  setup: SetupState | undefined,
  speech: SystemSpeechPresentation,
  strings: ControlCenterStrings,
): HTMLElement {
  const section = sectionCard(strings.setup);
  if (!setup) {
    const loading = element('p', { className: 'setup-progress', text: strings.loading });
    loading.setAttribute('role', 'status');
    loading.setAttribute('aria-live', 'polite');
    section.append(loading);
    return section;
  }

  const { activeStep, allComplete } = resolveSetupReloadState(snapshot.state.setupStep, setup);
  const progress = element('p', {
    className: 'setup-progress',
    text: allComplete
      ? `${strings.setupAllComplete} 4 / 4`
      : `${strings.setupStep} ${activeStep} / 4`,
  });
  progress.setAttribute('role', 'status');
  progress.setAttribute('aria-live', 'polite');
  section.append(progress);
  const list = element('ol', { className: 'setup-steps' });
  const panels = element('div', { className: 'setup-panels' });
  strings.setupSteps.forEach((label, index) => {
    const step = index + 1;
    const stepState = setup.stepStates[index];
    const statusLabel = strings.setupStepStatuses[stepState];
    const item = element('li');
    const button = labelledButton(
      `${strings.setupStep} ${step} / 4 — ${label}`,
      'setup-step',
      'button secondary setup-step',
    );
    button.dataset.setupStep = String(step);
    button.dataset.stepState = stepState;
    button.setAttribute('aria-controls', `setup-panel-${step}`);
    button.setAttribute('aria-expanded', String(activeStep === step));
    const isCurrent = activeStep === step;
    if (isCurrent) button.setAttribute('aria-current', 'step');
    const marker = element('span', {
      className: `badge ${stepState === 'complete' ? 'ready' : stepState}`,
      text: statusLabel,
    });
    button.append(document.createTextNode(' — '), marker);
    if (isCurrent) button.append(
      document.createTextNode(' — '),
      element('span', { className: 'badge', text: strings.setupCurrent }),
    );
    item.append(button);
    list.append(item);

    const panel = element('section', { className: 'setup-panel', id: `setup-panel-${step}` });
    panel.dataset.stepState = stepState;
    panel.hidden = activeStep !== step;
    const heading = element('h3', { id: `setup-panel-title-${step}`, text: label });
    const panelStatus = element('p', {
      id: `setup-panel-status-${step}`,
      className: `badge ${stepState === 'complete' ? 'ready' : stepState}`,
      text: statusLabel,
    });
    heading.tabIndex = -1;
    panel.setAttribute('aria-labelledby', heading.id);
    panel.setAttribute('aria-describedby', panelStatus.id);
    panel.append(heading, panelStatus);
    renderStep(panel, step, snapshot, setup, speech, strings);
    panels.append(panel);
  });
  section.append(list, panels);
  return section;
}

export function resolveSetupReloadState(
  explicitStep: number | undefined,
  setup: Pick<ControlCenterSetupState, 'stepStates' | 'recommendedStep'>,
): { activeStep: number; allComplete: boolean } {
  return {
    activeStep: explicitStep ?? setup.recommendedStep,
    allComplete: setup.stepStates.every((state) => state === 'complete'),
  };
}

export function renderMicrophoneCard(
  setup: SetupState | undefined,
  strings: ControlCenterStrings,
): HTMLElement {
  const card = sectionCard(strings.microphoneProof);
  appendMicrophoneControls(card, setup, strings);
  return card;
}

export function renderSystemTtsCard(
  snapshot: Snapshot,
  setup: SetupState | undefined,
  speech: SystemSpeechPresentation,
  strings: ControlCenterStrings,
): HTMLElement {
  const card = sectionCard(strings.systemVoice, strings.systemVoice);
  appendSystemTtsControls(card, snapshot, setup, speech, strings);
  return card;
}

function renderStep(
  panel: HTMLElement,
  step: number,
  snapshot: Snapshot,
  setup: SetupState | undefined,
  speech: SystemSpeechPresentation,
  strings: ControlCenterStrings,
): void {
  if (step === 1) appendMicrophoneControls(panel, setup, strings);
  else if (step === 2) appendSpeechToTextControls(panel, snapshot, strings);
  else if (step === 3) appendSystemTtsControls(panel, snapshot, setup, speech, strings);
  else appendAuthorityControls(panel, snapshot, strings);
}

function appendMicrophoneControls(
  container: HTMLElement,
  setup: SetupState | undefined,
  strings: ControlCenterStrings,
): void {
  const state = setup?.microphoneState ?? 'untested';
  const status = element('p', {
    id: 'microphone-proof-status',
    className: `callout ${state === 'signal-detected' ? 'ready' : 'neutral'}`,
    text: strings.microphoneStates[state],
  });
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const device = element('p', { className: 'muted' });
  device.append(
    document.createTextNode(`${strings.selectedMicrophone}: `),
    mixedText(setup?.microphoneLabel || strings.notConfigured),
  );
  const help = element('p', { className: 'muted', text: strings.microphoneProofHelp });
  const actions = element('div', { className: 'button-row' });
  const select = labelledButton(strings.selectMicrophone, 'select-microphone', 'button secondary');
  select.id = 'select-microphone';
  const test = labelledButton(
    state === 'testing' ? strings.stopSignalTest : strings.testSignal,
    state === 'testing' ? 'stop-microphone-test' : 'test-microphone-signal',
  );
  test.id = 'test-microphone-signal';
  actions.append(select, test);
  container.append(status, device, help, actions);
}

function appendSpeechToTextControls(
  container: HTMLElement,
  snapshot: Snapshot,
  strings: ControlCenterStrings,
): void {
  const selected = snapshot.capabilities.sttProvider === 'soniox';
  const ready = selected && snapshot.capabilities.sttState === 'ready';
  container.append(
    element('p', { className: 'muted', text: strings.sonioxSetupHelp }),
    element('p', {
      className: `callout ${ready ? 'ready' : 'neutral'}`,
      text: ready ? strings.sonioxConfigured : strings.notConfigured,
    }),
  );
  const actions = element('div', { className: 'button-row' });
  if (!selected) {
    actions.append(
      labelledButton(strings.configureSoniox, 'configure-soniox'),
      labelledButton(strings.leaveSpeechOff, 'leave-stt-off', 'button secondary'),
    );
  } else {
    actions.append(labelledButton(
      ready ? strings.sonioxCredentialReplace : strings.sonioxCredentialConfigure,
      'configure-soniox-secret', 'button secondary',
    ));
    if (!snapshot.capabilities.remoteProcessing) {
      actions.append(labelledButton(
        strings.sonioxConsentReview,
        'request-soniox-consent',
        'button secondary',
      ));
    }
    actions.append(labelledButton(strings.sonioxTest, 'test-soniox', 'button secondary'));
    actions.append(labelledButton(strings.leaveSpeechOff, 'leave-stt-off', 'button secondary'));
  }
  container.append(actions);
}

function appendSystemTtsControls(
  container: HTMLElement,
  snapshot: Snapshot,
  setup: SetupState | undefined,
  speech: SystemSpeechPresentation,
  strings: ControlCenterStrings,
): void {
  const enabled = setup?.systemTtsEnabled
    ?? snapshot.capabilities.systemTtsState !== 'off';
  const selectedVoice = setup?.systemTtsVoiceIndex ?? -1;
  const rate = setup?.systemTtsRate ?? 1;

  const modeLabel = element('label', { className: 'field' });
  modeLabel.htmlFor = 'system-tts-mode';
  modeLabel.append(element('span', { text: strings.speechOutputMode }));
  const mode = element('select', { id: 'system-tts-mode' });
  mode.dataset.action = 'system-tts-mode';
  mode.append(
    option('off', strings.speechOff, !enabled),
    option('system', strings.speechSystem, enabled),
  );
  modeLabel.append(mode);

  const voiceLabel = element('label', { className: 'field' });
  voiceLabel.htmlFor = 'system-tts-voice';
  voiceLabel.append(element('span', { text: strings.systemVoiceSelect }));
  const voice = element('select', { id: 'system-tts-voice' });
  voice.dataset.action = 'system-tts-voice';
  voice.append(option('-1', strings.systemVoiceDefault, selectedVoice === -1));
  speech.voices.forEach((item, index) => {
    const suffix = item.language ? ` — ${item.language}` : '';
    voice.append(option(String(index), `${item.name}${suffix}`, selectedVoice === index));
  });
  voice.disabled = !enabled || speech.voices.length === 0;
  voiceLabel.append(voice);

  const rateLabel = element('label', { className: 'field' });
  rateLabel.htmlFor = 'system-tts-rate';
  rateLabel.append(element('span', { text: strings.systemVoiceRate }));
  const rateInput = element('input', { id: 'system-tts-rate' });
  rateInput.type = 'range';
  rateInput.min = '0.5';
  rateInput.max = '2';
  rateInput.step = '0.1';
  rateInput.value = String(rate);
  rateInput.dataset.action = 'system-tts-rate';
  rateInput.disabled = !enabled;
  const rateOutput = element('output', { id: 'system-tts-rate-value', text: `${rate.toFixed(1)}×` });
  rateOutput.htmlFor = rateInput.id;
  rateLabel.append(rateInput, rateOutput);

  const availability = element('p', {
    className: 'muted',
    text: speech.voices.length > 0 ? strings.systemVoice : strings.noSystemVoices,
  });
  const actions = element('div', { className: 'button-row' });
  const preview = labelledButton(strings.previewVoice, 'preview-system-voice');
  preview.id = 'system-tts-preview';
  preview.disabled = !enabled || speech.voices.length === 0;
  const stop = labelledButton(strings.stopPreview, 'stop-system-voice', 'button secondary');
  stop.id = 'system-tts-stop';
  stop.disabled = speech.previewState !== 'speaking';
  actions.append(preview, stop);
  const previewStatus = element('p', {
    id: 'system-tts-preview-status',
    className: 'muted',
    text: strings.previewStates[speech.previewState],
  });
  previewStatus.setAttribute('role', 'status');
  previewStatus.setAttribute('aria-live', 'polite');
  container.append(modeLabel, voiceLabel, rateLabel, availability, actions, previewStatus);
}

function appendAuthorityControls(
  container: HTMLElement,
  snapshot: Snapshot,
  strings: ControlCenterStrings,
): void {
  container.append(
    element('p', { className: 'muted', text: strings.commandsReviewHelp }),
    element('p', {
      className: 'callout neutral',
      text: snapshot.state.effectiveAutoMode ? strings.autoActive : strings.autoWarning,
    }),
  );
  const actions = element('div', { className: 'button-row' });
  const commands = labelledButton(strings.reviewCommands, 'navigate');
  commands.dataset.route = 'commands';
  const privacy = labelledButton(strings.reviewAuthority, 'navigate', 'button secondary');
  privacy.dataset.route = 'privacy';
  actions.append(commands, privacy);
  if (snapshot.state.pendingReview) {
    actions.append(labelledButton(strings.review, 'preview-pending-action', 'button secondary'));
  }
  container.append(actions);
}

function option(value: string, label: string, selected: boolean): HTMLOptionElement {
  const item = element('option', { text: label });
  item.value = value;
  item.selected = selected;
  return item;
}

export function microphoneStateLabel(
  state: ControlCenterMicrophoneProofState,
  strings: ControlCenterStrings,
): string {
  return strings.microphoneStates[state];
}
