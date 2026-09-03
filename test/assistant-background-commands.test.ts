import assert from 'node:assert/strict';
import test from 'node:test';

import { SETTINGS_DEFAULTS, type VoiceInputSettings } from '../src/config';
import type { AssistantIntent } from '../src/assistant';
import type { TargetSnapshot } from '../src/assistant/context';
import type { AssistantPlan } from '../src/inference';
import type { AssistantActionController } from '../src/features/assistant/actionController';
import type { AssistantFeedbackController } from '../src/features/assistant/feedbackController';
import type { AssistantIdSequence } from '../src/features/assistant/idSequence';
import type { AssistantPlanningService } from '../src/features/assistant/planningService';
import { offerAssistantResumeOnStartup } from '../src/features/assistant/resumeSuggestion';
import { AssistantSessionController } from '../src/features/assistant/sessionController';
import type { AssistantResumeSuggestionChoice } from '../src/features/assistant/sessionContracts';
import { HostRuntimeLifecycle } from '../src/features/commands/runtimeLifecycle';
import type { PushToTalkController, TranscriptionService } from '../src/features/recording';
import {
  AssistantFinalTranscriptProcessor,
  WAKE_ARM_WINDOW_MS,
} from '../src/features/assistant/sessionTranscriptProcessor';
import type { MappingFeature } from '../src/features/mappings';
import {
  VOICE_CONFIRMATION_ARMING_DELAY_MS,
  acceptsBuiltinConfirmation,
  allowsBuiltinConfirmationPrompt,
  voiceConfirmationArmed,
} from '../src/platform/builtinConfirmationGate';

const SNAPSHOT: TargetSnapshot = {
  requestedTarget: 'here',
  resolvedTarget: 'focused-control',
  focusedTarget: 'focused-control',
  vscodeFocused: false,
  activeTabIdentity: 'tab-1',
  activeEditorIdentity: null,
  activeTerminalIdentity: null,
};

interface ProcessorHarness {
  processor: AssistantFinalTranscriptProcessor;
  routed: string[];
  planned: string[];
  executed: AssistantPlan[];
  spoken: string[];
  clock: { now: number };
  process(text: string): Promise<void>;
}

function createProcessor(options: { mappingHandles?: boolean } = {}): ProcessorHarness {
  const clock = { now: 5_000 };
  const routed: string[] = [];
  const planned: string[] = [];
  const executed: AssistantPlan[] = [];
  const spoken: string[] = [];
  const processor = new AssistantFinalTranscriptProcessor({
    settings: { read: () => ({ values: { ...SETTINGS_DEFAULTS }, workspaceOverrides: [] }) },
    mappings: {
      routeVoiceRequest: async (text: string) => {
        routed.push(text);
        return { handled: options.mappingHandles === true, kind: 'mapping' as const };
      },
    } as unknown as MappingFeature,
    planning: {
      deterministic: (postWakeText: string, intent: AssistantIntent): AssistantPlan => ({
        action: intent.kind === 'action' ? intent.action : 'write-here',
        target: 'current',
        content: postWakeText,
        spokenReply: '',
        reason: 'test',
        confidence: 1,
        requiresConfirmation: false,
      }),
      create: async (postWakeText: string, _snapshot, _signal, fallback: AssistantPlan) => {
        planned.push(postWakeText);
        return fallback;
      },
    } as unknown as AssistantPlanningService,
    actions: {
      execute: async (plan: AssistantPlan) => { executed.push(plan); },
    } as unknown as AssistantActionController,
    feedback: { speak: (text: string) => { spoken.push(text); } } as AssistantFeedbackController,
    localize: (english) => english,
    now: () => clock.now,
  });
  let sequence = 0;
  return {
    processor,
    routed,
    planned,
    executed,
    spoken,
    clock,
    process: (text: string) => processor.process(
      text,
      SNAPSHOT,
      `utterance-${++sequence}`,
      new AbortController().signal,
      () => true,
    ),
  };
}

