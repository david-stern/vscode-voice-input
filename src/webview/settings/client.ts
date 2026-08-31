import type { UiLang } from '../protocol';
import { attachSettingsEvents } from './events';
import { isSettingsHostMessage, type SettingsWebviewMessage } from './protocol';
import {
  createInitialSettingsUiState,
  createInitialSettingsState,
  projectSettingsUiState,
  reduceNavigation,
  reduceSetupProgress,
  reduceSettingsState,
  routeForLegacySection,
  type NavigationState,
  type SetupProgressAction,
} from './state';
import { SettingsSpeechPreview } from './speechPreview';
import { SettingsView } from './view';

declare const acquireVsCodeApi: () => {
  postMessage(message: SettingsWebviewMessage): void;
  getState(): unknown;
  setState(state: unknown): unknown;
};

const root = document.getElementById('root');
if (!root) throw new Error('Settings root is missing');

const vscode = acquireVsCodeApi();
const view = new SettingsView(root);
let state = createInitialSettingsState();
let ui = createInitialSettingsUiState(vscode.getState());
let initialized = false;
let navigation: NavigationState | undefined;
let lastSetupSpeechId: string | undefined;
const speech = new SettingsSpeechPreview(render);

function render(authoritative = false): void {
  view.update(state, speech.voices, speech.active, ui, authoritative);
}

function navigate(route: Parameters<typeof view.navigate>[0]): void {
  ui = { ...ui, route };
  persistUi();
  render(false);
  view.navigate(route);
}

function updateSetup(action: SetupProgressAction): void {
  ui = {
    route: ui.route,
    setup: reduceSetupProgress(ui.setup, action),
  };
  persistUi();
  render(false);
}

function persistUi(): void {
  vscode.setState(projectSettingsUiState(ui));
}

attachSettingsEvents({
  root,
  state: () => state,
  post: (message) => vscode.postMessage(message),
  previewLanguage: (language: UiLang) => {
    state = { ...state, uiLang: language };
    render(false);
  },
  navigate,
  updateSetup,
  render,
  speech,
});

window.addEventListener('message', (event) => {
  if (!isSettingsHostMessage(event.data)) return;
  if (event.data.type === 'settings-state') {
    const wasComplete = state.setup.complete;
    const reduction = reduceSettingsState(state, event.data.payload, initialized);
    if (!reduction.applied) return;
    state = reduction.state;
    if (!state.setup.speechRequest && lastSetupSpeechId) {
      lastSetupSpeechId = undefined;
      speech.stop();
    }
    if (!state.setup.complete && ui.setup.currentStep !== state.setup.currentStep) {
      ui = { ...ui, setup: { currentStep: state.setup.currentStep } };
      persistUi();
    }
    initialized = true;
    render(true);
    deliverSetupSpeech();
    if (!wasComplete && state.setup.complete) navigate('home');
    return;
  }
  const next = reduceNavigation(navigation, {
    revision: event.data.revision,
    section: event.data.section,
  });
  if (!next || next === navigation) return;
  navigation = next;
  navigate(routeForLegacySection(next.section));
});

render();
speech.refreshVoices();
if (typeof window.speechSynthesis !== 'undefined') {
  window.speechSynthesis.addEventListener('voiceschanged', () => speech.refreshVoices());
}

function deliverSetupSpeech(): void {
  const request = state.setup.speechRequest;
  if (!request || request.id === lastSetupSpeechId) return;
  lastSetupSpeechId = request.id;
  const revision = state.setup.revision;
  speech.speak(request.text, request.voiceUri, request.rate, request.lang, (outcome) => {
    vscode.postMessage({
      type: 'settings-setup-speech-result',
      setupRevision: revision,
      requestId: request.id,
      outcome,
    });
  });
}
vscode.postMessage({ type: 'settings-ready' });
