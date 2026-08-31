import type { ViewState, WebviewMessage } from '../protocol';
import { normalizeSpeechRate } from '../speech';
import { setHistoryActionLabel } from './historyView';

export interface MicEventDependencies {
  getState: () => ViewState;
  post: (message: WebviewMessage) => void;
  toggle: () => void;
  render: () => void;
  cancelSpeech: () => void;
  copiedLabel: () => string;
  copySuccessMessage: () => string;
  announce: (message: string) => void;
}

/** Wires the short-lived controls created by one full microphone-view render. */
export function attachMicEventHandlers(dependencies: MicEventDependencies): void {
  const {
    getState,
    post,
    toggle,
    render,
    cancelSpeech,
    copiedLabel,
    copySuccessMessage,
    announce,
  } = dependencies;
  const mic = document.getElementById('mic');
  if (mic) {
    const press = new MicPressLifecycle();
    const beginPress = () => {
      if (press.begin()) post({ type: 'start' });
    };
    const endPress = () => {
      if (press.end()) post({ type: 'stop' });
    };
    mic.addEventListener('mousedown', beginPress);
    mic.addEventListener('mouseup', endPress);
    mic.addEventListener('mouseleave', endPress);
    mic.addEventListener('touchstart', (event) => {
      event.preventDefault();
      beginPress();
    });
    mic.addEventListener('touchend', (event) => {
      event.preventDefault();
      endPress();
    });
    mic.addEventListener('touchcancel', (event) => {
      event.preventDefault();
      endPress();
    });
    mic.addEventListener('click', (event) => {
      if (micClickAction(event.detail)) toggle();
    });
  }

  document.getElementById('clear-all')?.addEventListener('click', () => post({ type: 'history-clear-request' }));
  document.getElementById('open-keybindings')?.addEventListener('click', () => post({ type: 'open-keybindings' }));
  document.getElementById('refresh-meta')?.addEventListener('click', () => post({ type: 'refresh-meta' }));
  document.getElementById('open-settings-center')?.addEventListener('click', () => post({ type: 'open-settings-center' }));

  document.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    const button = target?.closest<HTMLButtonElement>('button[data-act]');
    if (!button) return;
    const id = button.dataset.id!;
    if (button.dataset.act === 'copy') {
      const entry = getState().history.find((historyEntry) => historyEntry.id === id);
      if (!entry) return;
      navigator.clipboard?.writeText(entry.text).catch(() => post({ type: 'history-copy', id }));
      post({ type: 'history-copy', id });
      showCopyFeedback(button, copiedLabel(), copySuccessMessage(), announce);
    } else if (button.dataset.act === 'remove') {
      post({ type: 'history-remove', id });
    }
  });

  document.getElementById('assistant-enabled')?.addEventListener('click', () => {
    const currentState = getState();
    currentState.assistantEnabled = !currentState.assistantEnabled;
    post({ type: 'assistant-enabled-change', enabled: Boolean(currentState.assistantEnabled) });
    render();
  });
  document.getElementById('assistant-wake-phrase')?.addEventListener('change', (event) => {
    const currentState = getState();
    currentState.assistantWakePhrase = (event.target as HTMLInputElement).value.trim();
    post({ type: 'assistant-wake-phrase-change', wakePhrase: currentState.assistantWakePhrase });
  });
  document.getElementById('assistant-disclosure-acknowledge')?.addEventListener('click', () => {
    getState().assistantDisclosureAcknowledged = true;
    post({ type: 'assistant-disclosure-acknowledged' });
    render();
  });
  document.getElementById('assistant-persona')?.addEventListener('change', (event) => {
    getState().assistantPersona = (event.target as HTMLSelectElement).value as ViewState['assistantPersona'];
    post({ type: 'assistant-persona-change', persona: getState().assistantPersona! });
  });
  document.getElementById('assistant-provider-manage')?.addEventListener('click', () => post({ type: 'assistant-provider-manage' }));
  document.getElementById('assistant-speech-enabled')?.addEventListener('change', (event) => {
    getState().assistantSpeechEnabled = (event.target as HTMLInputElement).checked;
    if (!getState().assistantSpeechEnabled) cancelSpeech();
    postSpeechSettings(getState(), post);
    render();
  });
  document.getElementById('assistant-speech-voice')?.addEventListener('change', (event) => {
    getState().assistantSpeechVoiceUri = (event.target as HTMLSelectElement).value;
    postSpeechSettings(getState(), post);
  });
  document.getElementById('assistant-speech-rate')?.addEventListener('input', (event) => {
    getState().assistantSpeechRate = normalizeSpeechRate((event.target as HTMLInputElement).value);
    const output = document.getElementById('assistant-speech-rate-value');
    if (output) output.textContent = String(getState().assistantSpeechRate!.toFixed(1)).concat('×');
  });
  document.getElementById('assistant-speech-rate')?.addEventListener('change', () => postSpeechSettings(getState(), post));
  document.getElementById('assistant-stop-speaking')?.addEventListener('click', () => {
    cancelSpeech();
    post({ type: 'assistant-stop-speaking' });
  });
  document.getElementById('assistant-mappings-manage')?.addEventListener('click', () => post({ type: 'assistant-mappings-manage' }));
  document.getElementById('assistant-pending-confirm')?.addEventListener('click', () => {
    const pending = getState().assistantPendingSend;
    if (pending) post({ type: 'assistant-pending-send-confirm', id: pending.id });
  });
  document.getElementById('assistant-pending-cancel')?.addEventListener('click', () => {
    const pending = getState().assistantPendingSend;
    if (pending) post({ type: 'assistant-pending-send-cancel', id: pending.id });
  });
  document.getElementById('assistant-pending-action-confirm')?.addEventListener('click', () => {
    const pending = getState().assistantPendingAction;
    if (pending) post({ type: 'assistant-pending-action-confirm', id: pending.id });
  });
  document.getElementById('assistant-pending-action-cancel')?.addEventListener('click', () => {
    const pending = getState().assistantPendingAction;
    if (pending) post({ type: 'assistant-pending-action-cancel', id: pending.id });
  });
}

