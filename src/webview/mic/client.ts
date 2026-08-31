// Browser-side composition root: state projection, rendering, and messages.
import type { HostMessage, ViewState, WebviewMessage } from '../protocol';
import { resolveSpeakingState } from '../speech';
import { attachMicEventHandlers } from './events';
import { createInitialMicState } from './state';
import { MicSpeechClient } from './speechClient';
import { renderMicView } from './view';
import { stringsFor } from './renderHelpers';

declare const acquireVsCodeApi: () => {
  postMessage: (message: WebviewMessage) => void;
};

const vscode = acquireVsCodeApi();
let state: ViewState = createInitialMicState();
let shellEventsAttached = false;

const speech = new MicSpeechClient({
  state: () => state,
  post: (message) => vscode.postMessage(message),
  render,
});

function render(): void {
  const root = document.getElementById('root');
  if (!root) return;

  renderMicView(root, state, speech.availableVoices);
  if (shellEventsAttached) return;
  attachMicEventHandlers({
    getState: () => state,
    post: (message) => vscode.postMessage(message),
    toggle: () => vscode.postMessage({ type: 'toggle' }),
    render,
    cancelSpeech: () => speech.cancel(),
    copiedLabel: () => stringsFor(state).copied,
    copySuccessMessage: () => stringsFor(state).copySuccess,
    announce: announceHistoryStatus,
  });
  shellEventsAttached = true;
}

let announcementRevision = 0;

function announceHistoryStatus(message: string): void {
  const announcement = document.getElementById('history-announcement');
  if (!announcement) return;
  const revision = ++announcementRevision;
  announcement.textContent = '';
  queueMicrotask(() => {
    if (revision === announcementRevision) announcement.textContent = message;
  });
}

window.addEventListener('message', (event) => {
  const message = event.data as HostMessage;
  switch (message?.type) {
    case 'init':
    case 'state':
      applyHostState(message.payload);
      break;
    case 'recording-state':
      state.recording = Boolean(message.recording);
      render();
      break;
    case 'history':
      state.history = message.entries ?? [];
      render();
      break;
    case 'meta':
      state.models = message.models ?? [];
      state.languages = message.languages ?? [];
      state.metaLoading = Boolean(message.loading);
      state.metaError = message.error;
      render();
      break;
    case 'speak':
      speech.enqueue(message.id, message.text, message.lang);
      break;
    case 'cancel-speaking':
      speech.cancel();
      break;
  }
});

function applyHostState(nextState: ViewState): void {
  const wasEnabled = speech.isHostStateInitialized && Boolean(state.assistantSpeechEnabled);
  state = { ...state, ...nextState };
  state.assistantSpeaking = resolveSpeakingState(state.assistantSpeaking, speech.activeId);
  speech.markHostStateInitialized();
  speech.syncEnabled(wasEnabled);
  render();
}

installShortcutHandler();

function installShortcutHandler(): void {
  let altMHeld = false;
  document.addEventListener('keydown', (event) => {
    if (event.altKey && event.code === 'KeyM' && !event.repeat) {
      event.preventDefault();
      altMHeld = true;
    }
  });
  document.addEventListener('keyup', (event) => {
    if (event.key === 'Alt' && altMHeld) {
      altMHeld = false;
      return;
    }
    if (event.code !== 'KeyM' || !altMHeld) return;
    altMHeld = false;
    vscode.postMessage({ type: 'toggle' });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  render();
  if (typeof window.speechSynthesis !== 'undefined') {
    speech.refreshVoices();
    window.speechSynthesis.addEventListener('voiceschanged', () => speech.refreshVoices());
  }
  vscode.postMessage({ type: 'ready' });
});
