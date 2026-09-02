import type { ViewState, WebviewMessage } from '../protocol';
import type { CompactMicBrowserMessage } from './compactContracts';

export interface MicEventDependencies {
  getState: () => ViewState;
  post: (message: WebviewMessage | CompactMicBrowserMessage) => void;
  toggle: () => void;
  render: () => void;
  cancelSpeech: () => void;
  copiedLabel: () => string;
  copySuccessMessage: () => string;
  announce: (message: string) => void;
}

/** Wires only the compact microphone, pending review, and canonical-panel launchers. */
export function attachMicEventHandlers(dependencies: MicEventDependencies): void {
  const { post, toggle } = dependencies;
  const mic = document.getElementById('mic');
  if (mic) {
    const press = new MicPressLifecycle();
    const beginPress = () => { if (press.begin()) post({ type: 'start' }); };
    const endPress = () => { if (press.end()) post({ type: 'stop' }); };
    mic.addEventListener('mousedown', beginPress);
    mic.addEventListener('mouseup', endPress);
    mic.addEventListener('mouseleave', endPress);
    mic.addEventListener('touchstart', (event) => { event.preventDefault(); beginPress(); });
    mic.addEventListener('touchend', (event) => { event.preventDefault(); endPress(); });
    mic.addEventListener('touchcancel', (event) => { event.preventDefault(); endPress(); });
    mic.addEventListener('click', (event) => { if (micClickAction(event.detail)) toggle(); });
  }
  document.getElementById('open-control-center')?.addEventListener('click', () => (
    post({ type: 'mic-control-center-open', route: 'home' })
  ));
  document.getElementById('open-voice')?.addEventListener('click', () => (
    post({ type: 'mic-control-center-open', route: 'voice' })
  ));
  document.getElementById('open-commands')?.addEventListener('click', () => (
    post({ type: 'mic-control-center-open', route: 'commands' })
  ));
  document.getElementById('pending-review')?.addEventListener('click', () => (
    post({ type: 'mic-open-pending-review' })
  ));
  document.getElementById('compact-auto')?.addEventListener('click', () => (
    post({ type: 'mic-disable-auto' })
  ));
}

export function micClickAction(clickDetail: number): 'toggle' | undefined {
  return clickDetail === 0 ? 'toggle' : undefined;
}

export class MicPressLifecycle {
  private active = false;
  begin(): boolean { if (this.active) return false; this.active = true; return true; }
  end(): boolean { if (!this.active) return false; this.active = false; return true; }
}
