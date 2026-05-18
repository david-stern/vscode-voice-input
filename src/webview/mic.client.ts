// Webview UI: mic button, history list, collapsible settings.
// All state comes from the extension host via postMessage.
import { STRINGS, UiLang, Strings } from './i18n';

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
};

function t(): Strings {
  return STRINGS[state.uiLang];
}

function dir(): 'rtl' | 'ltr' {
  return state.uiLang === 'he' ? 'rtl' : 'ltr';
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  const sameDay =
    new Date().toDateString() === d.toDateString();
  if (sameDay) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

function render() {
  document.documentElement.setAttribute('dir', dir());
  document.documentElement.setAttribute('lang', state.uiLang);

  const root = document.getElementById('root')!;
  root.innerHTML = `
    <div class="card mic-card">
      <button id="mic" class="mic-btn ${state.recording ? 'recording' : ''}"
              title="${escapeHtml(t().holdHint)}">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor" aria-hidden="true">
          <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zm-7 9a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2a5 5 0 0 1-10 0H5z"/>
        </svg>
      </button>
      <div class="status">
        <span class="status-dot ${state.recording ? 'on' : ''}"></span>
        <span id="status-text">${state.recording ? escapeHtml(t().recording) : escapeHtml(t().idle)}</span>
      </div>
      <div class="hint">${escapeHtml(t().holdHint)} · ${escapeHtml(t().pressKeyHint)} <code class="hint-key">${escapeHtml(state.keybinding)}</code> ${escapeHtml(t().toToggle)}</div>
    </div>

    <div class="section">
      <div class="section-head">
        <h3>${escapeHtml(t().history)} <span class="count">${state.history.length}</span></h3>
        <button class="link-btn danger" id="clear-all"
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
            <button id="audio-device-scan" class="btn-ghost" title="${escapeHtml(t().audioDeviceScan)}">↺</button>
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
      <div class="entry-text" title="${escapeHtml(e.text)}">${escapeHtml(e.text)}</div>
      <div class="entry-meta">
        <span class="badge">${langFlag(e.lang)} ${escapeHtml(e.lang)}</span>
        <span class="ts">${fmtTime(e.ts)}</span>
        <button class="icon-btn" data-act="copy" data-id="${e.id}" title="${escapeHtml(t().copy)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/></svg>
        </button>
        <button class="icon-btn danger" data-act="remove" data-id="${e.id}" title="${escapeHtml(t().remove)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
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

window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg?.type === 'init' || msg?.type === 'state') {
    state = { ...state, ...msg.payload };
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
  vscode.postMessage({ type: 'ready' });
});
