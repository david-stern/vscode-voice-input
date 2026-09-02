import type { ViewState } from '../protocol';
import type { SpeechVoiceLike } from '../speech';
import { compactMicStateFromLegacy, type CompactMicState } from './compactContracts';
import { microphoneActionLabel, type MicSelectOption } from './renderHelpers';
import { STRINGS } from '../i18n';

const COMPACT_COPY = {
  en: {
    microphone: 'Microphone', latest: 'Latest transcript', pending: 'Pending action',
    open: 'Open Control Center', voice: 'Voice', commands: 'Commands', review: 'Review in Control Center',
    partial: 'Partial', final: 'Final', empty: 'No transcript yet', auto: 'AUTO is active — disable immediately',
    notConfigured: 'Not configured', soniox: 'Soniox configured — remote processing',
    system: 'System voice — temporary and OS-dependent',
    systemUnavailable: 'System voice unavailable — no OS voice found',
    localPending: 'Offline/local speech is planned and pending, but it is not included or available in this version. System voices are OS-provided and may be unavailable.',
  },
  he: {
    microphone: 'מיקרופון', latest: 'התמלול האחרון', pending: 'פעולה ממתינה',
    open: 'פתיחת מרכז הבקרה', voice: 'קול', commands: 'פקודות', review: 'בדיקה במרכז הבקרה',
    partial: 'זמני', final: 'סופי', empty: 'אין עדיין תמלול', auto: 'AUTO פעיל — כיבוי מיידי',
    notConfigured: 'לא מוגדר', soniox: 'Soniox מוגדר — עיבוד מרוחק',
    system: 'קול מערכת — זמני ותלוי במערכת ההפעלה',
    systemUnavailable: 'קול המערכת אינו זמין — לא נמצא קול של מערכת ההפעלה',
    localPending: 'דיבור לא־מקוון/מקומי מתוכנן ובהמתנה, אך אינו כלול ואינו זמין בגרסה זו. קולות המערכת מסופקים על־ידי מערכת ההפעלה וייתכן שלא יהיו זמינים.',
  },
} as const;

let state: ViewState;
let compact: CompactMicState;

/** Creates the compact daily launcher once, then reconciles host-owned status in place. */
export function renderMicView(
  root: HTMLElement,
  nextState: ViewState,
  voices: readonly SpeechVoiceLike[],
  nextCompact?: CompactMicState,
): void {
  state = nextState;
  compact = nextCompact ?? compactMicStateFromLegacy(nextState, voices.length > 0);
  if (!root.dataset.micShell) {
    root.innerHTML = renderMicShell();
    root.dataset.micShell = 'true';
  }
  patchMicView(root);
}

function renderMicShell(): string {
  return `
    <main id="compact-mic-main">
      <header class="compact-header">
        <div class="title-row"><h1 id="compact-title"></h1><button id="compact-auto" class="auto-kill" type="button" hidden></button></div>
        <p id="compact-provider-status" class="provider-status" role="status"></p>
      </header>
      <section class="compact-section" aria-labelledby="microphone-heading">
        <h2 id="microphone-heading"></h2>
        <button id="mic" class="mic-btn" type="button" aria-pressed="false"><span id="mic-action-label"></span></button>
        <p id="mic-unavailable-reason" class="muted" hidden></p>
        <p id="mic-live" role="status" aria-live="polite" aria-atomic="true"><span id="status-text"></span></p>
        <p class="shortcut"><span id="shortcut-label"></span> <kbd id="mic-hint-key" dir="ltr"></kbd></p>
      </section>
      <section class="compact-section" aria-labelledby="transcript-heading">
        <h2 id="transcript-heading"></h2>
        <div id="partial-block" hidden><strong id="partial-label"></strong><p id="partial-transcript" dir="auto" aria-live="polite"></p></div>
        <div><strong id="final-label"></strong><p id="final-transcript" dir="auto" aria-live="polite"></p></div>
      </section>
      <section id="pending-block" class="compact-section" aria-labelledby="pending-heading" hidden>
        <h2 id="pending-heading"></h2><p id="pending-label" dir="auto"></p>
        <button id="pending-review" class="secondary" type="button"></button>
      </section>
      <section class="compact-section launcher-section" aria-labelledby="launcher-heading">
        <h2 id="launcher-heading"></h2>
        <button id="open-control-center" type="button"></button>
        <div class="deep-links"><button id="open-voice" class="secondary" type="button"></button><button id="open-commands" class="secondary" type="button"></button></div>
      </section>
    </main>`;
}

