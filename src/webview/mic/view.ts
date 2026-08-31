import type { ViewState } from '../protocol';
import type { SpeechVoiceLike } from '../speech';
import {
  createMicViewModel,
  microphoneActionLabel,
  type MicSelectOption,
} from './renderHelpers';
import { patchHistory } from './historyView';

let state: ViewState;
let availableVoices: readonly SpeechVoiceLike[] = [];

/** Creates the microphone shell once, then reconciles every host-owned field in place. */
export function renderMicView(
  root: HTMLElement,
  nextState: ViewState,
  voices: readonly SpeechVoiceLike[],
): void {
  state = nextState;
  availableVoices = voices;
  if (!root.dataset.micShell) {
    root.innerHTML = renderMicShell();
    root.dataset.micShell = "true";
  }
  patchMicView(root);
}

function renderMicShell(): string {
  return `
    <main id="conversation-main">
    <header class="conversation-header">
      <h1 id="conversation-title"></h1>
      <p id="conversation-subtitle"></p>
    </header>
    <div class="card mic-card">
      <button id="mic" class="mic-btn" type="button" aria-pressed="false">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor" aria-hidden="true">
          <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zm-7 9a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2a5 5 0 0 1-10 0H5z"/>
        </svg>
        <span id="mic-action-label" class="mic-action-label"></span>
      </button>
      <div id="mic-live" class="status" role="status" aria-live="polite" aria-atomic="true">
        <span class="status-dot" aria-hidden="true"></span>
        <span id="status-text"></span>
        <span id="history-announcement" class="sr-only"></span>
      </div>
      <div class="hint"><span id="mic-hint-hold"></span> · <span id="mic-hint-press"></span>
        <code id="mic-hint-key" class="hint-key" dir="ltr"></code> <span id="mic-hint-toggle"></span>
      </div>
    </div>

    <section class="section" aria-labelledby="history-heading">
      <div class="section-head">
        <h2 id="history-heading" tabindex="-1"><span id="history-heading-label"></span> <span id="history-count" class="count"></span></h2>
        <button class="link-btn danger" id="clear-all" type="button"></button>
      </div>
      <div id="history-empty" class="empty" hidden></div>
      <div id="history" class="history-list"></div>
    </section>

    <section class="section assistant-section" aria-labelledby="assistant-heading">
      <div class="section-head">
        <h2 id="assistant-heading"></h2>
        <button id="assistant-enabled" class="toggle-btn" type="button" aria-pressed="false"></button>
      </div>
      <p id="assistant-status" class="assistant-status"></p>
      <p id="assistant-feedback" class="assistant-feedback" dir="auto" hidden></p>
      <label class="assistant-field" for="assistant-wake-phrase">
        <span id="assistant-wake-label"></span>
        <input id="assistant-wake-phrase" type="text" autocomplete="off" spellcheck="false" dir="auto" />
      </label>
      <label class="assistant-field" for="assistant-persona">
        <span id="assistant-persona-label"></span>
        <select id="assistant-persona"></select>
      </label>
      <div class="assistant-subsection" aria-labelledby="provider-heading">
        <div class="assistant-row">
          <span id="provider-heading" class="field-label"></span>
          <button id="assistant-provider-manage" class="btn-ghost" type="button"></button>
        </div>
        <p id="assistant-provider-status" class="subtle-status"></p>
        <p id="assistant-provider-disclosure" class="subtle-status" role="note"></p>
      </div>
      <div class="assistant-subsection" aria-labelledby="speech-heading">
        <div class="assistant-row">
          <span id="speech-heading" class="field-label"></span>
          <button id="assistant-stop-speaking" class="btn-ghost" type="button"></button>
        </div>
        <label class="check-row" for="assistant-speech-enabled">
          <input id="assistant-speech-enabled" type="checkbox" />
          <span id="assistant-speech-enabled-label"></span>
        </label>
        <label class="assistant-field" for="assistant-speech-voice">
          <span id="assistant-speech-voice-label"></span>
          <select id="assistant-speech-voice"></select>
        </label>
        <label class="assistant-field" for="assistant-speech-rate">
          <span><span id="assistant-speech-rate-label"></span>:
            <output id="assistant-speech-rate-value"></output>
          </span>
          <input id="assistant-speech-rate" type="range" min="0.5" max="2" step="0.1" />
        </label>
        <p id="assistant-speech-status" class="subtle-status"></p>
      </div>
      <div class="assistant-target">
        <span id="assistant-target-heading" class="field-label"></span>
        <span id="assistant-target-label" dir="auto"></span>
        <div id="assistant-confidence" class="assistant-confidence" hidden>
          <span id="assistant-confidence-label" class="confidence-label"></span>
          <progress id="assistant-confidence-progress" max="100"></progress>
        </div>
      </div>
      <div class="assistant-subsection custom-mappings" aria-labelledby="custom-mappings-heading">
        <div class="assistant-row">
          <span id="custom-mappings-heading" class="field-label"></span>
          <button id="assistant-mappings-manage" class="btn-ghost" type="button"></button>
        </div>
        <p id="assistant-mappings-count" class="subtle-status"></p>
        <p id="assistant-mappings-status" class="subtle-status"></p>
      </div>
      <div id="assistant-pending-action" class="pending-send pending-action" role="group"
           aria-labelledby="pending-action-heading" hidden>
        <strong id="pending-action-heading"></strong>
        <p id="pending-action-explain"></p>
        <dl class="pending-action-details">
          <div><dt id="pending-action-label-heading"></dt><dd id="pending-action-label" dir="auto"></dd></div>
          <div><dt id="pending-action-target-heading"></dt><dd id="pending-action-target" dir="ltr"></dd></div>
        </dl>
        <div class="actions-row">
          <button id="assistant-pending-action-confirm" class="btn" type="button"></button>
          <button id="assistant-pending-action-cancel" class="btn-ghost" type="button"></button>
        </div>
      </div>
      <div id="assistant-pending-send" class="pending-send" role="group"
           aria-labelledby="pending-send-heading" hidden>
        <strong id="pending-send-heading"></strong>
        <p id="pending-send-explain"></p>
        <blockquote id="pending-send-preview" dir="auto"></blockquote>
        <dl class="pending-action-details" id="pending-send-target-details">
          <div><dt id="pending-send-target-heading"></dt><dd id="pending-send-target" dir="auto"></dd></div>
        </dl>
        <div class="actions-row">
          <button id="assistant-pending-confirm" class="btn" type="button"></button>
          <button id="assistant-pending-cancel" class="btn-ghost" type="button"></button>
        </div>
      </div>
      <div id="assistant-disclosure" class="assistant-disclosure" role="note">
        <p id="assistant-disclosure-text"></p>
        <button id="assistant-disclosure-acknowledge" class="link-btn" type="button"></button>
      </div>
    </section>

    <section class="section settings-summary" aria-labelledby="settings-summary-heading">
      <div class="section-head"><h2 id="settings-summary-heading"></h2></div>
      <p id="settings-summary-status" class="subtle-status"></p>
      <button id="open-settings-center" class="btn-ghost" type="button"></button>
    </section>
    </main>
  `;
}

