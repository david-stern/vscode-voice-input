// Webview UI: mic button, history list, collapsible settings.
// All state comes from the extension host via postMessage.
import { STRINGS, UiLang, Strings } from './i18n';
import type {
  DeepSeekStatus,
  HostMessage,
  PendingAssistantSend,
} from './micView';
import type { PersonaId } from '../assistant/personas';
import {
  DEFAULT_SPEECH_RATE,
  SpeechQueue,
  SpeechLifecycle,
  continuesSpeakingAfterFinish,
  normalizeSpeechRate,
  resolveSpeakingState,
  selectSpeechVoice,
} from './speech';

declare const acquireVsCodeApi: () => {
  postMessage: (msg: unknown) => void;
};

interface HistoryEntry {
  id: string;
  text: string;
  lang: string;
  ts: number;
}

interface ModelInfo { id: string; type?: string; description?: string }
interface LanguageInfo { code: string; name: string }

interface InitState {
  uiLang: UiLang;
  speechLang: string;
  ttlDays: 0 | 1 | 7 | 30;
  model: string;
  history: HistoryEntry[];
  recording: boolean;
  keybinding: string;
  models: ModelInfo[];
  languages: LanguageInfo[];
  metaLoading: boolean;
  metaError?: string;
  audioDevice: string;
  audioDevices: { id: string; label: string }[];
  assistantEnabled?: boolean;
  assistantListening?: boolean;
  assistantWakePhrase?: string;
  assistantDisclosureAcknowledged?: boolean;
  assistantPersona?: PersonaId;
  assistantDeepSeekStatus?: DeepSeekStatus;
  assistantDeepSeekError?: string;
  assistantSpeechEnabled?: boolean;
  assistantSpeechVoiceUri?: string;
  assistantSpeechRate?: number;
  assistantSpeaking?: boolean;
  assistantTargetLabel?: string;
  assistantPlanConfidence?: number;
  assistantPendingSend?: PendingAssistantSend;
  assistantFeedback?: string;
}

const vscode = acquireVsCodeApi();

let state: InitState = {
  uiLang: 'he',
  speechLang: 'he',
  ttlDays: 30,
  model: 'stt-async-v4',
  history: [],
  recording: false,
  keybinding: 'Alt+M',
  models: [],
  languages: [],
  metaLoading: false,
  audioDevice: '',
  audioDevices: [],
  assistantEnabled: false,
  assistantListening: false,
  assistantWakePhrase: '',
  assistantDisclosureAcknowledged: false,
  assistantPersona: 'teacher-lecturer',
  assistantDeepSeekStatus: 'not-configured',
  assistantSpeechEnabled: true,
  assistantSpeechVoiceUri: '',
  assistantSpeechRate: DEFAULT_SPEECH_RATE,
  assistantSpeaking: false,
};

let availableVoices: SpeechSynthesisVoice[] = [];
const speechQueue = new SpeechQueue();
const speechLifecycle = new SpeechLifecycle();
let hostStateInitialized = false;

function t(): Strings {
  return STRINGS[state.uiLang];
}

