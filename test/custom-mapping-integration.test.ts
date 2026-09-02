import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CustomMapping } from '../src/assistant/mappings';
import type { TargetSnapshot } from '../src/assistant/context';
import { routeVoiceMappingRequest } from '../src/features/mappings/voiceRequestRouter';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  version: string;
  engines: { vscode: string };
  devDependencies: Record<string, string>;
  capabilities?: { untrustedWorkspaces?: { supported?: string } };
  contributes: {
    commands: Array<{ command: string }>;
    languageModelTools: Array<{
      name: string;
      canBeReferencedInPrompt: boolean;
      toolReferenceName: string;
      inputSchema: Record<string, unknown>;
    }>;
  };
};
const snapshot: TargetSnapshot = {
  requestedTarget: 'here',
  resolvedTarget: 'focused-control',
  vscodeFocused: true,
  activeTabIdentity: 'tab-1',
  activeEditorIdentity: null,
  activeTerminalIdentity: null,
};

const mapping: CustomMapping = {
  id: 'vm_abcdefghijklmnopqrstuv',
  kind: 'command',
  label: 'Format document',
  description: 'Formats the active document',
  phrases: ['format this'],
  commandId: 'editor.action.formatDocument',
  args: [],
  enabled: true,
  agentEnabled: true,
};

test('manifest requires the Agent-tool compatible VS Code API and aligned typings', () => {
  assert.equal(manifest.version, '2.1.0');
  assert.equal(manifest.engines.vscode, '^1.99.0');
  assert.equal(manifest.devDependencies['@types/vscode'], '^1.99.0');
  assert.equal(manifest.capabilities?.untrustedWorkspaces?.supported, 'limited');
});

test('manifest contributes exactly the bounded list/run Agent tools', () => {
  const tools = manifest.contributes.languageModelTools;
  assert.deepEqual(tools.map((tool) => tool.name), [
    'voice-input_listMappings',
    'voice-input_runMapping',
  ]);
  assert.deepEqual(tools.map((tool) => tool.toolReferenceName), [
    'voiceMappings',
    'runVoiceMapping',
  ]);
  assert.ok(tools.every((tool) => tool.canBeReferencedInPrompt === true));
  assert.deepEqual(tools[0].inputSchema, {
    type: 'object',
    properties: {
      cursor: {
        type: 'integer',
        minimum: 0,
        maximum: 50,
        description: 'Zero-based cursor returned as nextCursor by the previous page. Omit for the first page.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 20,
        default: 10,
        description: 'Maximum mappings to return in this page.',
      },
    },
    additionalProperties: false,
  });
  assert.deepEqual(tools[1].inputSchema.required, ['mappingId']);
  assert.deepEqual(Object.keys(
    (tools[1].inputSchema.properties as Record<string, unknown>),
  ), ['mappingId']);
  assert.equal(tools[1].inputSchema.additionalProperties, false);
  assert.ok(manifest.contributes.commands.some(
    (command) => command.command === 'voiceInput.manageCustomMappings',
  ));
});

test('voice mapping routing resolves exact local authority before remote planning', async () => {
  const events: string[] = [];
  let planned = false;
  const result = await routeVoiceMappingRequest('format this', snapshot, 'utterance-1', {
    matchPhrase: (phrase) => {
      events.push(`match:${phrase}`);
      return mapping;
    },
    request: (requested, target, utteranceId) => {
      events.push(`request:${requested.id}:${target.activeTabIdentity}:${utteranceId}`);
    },
    confirm: async () => { events.push('confirm'); },
    cancel: () => { events.push('cancel'); },
  });
  if (!result.handled) planned = true;

  assert.deepEqual(result, { handled: true, kind: 'mapping' });
  assert.equal(planned, false);
  assert.deepEqual(events, [
    'match:format this',
    'request:vm_abcdefghijklmnopqrstuv:tab-1:utterance-1',
  ]);
});

test('local confirmation is consumed without consulting mappings or remote planning', async () => {
  const events: string[] = [];
  const result = await routeVoiceMappingRequest('confirm action', snapshot, 'utterance-2', {
    matchPhrase: () => { events.push('match'); return mapping; },
    request: () => { events.push('request'); },
    confirm: async (id) => { events.push(`confirm:${id}`); },
    cancel: () => { events.push('cancel'); },
  });

  assert.deepEqual(result, { handled: true, kind: 'confirmation' });
  assert.deepEqual(events, ['confirm:utterance-2']);
});

test('an unmatched request invalidates custom authority before remote planning', async () => {
  const events: string[] = [];
  const result = await routeVoiceMappingRequest('explain this', snapshot, 'utterance-3', {
    matchPhrase: () => { events.push('match'); return undefined; },
    request: () => { events.push('request'); },
    confirm: async () => { events.push('confirm'); },
    cancel: (announce) => { events.push(`cancel:${String(announce)}`); },
  });
  if (!result.handled) events.push('remote-plan');

  assert.deepEqual(result, { handled: false, kind: 'unmatched' });
  assert.deepEqual(events, ['match', 'cancel:false', 'remote-plan']);
});
