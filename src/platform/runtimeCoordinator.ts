import * as vscode from 'vscode';

import { AgentRegistry, MappingApprovalStore } from '../agents';
import { ConsentService, CredentialService } from '../config';
import { AssistantFeature } from '../features/assistant';
import {
  CredentialChangeAuthorityGate,
  CredentialCommandController,
  HostRuntimeLifecycle,
  MicMessageRouter,
  registerVoiceInputCommands,
} from '../features/commands';
import { ControlCenterController } from '../features/controlCenter/controller';
import { registerControlCenterSurface } from '../features/controlCenter/registration';
import { DiagnosticsService } from '../features/diagnostics';
import { MappingFeature } from '../features/mappings';
import {
  AudioDeviceService,
  PushToTalkController,
  TranscriptionMetadataService,
} from '../features/recording';
import { HostStatePublisher } from '../features/state';
import { SettingsFeature, registerSettingsSurface } from '../features/settings';
import { HistoryStore } from '../history';
import { injectText } from '../inject';
import { log, show as showLog } from '../log';
import {
  ConnectionTestService,
  createPlannerConnectionProbes,
  createSonioxConnectionProbe,
} from '../providers';
import { listAudioDevices, startPcmStream, startRecorder } from '../recorder/native';
import { MicViewProvider } from '../webview/micView';
import { SettingsViewProvider } from '../webview/settingsView';
import { VsCodeAssistantActionHost } from './assistantActionHost';
import { VsCodeAssistantSessionUi } from './assistantSessionUi';
import { voiceConfirmationArmed } from './builtinConfirmationGate';
import { BuiltinVoiceCoordinator } from './builtinVoiceCoordinator';
import {
  VsCodeControlCenterPanelFactory,
  VsCodeControlCenterPersistence,
  VsCodeControlCenterRegistrationHost,
} from './controlCenterPanel';
import { ControlCenterManagementBridge } from './controlCenterManagement';
import { ControlCenterOperations } from './controlCenterOperations';
import { controlCenterOperationsPort } from './controlCenterOperationsPort';
import { ControlCenterSetupChoices } from './controlCenterSetupChoices';
import { ControlCenterStateCoordinator } from './controlCenterStateCoordinator';
import { VsCodeCredentialCommandUi } from './credentialCommandUi';
import { detectToggleRecordingKeybinding } from './keybinding';
import { autoDispatchTargetFingerprint, promptTargetFingerprint } from './promptBinding';
import { VsCodeMappingAgentToolHost } from './vscodeMappingAgentToolHost';
import { VsCodeMappingExecutionHost } from './vscodeMappingExecutionHost';
import { VsCodeMappingManagementHost } from './vscodeMappingManagementHost';
import { VsCodeMicMessageUi } from './micMessageUi';
import { VsCodeRecordingUi } from './recordingUi';
import { VsCodeSettingsNativeUi } from './settingsNativeUi';
import { VsCodeSettingsRegistrationHost } from './settingsRegistrationHost';
import { VoiceInputStatusBar } from './statusBar';
import { createSpeechOutputWiring } from './speechOutputWiring';
import { VsCodeTargetContext } from './targetContext';
import { VoiceAuthorityCoordinator } from './voiceAuthorityCoordinator';
import { VsCodeCommandRegistrationHost, VsCodeCommandWorkflows } from './voiceInputCommands';
import { createSettingsRepository } from './vscodeConfiguration';
import { VsCodeWebviewReadinessObservation } from './webviewReadiness';
import { registerVsCodeHostLifecycle } from './hostLifecycle';

const DISABLE_AUTO_COMMAND = 'voiceInput.disableAutoMode';

