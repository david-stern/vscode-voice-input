import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ConsentService,
  SETTINGS_DEFAULTS,
  type CredentialInvalidation,
} from '../src/config';
import type { AgentAuthorityPolicy, AgentRecord } from '../src/agents';
import type { TargetSnapshot } from '../src/assistant/context';
import { AssistantActionController } from '../src/features/assistant/actionController';
import type { AssistantFeedbackController } from '../src/features/assistant/feedbackController';
import type { AssistantIdSequence } from '../src/features/assistant/idSequence';
import type { AssistantPlanningService } from '../src/features/assistant/planningService';
import { AssistantSessionController } from '../src/features/assistant/sessionController';
import type { MappingFeature } from '../src/features/mappings';
import type { PushToTalkController, TranscriptionService } from '../src/features/recording';

const snapshot: TargetSnapshot = {
  requestedTarget: 'here',
  resolvedTarget: 'focused-control',
  focusedTarget: 'focused-control',
  vscodeFocused: true,
  activeTabIdentity: 'tab-1',
  activeEditorIdentity: null,
  activeTerminalIdentity: null,
};

test('write-here requires terminal authority whenever the captured target may be a terminal', async () => {
  const agent: AgentRecord = {
    id: 'agent_abcdefghijkl',
    name: 'Teacher',
    description: { en: 'Safe', he: 'בטוח' },
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    persona: 'teacher-lecturer',
    instructions: { en: 'Be safe.', he: 'פעל בבטיחות.' },
    speech: { enabled: false, voiceUri: '', rate: 1 },
    enabled: true,
  };
  const authority = {
    request: (proposal: { action: string }) => proposal.action === 'draft'
      ? {
          status: 'authorized',
          authorizationId: 'automatic-draft',
          permissionTier: 'automatic',
          mode: 'automatic',
          expiresAt: Date.now() + 1_000,
        }
      : {
          status: 'confirmation-required',
          pendingId: `pending-${proposal.action}`,
          permissionTier: 'confirmation-required',
          expiresAt: Date.now() + 1_000,
          preview: proposal,
        },
    confirm: () => ({ status: 'denied', permissionTier: 'confirmation-required', reason: 'no-pending-approval' }),
    execute: async (_id: string, _context: unknown, operation: () => PromiseLike<void>) => {
      await operation();
      return { ok: true, value: undefined };
    },
    revoke: () => undefined,
  } as unknown as AgentAuthorityPolicy;
  let current = snapshot;
  let confirmations = 0;
  let injections = 0;
  let sequence = 0;
  const previews: Array<{ action: string; targetEvidence: string }> = [];
  const actions = new AssistantActionController({
    host: {
      confirmAgentAction: async ({ proposal }) => {
        confirmations += 1;
        previews.push({ action: proposal.action, targetEvidence: proposal.targetEvidence });
        return false;
      },
      focusBuiltInChat: async () => false,
      prepareBuiltInChatDraft: async () => undefined,
      hasCommand: async () => false,
      executeCommand: async () => undefined,
      activeTerminal: () => undefined,
      hasActiveEditor: () => false,
      injectIntoEditor: async () => false,
      injectIntoFocusedControl: async () => { injections += 1; return true; },
    },
    target: {
      capture: () => current,
      forRequestedTarget: (value, requestedTarget) => ({
        ...value,
        requestedTarget,
        resolvedTarget: requestedTarget,
      }),
    },
    feedback: { speak: () => undefined } as unknown as AssistantFeedbackController,
    sequence: { next: (prefix: string) => `${prefix}-${++sequence}` } as AssistantIdSequence,
    localize: (english) => english,
    publish: () => undefined,
    stopAssistant: async () => undefined,
    authority,
    activeAgent: () => agent,
    isWorkspaceTrusted: () => true,
  });
  const writeHere = {
    action: 'write-here' as const,
    target: 'current' as const,
    content: 'safe text',
    spokenReply: '',
    reason: 'Write the requested draft.',
    confidence: 1,
    requiresConfirmation: false,
  };

  current = {
    ...snapshot,
    resolvedTarget: 'terminal',
    focusedTarget: 'terminal',
    activeTerminalIdentity: 'terminal-1',
  };
  await actions.execute(writeHere, current, 'utterance-terminal');

  current = {
    ...snapshot,
    activeTerminalIdentity: 'terminal-1',
  };
  await actions.execute(writeHere, current, 'utterance-ambiguous-terminal');

  current = {
    ...snapshot,
    activeEditorIdentity: 'editor-1',
  };
  await actions.execute(writeHere, current, 'utterance-editor-draft');

  assert.equal(confirmations, 2);
  assert.equal(injections, 1);
  assert.deepEqual(previews.map(({ action }) => action), ['terminal', 'terminal']);
  assert.match(previews[0]?.targetEvidence ?? '', /^Active terminal · /u);
  assert.match(previews[1]?.targetEvidence ?? '', /^Focused VS Code control · /u);
  actions.dispose();
});

