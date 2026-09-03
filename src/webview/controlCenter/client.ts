import {
  type ControlCenterBrowserMessage,
  type ControlCenterCommandRow,
  type ControlCenterHostMessage,
  type ControlCenterRoute,
} from './contracts';
import { registerControlCenterFormHandlers } from './clientForms';
import {
  parseCommandFilterState,
  updateCommandFilterState,
  type CommandCategoryFilter,
} from './filters';
import {
  captureFocusBookmark,
  focusControlCenterTarget,
  restoreFocusBookmark,
} from './focus';
import {
  isHostChannelVoice,
  mergeSystemVoices,
  sonioxSystemVoices,
} from './hostVoices';
import { CONTROL_CENTER_STRINGS } from './i18n';
import {
  openActionPreviewOverlay,
  openAutoExplanationOverlay,
  openCommandLoadingOverlay,
  openNavigationOverlay,
  openProviderDetailsOverlay,
  showCommandDetailsOverlay,
} from './clientOverlays';
import {
  postAgentAction,
  postCustomCommandAction,
  postPlanningProviderAction,
} from './managementClient';
import { OverlayController } from './overlay';
import { isControlCenterRevision, parseControlCenterHostMessage } from './protocol';
import { ControlCenterSystemSpeech } from './systemSpeech';
import { ControlCenterView, type ControlCenterManagementResources } from './view';

