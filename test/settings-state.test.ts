import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createInitialSettingsUiState,
  createInitialSettingsState,
  isDeepSeekModelValueValid,
  isCurrentMappingsRevision,
  nextResourceOperation,
  projectSettingsUiState,
  reduceNavigation,
  reduceSetupProgress,
  reduceSettingsState,
  routeForLegacySection,
  workspaceOverrideFor,
} from '../src/webview/settings/state';
import { createReadinessPresentation } from '../src/webview/settings/presentation';

test('settings reducer accepts the first state then only newer revisions', () => {
  const initial = createInitialSettingsState();
  const first = { ...initial, revision: 0, uiLang: 'he' as const };
  const firstResult = reduceSettingsState(initial, first, false);
  assert.equal(firstResult.applied, true);
  assert.equal(firstResult.state.uiLang, 'he');

  const equal = reduceSettingsState(first, { ...first, uiLang: 'en' }, true);
  assert.equal(equal.applied, false);
  assert.equal(equal.state.uiLang, 'he');

  const older = reduceSettingsState(first, { ...first, revision: 0, uiLang: 'en' }, true);
  assert.equal(older.applied, false);
  const newer = reduceSettingsState(first, { ...first, revision: 1, uiLang: 'en' }, true);
  assert.equal(newer.applied, true);
  assert.equal(newer.state.uiLang, 'en');
});

test('navigation reducer preserves the newest requested section independently of state refreshes', () => {
  const first = reduceNavigation(undefined, { revision: 1, section: 'mappings' });
  assert.deepEqual(first, { revision: 1, section: 'mappings' });
  assert.equal(reduceNavigation(first, { revision: 1, section: 'general' }), first);
  assert.equal(reduceNavigation(first, { revision: 0, section: 'privacy' }), first);
  assert.deepEqual(reduceNavigation(first, { revision: 2, section: 'privacy' }), {
    revision: 2,
    section: 'privacy',
  });
});

test('mapping revision gate makes an accepted toggle replay stale', () => {
  const requestRevision = 12;
  let currentRevision = 12;

  assert.equal(isCurrentMappingsRevision(requestRevision, currentRevision), true);
  currentRevision = nextResourceOperation(currentRevision);
  assert.equal(isCurrentMappingsRevision(requestRevision, currentRevision), false);
});

test('DeepSeek model validity follows mode and clears when a valid host value returns', () => {
  assert.equal(isDeepSeekModelValueValid('deepseek', '  '), false);
  assert.equal(isDeepSeekModelValueValid('deepseek', 'deepseek-chat'), true);
  assert.equal(isDeepSeekModelValueValid('off', ''), true);
});

test('resource revisions advance safely and workspace overrides retain global and effective values', () => {
  assert.equal(nextResourceOperation(9), 10);
  const state = createInitialSettingsState();
  state.general.workspaceOverrides.push({
    setting: 'audioDevice',
    source: 'workspace-folder',
    globalValue: 'global-device',
    effectiveValue: 'workspace-device',
  });
  assert.deepEqual(workspaceOverrideFor(state, 'audioDevice'), {
    setting: 'audioDevice',
    source: 'workspace-folder',
    globalValue: 'global-device',
    effectiveValue: 'workspace-device',
  });
});

test('setup reducer resumes navigation only and never persists host readiness or credentials', () => {
  const restored = createInitialSettingsUiState({
    route: 'agents',
    setup: {
      currentStep: 'provider',
      completedSteps: ['transcription', 'unknown', 'microphone', 'transcription'],
      complete: true,
      apiKey: 'must-not-survive',
    },
    credential: 'must-not-survive',
  });
  assert.deepEqual(restored, {
    route: 'agents',
    setup: { currentStep: 'provider' },
  });

  const speech = reduceSetupProgress(restored.setup, { type: 'go', step: 'speech' });
  assert.deepEqual(speech, { currentStep: 'speech' });
  const projected = JSON.stringify(projectSettingsUiState({ route: 'home', setup: speech }));
  assert.equal(projected.includes('credential'), false);
  assert.equal(projected.includes('completedSteps'), false);
  assert.equal(projected.includes('complete'), false);

  const invalid = createInitialSettingsUiState({ route: 'secrets', setup: { currentStep: 'key', completedSteps: ['key'] } });
  assert.equal(invalid.route, 'setup');
  assert.deepEqual(invalid.setup, { currentStep: 'microphone' });
});

test('legacy host sections map to the new product routes without changing the host protocol', () => {
  assert.equal(routeForLegacySection('general'), 'home');
  assert.equal(routeForLegacySection('assistant'), 'agents');
  assert.equal(routeForLegacySection('microphone'), 'conversation');
  assert.equal(routeForLegacySection('mappings'), 'actions');
});

test('readiness projection distinguishes loading, ready, and unavailable recovery states', () => {
  const state = createInitialSettingsState();
  const loading = new Map(createReadinessPresentation(state).map((item) => [item.id, item.readiness]));
  assert.equal(loading.get('actions'), 'loading');
  assert.equal(loading.get('transcription'), 'attention');

  state.transcription.configured = true;
  state.transcription.test = { phase: 'complete', operationRevision: 1, result: 'connected' };
  state.microphone.status = 'ready';
  state.mappings.status = 'ready';
  state.mappings.items.push({
    id: 'vm_abcdefghijklmnopqrstuv', label: 'Run tests', description: '', phrases: ['run tests'],
    kind: 'command', targetId: 'workbench.action.tasks.test', enabled: true, agentEnabled: false,
    approval: 'none', permissionTier: 'confirmation-required',
  });
  const ready = new Map(createReadinessPresentation(state).map((item) => [item.id, item.readiness]));
  assert.equal(ready.get('transcription'), 'ready');
  assert.equal(ready.get('microphone'), 'ready');
  assert.equal(ready.get('actions'), 'ready');

  state.microphone.status = 'error';
  state.transcription.test = { phase: 'complete', operationRevision: 2, result: 'unavailable' };
  const failed = new Map(createReadinessPresentation(state).map((item) => [item.id, item.readiness]));
  assert.equal(failed.get('microphone'), 'unavailable');
  assert.equal(failed.get('transcription'), 'unavailable');
});

test('stale and legacy microphone recovery state remains unavailable while repaired state is ready', () => {
  const state = createInitialSettingsState();
  state.microphone.status = 'unavailable';
  state.microphone.selection = {
    kind: 'stale', status: 'unavailable', recovery: 'select-device',
  };
  let readiness = new Map(createReadinessPresentation(state).map((item) => [item.id, item.readiness]));
  assert.equal(readiness.get('microphone'), 'unavailable');

  state.microphone.selection = {
    kind: 'legacy', status: 'unavailable', recovery: 'select-device',
  };
  readiness = new Map(createReadinessPresentation(state).map((item) => [item.id, item.readiness]));
  assert.equal(readiness.get('microphone'), 'unavailable');

  state.microphone.status = 'ready';
  state.microphone.selection = {
    kind: 'repaired', status: 'ready', recovery: 'none', label: 'Built-in microphone',
  };
  readiness = new Map(createReadinessPresentation(state).map((item) => [item.id, item.readiness]));
  assert.equal(readiness.get('microphone'), 'ready');
});