function patchMicView(root: HTMLElement): void {
  const model = createMicViewModel(state, availableVoices);
  const strings = model.strings;
  document.documentElement.dir = model.direction;
  document.documentElement.lang = state.uiLang;
  document.title = strings.appTitle;
  setText(root, 'conversation-title', strings.appTitle);
  setText(root, 'conversation-subtitle', strings.holdHint);

  const micLabel = microphoneActionLabel(state.recording, strings);
  const mic = byId<HTMLButtonElement>(root, 'mic');
  if (mic) {
    mic.classList.toggle('recording', state.recording);
    mic.setAttribute('aria-pressed', String(state.recording));
    mic.setAttribute('aria-label', micLabel);
    mic.title = micLabel;
  }
  setText(root, 'mic-action-label', micLabel);
  bySelector(root, '.status-dot')?.classList.toggle('on', state.recording);
  const liveStatus = state.recording
    ? strings.recording
    : state.assistantPendingAction
      ? strings.pendingAction
      : state.assistantPendingSend ? strings.pendingSend : strings.idle;
  setText(root, 'status-text', liveStatus);
  setText(root, 'mic-hint-hold', strings.holdHint);
  setText(root, 'mic-hint-press', strings.pressKeyHint);
  setText(root, 'mic-hint-key', state.keybinding);
  setText(root, 'mic-hint-toggle', strings.toToggle);

  patchHistory(root, state.history, state.uiLang, strings);
  patchAssistant(root, model);

  setText(root, 'settings-summary-heading', strings.settings);
  setText(root, 'settings-summary-status', model.settingsStatus);
  setText(root, 'open-settings-center', strings.settings);
}