declare const acquireVsCodeApi: () => {
  postMessage(message: ControlCenterBrowserMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
};

interface PendingCommandPage {
  snapshot: Extract<ControlCenterHostMessage, { type: 'stateSnapshot' }>;
  chunks: Map<number, readonly ControlCenterCommandRow[]>;
  invalid: boolean;
}

type HostResourceKey = Exclude<keyof ControlCenterManagementResources, 'systemSpeech'>;
type HostResourceMessage = Extract<ControlCenterHostMessage, {
  type:
    | 'planningProviderState'
    | 'agentPageState'
    | 'customCommandPageState'
    | 'customCommandDetails'
    | 'setupState'
    | 'diagnosticsState';
}>;

const root = document.getElementById('root');
if (!root) throw new Error('Control Center root is missing');
const vscode = acquireVsCodeApi();
const view = new ControlCenterView(root);
const systemSpeech = new ControlCenterSystemSpeech(() => renderCurrent());
let snapshot: Extract<ControlCenterHostMessage, { type: 'stateSnapshot' }> | undefined;
let overlay: OverlayController | undefined;
let pendingPage: PendingCommandPage | undefined;
let currentRows: readonly ControlCenterCommandRow[] = [];
let resources: ControlCenterManagementResources = {};
let lastAppliedRevision = restoredRevision(vscode.getState());
let interactionSequence = 0;
let pendingCommandDetails: string | undefined;
let pendingCustomCommandDetails: string | undefined;
let lastVoiceObservationKey = '';
// Host previews are played outside this browser, so only the client that asked for one
// knows it is running. The flag is cleared by stopping it or by the next host snapshot.
let hostPreviewActive = false;
const transcriptSequences = new Map<string, number>();

window.addEventListener('message', (event) => {
  const message = parseControlCenterHostMessage(event.data);
  if (!message) return;
  switch (message.type) {
    case 'stateSnapshot': acceptSnapshot(message); break;
    case 'commandPageChunk': acceptCommandChunk(message); break;
    case 'commandDetails': showCommandDetailsOverlay(
      snapshot, overlay, message, pendingCommandDetails, view.currentShell?.heading, post,
    ); break;
    case 'planningProviderState': acceptResource('providers', message); break;
    case 'agentPageState': acceptResource('agents', message); break;
    case 'customCommandPageState': acceptResource('customCommands', message); break;
    case 'customCommandDetails':
      if (message.id === pendingCustomCommandDetails) {
        pendingCustomCommandDetails = undefined;
        acceptResource('customCommandDetails', message, 'custom-command-form-heading');
      }
      break;
    case 'setupState': acceptResource('setup', message); break;
    case 'diagnosticsState': acceptResource('diagnostics', message); break;
    case 'statusUpdate': updateStatus(message); break;
    case 'transcriptUpdate': updateTranscript(message); break;
    case 'focusReturn':
      if (message.revision === lastAppliedRevision && view.currentShell) {
        focusControlCenterTarget(view.currentShell, message.target);
      }
      break;
  }
});

document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement | null;
  const actionTarget = target?.closest<HTMLElement>('[data-action]');
  if (!actionTarget || !snapshot) return;
  const action = actionTarget.dataset.action;
  if (action === 'navigate' && actionTarget.dataset.route) {
    closeOverlay('close', false);
    post({ type: 'navigateIntent', revision: snapshot.revision, route: actionTarget.dataset.route as ControlCenterRoute });
  } else if (action === 'open-navigation') openNavigationOverlay(snapshot, overlay, actionTarget, post);
  else if (action === 'disable-auto') post({ type: 'disableAutoIntent', revision: snapshot.revision });
  else if (action === 'explain-auto') {
    openAutoExplanationOverlay(snapshot, overlay, actionTarget, post, closeOverlay);
  }
  else if (action === 'configure-soniox') postProviderSetup('soniox', 'select');
  else if (action === 'leave-stt-off') postProviderSetup('none', 'select');
  else if (action === 'configure-soniox-secret') postProviderSetup('soniox', 'configure-secret');
  else if (action === 'request-soniox-consent') postProviderSetup('soniox', 'request-remote-consent');
  else if (action === 'test-soniox') postProviderSetup('soniox', 'test');
  else if (action === 'revoke-soniox') postProviderSetup('soniox', 'revoke');
  else if (action === 'provider-details') openProviderDetailsOverlay(snapshot, overlay, actionTarget, post);
  else if (action === 'mic-test') post({ type: 'micIntent', revision: snapshot.revision, action: 'test' });
  else if (action === 'select-microphone') postMicrophoneSetup('select-device');
  else if (action === 'test-microphone-signal') postMicrophoneSetup('test-signal');
  else if (action === 'stop-microphone-test') postMicrophoneSetup('stop-test');
  else if (action === 'setup-step' && actionTarget.dataset.setupStep) post({
    type: 'navigateIntent', revision: snapshot.revision, route: 'home',
    params: { setupStep: Number(actionTarget.dataset.setupStep) },
  });
  else if (action === 'preview-pending-action') {
    openActionPreviewOverlay(snapshot, overlay, actionTarget, post, closeOverlay, closeForPendingDecision);
  }
  else if (action === 'clear-filters') postFilter('');
  else if (action === 'category-filter' && actionTarget.dataset.category) {
    const category = actionTarget.dataset.category as CommandCategoryFilter;
    const current = parseCommandFilterState(snapshot.state.filter);
    postFilter(updateCommandFilterState(snapshot.state.filter, {
      category: current.category === category ? undefined : category,
    }));
  } else if (action === 'previous-page' || action === 'next-page') {
    const page = snapshot.state.commandPage?.pageIndex ?? 1;
    post({ type: 'setPageIntent', revision: snapshot.revision, page: action === 'previous-page' ? page - 1 : page + 1 });
  } else if (action === 'edit-command' && actionTarget.dataset.commandId) {
    pendingCommandDetails = actionTarget.dataset.commandId;
    openCommandLoadingOverlay(
      snapshot, overlay, actionTarget, pendingCommandDetails, nextInteractionSequence(), post,
    );
  } else if (action === 'management-page' && actionTarget.dataset.managementTarget && actionTarget.dataset.page) {
    post({
      type: 'setManagementPageIntent', revision: snapshot.revision,
      target: actionTarget.dataset.managementTarget as 'agents' | 'custom-commands',
      page: Number(actionTarget.dataset.page),
    });
  } else if (action === 'cancel-custom-command-edit') cancelCustomCommandEdit();
  else if (action === 'run-diagnostics') postDiagnostics('run');
  else if (action === 'open-diagnostics') postDiagnostics('open');
  else if (action === 'copy-diagnostics') postDiagnostics('copy');
  else if (action === 'preview-system-voice') previewSystemVoice();
  else if (action === 'stop-system-voice') stopSystemVoice();
  else if (actionTarget.closest('[data-provider-id]')) {
    postPlanningProviderAction(action, actionTarget, snapshot.revision, post);
  } else if (actionTarget.closest('[data-agent-id]')) {
    postAgentAction(action, actionTarget, snapshot.revision, post);
  } else if (actionTarget.closest('[data-custom-command-id]')) {
    postCustomCommandAction(action, actionTarget, snapshot.revision, post, (id) => {
      pendingCustomCommandDetails = id;
      return nextInteractionSequence();
    });
  }
});

registerControlCenterFormHandlers({ snapshot: () => snapshot, post });

document.addEventListener('DOMContentLoaded', () => {
  systemSpeech.refreshVoices();
  if (typeof window.speechSynthesis !== 'undefined') {
    window.speechSynthesis.addEventListener('voiceschanged', refreshSystemVoices);
  }
  post({ type: 'ready', lastAppliedRevision });
});

window.addEventListener('pagehide', () => {
  if (typeof window.speechSynthesis !== 'undefined') {
    window.speechSynthesis.removeEventListener('voiceschanged', refreshSystemVoices);
  }
  systemSpeech.dispose();
});

