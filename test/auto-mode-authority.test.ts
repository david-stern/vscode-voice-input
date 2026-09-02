import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AgentAuthorityPolicy,
  type AgentActionProposal,
  type AgentAutoModeSnapshot,
} from '../src/agents/authority';
import type { AgentRecord } from '../src/agents/contracts';
import type { CustomMapping } from '../src/assistant';

const mapping: CustomMapping = {
  id: `vm_${'a'.repeat(22)}`,
  kind: 'command',
  label: 'Format',
  description: '',
  phrases: ['format'],
  enabled: true,
  agentEnabled: true,
  commandId: 'editor.action.formatDocument',
  args: [],
};

const agent = {
  id: 'agent-test',
  enabled: true,
  provider: 'openai',
  model: 'gpt-test',
} as AgentRecord;

const proposal: AgentActionProposal = {
  proposalId: 'proposal-1',
  agentId: agent.id,
  provider: agent.provider,
  model: agent.model,
  action: 'command',
  reason: 'Run the enabled mapping.',
  confidence: 1,
  targetEvidence: 'editor-1',
  mappingId: mapping.id,
};

test('Auto skips only the extension confirmation and epoch changes revoke authorization', async () => {
  let snapshot: AgentAutoModeSnapshot = { effective: true, epoch: 7, fingerprint: 'auto:7' };
  const listeners = new Set<() => void>();
  const policy = new AgentAuthorityPolicy({
    approvals: {
      isApproved: () => false,
      onWillChange: () => ({ dispose() {} }),
    },
    autoMode: {
      snapshot: () => snapshot,
      onWillChange: (listener) => {
        listeners.add(listener);
        return { dispose: () => listeners.delete(listener) };
      },
    },
    idFactory: (() => { let id = 0; return () => `authority-${++id}`; })(),
  });
  const context = {
    workspaceTrusted: true,
    activeAgent: agent,
    targetFingerprint: 'target:1',
    targetEvidence: proposal.targetEvidence,
    resolveMapping: () => mapping,
  };
  const decision = policy.request(proposal, context);
  assert.equal(decision.status, 'authorized');
  if (decision.status !== 'authorized') return;
  assert.equal(decision.mode, 'auto-mode');

  snapshot = { effective: false, epoch: 8, fingerprint: 'auto:8' };
  for (const listener of listeners) listener();
  assert.deepEqual(await policy.execute(decision.authorizationId, context, async () => 'unsafe'), {
    ok: false,
    reason: 'authorization-invalid',
  });
});

test('Auto never bypasses trust or mapping exposure', () => {
  const policy = new AgentAuthorityPolicy({
    approvals: {
      isApproved: () => false,
      onWillChange: () => ({ dispose() {} }),
    },
    autoMode: {
      snapshot: () => ({ effective: true, epoch: 1, fingerprint: 'auto:1' }),
      onWillChange: () => ({ dispose() {} }),
    },
  });
  assert.equal(policy.request(proposal, {
    workspaceTrusted: false,
    activeAgent: agent,
    targetFingerprint: 'target:1',
    targetEvidence: proposal.targetEvidence,
    resolveMapping: () => mapping,
  }).status, 'denied');
  assert.equal(policy.request(proposal, {
    workspaceTrusted: true,
    activeAgent: agent,
    targetFingerprint: 'target:1',
    targetEvidence: proposal.targetEvidence,
    resolveMapping: () => ({ ...mapping, enabled: false }),
  }).status, 'denied');
});