test('a wake phrase spoken alone arms the next utterance and acknowledges out loud', async () => {
  const harness = createProcessor();

  await harness.process('assistant');
  assert.deepEqual(harness.routed, [], 'the wake phrase itself never reaches the matcher');
  assert.deepEqual(harness.planned, []);
  assert.deepEqual(harness.spoken, ['Yes?'], 'arming is acknowledged through the feedback path');
  assert.equal(harness.processor.isWakeArmed, true);

  harness.clock.now += 2_000;
  await harness.process('open terminal');

  assert.deepEqual(harness.routed, ['open terminal'], 'the armed command uses the normal path');
  assert.deepEqual(harness.planned, ['open terminal']);
  assert.deepEqual(harness.executed.map((plan) => plan.action), ['open-terminal']);
  assert.equal(harness.processor.isWakeArmed, false, 'the window is consumed exactly once');

  await harness.process('open chat');
  assert.deepEqual(harness.routed, ['open terminal'], 'a second utterance is no longer authorized');
});

test('the wake-armed window expires, is never opened by ordinary speech, and clears on stop', async () => {
  const expired = createProcessor();
  await expired.process('hey assistant');
  expired.clock.now += WAKE_ARM_WINDOW_MS + 1;
  await expired.process('open terminal');
  assert.deepEqual(expired.routed, [], 'a late utterance is ignored exactly as before');
  assert.deepEqual(expired.executed, []);

  const unarmed = createProcessor();
  await unarmed.process('please delete everything');
  assert.equal(unarmed.processor.isWakeArmed, false, 'ordinary speech never arms the window');
  await unarmed.process('open terminal');
  assert.deepEqual(unarmed.routed, []);
  assert.deepEqual(unarmed.spoken, []);

  const stopped = createProcessor();
  await stopped.process('assistant');
  assert.equal(stopped.processor.isWakeArmed, true);
  stopped.processor.disarmWake();
  await stopped.process('open terminal');
  assert.deepEqual(stopped.routed, [], 'stopping the session disarms the window');
});

test('a wake-armed utterance keeps the wake-prefixed authority and confirmation path', async () => {
  const mapped = createProcessor({ mappingHandles: true });
  await mapped.process('assistant');
  await mapped.process('deploy the site');
  assert.deepEqual(mapped.routed, ['deploy the site'], 'custom mappings still see it first');
  assert.deepEqual(mapped.planned, [], 'a handled mapping still short-circuits planning');
  assert.deepEqual(mapped.executed, []);

  // Wake-prefixed and wake-armed requests produce the same request text and intent.
  const prefixed = createProcessor();
  await prefixed.process('assistant, write hello');
  const armed = createProcessor();
  await armed.process('assistant');
  await armed.process('write hello');
  assert.deepEqual(armed.routed, prefixed.routed);
  assert.deepEqual(
    armed.executed.map((plan) => `${plan.action}:${plan.content}`),
    prefixed.executed.map((plan) => `${plan.action}:${plan.content}`),
  );

  // A wake phrase inside the armed window re-arms rather than being pasted as text.
  const rearmed = createProcessor();
  await rearmed.process('assistant');
  await rearmed.process('assistant');
  assert.deepEqual(rearmed.routed, []);
  assert.deepEqual(rearmed.spoken, ['Yes?', 'Yes?']);
  assert.equal(rearmed.processor.isWakeArmed, true);
});

test('voice confirmations may be raised while VS Code is unfocused but never while untrusted', () => {
  assert.equal(allowsBuiltinConfirmationPrompt({ workspaceTrusted: true }), true);
  assert.equal(allowsBuiltinConfirmationPrompt({ workspaceTrusted: false }), false);

  const armed = VOICE_CONFIRMATION_ARMING_DELAY_MS;
  assert.equal(acceptsBuiltinConfirmation({
    accepted: true,
    elapsedMs: armed,
    workspaceTrusted: true,
    panelGeneration: 4,
    capturedPanelGeneration: 4,
  }), true);
  for (const outcome of [
    { accepted: false, elapsedMs: armed, workspaceTrusted: true, panelGeneration: 4, capturedPanelGeneration: 4 },
    { accepted: true, elapsedMs: armed, workspaceTrusted: false, panelGeneration: 4, capturedPanelGeneration: 4 },
    { accepted: true, elapsedMs: armed, workspaceTrusted: true, panelGeneration: 5, capturedPanelGeneration: 4 },
    // A stray Enter already in flight when the modal steals focus resolves near-instantly.
    { accepted: true, elapsedMs: armed - 1, workspaceTrusted: true, panelGeneration: 4, capturedPanelGeneration: 4 },
  ]) {
    assert.equal(acceptsBuiltinConfirmation(outcome), false, JSON.stringify(outcome));
  }

  assert.equal(voiceConfirmationArmed(0), false);
  assert.equal(voiceConfirmationArmed(armed - 1), false);
  assert.equal(voiceConfirmationArmed(armed), true);
});

