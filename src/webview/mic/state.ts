import type { ViewState } from '../protocol';
import { DEFAULT_SPEECH_RATE } from '../speech';

/** Browser-local defaults used until the extension host posts its first state. */
export function createInitialMicState(): ViewState {
  return {
    uiLang: 'he', speechLang: 'he', ttlDays: 30, model: 'stt-async-v4',
    history: [], recording: false, keybinding: 'Alt+M', models: [], languages: [],
    metaLoading: false, audioDevice: '', audioDevices: [], assistantEnabled: false,
    assistantListening: false, assistantWakePhrase: '', assistantDisclosureAcknowledged: false,
    assistantPersona: 'teacher-lecturer', assistantProviderId: 'off',
    assistantProviderName: '', assistantProviderStatus: 'off',
    assistantSpeechEnabled: true, assistantSpeechVoiceUri: '',
    assistantSpeechRate: DEFAULT_SPEECH_RATE, assistantSpeaking: false,
  };
}
