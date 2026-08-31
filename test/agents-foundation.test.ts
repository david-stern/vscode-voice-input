import assert from 'node:assert/strict';
import test from 'node:test';

import type { CustomMapping } from '../src/assistant';
import {
  AGENT_STORAGE_KEY,
  AgentAuthorityPolicy,
  AgentError,
  AgentRegistry,
  MAPPING_APPROVAL_STORAGE_KEY,
  MappingApprovalStore,
  builtinAgentTemplates,
  type AgentDraft,
  type AgentRecord,
  type AgentStorage,
} from '../src/agents';

class MemoryStorage implements AgentStorage {
  readonly values = new Map<string, unknown>();
  updateGate: Promise<void> | undefined;

  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  async update(key: string, value: unknown): Promise<void> {
    await this.updateGate;
    this.values.set(key, structuredClone(value));
  }
}

test('six built-in templates are bilingual, safe, and learning-oriented', () => {
  const templates = builtinAgentTemplates();
  assert.equal(templates.length, 6);
  assert.deepEqual(templates.map((template) => template.templateId), [
    'teacher-lecturer', 'secretary', 'friend', 'tour-guide', 'mathematician', 'philosopher',
  ]);
  for (const template of templates) {
    assert.ok(template.description.en.length > 0);
    assert.ok(template.description.he.length > 0);
    assert.ok(template.instructions.en.length > 0);
    assert.ok(template.instructions.he.length > 0);
    assert.match(template.instructions.en, /polite|warm/iu);
    assert.match(template.instructions.en, /uncertain|uncertainty|assumptions/iu);
    assert.match(template.instructions.en, /host confirms|host confirms the result|host confirms it/iu);
    assert.equal(template.provider, 'deepseek');
    assert.equal(template.enabled, true);
  }
});