test('startup resume is offered once and both explicit answers are persisted', async () => {
  const settings = createSettingsPort();
  let prompts = 0;
  const ui = {
    suggestStartupResume: async (): Promise<AssistantResumeSuggestionChoice> => {
      prompts += 1;
      return 'enable';
    },
  };

  assert.equal(
    await offerAssistantResumeOnStartup({ settings, ui, isCurrent: () => true }),
    'enabled',
  );
  assert.equal(prompts, 1);
  assert.equal(settings.read().values.assistantResumeOnStartup, true);

  assert.equal(
    await offerAssistantResumeOnStartup({ settings, ui, isCurrent: () => true }),
    'already-decided',
    'an enabled preference is never re-offered',
  );
  assert.equal(prompts, 1);

  const declining = createSettingsPort();
  assert.equal(
    await offerAssistantResumeOnStartup({
      settings: declining,
      ui: { suggestStartupResume: async () => 'dismiss' },
      isCurrent: () => true,
    }),
    'declined',
  );
  assert.equal(declining.read().values.assistantResumeOnStartup, false);
  assert.equal(declining.hasExplicitGlobal('assistantResumeOnStartup'), true);
  assert.equal(
    await offerAssistantResumeOnStartup({
      settings: declining,
      ui: { suggestStartupResume: async () => assert.fail('a declined offer must not repeat') },
      isCurrent: () => true,
    }),
    'already-decided',
  );

  const ignored = createSettingsPort();
  assert.equal(
    await offerAssistantResumeOnStartup({
      settings: ignored,
      ui: { suggestStartupResume: async () => 'ignored' },
      isCurrent: () => true,
    }),
    'ignored',
  );
  assert.equal(ignored.hasExplicitGlobal('assistantResumeOnStartup'), false);

  const hostWithoutSupport = createSettingsPort();
  assert.equal(
    await offerAssistantResumeOnStartup({
      settings: hostWithoutSupport, ui: {}, isCurrent: () => true,
    }),
    'unsupported',
  );

  const stopped = createSettingsPort();
  assert.equal(
    await offerAssistantResumeOnStartup({
      settings: stopped,
      ui: { suggestStartupResume: async () => 'enable' },
      isCurrent: () => false,
    }),
    'ignored',
    'an answer that arrives after the session ended changes nothing',
  );
  assert.equal(stopped.hasExplicitGlobal('assistantResumeOnStartup'), false);
});

test('only a manual start offers startup resume, and only until it is answered', async () => {
  const settings = createSettingsPort();
  const prompts: string[] = [];
  const controller = createSessionController({
    settings,
    suggest: async () => { prompts.push('offer'); return 'dismiss'; },
  });

  await controller.start({ allowPrompts: false });
  await settle();
  assert.deepEqual(prompts, [], 'a silent startup resume never raises a discovery prompt');
  await controller.stop();

  await controller.start();
  await settle();
  assert.deepEqual(prompts, ['offer'], 'the first manual start offers it once');
  assert.equal(settings.hasExplicitGlobal('assistantResumeOnStartup'), true);
  await controller.stop();

  await controller.start();
  await settle();
  assert.deepEqual(prompts, ['offer'], 'a later manual start never repeats the offer');
  await controller.stop();

  const enabling = createSettingsPort();
  const enabler = createSessionController({
    settings: enabling,
    suggest: async () => 'enable',
  });
  await enabler.start();
  await settle();
  assert.equal(enabling.read().values.assistantResumeOnStartup, true);
  await enabler.stop();
});