test('assistant construction is inert and explicit start cancels push-to-talk before capture', async () => {
  const events: string[] = [];
  let captureCancelled = 0;
  let captureStopped = 0;
  let invalidatedSend = 0;
  let invalidatedMapping = 0;
  let speechCancelled = 0;
  const controller = new AssistantSessionController({
    settings: {
      read: () => ({ values: { ...SETTINGS_DEFAULTS }, workspaceOverrides: [] }),
    },
    credentials: { status: async () => ({ provider: 'soniox', configured: true }) },
    consents: {
      status: () => ({ id: 'assistant-listening', acknowledged: true }),
      acknowledge: async () => ({ id: 'assistant-listening', acknowledged: true }),
    },
    devices: { get: async () => { events.push('devices'); return []; } },
    recording: {
      cancel: async () => { events.push('push-cancelled'); },
    } as unknown as PushToTalkController,
    transcriptions: {
      abort: () => { events.push('transcriptions-aborted'); },
    } as unknown as TranscriptionService,
    mappings: {
      cancel: () => { invalidatedMapping += 1; },
    } as unknown as MappingFeature,
    planning: { invalidate: () => { events.push('planning-invalidated'); } } as AssistantPlanningService,
    actions: {
      clearPending: () => { invalidatedSend += 1; },
    } as unknown as AssistantActionController,
    feedback: {
      cancelSpeaking: () => { speechCancelled += 1; },
    } as unknown as AssistantFeedbackController,
    sequence: {} as AssistantIdSequence,
    target: { capture: () => snapshot, forRequestedTarget: (value) => value },
    status: {
      idle: () => events.push('idle'),
      listening: () => events.push('listening'),
      transcribing: () => events.push('transcribing'),
      stoppedWithError: (message) => events.push(`error:${message}`),
    },
    ui: {
      confirmListeningDisclosure: async () => true,
      showMissingSonioxCredential: async () => false,
      showError: async () => undefined,
      executeCommand: async () => undefined,
    },
    startPcmStream: async () => {
      events.push('capture-started');
      return {
        sampleRate: 16_000,
        selectedDevice: 'mic-1',
        outcome: new Promise(() => {}),
        cancel: () => { captureCancelled += 1; },
        stop: async () => { captureStopped += 1; return { reason: 'cancelled' as const }; },
      };
    },
    publish: () => { events.push('published'); },
    isDeactivating: () => false,
    setTimer: () => 1 as unknown as ReturnType<typeof setTimeout>,
    clearTimer: () => {},
  });

  assert.deepEqual(events, []);
  await controller.start();
  assert.equal(controller.isListening, true);
  assert.deepEqual(events.slice(0, 4), [
    'devices',
    'push-cancelled',
    'capture-started',
    'listening',
  ]);

  await controller.stop();
  assert.equal(controller.isListening, false);
  assert.equal(captureCancelled, 1);
  assert.equal(captureStopped, 1);
  assert.equal(invalidatedSend, 1);
  assert.equal(invalidatedMapping, 1);
  assert.equal(speechCancelled, 1);
  assert.ok(events.includes('planning-invalidated'));
  assert.ok(events.includes('transcriptions-aborted'));
  assert.ok(events.includes('idle'));
});