function patchAssistant(root: HTMLElement, model: ReturnType<typeof createMicViewModel>): void {
  const { strings } = model;
  setText(root, 'assistant-heading', strings.assistant);
  const enabled = byId<HTMLButtonElement>(root, 'assistant-enabled');
  if (enabled) {
    enabled.classList.toggle('on', Boolean(state.assistantEnabled));
    enabled.setAttribute('aria-pressed', String(Boolean(state.assistantEnabled)));
    enabled.textContent = strings.assistantEnabled;
  }
  setText(root, 'assistant-status', model.assistantStatus);
  setText(root, 'assistant-feedback', model.feedback);
  setHidden(root, 'assistant-feedback', !model.feedback);

  setText(root, 'assistant-wake-label', strings.assistantWakePhrase);
  const wakePhrase = byId<HTMLInputElement>(root, 'assistant-wake-phrase');
  if (wakePhrase) {
    if (document.activeElement !== wakePhrase) wakePhrase.value = state.assistantWakePhrase ?? '';
    wakePhrase.placeholder = strings.assistantWakePhraseHint;
    wakePhrase.disabled = !state.assistantEnabled;
  }
  setText(root, 'assistant-persona-label', strings.assistantPersona);
  syncOptions(byId<HTMLSelectElement>(root, 'assistant-persona'), model.personas);

  setText(root, 'provider-heading', `${strings.providerHeading}: ${model.providerName}`);
  setText(root, 'assistant-provider-manage', strings.providerManage);
  setText(root, 'assistant-provider-status', model.providerStatus);
  byId(root, 'assistant-provider-status')?.classList.toggle('error', state.assistantProviderStatus === 'error');
  setText(root, 'assistant-provider-disclosure', strings.providerDisclosure);

  setText(root, 'speech-heading', strings.speechResponse);
  setText(root, 'assistant-stop-speaking', strings.speechStop);
  const stop = byId<HTMLButtonElement>(root, 'assistant-stop-speaking');
  if (stop) stop.disabled = !state.assistantSpeaking;
  const speechEnabled = byId<HTMLInputElement>(root, 'assistant-speech-enabled');
  if (speechEnabled) speechEnabled.checked = Boolean(state.assistantSpeechEnabled);
  setText(root, 'assistant-speech-enabled-label', strings.speechEnabled);
  setText(root, 'assistant-speech-voice-label', strings.speechVoice);
  const voice = byId<HTMLSelectElement>(root, 'assistant-speech-voice');
  syncOptions(voice, model.voices);
  if (voice) voice.disabled = !state.assistantSpeechEnabled || availableVoices.length === 0;
  setText(root, 'assistant-speech-rate-label', strings.speechRate);
  setText(root, 'assistant-speech-rate-value', `${model.speechRate.toFixed(1)}×`);
  const rate = byId<HTMLInputElement>(root, 'assistant-speech-rate');
  if (rate) {
    if (document.activeElement !== rate) rate.value = String(model.speechRate);
    rate.disabled = !state.assistantSpeechEnabled;
  }
  setText(root, 'assistant-speech-status', model.speechStatus);

  setText(root, 'assistant-target-heading', strings.assistantTarget);
  setText(root, 'assistant-target-label', model.targetLabel);
  const hasConfidence = model.confidence !== undefined;
  setHidden(root, 'assistant-confidence', !hasConfidence);
  setText(root, 'assistant-confidence-label', hasConfidence
    ? `${strings.assistantPlanConfidence}: ${model.confidence}%`
    : '');
  const confidence = byId<HTMLProgressElement>(root, 'assistant-confidence-progress');
  if (confidence && model.confidence !== undefined) {
    confidence.value = model.confidence;
    confidence.setAttribute('aria-label', strings.assistantPlanConfidence);
  }

  patchMappings(root, model);
  patchPendingControls(root, model);
  setText(root, 'assistant-disclosure-text', strings.assistantDisclosure);
  setText(root, 'assistant-disclosure-acknowledge', strings.assistantDisclosureAcknowledge);
  setHidden(root, 'assistant-disclosure', Boolean(state.assistantDisclosureAcknowledged));
}