function acceptSnapshot(message: Extract<ControlCenterHostMessage, { type: 'stateSnapshot' }>): void {
  if (message.revision <= (lastAppliedRevision ?? -1)) return;
  overlay?.dispose();
  overlay = undefined;
  view.currentShell?.menu.setAttribute('aria-expanded', 'false');
  resources = {};
  currentRows = [];
  hostPreviewActive = false;
  pendingCommandDetails = undefined;
  pendingCustomCommandDetails = undefined;
  if (message.state.route === 'commands' && (message.state.commandPage?.chunkCount ?? 0) > 0) {
    pendingPage = { snapshot: message, chunks: new Map(), invalid: false };
    return;
  }
  pendingPage = undefined;
  applySnapshot(message, []);
}

function acceptCommandChunk(message: Extract<ControlCenterHostMessage, { type: 'commandPageChunk' }>): void {
  const pending = pendingPage;
  const page = pending?.snapshot.state.commandPage;
  if (!pending || !page || pending.invalid || message.revision !== pending.snapshot.revision
    || message.chunkCount !== page.chunkCount || pending.chunks.has(message.chunkIndex)) {
    if (pending) pending.invalid = true;
    return;
  }
  pending.chunks.set(message.chunkIndex, message.rows);
  if (pending.chunks.size !== page.chunkCount) return;
  const rows: ControlCenterCommandRow[] = [];
  for (let index = 1; index <= page.chunkCount; index += 1) {
    const chunk = pending.chunks.get(index);
    if (!chunk) { pending.invalid = true; return; }
    rows.push(...chunk);
  }
  if (rows.length !== page.pageRowCount || new Set(rows.map(({ commandId }) => commandId)).size !== rows.length) {
    pending.invalid = true;
    return;
  }
  pendingPage = undefined;
  applySnapshot(pending.snapshot, rows);
}

function applySnapshot(
  next: Extract<ControlCenterHostMessage, { type: 'stateSnapshot' }>,
  rows: readonly ControlCenterCommandRow[],
): void {
  snapshot = next;
  currentRows = rows;
  const shell = view.render(next, rows, resourcesWithSpeech());
  shell.menu.setAttribute('aria-expanded', 'false');
  overlay = new OverlayController(shell.app, shell.overlayRoot, (reason) => closeOverlay(reason, true));
  focusControlCenterTarget(shell, next.focusTarget);
  lastAppliedRevision = next.revision;
  vscode.setState({ lastAppliedRevision });
  queueMicrotask(() => {
    post({ type: 'ack', revision: next.revision });
    publishVoiceObservation();
  });
}

function acceptResource(
  key: HostResourceKey,
  message: HostResourceMessage,
  preferredFocusId?: string,
): void {
  if (!snapshot || message.revision !== snapshot.revision) return;
  resources = { ...resources, [key]: message } as ControlCenterManagementResources;
  renderCurrent(preferredFocusId);
}

function renderCurrent(preferredFocusId?: string): void {
  if (!snapshot) return;
  const activeOverlay = overlay?.activeKind;
  const bookmark = captureFocusBookmark();
  const shell = view.render(snapshot, currentRows, resourcesWithSpeech());
  if (activeOverlay) return;
  const preferred = preferredFocusId ? document.getElementById(preferredFocusId) : undefined;
  if (preferred instanceof HTMLElement) preferred.focus({ preventScroll: true });
  else if (!restoreFocusBookmark(bookmark)) focusControlCenterTarget(shell, snapshot.focusTarget);
}

function resourcesWithSpeech(): ControlCenterManagementResources {
  const local = systemSpeech.presentation();
  // Soniox voices arrive as bare ids and are expanded here exactly as the host expands
  // them, so both sides index one identical list.
  const hostVoices = [
    ...resources.setup?.hostVoices ?? [],
    ...sonioxSystemVoices(resources.setup?.sonioxVoices ?? [], snapshot?.state.language),
  ];
  // The host appends its own voices to the observed ones and indexes the merged list,
  // so the dropdown must render exactly that list for a voice index to mean one voice.
  return {
    ...resources,
    systemSpeech: {
      voices: hostVoices.length === 0 ? local.voices : mergeSystemVoices(local.voices, hostVoices),
      previewState: hostPreviewActive ? 'speaking' : local.previewState,
    },
  };
}

function closeForPendingDecision(
  decision: 'request-native-confirmation' | 'cancel',
): void {
  if (!snapshot) return;
  const revision = snapshot.revision;
  const active = overlay?.activeKind;
  overlay?.closeForNativePrompt();
  view.currentShell?.menu.setAttribute('aria-expanded', 'false');
  pendingCommandDetails = undefined;
  if (active) post({ type: 'closeOverlayIntent', revision, reason: decision === 'cancel' ? 'cancel' : 'save' });
  post({ type: 'pendingReviewIntent', revision, decision });
}