test('assistant rejects a non-16k initial stream and releases it', async () => {
  let cancelled = 0;
  let stopped = 0;
  const errors: string[] = [];
  const controller = new AssistantSessionController({
    settings: {
      read: () => ({ values: { ...SETTINGS_DEFAULTS }, workspaceOverrides: [] }),
    },
    credentials: { status: async () => ({ provider: 'soniox', configured: true }) },
    consents: {
      status: () => ({ id: 'assistant-listening', acknowledged: true }),
      acknowledge: async () => ({ id: 'assistant-listening', acknowledged: true }),
    },
    devices: { get: async () => [] },
    recording: { cancel: async () => {} } as unknown as PushToTalkController,
    transcriptions: { abort: () => {} } as unknown as TranscriptionService,
    mappings: { cancel: () => {} } as unknown as MappingFeature,
    planning: { invalidate: () => undefined } as unknown as AssistantPlanningService,
    actions: { clearPending: () => {} } as unknown as AssistantActionController,
    feedback: { cancelSpeaking: () => {} } as unknown as AssistantFeedbackController,
    sequence: {} as AssistantIdSequence,
    target: { capture: () => snapshot, forRequestedTarget: (value) => value },
    status: {
      idle: () => {},
      listening: () => {},
      transcribing: () => {},
      stoppedWithError: (message) => errors.push(message),
    },
    ui: {
      confirmListeningDisclosure: async () => true,
      showMissingSonioxCredential: async () => false,
      showError: async () => undefined,
      executeCommand: async () => undefined,
    },
    startPcmStream: async () => ({
      sampleRate: 48_000,
      selectedDevice: 'mic-1',
      outcome: new Promise(() => {}),
      cancel: () => { cancelled += 1; },
      stop: async () => { stopped += 1; return { reason: 'cancelled' as const }; },
    }),
    publish: () => {},
    isDeactivating: () => false,
  });

  await controller.start();

  assert.equal(controller.isListening, false);
  assert.equal(cancelled, 1);
  assert.equal(stopped, 1);
  assert.match(errors[0] ?? '', /requires 16000 Hz/u);
});

test('Soniox credential invalidation synchronously cancels an active assistant capture', async () => {
  let invalidate: ((event: CredentialInvalidation) => void) | undefined;
  let subscriptionDisposed = false;
  let cancelled = 0;
  let stopped = 0;
  const errors: string[] = [];
  const controller = new AssistantSessionController({
    settings: { read: () => ({ values: { ...SETTINGS_DEFAULTS }, workspaceOverrides: [] }) },
    credentials: {
      status: async () => ({ provider: 'soniox', configured: true }),
      onDidInvalidate: (listener) => {
        invalidate = listener;
        return { dispose: () => { subscriptionDisposed = true; } };
      },
    },
    consents: {
      status: () => ({ id: 'assistant-listening', acknowledged: true }),
      revision: () => 0,
      acknowledgeIfCurrent: async () => true,
    },
    devices: { get: async () => [] },
    recording: { cancel: async () => {} } as unknown as PushToTalkController,
    transcriptions: { abort: () => {} } as unknown as TranscriptionService,
    mappings: { cancel: () => {} } as unknown as MappingFeature,
    planning: { invalidate: () => undefined } as unknown as AssistantPlanningService,
    actions: { clearPending: () => {} } as unknown as AssistantActionController,
    feedback: { cancelSpeaking: () => {} } as unknown as AssistantFeedbackController,
    sequence: {} as AssistantIdSequence,
    target: { capture: () => snapshot, forRequestedTarget: (value) => value },
    status: {
      idle: () => {}, listening: () => {}, transcribing: () => {},
      stoppedWithError: (message) => { errors.push(message); },
    },
    ui: {
      confirmListeningDisclosure: async () => true,
      showMissingSonioxCredential: async () => false,
      showError: async () => undefined,
      executeCommand: async () => undefined,
    },
    startPcmStream: async () => ({
      sampleRate: 16_000,
      selectedDevice: 'mic-1',
      outcome: new Promise(() => {}),
      cancel: () => { cancelled += 1; },
      stop: async () => { stopped += 1; return { reason: 'cancelled' as const }; },
    }),
    publish: () => {},
    isDeactivating: () => false,
    setTimer: () => 1 as unknown as ReturnType<typeof setTimeout>,
    clearTimer: () => {},
  });

  await controller.start();
  invalidate?.({ provider: 'soniox', revision: 1 });

  assert.equal(cancelled, 1);
  assert.equal(controller.isListening, false);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(stopped, 1);
  assert.match(errors[0] ?? '', /Soniox API key is no longer available/u);
  controller.dispose();
  assert.equal(subscriptionDisposed, true);
});