function dir(): 'rtl' | 'ltr' {
  return state.uiLang === 'he' ? 'rtl' : 'ltr';
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const locale = state.uiLang === 'he' ? 'he-IL' : 'en-US';
  const sameDay = new Date().toDateString() === d.toDateString();
  return new Intl.DateTimeFormat(locale, sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' },
  ).format(d);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function langFlag(lang: string): string {
  if (lang === 'he') return '🇮🇱';
  if (lang === 'en') return '🇺🇸';
  return '🌐';
}

function personaOptions(): { value: PersonaId; label: string }[] {
  return [
    { value: 'teacher-lecturer', label: t().personaTeacher },
    { value: 'secretary', label: t().personaSecretary },
    { value: 'friend', label: t().personaFriend },
    { value: 'tour-guide', label: t().personaTravelGuide },
    { value: 'mathematician', label: t().personaMathematician },
    { value: 'philosopher', label: t().personaPhilosopher },
  ];
}

function renderPersonaOptions(): string {
  return personaOptions().map(({ value, label }) =>
    `<option value="${value}" ${state.assistantPersona === value ? 'selected' : ''}>${escapeHtml(label)}</option>`,
  ).join('');
}

function deepSeekStatusText(): string {
  switch (state.assistantDeepSeekStatus) {
    case 'ready': return t().deepSeekReady;
    case 'checking': return t().deepSeekChecking;
    case 'error': return state.assistantDeepSeekError || t().deepSeekError;
    default: return t().deepSeekMissing;
  }
}

function renderVoiceOptions(): string {
  if (availableVoices.length === 0) {
    return `<option value="">${escapeHtml(t().speechNoVoices)}</option>`;
  }
  const selected = selectSpeechVoice(
    availableVoices,
    state.assistantSpeechVoiceUri,
    state.speechLang === 'auto' ? state.uiLang : state.speechLang,
  );
  return availableVoices.map((voice) => {
    const isSelected = voice.voiceURI === selected?.voiceURI;
    const suffix = voice.default ? ` — ${t().speechSystemDefault}` : '';
    return `<option value="${escapeHtml(voice.voiceURI)}" ${isSelected ? 'selected' : ''}>${escapeHtml(`${voice.name} (${voice.lang})${suffix}`)}</option>`;
  }).join('');
}

function confidencePercent(): number | undefined {
  const confidence = state.assistantPlanConfidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return undefined;
  return Math.round(Math.min(1, Math.max(0, confidence)) * 100);
}

function render() {
  document.documentElement.setAttribute('dir', dir());
  document.documentElement.setAttribute('lang', state.uiLang);

  const root = document.getElementById('root')!;
  root.innerHTML = `
    <div class="card mic-card">
      <button id="mic" class="mic-btn ${state.recording ? 'recording' : ''}"
              type="button" aria-label="${escapeHtml(t().holdHint)}"
              aria-pressed="${state.recording}" title="${escapeHtml(t().holdHint)}">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor" aria-hidden="true">
          <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zm-7 9a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2a5 5 0 0 1-10 0H5z"/>
        </svg>
      </button>
      <div class="status" role="status" aria-live="polite">
        <span class="status-dot ${state.recording ? 'on' : ''}" aria-hidden="true"></span>
        <span id="status-text">${state.recording ? escapeHtml(t().recording) : escapeHtml(t().idle)}</span>
      </div>
      <div class="hint">${escapeHtml(t().holdHint)} · ${escapeHtml(t().pressKeyHint)} <code class="hint-key">${escapeHtml(state.keybinding)}</code> ${escapeHtml(t().toToggle)}</div>
    </div>

    <div class="section">
      <div class="section-head">
        <h3>${escapeHtml(t().history)} <span class="count">${state.history.length}</span></h3>
        <button class="link-btn danger" id="clear-all" type="button" aria-label="${escapeHtml(t().clearAll)}"
          ${state.history.length === 0 ? 'disabled' : ''}>${escapeHtml(t().clearAll)}</button>
      </div>
      <div id="history" class="history-list">
        ${
          state.history.length === 0
            ? `<div class="empty">${escapeHtml(t().noHistory)}</div>`
            : state.history.map(renderEntry).join('')
        }
      </div>
    </div>

    <section class="section assistant-section" aria-labelledby="assistant-heading">
      <div class="section-head">
        <h3 id="assistant-heading">${escapeHtml(t().assistant)}</h3>
        <button id="assistant-enabled" class="toggle-btn ${state.assistantEnabled ? 'on' : ''}" type="button"
          aria-pressed="${!!state.assistantEnabled}">
          ${escapeHtml(t().assistantEnabled)}
        </button>
      </div>
      <p class="assistant-status" role="status" aria-live="polite">
        ${escapeHtml(state.assistantListening
          ? t().assistantListening
          : state.assistantEnabled ? t().assistantReady : t().assistantDisabled)}
      </p>
      ${state.assistantFeedback ? `<p class="assistant-feedback" role="status" aria-live="polite" dir="auto">${escapeHtml(state.assistantFeedback)}</p>` : ''}
      <label class="assistant-field" for="assistant-wake-phrase">
        <span>${escapeHtml(t().assistantWakePhrase)}</span>
        <input id="assistant-wake-phrase" type="text" value="${escapeHtml(state.assistantWakePhrase ?? '')}"
          placeholder="${escapeHtml(t().assistantWakePhraseHint)}" autocomplete="off" spellcheck="false"
          ${state.assistantEnabled ? '' : 'disabled'} />
      </label>
      <label class="assistant-field" for="assistant-persona">
        <span>${escapeHtml(t().assistantPersona)}</span>
        <select id="assistant-persona">${renderPersonaOptions()}</select>
      </label>
      <div class="assistant-subsection" aria-labelledby="deepseek-heading">
        <div class="assistant-row">
          <span id="deepseek-heading" class="field-label">${escapeHtml(t().deepSeek)}</span>
          <button id="assistant-deepseek-setup" class="btn-ghost" type="button">${escapeHtml(t().deepSeekSetup)}</button>
        </div>
        <p class="subtle-status ${state.assistantDeepSeekStatus === 'error' ? 'error' : ''}" role="status" aria-live="polite">
          ${escapeHtml(deepSeekStatusText())}
        </p>
        <p class="subtle-status" role="note">${escapeHtml(t().deepSeekDisclosure)}</p>
      </div>
      <div class="assistant-subsection" aria-labelledby="speech-heading">
        <div class="assistant-row">
          <span id="speech-heading" class="field-label">${escapeHtml(t().speechResponse)}</span>
          <button id="assistant-stop-speaking" class="btn-ghost" type="button"
            ${state.assistantSpeaking ? '' : 'disabled'}>${escapeHtml(t().speechStop)}</button>
        </div>
        <label class="check-row" for="assistant-speech-enabled">
          <input id="assistant-speech-enabled" type="checkbox" ${state.assistantSpeechEnabled ? 'checked' : ''} />
          <span>${escapeHtml(t().speechEnabled)}</span>
        </label>
        <label class="assistant-field" for="assistant-speech-voice">
          <span>${escapeHtml(t().speechVoice)}</span>
          <select id="assistant-speech-voice" ${state.assistantSpeechEnabled && availableVoices.length ? '' : 'disabled'}>
            ${renderVoiceOptions()}
          </select>
        </label>
        <label class="assistant-field" for="assistant-speech-rate">
          <span>${escapeHtml(t().speechRate)}: <output id="assistant-speech-rate-value">${normalizeSpeechRate(state.assistantSpeechRate).toFixed(1)}×</output></span>
          <input id="assistant-speech-rate" type="range" min="0.5" max="2" step="0.1"
            value="${normalizeSpeechRate(state.assistantSpeechRate)}" ${state.assistantSpeechEnabled ? '' : 'disabled'} />
        </label>
        <p class="subtle-status" role="status" aria-live="polite">
          ${escapeHtml(state.assistantSpeaking ? t().speechSpeaking : t().speechIdle)}
        </p>
      </div>
      <div class="assistant-target" role="status" aria-live="polite">
        <span class="field-label">${escapeHtml(t().assistantTarget)}</span>
        <span dir="auto">${escapeHtml(state.assistantTargetLabel || t().assistantTargetUnknown)}</span>
        ${confidencePercent() === undefined ? '' : `
          <span class="confidence-label">${escapeHtml(t().assistantPlanConfidence)}: ${confidencePercent()}%</span>
          <progress max="100" value="${confidencePercent()}" aria-label="${escapeHtml(t().assistantPlanConfidence)}"></progress>`}
      </div>
      ${state.assistantPendingSend ? `
        <div class="pending-send" role="alert" aria-labelledby="pending-send-heading">
          <strong id="pending-send-heading">${escapeHtml(t().pendingSend)}</strong>
          <p>${escapeHtml(t().pendingSendExplain)}</p>
          <blockquote dir="auto">${escapeHtml(state.assistantPendingSend.preview)}</blockquote>
          <div class="actions-row">
            <button id="assistant-pending-confirm" class="btn" type="button">${escapeHtml(t().pendingSendConfirm)}</button>
            <button id="assistant-pending-cancel" class="btn-ghost" type="button">${escapeHtml(t().pendingSendCancel)}</button>
          </div>
        </div>` : ''}
      ${state.assistantDisclosureAcknowledged ? '' : `
        <div class="assistant-disclosure" role="note">
          <p>${escapeHtml(t().assistantDisclosure)}</p>
          <button id="assistant-disclosure" class="link-btn" type="button">${escapeHtml(t().assistantDisclosureAcknowledge)}</button>
        </div>`}
    </section>

    <details class="section settings-section" id="settings">
      <summary>
        <span>${escapeHtml(t().settings)}</span>
        <span class="chevron">▾</span>
      </summary>
      <div class="settings-grid">
        <label>
          <span>${escapeHtml(t().settingsSpeechLang)}</span>
          <select id="speech-lang">
            ${renderLanguageOptions()}
          </select>
        </label>
        <label>
          <span>${escapeHtml(t().settingsUiLang)}</span>
          <select id="ui-lang">
            <option value="he" ${state.uiLang === 'he' ? 'selected' : ''}>${escapeHtml(t().uiHebrew)}</option>
            <option value="en" ${state.uiLang === 'en' ? 'selected' : ''}>${escapeHtml(t().uiEnglish)}</option>
          </select>
        </label>
        <label>
          <span>${escapeHtml(t().settingsTtl)}</span>
          <select id="ttl">
            <option value="0" ${state.ttlDays === 0 ? 'selected' : ''}>${escapeHtml(t().ttlForever)}</option>
            <option value="1" ${state.ttlDays === 1 ? 'selected' : ''}>${escapeHtml(t().ttl1d)}</option>
            <option value="7" ${state.ttlDays === 7 ? 'selected' : ''}>${escapeHtml(t().ttl7d)}</option>
            <option value="30" ${state.ttlDays === 30 ? 'selected' : ''}>${escapeHtml(t().ttl30d)}</option>
          </select>
        </label>
        <label class="full">
          <span>${escapeHtml(t().settingsModel)} ${state.metaLoading ? '<span class="meta-loading">⟳</span>' : ''}</span>
          <select id="model">
            ${renderModelOptions()}
          </select>
          ${state.metaError ? `<span class="meta-error">${escapeHtml(state.metaError)}</span>` : ''}
        </label>
        <label class="full">
          <span>${escapeHtml(t().settingsAudioDevice)}</span>
          <div class="kb-row">
            <select id="audio-device" style="flex:1">
              <option value="" ${!state.audioDevice ? 'selected' : ''}>${escapeHtml(t().audioDeviceDefault)}</option>
              ${state.audioDevices.map((d) =>
                `<option value="${escapeHtml(d.id)}" ${state.audioDevice === d.id ? 'selected' : ''}>${escapeHtml(d.label)}</option>`
              ).join('')}
            </select>
            <button id="audio-device-scan" class="btn-ghost" type="button" aria-label="${escapeHtml(t().audioDeviceScan)}" title="${escapeHtml(t().audioDeviceScan)}">↺</button>
          </div>
        </label>
        <label class="full">
          <span>${escapeHtml(t().settingsKey)}</span>
          <div class="kb-row">
            <code class="kbd">${escapeHtml(state.keybinding)}</code>
            <button id="open-keybindings" class="btn-ghost">${escapeHtml(t().changeKey)}</button>
          </div>
        </label>
        <div class="actions-row">
          <button id="set-api-key" class="btn">${escapeHtml(t().setApiKey)}</button>
          <button id="refresh-meta" class="btn-ghost" title="Refresh models/languages from Soniox">
            ⟳ ${escapeHtml(t().refresh)}
          </button>
        </div>
      </div>
    </details>
  `;

  attachHandlers();
}

function renderLanguageOptions(): string {
  const langs = state.languages.length > 0 ? state.languages : [
    { code: 'he', name: 'Hebrew' },
    { code: 'en', name: 'English' },
    { code: 'auto', name: 'Auto-detect' },
  ];
  let opts = '';
  for (const l of langs) {
    const sel = state.speechLang === l.code ? 'selected' : '';
    opts += `<option value="${escapeHtml(l.code)}" ${sel}>${escapeHtml(l.name)} (${escapeHtml(l.code)})</option>`;
  }
  return opts;
}

function renderModelOptions(): string {
  const models = state.models.length > 0 ? state.models : [
    { id: 'stt-async-v4', description: 'Async v4 (recommended)' },
    { id: 'stt-rt-v4', description: 'Real-time v4' },
  ];
  let opts = '';
  let hasCurrent = false;
  for (const m of models) {
    const sel = state.model === m.id ? 'selected' : '';
    if (sel) hasCurrent = true;
    const label = m.description ? `${m.id} — ${m.description}` : m.id;
    opts += `<option value="${escapeHtml(m.id)}" ${sel}>${escapeHtml(label)}</option>`;
  }
  if (!hasCurrent && state.model) {
    opts =
      `<option value="${escapeHtml(state.model)}" selected>${escapeHtml(state.model)} (custom)</option>` + opts;
  }
  return opts;
}

function renderEntry(e: HistoryEntry): string {
  return `
    <div class="entry" data-id="${e.id}">
      <div class="entry-text" dir="auto" lang="${escapeHtml(e.lang)}">${escapeHtml(e.text)}</div>
      <div class="entry-meta">
        <span class="badge">${langFlag(e.lang)} ${escapeHtml(e.lang)}</span>
        <span class="ts">${fmtTime(e.ts)}</span>
        <button class="icon-btn" type="button" data-act="copy" data-id="${e.id}" aria-label="${escapeHtml(t().copy)}" title="${escapeHtml(t().copy)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/></svg>
        </button>
        <button class="icon-btn danger" type="button" data-act="remove" data-id="${e.id}" aria-label="${escapeHtml(t().remove)}" title="${escapeHtml(t().remove)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
        </button>
      </div>
    </div>
  `;
}

function attachHandlers() {
  const mic = document.getElementById('mic');
  if (mic) {
    mic.addEventListener('mousedown', () => vscode.postMessage({ type: 'start' }));
    mic.addEventListener('mouseup', () => vscode.postMessage({ type: 'stop' }));
    mic.addEventListener('mouseleave', () => {
      if (state.recording) vscode.postMessage({ type: 'stop' });
    });
    mic.addEventListener('touchstart', (e) => {
      e.preventDefault();
      vscode.postMessage({ type: 'start' });
    });
    mic.addEventListener('touchend', (e) => {
      e.preventDefault();
      vscode.postMessage({ type: 'stop' });
    });
  }

  document.getElementById('clear-all')?.addEventListener('click', () => {
    // Webview confirm() is blocked. Let the extension host show the dialog.
    vscode.postMessage({ type: 'history-clear-request' });
  });

  document.getElementById('open-keybindings')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'open-keybindings' });
  });

  document.getElementById('refresh-meta')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'refresh-meta' });
  });

  document.querySelectorAll<HTMLButtonElement>('button[data-act]').forEach((b) => {
    b.addEventListener('click', () => {
      const id = b.dataset.id!;
      const act = b.dataset.act!;
      if (act === 'copy') {
        const entry = state.history.find((e) => e.id === id);
        if (entry) {
          navigator.clipboard?.writeText(entry.text).catch(() => {
            /* webview clipboard may be restricted; ask host */
            vscode.postMessage({ type: 'history-copy', id });
          });
          vscode.postMessage({ type: 'history-copy', id });
          flashLabel(b, t().copied);
        }
      } else if (act === 'remove') {
        vscode.postMessage({ type: 'history-remove', id });
      }
    });
  });

  document.getElementById('speech-lang')?.addEventListener('change', (e) => {
    state.speechLang = (e.target as HTMLSelectElement).value;
    pushSettings();
  });
  document.getElementById('ui-lang')?.addEventListener('change', (e) => {
    state.uiLang = (e.target as HTMLSelectElement).value as UiLang;
    pushSettings();
    render();
  });
  document.getElementById('ttl')?.addEventListener('change', (e) => {
    state.ttlDays = Number((e.target as HTMLSelectElement).value) as InitState['ttlDays'];
    pushSettings();
  });
  document.getElementById('model')?.addEventListener('change', (e) => {
    state.model = (e.target as HTMLSelectElement).value.trim();
    pushSettings();
  });
  document.getElementById('set-api-key')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'set-api-key' });
  });

  document.getElementById('audio-device')?.addEventListener('change', (e) => {
    state.audioDevice = (e.target as HTMLSelectElement).value;
    vscode.postMessage({ type: 'audio-device-change', deviceId: state.audioDevice });
  });
  document.getElementById('audio-device-scan')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'audio-device-scan' });
  });
  document.getElementById('assistant-enabled')?.addEventListener('click', () => {
    state.assistantEnabled = !state.assistantEnabled;
    vscode.postMessage({ type: 'assistant-enabled-change', enabled: state.assistantEnabled });
    render();
  });
  document.getElementById('assistant-wake-phrase')?.addEventListener('change', (e) => {
    state.assistantWakePhrase = (e.target as HTMLInputElement).value.trim();
    vscode.postMessage({ type: 'assistant-wake-phrase-change', wakePhrase: state.assistantWakePhrase });
  });
  document.getElementById('assistant-disclosure')?.addEventListener('click', () => {
    state.assistantDisclosureAcknowledged = true;
    vscode.postMessage({ type: 'assistant-disclosure-acknowledged' });
    render();
  });
  document.getElementById('assistant-persona')?.addEventListener('change', (e) => {
    state.assistantPersona = (e.target as HTMLSelectElement).value as PersonaId;
    vscode.postMessage({ type: 'assistant-persona-change', persona: state.assistantPersona });
  });
  document.getElementById('assistant-deepseek-setup')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'assistant-deepseek-setup' });
  });
  document.getElementById('assistant-speech-enabled')?.addEventListener('change', (e) => {
    state.assistantSpeechEnabled = (e.target as HTMLInputElement).checked;
    if (!state.assistantSpeechEnabled) cancelSpeech();
    pushSpeechSettings();
    render();
  });
  document.getElementById('assistant-speech-voice')?.addEventListener('change', (e) => {
    state.assistantSpeechVoiceUri = (e.target as HTMLSelectElement).value;
    pushSpeechSettings();
  });
  document.getElementById('assistant-speech-rate')?.addEventListener('input', (e) => {
    state.assistantSpeechRate = normalizeSpeechRate((e.target as HTMLInputElement).value);
    const output = document.getElementById('assistant-speech-rate-value');
    if (output) output.textContent = `${state.assistantSpeechRate.toFixed(1)}×`;
  });
  document.getElementById('assistant-speech-rate')?.addEventListener('change', () => {
    pushSpeechSettings();
  });
  document.getElementById('assistant-stop-speaking')?.addEventListener('click', () => {
    cancelSpeech();
    vscode.postMessage({ type: 'assistant-stop-speaking' });
  });
  document.getElementById('assistant-pending-confirm')?.addEventListener('click', () => {
    if (state.assistantPendingSend) {
      vscode.postMessage({ type: 'assistant-pending-send-confirm', id: state.assistantPendingSend.id });
    }
  });
  document.getElementById('assistant-pending-cancel')?.addEventListener('click', () => {
    if (state.assistantPendingSend) {
      vscode.postMessage({ type: 'assistant-pending-send-cancel', id: state.assistantPendingSend.id });
    }
  });
}