test('agent registry migrates legacy choice, persists six templates, and maintains a safe default through CRUD', async () => {
  const storage = new MemoryStorage();
  let next = 0;
  const registry = new AgentRegistry(storage, {
    idFactory: () => `agent_created_${String(++next).padStart(12, '0')}`,
    legacySettings: () => ({
      assistantPersona: 'philosopher',
      assistantProvider: 'openai',
      providerProfiles: { openai: { endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-migrated', enabled: true } },
    }),
  });

  const initialized = await registry.initialize();
  assert.equal(initialized.migrated, true);
  assert.equal(registry.list().length, 6);
  assert.equal(registry.getDefault()?.persona, 'philosopher');
  assert.equal(registry.getDefault()?.provider, 'openai');
  assert.equal(registry.getDefault()?.model, 'gpt-migrated');
  assert.equal((storage.values.get(AGENT_STORAGE_KEY) as { agents: unknown[] }).agents.length, 6);

  const created = await registry.create(draft('Personal Helper'));
  await assert.rejects(registry.create(draft(' personal   helper ')), hasAgentCode('duplicate-name'));
  const duplicated = await registry.duplicate(created.id);
  assert.match(duplicated.name, /^Personal Helper copy$/u);
  await registry.setDefault(created.id);
  assert.equal(registry.defaultId, created.id);
  await registry.setEnabled(created.id, false);
  assert.notEqual(registry.defaultId, created.id);
  await registry.delete(duplicated.id);
  assert.equal(registry.get(duplicated.id), undefined);
});

test('agent registry rejects provider/model/fallback/secret validation escapes before persistence', async () => {
  const storage = new MemoryStorage();
  const registry = new AgentRegistry(storage, {
    idFactory: () => 'agent_created_abcdefghijkl',
  });
  await registry.initialize();
  const before = JSON.stringify(storage.values.get(AGENT_STORAGE_KEY));

  await assert.rejects(registry.create({ ...draft('Bad Provider'), provider: 'invented' }), hasAgentCode('invalid-provider'));
  await assert.rejects(registry.create({ ...draft('Bad Model'), model: 'bad model' }), hasAgentCode('invalid-model'));
  await assert.rejects(registry.create({
    ...draft('Loop'), fallback: { provider: 'openai', model: 'gpt-test' },
  }), hasAgentCode('fallback-loop'));
  await assert.rejects(registry.create({
    ...draft('Secret'), instructions: { en: 'Bearer abcdefghijklmnopqrstuvwxyz', he: 'הנחיות בטוחות' },
  }), hasAgentCode('secret-like-content'));
  await assert.rejects(registry.create({
    ...draft('Secret description'),
    description: { en: 'sk-abcdefghijklmnopqrstuvwxyz', he: 'תיאור בטוח' },
  }), hasAgentCode('secret-like-content'));
  assert.equal(JSON.stringify(storage.values.get(AGENT_STORAGE_KEY)), before);
});

test('mapping approvals persist only opaque metadata and revoke when mapping/trust changes', async () => {
  const storage = new MemoryStorage();
  let trusted = true;
  let mapping: CustomMapping | undefined = customMapping();
  const approvals = new MappingApprovalStore(
    storage,
    (id) => mapping?.id === id ? mapping : undefined,
    { isWorkspaceTrusted: () => trusted },
  );

  const granted = await approvals.grant(mapping.id, 123);
  assert.deepEqual(granted, { mappingId: mapping.id, approvedAt: 123, effective: true });
  const persisted = storage.values.get(MAPPING_APPROVAL_STORAGE_KEY) as {
    schemaVersion: number;
    approvals: Array<Record<string, unknown>>;
  };
  assert.deepEqual(Object.keys(persisted).sort(), ['approvals', 'schemaVersion']);
  assert.deepEqual(Object.keys(persisted.approvals[0]).sort(), ['approvedAt', 'fingerprint', 'mappingId']);
  assert.doesNotMatch(JSON.stringify(persisted), /workbench\.action\.test|static-private-arg/u);

  mapping = { ...mapping, commandId: 'workbench.action.edited' };
  assert.equal(approvals.isApproved(mapping.id), false, 'edited mappings invalidate their fingerprint');
  await approvals.grant(mapping.id, 124);
  mapping = undefined;
  assert.equal(approvals.state(granted.mappingId), 'revoked', 'deleted mappings cannot retain approval');

  mapping = customMapping();
  await approvals.grant(mapping.id, 125);
  await approvals.revoke(mapping.id);
  assert.equal(approvals.state(mapping.id), 'revoked');
  await approvals.grant(mapping.id, 126);
  trusted = false;
  assert.equal(approvals.state(mapping.id), 'revoked', 'trust downgrade immediately closes approval');
});

test('revoke wins a racing approval grant before storage returns', async () => {
  const storage = new MemoryStorage();
  const gate = deferred<void>();
  storage.updateGate = gate.promise;
  const mapping = customMapping();
  const approvals = new MappingApprovalStore(storage, () => mapping, {
    isWorkspaceTrusted: () => true,
  });
  const grant = approvals.grant(mapping.id, 50);
  await Promise.resolve();
  const revoke = approvals.revoke(mapping.id);
  assert.equal(approvals.isApproved(mapping.id), false);
  gate.resolve();
  await assert.rejects(grant, /mapping-approval-revoked/u);
  await revoke;
  assert.equal(approvals.isApproved(mapping.id), false);
});

test('authority requires fresh confirmation, exact target evidence, and serializes dispatch', async () => {
  let now = 100;
  const agent = agentRecord();
  const policy = new AgentAuthorityPolicy({
    approvals: approvalPort(false),
    ttlMs: 10,
    now: () => now,
    idFactory: sequence('authority'),
  });
  const context = authorityContext(agent);
  const pending = policy.request(proposal(agent, 'send'), context);
  assert.equal(pending.status, 'confirmation-required');
  if (pending.status !== 'confirmation-required') return assert.fail('expected pending confirmation');
  now = 111;
  assert.deepEqual(policy.confirm(pending.pendingId, 'confirm-1', context), {
    status: 'denied', permissionTier: 'confirmation-required', reason: 'approval-expired',
  });

  now = 200;
  const targetPending = policy.request(proposal(agent, 'send'), context);
  assert.equal(targetPending.status, 'confirmation-required');
  if (targetPending.status !== 'confirmation-required') return assert.fail('expected pending confirmation');
  now = 201;
  assert.deepEqual(policy.confirm(targetPending.pendingId, 'confirm-2', {
    ...context, targetEvidence: 'different-editor', targetFingerprint: 'different-fingerprint',
  }), {
    status: 'denied', permissionTier: 'confirmation-required', reason: 'target-changed',
  });

  const first = policy.request(proposal(agent, 'draft'), context);
  const second = policy.request({ ...proposal(agent, 'draft'), proposalId: 'draft-2' }, context);
  assert.equal(first.status, 'authorized');
  assert.equal(second.status, 'authorized');
  if (first.status !== 'authorized' || second.status !== 'authorized') return assert.fail('expected automatic authorizations');
  const operation = deferred<string>();
  const running = policy.execute(first.authorizationId, context, () => operation.promise);
  await Promise.resolve();
  assert.deepEqual(await policy.execute(second.authorizationId, context, async () => 'second'), {
    ok: false, reason: 'busy',
  });
  operation.resolve('first');
  assert.deepEqual(await running, { ok: true, value: 'first' });
});

test('model output cannot grant always-approved authority and model changes invalidate it', () => {
  const agent = agentRecord();
  const mapping = customMapping();
  const policy = new AgentAuthorityPolicy({
    approvals: approvalPort(true),
    idFactory: sequence('authority'),
  });
  const context = authorityContext(agent, mapping);

  const alwaysApprovedAttempt = policy.request({
    ...proposal(agent, 'command', mapping.id),
    alwaysApproved: true,
  }, context);
  assert.deepEqual(alwaysApprovedAttempt, {
    status: 'denied', permissionTier: 'confirmation-required', reason: 'invalid-proposal',
  });

  const wrongModel = policy.request({
    ...proposal(agent, 'command', mapping.id), model: 'model-from-output',
  }, context);
  assert.deepEqual(wrongModel, {
    status: 'denied', permissionTier: 'confirmation-required', reason: 'agent-changed',
  });

  const approved = policy.request(proposal(agent, 'command', mapping.id), context);
  assert.equal(approved.status, 'authorized');
  if (approved.status === 'authorized') assert.equal(approved.mode, 'always-approved');
});

function draft(name: string): AgentDraft {
  return {
    name,
    description: { en: 'A helpful agent.', he: 'סוכן מועיל.' },
    provider: 'openai',
    model: 'gpt-test',
    persona: 'teacher-lecturer',
    instructions: { en: 'Be polite and explain uncertainty.', he: 'יש לנהוג בנימוס ולציין אי ודאות.' },
    speech: { enabled: true, voiceUri: '', rate: 1 },
    enabled: true,
  };
}

function customMapping(): CustomMapping {
  return {
    id: 'vm_abcdefghijklmnopqrstuv',
    kind: 'command',
    label: 'Test mapping',
    description: 'A test mapping.',
    phrases: ['run test mapping'],
    enabled: true,
    agentEnabled: true,
    commandId: 'workbench.action.test',
    args: ['static-private-arg'],
  };
}

function agentRecord(): AgentRecord {
  return { id: 'agent_created_abcdefghijkl', ...draft('Authority agent') };
}

function proposal(agent: AgentRecord, action: 'draft' | 'send' | 'command', mappingId?: string) {
  return {
    proposalId: `proposal-${action}`,
    agentId: agent.id,
    provider: agent.provider,
    model: agent.model,
    action,
    reason: 'Requested action.',
    confidence: 0.9,
    targetEvidence: 'active-editor',
    ...(mappingId ? { mappingId } : {}),
  };
}

function authorityContext(agent: AgentRecord, mapping?: CustomMapping) {
  return {
    workspaceTrusted: true,
    activeAgent: agent,
    targetFingerprint: 'editor-fingerprint',
    targetEvidence: 'active-editor',
    resolveMapping: (id: string) => mapping?.id === id ? mapping : undefined,
  };
}

function approvalPort(approved: boolean) {
  return {
    isApproved: () => approved,
    onWillChange: () => ({ dispose: () => undefined }),
  };
}

function hasAgentCode(code: AgentError['code']): (error: unknown) => boolean {
  return (error) => error instanceof AgentError && error.code === code;
}

function sequence(prefix: string): () => string {
  let value = 0;
  return () => `${prefix}_${String(++value).padStart(12, '0')}`;
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((done) => { resolve = done; }),
    resolve,
  };
}