test('non-interactive startup start never opens consent or credential prompts', async () => {
  let consentGranted = false;
  let credentialConfigured = true;
  let consentPrompts = 0;
  let credentialPrompts = 0;
  let captures = 0;
  const controller = new AssistantSessionController({
    settings: { read: () => ({ values: { ...SETTINGS_DEFAULTS }, workspaceOverrides: [] }) },
    credentials: {
      status: async () => ({ provider: 'soniox', configured: credentialConfigured }),
    },
    consents: {
      status: () => ({ id: 'assistant-listening', acknowledged: consentGranted }),
      revision: () => 0,
      acknowledgeIfCurrent: async () => true,
    },
    devices: { get: async () => [] },
    recording: { cancel: async () => {} } as unknown as PushToTalkController,
    transcriptions: { abort: () => {} } as unknown as TranscriptionService,
    mappings: { cancel: () => {} } as unknown as MappingFeature,
    planning: { invalidate: () => undefined } as unknown as AssistantPlanningService,
    actions: { clearPending: () => {} } as unknown as AssistantActionController,
    feedback: { cancelSpeaking: () => {} } as unknown as AssistantFeedbackController,
    sequence: {} as AssistantIdSequence,
    target: { capture: () => snapshot, forRequestedTarget: (value) => value },
    status: { idle: () => {}, listening: () => {}, transcribing: () => {}, stoppedWithError: () => {} },
    ui: {
      confirmListeningDisclosure: async () => { consentPrompts += 1; return true; },
      showMissingSonioxCredential: async () => { credentialPrompts += 1; return true; },
      showError: async () => undefined,
      executeCommand: async () => undefined,
    },
    startPcmStream: async () => {
      captures += 1;
      throw new Error('capture must remain closed');
    },
    publish: () => {},
    isDeactivating: () => false,
  });

  await controller.start({ allowPrompts: false });
  consentGranted = true;
  credentialConfigured = false;
  await controller.start({ allowPrompts: false });

  assert.deepEqual({ consentPrompts, credentialPrompts, captures }, {
    consentPrompts: 0,
    credentialPrompts: 0,
    captures: 0,
  });
});

test('listening consent revoke cancels capture and speech before delayed persistence settles', async () => {
  let storedConsent = true;
  const persistence = deferred<void>();
  const consents = new ConsentService({
    get: <T>(_key: string, fallback: T) => (storedConsent as unknown as T) ?? fallback,
    update: async (_key, value) => {
      await persistence.promise;
      storedConsent = value === true;
    },
  });
  let captureCancelled = 0;
  let captureStopped = 0;
  let speechCancelled = 0;
  const controller = new AssistantSessionController({
    settings: { read: () => ({ values: { ...SETTINGS_DEFAULTS }, workspaceOverrides: [] }) },
    credentials: { status: async () => ({ provider: 'soniox', configured: true }) },
    consents,
    devices: { get: async () => [] },
    recording: { cancel: async () => {} } as unknown as PushToTalkController,
    transcriptions: { abort: () => {} } as unknown as TranscriptionService,
    mappings: { cancel: () => {} } as unknown as MappingFeature,
    planning: { invalidate: () => undefined } as unknown as AssistantPlanningService,
    actions: { clearPending: () => {} } as unknown as AssistantActionController,
    feedback: {
      cancelSpeaking: () => { speechCancelled += 1; },
    } as unknown as AssistantFeedbackController,
    sequence: {} as AssistantIdSequence,
    target: { capture: () => snapshot, forRequestedTarget: (value) => value },
    status: { idle: () => {}, listening: () => {}, transcribing: () => {}, stoppedWithError: () => {} },
    ui: {
      confirmListeningDisclosure: async () => true,
      showMissingSonioxCredential: async () => false,
      showError: async () => undefined,
      executeCommand: async () => undefined,
    },
    startPcmStream: async () => ({
      sampleRate: 16_000,
      selectedDevice: 'mic-1',
      outcome: new Promise(() => {}),
      cancel: () => { captureCancelled += 1; },
      stop: async () => { captureStopped += 1; return { reason: 'cancelled' as const }; },
    }),
    publish: () => {},
    isDeactivating: () => false,
    setTimer: () => 1 as unknown as ReturnType<typeof setTimeout>,
    clearTimer: () => {},
  });

  await controller.start();
  const pendingRevoke = consents.revoke('assistant-listening');

  assert.equal(controller.isListening, false);
  assert.equal(captureCancelled, 1);
  assert.equal(speechCancelled, 1);
  assert.equal(storedConsent, true);
  persistence.resolve(undefined);
  await pendingRevoke;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(captureStopped, 1);
  assert.equal(storedConsent, false);
});

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}