function flashLabel(btn: HTMLButtonElement, text: string) {
  const original = btn.title;
  btn.title = text;
  btn.classList.add('flash');
  setTimeout(() => {
    btn.title = original;
    btn.classList.remove('flash');
  }, 1200);
}

function pushSettings() {
  vscode.postMessage({
    type: 'settings-update',
    speechLang: state.speechLang,
    uiLang: state.uiLang,
    ttlDays: state.ttlDays,
    model: state.model,
  });
}

function pushSpeechSettings() {
  state.assistantSpeechRate = normalizeSpeechRate(state.assistantSpeechRate);
  vscode.postMessage({
    type: 'assistant-speech-settings-change',
    enabled: !!state.assistantSpeechEnabled,
    voiceUri: state.assistantSpeechVoiceUri,
    rate: state.assistantSpeechRate,
  });
}

function finishSpeech(
  id: string,
  outcome: 'completed' | 'cancelled' | 'error' | 'unavailable' | 'queue-full',
  generation: number,
) {
  if (!speechLifecycle.finish(id, generation)) return;
  const continues = continuesSpeakingAfterFinish(
    state.assistantSpeechEnabled,
    speechQueue.length,
  );
  state.assistantSpeaking = continues;
  vscode.postMessage({ type: 'assistant-speech-finished', id, outcome });
  if (continues) drainSpeechQueue();
  else render();
}