function patchMappings(root: HTMLElement, model: ReturnType<typeof createMicViewModel>): void {
  const { strings } = model;
  setText(root, 'custom-mappings-heading', strings.customMappings);
  setText(root, 'assistant-mappings-manage', strings.customMappingsManage);
  setText(root, 'assistant-mappings-count', model.mappingCount);
  setText(root, 'assistant-mappings-status', model.mappingStatus);
  byId(root, 'assistant-mappings-status')?.classList.toggle(
    'error',
    state.assistantMappingSummary?.status === 'error',
  );
}

function patchPendingControls(root: HTMLElement, model: ReturnType<typeof createMicViewModel>): void {
  const { strings, pendingAction, pendingSend } = model;
  setHidden(root, 'assistant-pending-action', !pendingAction);
  setText(root, 'pending-action-heading', strings.pendingAction);
  setText(root, 'pending-action-explain', strings.pendingActionExplain);
  setText(root, 'pending-action-label-heading', strings.customMappings);
  setText(root, 'pending-action-label', pendingAction?.label ?? '');
  setText(root, 'pending-action-target-heading', strings.pendingActionTarget);
  setText(root, 'pending-action-target', pendingAction?.targetId ?? '');
  setText(root, 'assistant-pending-action-confirm', strings.pendingActionConfirm);
  setText(root, 'assistant-pending-action-cancel', strings.pendingActionCancel);

  setHidden(root, 'assistant-pending-send', !pendingSend);
  setText(root, 'pending-send-heading', strings.pendingSend);
  setText(root, 'pending-send-explain', strings.pendingSendExplain);
  setText(root, 'pending-send-preview', pendingSend?.preview ?? '');
  setText(root, 'pending-send-target-heading', strings.assistantTarget);
  setText(root, 'pending-send-target', pendingSend?.targetLabel ?? strings.assistantTargetUnknown);
  setHidden(root, 'pending-send-target-details', !pendingSend);
  setText(root, 'assistant-pending-confirm', strings.pendingSendConfirm);
  setText(root, 'assistant-pending-cancel', strings.pendingSendCancel);
}

function syncOptions<T extends string>(
  select: HTMLSelectElement | null,
  options: readonly MicSelectOption<T>[],
): void {
  if (!select) return;
  const focused = document.activeElement === select;
  const currentValue = select.value;
  const signature = JSON.stringify(options.map(({ value, label }) => [value, label]));
  if (select.dataset.optionsSignature !== signature) {
    select.replaceChildren(...options.map(({ value, label }) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      return option;
    }));
    select.dataset.optionsSignature = signature;
  }
  select.value = reconciledSelectValue(options, currentValue, focused);
}

export function reconciledSelectValue<T extends string>(
  options: readonly MicSelectOption<T>[],
  currentValue: string,
  focused: boolean,
): string {
  if (focused && options.some(({ value }) => value === currentValue)) return currentValue;
  return options.find(({ selected }) => selected)?.value ?? '';
}

function byId<T extends HTMLElement = HTMLElement>(root: HTMLElement, id: string): T | null {
  return root.querySelector<T>(`#${id}`);
}

function bySelector(root: HTMLElement, selector: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(selector);
}

function setText(root: HTMLElement, id: string, value: string): void {
  const element = byId(root, id);
  if (element) element.textContent = value;
}

function setHidden(root: HTMLElement, id: string, hidden: boolean): void {
  const element = byId(root, id);
  if (element) element.hidden = hidden;
}