function patchMicView(root: HTMLElement): void {
  const strings = STRINGS[compact.language];
  const copy = COMPACT_COPY[compact.language];
  document.documentElement.lang = compact.language;
  document.documentElement.dir = compact.language === 'he' ? 'rtl' : 'ltr';
  document.title = strings.appTitle;
  setText(root, 'compact-title', strings.appTitle);
  setText(root, 'compact-provider-status', statusLabel(compact, copy));
  const auto = byId<HTMLButtonElement>(root, 'compact-auto');
  if (auto) { auto.hidden = !compact.effectiveAutoMode; auto.textContent = copy.auto; }
  setText(root, 'microphone-heading', copy.microphone);
  const micLabel = microphoneActionLabel(state.recording, strings);
  const mic = byId<HTMLButtonElement>(root, 'mic');
  if (mic) {
    mic.disabled = !compact.microphoneAvailable && !state.recording;
    mic.setAttribute('aria-pressed', String(state.recording));
    mic.setAttribute('aria-label', micLabel);
    if (mic.disabled && compact.microphoneUnavailableReason) {
      mic.setAttribute('aria-describedby', 'mic-unavailable-reason');
    } else mic.removeAttribute('aria-describedby');
  }
  setText(root, 'mic-action-label', micLabel);
  setText(root, 'status-text', state.recording ? strings.recording : strings.idle);
  setText(root, 'shortcut-label', compact.language === 'he' ? 'קיצור דרך:' : 'Shortcut:');
  setText(root, 'mic-hint-key', state.keybinding);
  setText(root, 'mic-unavailable-reason', compact.microphoneUnavailableReason ?? '');
  setHidden(root, 'mic-unavailable-reason', compact.microphoneAvailable || !compact.microphoneUnavailableReason);

  setText(root, 'transcript-heading', copy.latest);
  setText(root, 'partial-label', `${copy.partial}:`);
  setText(root, 'partial-transcript', compact.partialTranscript ?? '');
  setHidden(root, 'partial-block', !compact.streamingPartials);
  setText(root, 'final-label', `${copy.final}:`);
  setText(root, 'final-transcript', compact.finalTranscript || copy.empty);

  setText(root, 'pending-heading', copy.pending);
  setText(root, 'pending-label', compact.pendingActionLabel ?? '');
  setText(root, 'pending-review', copy.review);
  setHidden(root, 'pending-block', !compact.pendingActionLabel);
  setText(root, 'launcher-heading', copy.open);
  setText(root, 'open-control-center', copy.open);
  setText(root, 'open-voice', copy.voice);
  setText(root, 'open-commands', copy.commands);
}

function statusLabel(value: CompactMicState, copy: (typeof COMPACT_COPY)['en'] | (typeof COMPACT_COPY)['he']): string {
  return {
    'not-configured': copy.notConfigured,
    'soniox-configured': copy.soniox,
    'system-voice': copy.system,
    'system-voice-unavailable': copy.systemUnavailable,
    'local-pending': copy.localPending,
  }[value.providerStatus];
}

function byId<T extends HTMLElement>(root: HTMLElement, id: string): T | null {
  return root.querySelector<T>(`#${id}`);
}

function setText(root: HTMLElement, id: string, value: string): void {
  const node = byId(root, id);
  if (node) node.textContent = value;
}

function setHidden(root: HTMLElement, id: string, hidden: boolean): void {
  const node = byId(root, id);
  if (node) node.hidden = hidden;
}

/** Keep focused select reconciliation available for compatibility tests and old callers. */
export function reconciledSelectValue<T extends string>(
  selected: T,
  options: readonly MicSelectOption<T>[],
  currentValue: string,
  focused: boolean,
): string {
  return focused && options.some(({ value }) => value === currentValue) ? currentValue : selected;
}
