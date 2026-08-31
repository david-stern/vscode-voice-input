import { STRINGS, type Strings } from '../i18n';
import type { PersonaId, ViewState } from '../protocol';
import {
  normalizeSpeechRate,
  selectSpeechVoice,
  type SpeechVoiceLike,
} from '../speech';

export interface MicSelectOption<T extends string = string> {
  value: T;
  label: string;
  selected: boolean;
}

export interface MicViewModel {
  strings: Strings;
  direction: 'rtl' | 'ltr';
  assistantStatus: string;
  feedback: string;
  personas: MicSelectOption<PersonaId>[];
  providerName: string;
  providerStatus: string;
  voices: MicSelectOption[];
  speechRate: number;
  speechStatus: string;
  targetLabel: string;
  confidence: number | undefined;
  mappingCount: string;
  mappingStatus: string;
  settingsStatus: string;
  pendingAction: ViewState['assistantPendingAction'];
  pendingSend: ViewState['assistantPendingSend'];
}

export function stringsFor(state: ViewState): Strings {
  return STRINGS[state.uiLang];
}

export function microphoneActionLabel(
  recording: boolean,
  strings: Pick<Strings, 'micStartAction' | 'micStopAction'>,
): string {
  return recording ? strings.micStopAction : strings.micStartAction;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatHistoryTime(timestamp: number, uiLang: ViewState['uiLang']): string {
  const date = new Date(timestamp);
  const locale = uiLang === 'he' ? 'he-IL' : 'en-US';
  const sameDay = new Date().toDateString() === date.toDateString();
  return new Intl.DateTimeFormat(locale, sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' },
  ).format(date);
}

export function languageFlag(language: string): string {
  const normalized = language.trim();
  return normalized ? normalized.toLocaleUpperCase('en-US') : '—';
}

export function personaOptions(strings: Strings): { value: PersonaId; label: string }[] {
  return [
    { value: 'teacher-lecturer', label: strings.personaTeacher },
    { value: 'secretary', label: strings.personaSecretary },
    { value: 'friend', label: strings.personaFriend },
    { value: 'tour-guide', label: strings.personaTravelGuide },
    { value: 'mathematician', label: strings.personaMathematician },
    { value: 'philosopher', label: strings.personaPhilosopher },
  ];
}

export function confidencePercent(state: ViewState): number | undefined {
  const confidence = state.assistantPlanConfidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return undefined;
  return Math.round(Math.min(1, Math.max(0, confidence)) * 100);
}

/** Pure projection shared by DOM reconciliation and late-state regression tests. */
export function createMicViewModel(
  state: ViewState,
  voices: readonly SpeechVoiceLike[],
): MicViewModel {
  const strings = stringsFor(state);
  const selectedPersona = state.assistantPersona ?? 'teacher-lecturer';
  const selectedVoice = selectSpeechVoice(
    voices,
    state.assistantSpeechVoiceUri,
    state.speechLang === 'auto' ? state.uiLang : state.speechLang,
  );
  const summary = state.assistantMappingSummary;

  return {
    strings,
    direction: state.uiLang === 'he' ? 'rtl' : 'ltr',
    assistantStatus: state.assistantListening
      ? strings.assistantListening
      : state.assistantEnabled ? strings.assistantReady : strings.assistantDisabled,
    feedback: state.assistantFeedback ?? '',
    personas: personaOptions(strings).map(({ value, label }) => ({
      value,
      label,
      selected: value === selectedPersona,
    })),
    providerName: state.assistantProviderId === 'off'
      ? strings.providerOff
      : state.assistantProviderName || state.assistantProviderId || strings.providerOff,
    providerStatus: providerStatusText(state, strings),
    voices: voices.length === 0
      ? [{ value: '', label: strings.speechNoVoices, selected: true }]
      : voices.map((voice) => ({
        value: voice.voiceURI,
        label: `${voice.name} (${voice.lang})${voice.default ? ` — ${strings.speechSystemDefault}` : ''}`,
        selected: voice.voiceURI === selectedVoice?.voiceURI,
      })),
    speechRate: normalizeSpeechRate(state.assistantSpeechRate),
    speechStatus: state.assistantSpeaking ? strings.speechSpeaking : strings.speechIdle,
    targetLabel: state.assistantTargetLabel || strings.assistantTargetUnknown,
    confidence: confidencePercent(state),
    mappingCount: `${strings.customMappingsCount}: ${summary?.enabled ?? 0}/${summary?.total ?? 0} · ${strings.customMappingsAgentExposed}: ${summary?.agentExposed ?? 0}`,
    mappingStatus: mappingStatusText(state, strings),
    settingsStatus: state.metaLoading
      ? strings.providerChecking
      : state.metaError || (state.assistantEnabled ? strings.assistantReady : strings.assistantDisabled),
    pendingAction: state.assistantPendingAction,
    pendingSend: state.assistantPendingSend,
  };
}

function providerStatusText(state: ViewState, strings: Strings): string {
  switch (state.assistantProviderStatus) {
    case 'off': return strings.providerOff;
    case 'ready': return strings.providerReady;
    case 'checking': return strings.providerChecking;
    case 'consent-required': return strings.providerConsentRequired;
    case 'error': return state.assistantProviderError || strings.providerError;
    default: return strings.providerMissing;
  }
}

function mappingStatusText(state: ViewState, strings: Strings): string {
  switch (state.assistantMappingSummary?.status) {
    case 'untrusted': return strings.customMappingsStatusUntrusted;
    case 'error': return strings.customMappingsStatusError;
    default: return strings.customMappingsStatusReady;
  }
}