function drainSpeechQueue() {
  if (!hostStateInitialized || speechLifecycle.activeId || !state.assistantSpeechEnabled) return;
  const item = speechQueue.take();
  if (!item) {
    state.assistantSpeaking = false;
    render();
    return;
  }

  if (typeof window.speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') {
    vscode.postMessage({ type: 'assistant-speech-finished', id: item.id, outcome: 'unavailable' });
    drainSpeechQueue();
    return;
  }

  let generation: number | undefined;
  try {
    const utterance = new SpeechSynthesisUtterance(item.text);
    const voice = selectSpeechVoice(
      availableVoices,
      state.assistantSpeechVoiceUri,
      item.lang || (state.speechLang === 'auto' ? state.uiLang : state.speechLang),
    );
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else if (item.lang) {
      utterance.lang = item.lang;
    }
    utterance.rate = normalizeSpeechRate(state.assistantSpeechRate);
    generation = speechLifecycle.start(item.id);
    if (generation === undefined) {
      vscode.postMessage({ type: 'assistant-speech-finished', id: item.id, outcome: 'error' });
      return;
    }
    state.assistantSpeaking = true;
    vscode.postMessage({ type: 'assistant-speech-started', id: item.id });
    utterance.onend = () => {
      finishSpeech(item.id, 'completed', generation);
    };
    utterance.onerror = () => {
      finishSpeech(item.id, 'error', generation);
    };
    render();
    window.speechSynthesis.speak(utterance);
  } catch {
    if (generation !== undefined) speechLifecycle.finish(item.id, generation);
    state.assistantSpeaking = false;
    vscode.postMessage({ type: 'assistant-speech-finished', id: item.id, outcome: 'error' });
    drainSpeechQueue();
  }
}