test('startup resume names the single gate that blocked a silent resume', async () => {
  const scenarios = [
    { name: 'untrusted', trusted: false, consent: true, devices: 1, credential: true, log: 'resumeReady/workspace-untrusted' },
    { name: 'consent', trusted: true, consent: false, devices: 1, credential: true, log: 'resumeReady/listening-consent' },
    { name: 'microphone', trusted: true, consent: true, devices: 0, credential: true, log: 'resumeReady/no-microphone' },
    { name: 'credential', trusted: true, consent: true, devices: 1, credential: false, log: 'credentialReady/soniox-not-configured' },
  ] as const;

  for (const scenario of scenarios) {
    const logs: string[] = [];
    let starts = 0;
    const runtime = new HostRuntimeLifecycle({
      metadata: { refresh: async () => undefined },
      devices: {
        get: async () => Array.from({ length: scenario.devices }, () => ({ id: 'mic', label: 'Mic' })),
      },
      credentials: { offerInitialSonioxSetup: async () => undefined },
      credentialStore: { dispose: () => undefined },
      state: { invalidate: () => undefined },
      settings: { refresh: async () => undefined, dispose: () => undefined },
      recording: { dispose: () => undefined },
      assistant: { dispose: () => undefined },
      mappings: { dispose: () => undefined },
      transcriptions: { abortAll: () => undefined },
      setDeactivating: () => undefined,
      log: (message) => logs.push(message),
      startupResume: {
        settings: {
          read: () => ({
            values: { ...SETTINGS_DEFAULTS, assistantResumeOnStartup: true },
            workspaceOverrides: [],
          }),
        },
        consents: { status: () => ({ id: 'assistant-listening', acknowledged: scenario.consent }) },
        credentials: {
          status: async () => ({ provider: 'soniox', configured: scenario.credential }),
        },
        devices: { selectionStatus: { kind: 'available' } as never },
        workspaceTrusted: () => scenario.trusted,
        start: async () => { starts += 1; },
      },
    });

    await runtime.start();
    assert.equal(starts, 0, scenario.name);
    assert.deepEqual(
      logs,
      [`assistant startup resume skipped: ${scenario.log}`],
      `${scenario.name} must be named exactly once`,
    );
  }
});

function createSessionController(options: {
  settings: ReturnType<typeof createSettingsPort>;
  suggest(): Promise<AssistantResumeSuggestionChoice>;
}): AssistantSessionController {
  return new AssistantSessionController({
    settings: options.settings,
    credentials: { status: async () => ({ provider: 'soniox', configured: true }) },
    consents: {
      status: () => ({ id: 'assistant-listening', acknowledged: true }),
      revision: () => 0,
      acknowledgeIfCurrent: async () => true,
    },
    devices: { get: async () => [] },
    recording: { cancel: async () => undefined } as unknown as PushToTalkController,
    transcriptions: { abort: () => undefined } as unknown as TranscriptionService,
    mappings: { cancel: () => undefined } as unknown as MappingFeature,
    planning: { invalidate: () => undefined } as unknown as AssistantPlanningService,
    actions: { clearPending: () => undefined } as unknown as AssistantActionController,
    feedback: { cancelSpeaking: () => undefined } as unknown as AssistantFeedbackController,
    sequence: { next: (prefix: string) => `${prefix}-1` } as AssistantIdSequence,
    target: { capture: () => SNAPSHOT, forRequestedTarget: (value) => value },
    status: {
      idle: () => undefined,
      listening: () => undefined,
      transcribing: () => undefined,
      stoppedWithError: () => undefined,
    },
    ui: {
      confirmListeningDisclosure: async () => true,
      showMissingSonioxCredential: async () => false,
      showError: async () => undefined,
      executeCommand: async () => undefined,
      suggestStartupResume: options.suggest,
    },
    startPcmStream: async () => ({
      sampleRate: 16_000,
      selectedDevice: 'mic-1',
      outcome: new Promise(() => undefined),
      cancel: () => undefined,
      stop: async () => ({ reason: 'cancelled' as const }),
    }),
    publish: () => undefined,
    isDeactivating: () => false,
    setTimer: () => 1 as unknown as ReturnType<typeof setTimeout>,
    clearTimer: () => undefined,
  });
}

async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function createSettingsPort() {
  const values: VoiceInputSettings = { ...SETTINGS_DEFAULTS };
  const explicit = new Set<string>();
  return {
    read: () => ({ values: { ...values }, workspaceOverrides: [] as never[] }),
    hasExplicitGlobal: (name: string) => explicit.has(name),
    update: async (patch: Partial<VoiceInputSettings>) => {
      for (const [name, value] of Object.entries(patch)) {
        explicit.add(name);
        Object.assign(values, { [name]: value });
      }
    },
  };
}