function cancelCustomCommandEdit(): void {
  pendingCustomCommandDetails = undefined;
  const remaining = { ...resources };
  delete remaining.customCommandDetails;
  resources = remaining;
  renderCurrent('custom-management-heading');
}

function previewSystemVoice(): void {
  if (!snapshot) return;
  const voice = document.querySelector<HTMLSelectElement>('#system-tts-voice');
  const rate = document.querySelector<HTMLInputElement>('#system-tts-rate');
  const voiceIndex = Number(voice?.value ?? -1);
  const selected = resourcesWithSpeech().systemSpeech?.voices[voiceIndex];
  // A host-channel voice cannot be played by this browser: the host previews it for us.
  if (selected && isHostChannelVoice(selected.voiceUri)) {
    hostPreviewActive = true;
    post({ type: 'systemTtsIntent', revision: snapshot.revision, operation: 'preview' });
    renderCurrent();
    return;
  }
  systemSpeech.preview(
    CONTROL_CENTER_STRINGS[snapshot.state.language].systemVoicePreviewText,
    voiceIndex,
    Number(rate?.value ?? 1),
    snapshot.state.language,
  );
}

function stopSystemVoice(): void {
  systemSpeech.stop();
  if (!hostPreviewActive || !snapshot) return;
  hostPreviewActive = false;
  post({ type: 'systemTtsIntent', revision: snapshot.revision, operation: 'preview-stop' });
  renderCurrent();
}

function refreshSystemVoices(): void {
  systemSpeech.refreshVoices();
  publishVoiceObservation();
}

function publishVoiceObservation(): void {
  if (!snapshot) return;
  const voices = systemSpeech.presentation().voices.map((voice) => ({ ...voice }));
  const key = `${snapshot.revision}:${JSON.stringify(voices)}`;
  if (key === lastVoiceObservationKey) return;
  lastVoiceObservationKey = key;
  post({ type: 'systemTtsVoicesObservedIntent', revision: snapshot.revision, voices });
}

function postProviderSetup(
  provider: 'none' | 'soniox',
  request: 'select' | 'configure-secret' | 'request-remote-consent' | 'test' | 'revoke',
): void {
  if (snapshot) post({ type: 'providerSetupIntent', revision: snapshot.revision, provider, request });
}

function postMicrophoneSetup(operation: 'select-device' | 'test-signal' | 'stop-test'): void {
  if (snapshot) post({ type: 'microphoneSetupIntent', revision: snapshot.revision, operation });
}

function postDiagnostics(operation: 'run' | 'open' | 'copy'): void {
  if (snapshot) post({
    type: 'diagnosticsIntent', revision: snapshot.revision,
    operation, requestSequence: nextInteractionSequence(),
  });
}

function postFilter(filter: string): void {
  if (snapshot) post({ type: 'setFilterIntent', revision: snapshot.revision, filter });
}

function nextInteractionSequence(): number {
  interactionSequence = interactionSequence >= Number.MAX_SAFE_INTEGER ? 1 : interactionSequence + 1;
  return interactionSequence;
}

function closeOverlay(reason: 'close' | 'escape' | 'cancel' | 'save', returnFocus: boolean): void {
  if (snapshot && overlay?.activeKind) {
    post({ type: 'closeOverlayIntent', revision: snapshot.revision, reason });
  }
  overlay?.close(returnFocus);
  view.currentShell?.menu.setAttribute('aria-expanded', 'false');
  pendingCommandDetails = undefined;
}

function updateStatus(message: Extract<ControlCenterHostMessage, { type: 'statusUpdate' }>): void {
  if (!snapshot || message.revision !== snapshot.revision || !view.currentShell) return;
  const region = {
    progress: view.currentShell.progress,
    success: view.currentShell.success,
    error: view.currentShell.error,
  }[message.channel];
  region.textContent = message.message;
}

function updateTranscript(message: Extract<ControlCenterHostMessage, { type: 'transcriptUpdate' }>): void {
  if (!snapshot || message.revision !== snapshot.revision) return;
  const prior = transcriptSequences.get(message.operationId) ?? -1;
  if (message.sequence <= prior) return;
  transcriptSequences.set(message.operationId, message.sequence);
  if (message.kind === 'partial' && !snapshot.capabilities.streamingPartials) return;
  const target = document.getElementById(message.kind === 'partial' ? 'partial-transcript' : 'final-transcript');
  if (target) target.textContent = message.text;
}

function post(message: ControlCenterBrowserMessage): void { vscode.postMessage(message); }

function restoredRevision(value: unknown): number | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 1 && isControlCenterRevision(record.lastAppliedRevision)
    ? record.lastAppliedRevision
    : null;
}