function enqueueSpeech(id: string, text: string, lang?: string) {
  if (!hostStateInitialized || !state.assistantSpeechEnabled) {
    vscode.postMessage({ type: 'assistant-speech-finished', id, outcome: 'unavailable' });
    return;
  }
  if (!speechQueue.enqueue({ id, text, lang })) {
    vscode.postMessage({ type: 'assistant-speech-finished', id, outcome: 'queue-full' });
    return;
  }
  drainSpeechQueue();
}

function cancelSpeech() {
  const pending = speechQueue.cancel();
  for (const item of pending) {
    vscode.postMessage({ type: 'assistant-speech-finished', id: item.id, outcome: 'cancelled' });
  }
  const current = speechLifecycle.cancel();
  state.assistantSpeaking = false;
  window.speechSynthesis?.cancel();
  if (current) {
    vscode.postMessage({ type: 'assistant-speech-finished', id: current, outcome: 'cancelled' });
  }
  render();
}

function refreshVoices() {
  if (typeof window.speechSynthesis === 'undefined') return;
  availableVoices = window.speechSynthesis.getVoices();
  render();
}

window.addEventListener('message', (e) => {
  const msg = e.data as HostMessage | { type: 'init'; payload: InitState };
  if (msg?.type === 'init' || msg?.type === 'state') {
    const wasEnabled = hostStateInitialized && !!state.assistantSpeechEnabled;
    state = { ...state, ...msg.payload };
    state.assistantSpeaking = resolveSpeakingState(
      state.assistantSpeaking,
      speechLifecycle.activeId,
    );
    hostStateInitialized = true;
    if (wasEnabled && !state.assistantSpeechEnabled) cancelSpeech();
    else if (!wasEnabled && state.assistantSpeechEnabled) drainSpeechQueue();
    render();
  } else if (msg?.type === 'recording-state') {
    state.recording = !!msg.recording;
    render();
  } else if (msg?.type === 'history') {
    state.history = msg.entries ?? [];
    render();
  } else if (msg?.type === 'meta') {
    state.models = msg.models ?? [];
    state.languages = msg.languages ?? [];
    state.metaLoading = !!msg.loading;
    state.metaError = msg.error;
    render();
  } else if (msg?.type === 'speak') {
    enqueueSpeech(msg.id, msg.text, msg.lang);
  } else if (msg?.type === 'cancel-speaking') {
    cancelSpeech();
  }
});

// Track whether Alt+M was pressed so we can fire the toggle only on keyup.
let altMHeld = false;

document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.altKey && e.code === 'KeyM' && !e.repeat) {
    e.preventDefault();
    altMHeld = true;
  }
});

document.addEventListener('keyup', (e: KeyboardEvent) => {
  // Alt released before M — cancel without firing.
  if (e.key === 'Alt' && altMHeld) {
    altMHeld = false;
    return;
  }
  if (e.code === 'KeyM' && altMHeld) {
    altMHeld = false;
    if (state.recording) {
      vscode.postMessage({ type: 'stop' });
    } else {
      vscode.postMessage({ type: 'start' });
    }
  }
});

document.addEventListener('DOMContentLoaded', () => {
  render();
  if (typeof window.speechSynthesis !== 'undefined') {
    refreshVoices();
    window.speechSynthesis.addEventListener('voiceschanged', refreshVoices);
  }
  vscode.postMessage({ type: 'ready' });
});