/** Composition root kept outside extension.ts so the host entrypoint stays auditable. */
export async function activateVoiceInput(context: vscode.ExtensionContext): Promise<void> {
  log('activate v', context.extension.packageJSON.version);
  const legacyGlobalStateKeys = Object.freeze([...context.globalState.keys()]);
  const history = new HistoryStore(context.globalState);
  const settings = createSettingsRepository();
  try { await settings.migrateLegacyDeepSeekProvider(); } catch {
    log('legacy provider migration failed safely: settings unavailable');
  }
  const credentials = new CredentialService(context.secrets);
  const consents = new ConsentService(context.globalState);
  const agents = new AgentRegistry(context.globalState, { legacySettings: () => settings.read().values });
  try { await agents.initialize(); } catch { log('agent registry migration failed safely'); }
  const readSettings = () => settings.read().values;
  const localize = (english: string, hebrew: string) => (
    readSettings().uiLanguage === 'he' ? hebrew : english
  );

  let deactivating = false;
  const assistantRef: { current?: AssistantFeature } = {};
  const stateRef: { current?: HostStatePublisher } = {};
  const settingsFeatureRef: { current?: SettingsFeature } = {};
  const controlRef: { current?: ControlCenterController } = {};
  const controlStateRef: { current?: ControlCenterStateCoordinator } = {};
  const managementRef: { current?: ControlCenterManagementBridge } = {};
  const controlOperationsRef: { current?: ControlCenterOperations } = {};
  const statusRef: { current?: VoiceInputStatusBar } = {};
  const recordingRef: { current?: PushToTalkController } = {};
  const credentialRef: { current?: CredentialCommandController } = {};
  const connectionRef: { current?: ConnectionTestService } = {};
  const mappingsRef: { current?: MappingFeature } = {};
  const publishMic = () => stateRef.current?.pushFull() ?? Promise.resolve();
  const publishSettings = () => settingsFeatureRef.current?.refresh() ?? Promise.resolve();
  const publishCompact = async () => {
    const source = controlStateRef.current;
    if (source) micProvider.postCompactState(await source.readCompactState());
  };
  const publishFull = async () => {
    await Promise.all([
      publishMic(), publishSettings(), publishCompact(),
    ]);
    // A mutation can be running inside ControlCenterController's serialized
    // message handler. Queue its panel refresh without awaiting the same
    // serial tail, while still awaiting every independent projection above.
    void controlRef.current?.refresh();
  };
  const publishHistory = () => stateRef.current?.pushHistory() ?? Promise.resolve();

  const target = new VsCodeTargetContext();
  const authority = new VoiceAuthorityCoordinator({
    context,
    settings,
    credentials,
    legacyGlobalStateKeys,
    target,
    panelGeneration: () => controlRef.current?.generation ?? 0,
    localize,
    publish: publishFull,
    onAutoEffective: (effective) => statusRef.current?.setAutoModeEffective(effective),
    log,
  });
  const builtins = new BuiltinVoiceCoordinator({
    storage: context.globalState,
    authority: authority.autoAuthority,
    localize,
    speak: (message) => assistantRef.current?.speak(message),
    publish: publishFull,
    panelGeneration: () => controlRef.current?.generation ?? 0,
  });
  const mappingApprovals = new MappingApprovalStore(
    context.globalState,
    (mappingId) => mappingsRef.current?.resolveMapping(mappingId),
    { isWorkspaceTrusted: () => vscode.workspace.isTrusted },
  );
  const mappings = new MappingFeature({
    storage: context.globalState,
    executionHost: new VsCodeMappingExecutionHost(
      authority.autoAuthority,
      () => autoDispatchTargetFingerprint(target.capture()),
    ),
    managementHost: new VsCodeMappingManagementHost(),
    agentToolHost: new VsCodeMappingAgentToolHost(),
    localize,
    isWorkspaceTrusted: () => vscode.workspace.isTrusted,
    approvals: mappingApprovals,
    captureTarget: () => target.capture(),
    clearPendingSend: () => assistantRef.current?.clearPendingSend(false),
    speak: (message) => assistantRef.current?.speak(message),
    publish: publishFull,
    builtins,
    autoMode: authority.autoAuthority,
    targetFingerprint: autoDispatchTargetFingerprint, // must match the execution host above
  });
  mappingsRef.current = mappings;
  const setupChoices = new ControlCenterSetupChoices(context.globalState);

  const controlState = new ControlCenterStateCoordinator({
    settings,
    credentials,
    consents,
    sonioxConsent: authority.sonioxConsent,
    autoMode: authority.autoAuthority, setupChoices,
    builtins,
    mappings,
    agents,
    devices: deviceProxy(),
    latestTranscript: async () => (await history.list(readSettings().historyTtlDays))[0]?.text,
    enableAuto: () => authority.enableAuto(),
    disableAuto: () => authority.disableAuto(),
    setupSoniox: (request) => setupSoniox(request),
    selectNoProvider: () => authority.selectProvider('none'),
    microphone: (action) => microphone(action),
    confirmPending: (kind) => confirmPending(kind),
    cancelPending: () => mappings.cancel(true),
    planningProvider: (message): Promise<void> => (
      managementRef.current?.planningProvider(message) ?? Promise.resolve()
    ),
    agentManagement: (message): Promise<void> => (
      managementRef.current?.agentManagement(message) ?? Promise.resolve()
    ),
    operations: controlCenterOperationsPort(controlOperationsRef),
    publish: publishFull,
    log,
  });
  controlStateRef.current = controlState;
  const control = new ControlCenterController({
    factory: new VsCodeControlCenterPanelFactory(context.extensionUri),
    persistence: new VsCodeControlCenterPersistence(context.globalState),
    source: controlState,
  });
  controlRef.current = control;
  const launcher = {
    open: (route: 'home' | 'voice' | 'commands') => control.createOrShow(route),
    openPendingReview: () => {
      const commandId = mappings.pendingBuiltin?.commandId;
      return control.createOrShow('commands', commandId ? { commandId } : undefined);
    },
    disableAuto: () => authority.disableAuto(),
  };
  const micProvider = new MicViewProvider(context.extensionUri, launcher);
  const settingsProvider = new SettingsViewProvider(context.extensionUri, {
    open: (route) => control.createOrShow(route),
  });
  const management = new ControlCenterManagementBridge(
    settingsProvider,
    () => settingsFeatureRef.current,
  );
  managementRef.current = management;
  const readiness = new VsCodeWebviewReadinessObservation();

  const metadata = new TranscriptionMetadataService(
    credentials,
    { postMeta: (models, languages, loading, error) => {
      micProvider.postMeta(models, languages, loading, error);
      void publishSettings();
    } },
    log,
    {
      selected: () => readSettings().transcriptionProvider === 'soniox',
      capture: () => authority.sonioxConsent.capture(),
      revalidate: (receipt) => authority.sonioxConsent.revalidate(receipt),
    },
  );
  const status = new VoiceInputStatusBar(
    micProvider,
    () => assistantRef.current?.isActive ?? false,
    localize,
    { disableCommandId: DISABLE_AUTO_COMMAND },
  );
  statusRef.current = status;
  const devices = new AudioDeviceService({ settings, enumerate: listAudioDevices });
  const recording = new PushToTalkController({
    devices,
    transcriptions: authority.transcriptions,
    settings,
    history,
    status,
    ui: new VsCodeRecordingUi(),
    publishHistory,
    stopAssistant: () => assistantRef.current?.stop() ?? Promise.resolve(),
    isAssistantActive: () => assistantRef.current?.isActive ?? false,
    isDeactivating: () => deactivating,
    localize,
    startRecorder,
    injectText,
  });
  recordingRef.current = recording;
  // VS Code's Electron webview reports no speechSynthesis voices on some Linux builds, so
  // the host keeps a probed speech-dispatcher fallback plus the consent-gated Soniox path.
  const speechOutput = createSpeechOutputWiring({
    browser: micProvider, settings, credentials, localize, log,
    authority: authority.sonioxConsent,
    publish: () => { void publishFull(); },
    onFinished: (id, outcome) => assistantRef.current?.speechFinished(id, outcome),
  });
  const assistant = new AssistantFeature({
    settings, credentials, consents, agents, mappingApprovals,
    isWorkspaceTrusted: () => vscode.workspace.isTrusted,
    devices,
    recording,
    transcriptions: authority.transcriptions,
    mappings,
    target,
    actionHost: new VsCodeAssistantActionHost(target, localize),
    speech: speechOutput.delivery,
    feedbackStatus: status,
    sessionStatus: status,
    sessionUi: new VsCodeAssistantSessionUi(localize),
    startPcmStream,
    publish: publishFull,
    isDeactivating: () => deactivating,
    localize,
    log,
    speechProviders: authority.speechProviders,
    autoMode: authority.autoAuthority,
    onTranscript: (event) => {
      const transcript = controlState.acceptTranscript(event);
      void control.postTranscript(transcript);
      void publishCompact();
    },
  });
  assistantRef.current = assistant;

  const state = new HostStatePublisher({
    settings, credentials, consents, history, recording, devices, metadata,
    assistant, mappings, view: micProvider,
    keybinding: () => detectToggleRecordingKeybinding(context.extension.packageJSON),
  });
  stateRef.current = state;
  const connectionTests = new ConnectionTestService({
    credentials,
    consent: consents,
    probes: { soniox: createSonioxConnectionProbe(), ...createPlannerConnectionProbes() },
    settings,
    sonioxAuthority: authority.sonioxConsent,
  });
  connectionRef.current = connectionTests;
  const credentialGate = new CredentialChangeAuthorityGate(
    () => assistant.beginIntelligenceChange(),
    (token) => assistant.finishIntelligenceChange(token),
  );
  const credentialCommands = new CredentialCommandController({
    credentials,
    consents,
    ui: new VsCodeCredentialCommandUi(localize),
    profile: (provider) => readSettings().providerProfiles[provider],
    clearDeepSeekError: () => assistant.clearProviderError(),
    clearProviderError: () => assistant.clearProviderError(),
    beginCredentialChange: (provider) => {
      connectionTests.cancel(provider);
      if (provider === 'soniox') {
        void assistant.stop(assistant.isActive ? localize(
          'Voice Input assistant stopped because its Soniox credential is changing.',
          'Voice Input: העוזר הופסק מפני שפרטי האימות של Soniox משתנים.',
        ) : undefined);
        return undefined;
      }
      return credentialGate.acquire();
    },
    publish: publishFull,
    executeCommand: (commandId) => vscode.commands.executeCommand(commandId),
    localize,
  });
  credentialRef.current = credentialCommands;
  const diagnostics = new DiagnosticsService({
    version: context.extension.packageJSON.version,
    devices,
    credentials,
    isWorkspaceTrusted: () => vscode.workspace.isTrusted,
    log,
    showLog,
  });
  const settingsFeature = new SettingsFeature({
    settings, credentials, consents, assistant, agents, devices, metadata,
    transcriptions: authority.transcriptions, mappings,
    credentialOperations: credentialCommands,
    connectionTests,
    diagnostics,
    view: management.view,
    nativeUi: new VsCodeSettingsNativeUi(context.extension.id, localize),
    shortcut: () => detectToggleRecordingKeybinding(context.extension.packageJSON),
    extensionVersion: context.extension.packageJSON.version,
    isWorkspaceTrusted: () => vscode.workspace.isTrusted,
    publishMic,
    startPcmStream,
  });
  settingsFeatureRef.current = settingsFeature;
  const router = new MicMessageRouter({
    settings, consents, history, recording, devices, metadata, assistant, mappings,
    state: { pushFull: publishFull, pushHistory: () => state.pushHistory() },
    ui: new VsCodeMicMessageUi(localize),
    openSettingsCenter: () => control.createOrShow('home'),
  });
  const runtime = new HostRuntimeLifecycle({
    metadata, devices, credentials: credentialCommands, state, settings: settingsFeature,
    credentialStore: credentials,
    recording, assistant, mappings, transcriptions: authority.transcriptions,
    startupResume: {
      settings, consents, credentials, devices,
      workspaceTrusted: () => vscode.workspace.isTrusted,
      start: () => assistant.start({ allowPrompts: false }),
    },
    setDeactivating: () => { deactivating = true; },
    log,
  });
  const workflows = new VsCodeCommandWorkflows({
    settings, devices, history, state, localize,
    configureProvider: (provider) => credentialCommands.configureProvider(provider),
    testProvider: (provider, signal) => credentialCommands.isChanging(provider)
      ? Promise.resolve({ provider, category: 'cancelled' })
      : connectionTests.test(provider, signal),
  });
  const controlOperations = new ControlCenterOperations({
    settings, setupChoices,
    hostSpeech: speechOutput.host, sonioxTts: speechOutput.soniox,
    devices,
    diagnostics,
    selectAudioDevice: () => workflows.selectAudioDevice(),
    startPcmStream,
    publish: publishFull,
    localize,
    copyText: (text) => vscode.env.clipboard.writeText(text),
  });
  controlOperationsRef.current = controlOperations;

  micProvider.onMessage((message) => {
    if (message.type === 'ready') readiness.mark('microphone');
    void router.route(message);
  });
  settingsProvider.onMessage((message) => {
    if (message.type === 'settings-ready') readiness.mark('settings');
    void settingsFeature.route(message);
  });
  context.subscriptions.push(
    readiness,
    status,
    control,
    controlOperations, speechOutput,
    authority,
    vscode.window.registerWebviewViewProvider(MicViewProvider.viewType, micProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    ...registerControlCenterSurface(new VsCodeControlCenterRegistrationHost(), control),
    ...registerSettingsSurface(new VsCodeSettingsRegistrationHost(), settingsProvider),
    ...mappings.registerAgentTools(),
    ...registerVsCodeHostLifecycle({ target, assistant, mappings, state, settings: settingsFeature }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('voiceInput')) authority.configurationChanged();
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => authority.workspaceContextChanged()),
    vscode.commands.registerCommand(DISABLE_AUTO_COMMAND, () => authority.disableAuto()),
    ...registerVoiceInputCommands(new VsCodeCommandRegistrationHost(), {
      recording, assistant, mappings, credentials: credentialCommands,
      selectAudioDevice: () => workflows.selectAudioDevice(),
      clearHistory: () => workflows.clearHistory(),
      manageAssistantProvider: () => workflows.manageAssistantProvider(),
      testAssistantProvider: () => workflows.testAssistantProvider(),
      diagnostics,
    }),
    { dispose: () => connectionTests.dispose() },
    runtime,
  );
  await authority.initialize();
  await runtime.start();

  function deviceProxy() {
    return {
      get hasCachedResult() { return devices?.hasCachedResult ?? false; },
      get cachedDevices() { return devices?.cachedDevices ?? []; },
      get selectionStatus() { return devices?.selectionStatus; },
    };
  }

  async function setupSoniox(
    request: 'select' | 'configure-secret' | 'request-remote-consent' | 'test' | 'revoke',
  ): Promise<void> {
    if (request === 'revoke') return authority.revokeSonioxConsent();
    if (request === 'test') {
      const result = await connectionRef.current?.test('soniox');
      await vscode.window.showInformationMessage(localize(
        `Voice Input: Soniox test ${result?.category ?? 'unavailable'}.`,
        `Voice Input: בדיקת Soniox הסתיימה במצב ${result?.category ?? 'unavailable'}.`,
      ));
      return;
    }
    if (request === 'select') await authority.selectProvider('soniox');
    if (request === 'select' || request === 'configure-secret') {
      await credentialRef.current?.setSoniox();
    }
    if ((await credentials.status('soniox')).configured) {
      await authority.requestSonioxConsent();
    }
  }

  async function microphone(action: 'start' | 'stop' | 'test'): Promise<void> {
    const recording = recordingRef.current;
    if (!recording) return;
    if (action === 'stop' || recording.isRecording) await recording.stop();
    else await recording.start();
    await publishFull();
  }

  async function confirmPending(kind: 'builtin' | 'custom'): Promise<void> {
    if (kind === 'builtin') return mappings.confirmPendingBuiltin();
    const pending = mappings.pendingAction;
    if (!pending) return;
    // The native confirmation is itself the authorizing gesture, so it may be raised while
    // VS Code is unfocused: background listening exists exactly for that case.
    if (!vscode.workspace.isTrusted) return;
    const panelGeneration = control.generation;
    const requestedTarget = promptTargetFingerprint(target.capture());
    const confirm = localize('Run action', 'הפעלת פעולה');
    const openedAt = Date.now();
    const selected = await vscode.window.showWarningMessage(
      localize(
        `Run “${pending.label}” in the current VS Code target?`,
        `להפעיל את „${pending.label}” ביעד הנוכחי של VS Code?`,
      ),
      { modal: true },
      confirm,
    );
    // Focus is not re-checked after the modal (it blurs its own window); an accept faster than the arming delay is a stray keystroke.
    if (selected === confirm
      && voiceConfirmationArmed(Date.now() - openedAt)
      && vscode.workspace.isTrusted
      && panelGeneration === control.generation
      && requestedTarget === promptTargetFingerprint(target.capture())
      && mappings.pendingAction?.id === pending.id) {
      await mappings.confirmIfPending(pending.id, assistant.nextId('control-center-confirm'));
    }
  }
}
