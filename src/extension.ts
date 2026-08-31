import * as vscode from 'vscode';
import { AgentRegistry, MappingApprovalStore } from './agents';
import { ConsentService, CredentialService } from './config';
import { AssistantFeature } from './features/assistant';
import { CredentialChangeAuthorityGate, CredentialCommandController, HostRuntimeLifecycle, MicMessageRouter, registerVoiceInputCommands } from './features/commands';
import { DiagnosticsService } from './features/diagnostics';
import { MappingFeature } from './features/mappings';
import { AudioDeviceService, PushToTalkController, TranscriptionMetadataService, TranscriptionService } from './features/recording';
import { HostStatePublisher } from './features/state';
import { SettingsFeature, registerSettingsSurface } from './features/settings';
import { HistoryStore } from './history';
import { injectText } from './inject';
import { log, show as showLog } from './log';
import {
  VsCodeAssistantActionHost, VsCodeAssistantSessionUi, VsCodeCommandRegistrationHost,
  VsCodeCommandWorkflows, VsCodeCredentialCommandUi, VsCodeMappingAgentToolHost,
  VsCodeMappingExecutionHost, VsCodeMappingManagementHost, VsCodeMicMessageUi,
  VsCodeRecordingUi, VsCodeSettingsNativeUi, VsCodeSettingsRegistrationHost,
  VsCodeTargetContext, VsCodeWebviewReadinessObservation, VoiceInputStatusBar, createSettingsRepository,
  detectToggleRecordingKeybinding, registerVsCodeHostLifecycle,
} from './platform';
import { ConnectionTestService, createPlannerConnectionProbes, createSonioxConnectionProbe } from './providers';
import { listAudioDevices, startPcmStream, startRecorder } from './recorder/native';
import { MicViewProvider } from './webview/micView';
import { SettingsViewProvider } from './webview/settingsView';
/** Composition root: constructs host services, connects ports and registers lifecycle ownership. */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  log('activate v', context.extension.packageJSON.version);
  const provider = new MicViewProvider(context.extensionUri);
  const settingsProvider = new SettingsViewProvider(context.extensionUri);
  const runtimeWebviewReadiness = new VsCodeWebviewReadinessObservation();
  context.subscriptions.push(runtimeWebviewReadiness);
  const history = new HistoryStore(context.globalState);
  const settings = createSettingsRepository();
  try {
    await settings.migrateLegacyDeepSeekProvider();
  } catch {
    log('legacy provider migration failed safely: settings unavailable');
  }
  const credentials = new CredentialService(context.secrets);
  const consents = new ConsentService(context.globalState);
  const agents = new AgentRegistry(context.globalState, {
    legacySettings: () => settings.read().values,
  });
  try {
    await agents.initialize();
  } catch {
    log('agent registry migration failed safely: storage unavailable');
  }
  const readSettings = () => settings.read().values;
  const localize = (english: string, hebrew: string) => (
    readSettings().uiLanguage === 'he' ? hebrew : english
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(MicViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );
  let deactivating = false;
  const assistantRef: { current?: AssistantFeature } = {};
  const stateRef: { current?: HostStatePublisher } = {};
  const settingsFeatureRef: { current?: SettingsFeature } = {};
  const publishMic = () => stateRef.current?.pushFull() ?? Promise.resolve();
  const publishSettings = () => settingsFeatureRef.current?.refresh() ?? Promise.resolve();
  const publishFull = () => Promise.all([publishMic(), publishSettings()]).then(() => undefined);
  const publishHistory = () => stateRef.current?.pushHistory() ?? Promise.resolve();

  const metadata = new TranscriptionMetadataService(
    credentials,
    {
      postMeta: (models, languages, loading, error) => {
        provider.postMeta(models, languages, loading, error);
        void publishSettings();
      },
    },
    (message) => log(message),
  );
  const status = new VoiceInputStatusBar(
    provider,
    () => assistantRef.current?.isActive ?? false,
    localize,
  );
  const target = new VsCodeTargetContext();
  const mappingsRef: { current?: MappingFeature } = {};
  const mappingApprovals = new MappingApprovalStore(
    context.globalState,
    (mappingId) => mappingsRef.current?.resolveMapping(mappingId),
    { isWorkspaceTrusted: () => vscode.workspace.isTrusted },
  );
  const mappings = new MappingFeature({
    storage: context.globalState,
    executionHost: new VsCodeMappingExecutionHost(),
    managementHost: new VsCodeMappingManagementHost(),
    agentToolHost: new VsCodeMappingAgentToolHost(),
    localize,
    isWorkspaceTrusted: () => vscode.workspace.isTrusted,
    approvals: mappingApprovals,
    captureTarget: () => target.capture(),
    clearPendingSend: () => assistantRef.current?.clearPendingSend(false),
    speak: (message) => assistantRef.current?.speak(message),
    publish: publishFull,
  });
  mappingsRef.current = mappings;
  const devices = new AudioDeviceService({ settings, enumerate: listAudioDevices });
  const transcriptions = new TranscriptionService({ credentials, settings });
  const recording = new PushToTalkController({
    devices,
    transcriptions,
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
  const assistant = new AssistantFeature({
    settings,
    credentials,
    consents,
    agents,
    mappingApprovals,
    isWorkspaceTrusted: () => vscode.workspace.isTrusted,
    devices,
    recording,
    transcriptions,
    mappings,
    target,
    actionHost: new VsCodeAssistantActionHost(target, localize),
    speech: provider,
    feedbackStatus: status,
    sessionStatus: status,
    sessionUi: new VsCodeAssistantSessionUi(localize),
    startPcmStream,
    publish: publishFull,
    isDeactivating: () => deactivating,
    localize,
    log,
  });
  assistantRef.current = assistant;

  const state = new HostStatePublisher({
    settings,
    credentials,
    consents,
    history,
    recording,
    devices,
    metadata,
    assistant,
    mappings,
    view: provider,
    keybinding: () => detectToggleRecordingKeybinding(context.extension.packageJSON),
  });
  stateRef.current = state;

  const connectionTests = new ConnectionTestService({
    credentials,
    consent: consents,
    probes: { soniox: createSonioxConnectionProbe(), ...createPlannerConnectionProbes() },
    settings,
  });
  const credentialPlanningGate = new CredentialChangeAuthorityGate(
    () => assistant.beginIntelligenceChange(), (token) => assistant.finishIntelligenceChange(token),
  );
  const credentialCommands = new CredentialCommandController({
    credentials,
    consents,
    ui: new VsCodeCredentialCommandUi(localize),
    profile: (plannerProvider) => readSettings().providerProfiles[plannerProvider],
    clearDeepSeekError: () => assistant.clearProviderError(),
    clearProviderError: () => assistant.clearProviderError(),
    beginCredentialChange: (plannerProvider) => {
      connectionTests.cancel(plannerProvider);
      if (plannerProvider === 'soniox') {
        void assistant.stop(assistant.isActive ? localize(
          'Voice Input assistant stopped because its Soniox credential is changing.',
          'Voice Input: העוזר הופסק מפני שפרטי האימות של Soniox משתנים.',
        ) : undefined);
        return undefined;
      }
      return credentialPlanningGate.acquire();
    },
    publish: publishFull,
    executeCommand: (commandId) => vscode.commands.executeCommand(commandId),
    localize,
  });
  const diagnostics = new DiagnosticsService({
    version: context.extension.packageJSON.version,
    devices,
    credentials,
    isWorkspaceTrusted: () => vscode.workspace.isTrusted,
    log,
    showLog,
  });
  const settingsFeature = new SettingsFeature({
    settings,
    credentials,
    consents,
    assistant,
    agents,
    devices,
    metadata,
    transcriptions,
    mappings,
    credentialOperations: credentialCommands,
    connectionTests,
    diagnostics,
    view: settingsProvider,
    nativeUi: new VsCodeSettingsNativeUi(context.extension.id, localize),
    shortcut: () => detectToggleRecordingKeybinding(context.extension.packageJSON),
    extensionVersion: context.extension.packageJSON.version,
    isWorkspaceTrusted: () => vscode.workspace.isTrusted,
    publishMic,
    startPcmStream,
  });
  settingsFeatureRef.current = settingsFeature;
  const messageRouter = new MicMessageRouter({
    settings,
    consents,
    history,
    recording,
    devices,
    metadata,
    assistant,
    mappings,
    state: {
      pushFull: publishFull,
      pushHistory: () => state.pushHistory(),
    },
    ui: new VsCodeMicMessageUi(localize),
    openSettingsCenter: () => settingsProvider.reveal('general'),
  });
  const runtime = new HostRuntimeLifecycle({
    metadata,
    devices,
    credentials: credentialCommands,
    state,
    settings: settingsFeature,
    recording,
    assistant,
    mappings,
    transcriptions,
    startupResume: {
      settings, consents, credentials, devices,
      workspaceTrusted: () => vscode.workspace.isTrusted,
      start: () => assistant.start({ allowPrompts: false }),
    },
    setDeactivating: () => { deactivating = true; },
    log,
  });
  const commandWorkflows = new VsCodeCommandWorkflows({
    settings,
    devices,
    history,
    state,
    localize,
    configureProvider: (plannerProvider) => credentialCommands.configureProvider(plannerProvider),
    testProvider: (plannerProvider, signal) => credentialCommands.isChanging(plannerProvider)
      ? Promise.resolve({ provider: plannerProvider, category: 'cancelled' })
      : connectionTests.test(plannerProvider, signal),
  });

  provider.onMessage((message) => { if (message.type === 'ready') runtimeWebviewReadiness.mark('microphone'); void messageRouter.route(message); });
  settingsProvider.onMessage((message) => { if (message.type === 'settings-ready') runtimeWebviewReadiness.mark('settings'); void settingsFeature.route(message); });
  context.subscriptions.push(
    status,
    ...registerSettingsSurface(new VsCodeSettingsRegistrationHost(), settingsProvider),
    ...mappings.registerAgentTools(),
    ...registerVsCodeHostLifecycle({ target, assistant, mappings, state, settings: settingsFeature }),
    ...registerVoiceInputCommands(new VsCodeCommandRegistrationHost(), {
      recording,
      assistant,
      mappings,
      credentials: credentialCommands,
      selectAudioDevice: () => commandWorkflows.selectAudioDevice(),
      clearHistory: () => commandWorkflows.clearHistory(),
      manageAssistantProvider: () => commandWorkflows.manageAssistantProvider(),
      testAssistantProvider: () => commandWorkflows.testAssistantProvider(),
      diagnostics: {
        run: async () => {
          const result = await diagnostics.run();
          await publishSettings();
          return result;
        },
      },
    }),
    { dispose: () => connectionTests.dispose() },
    runtime,
  );

  await runtime.start();
}
export function deactivate(): void {}