/** Native buttons report keyboard/assistive clicks with detail 0; pointer paths are handled above. */
export function micClickAction(clickDetail: number): 'toggle' | undefined {
  return clickDetail === 0 ? 'toggle' : undefined;
}

/** Tracks only the physical hold gesture, independently of delayed host recording state. */
export class MicPressLifecycle {
  private active = false;

  begin(): boolean {
    if (this.active) return false;
    this.active = true;
    return true;
  }

  end(): boolean {
    if (!this.active) return false;
    this.active = false;
    return true;
  }
}

function postSpeechSettings(state: ViewState, post: MicEventDependencies['post']): void {
  state.assistantSpeechRate = normalizeSpeechRate(state.assistantSpeechRate);
  post({ type: 'assistant-speech-settings-change', enabled: !!state.assistantSpeechEnabled, voiceUri: state.assistantSpeechVoiceUri ?? '', rate: state.assistantSpeechRate });
}

function showCopyFeedback(
  button: HTMLButtonElement,
  copied: string,
  announcement: string,
  announce: (message: string) => void,
): void {
  const revision = String(Number(button.dataset.feedbackRevision ?? '0') + 1);
  button.dataset.feedbackRevision = revision;
  button.dataset.feedbackActive = 'true';
  setHistoryActionLabel(button, copied);
  button.classList.add('flash');
  announce(announcement);
  setTimeout(() => {
    if (button.dataset.feedbackRevision !== revision) return;
    delete button.dataset.feedbackActive;
    setHistoryActionLabel(button, button.dataset.defaultLabel ?? '');
    button.classList.remove('flash');
  }, 1200);
}
