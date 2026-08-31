import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_PLANNER_RESPONSE_BYTES,
  OpenAICompatibleChatPlannerClient,
  PLANNER_TARGETS,
  PROVIDER_DESCRIPTORS,
  PROVIDER_IDS,
  PlannerError,
  REMOTE_PLANNER_ACTIONS,
  createPlannerClient,
  parseAssistantPlan,
  type AssistantPlan,
  type PlannerInput,
  type ProviderId,
} from '../src/inference';

const INPUT: PlannerInput = {
  postWakeRequest: 'כתוב כאן סיכום קצר',
  persona: 'teacher-lecturer',
  locale: 'he',
  target: { kind: 'editor', vscodeFocused: true },
};

const VALID_PLAN: AssistantPlan = {
  action: 'write-editor',
  target: 'editor',
  content: 'סיכום קצר',
  spokenReply: 'אני מציעה לכתוב סיכום קצר בעורך.',
  reason: 'העורך הוא היעד הפעיל שביקשת.',
  confidence: 0.94,
  requiresConfirmation: false,
};

interface AdapterCase {
  id: ProviderId;
  url: string;
  envelope(content: string): unknown;
  assertRequest(body: Record<string, unknown>, headers: Record<string, string>): void;
}

const CHAT_ENVELOPE = (content: string) => ({
  choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }],
});

const ADAPTER_CASES: readonly AdapterCase[] = [
  {
    id: 'deepseek',
    url: 'https://api.deepseek.com/chat/completions',
    envelope: CHAT_ENVELOPE,
    assertRequest: assertOpenAIChatRequest,
  },
  {
    id: 'anthropic',
    url: 'https://api.anthropic.com/v1/messages',
    envelope: (content) => ({
      role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: content }],
    }),
    assertRequest: (body, headers) => {
      assert.equal(headers['x-api-key'], 'test-secret');
      assert.equal(headers['anthropic-version'], '2023-06-01');
      assert.equal(body.stream, false);
      assert.equal(typeof body.system, 'string');
      assert.deepEqual((body.messages as Array<{ role: string }>).map(({ role }) => role), ['user']);
      assert.equal('tools' in body, false);
    },
  },
  {
    id: 'openai',
    url: 'https://api.openai.com/v1/responses',
    envelope: (content) => ({
      status: 'completed',
      error: null,
      incomplete_details: null,
      output: [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: content }],
      }],
    }),
    assertRequest: (body, headers) => {
      assert.equal(headers.Authorization, 'Bearer test-secret');
      assert.equal(body.stream, false);
      assert.equal(body.store, false);
      assert.deepEqual(body.tools, []);
      assert.equal(body.parallel_tool_calls, false);
      const text = body.text as { format: { type: string; strict: boolean } };
      assert.equal(text.format.type, 'json_schema');
      assert.equal(text.format.strict, true);
      assert.equal(typeof body.instructions, 'string');
      assert.equal(typeof body.input, 'string');
    },
  },
  {
    id: 'gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent',
    envelope: (content) => ({
      candidates: [{
        finishReason: 'STOP',
        content: { role: 'model', parts: [{ text: content }] },
      }],
    }),
    assertRequest: (body, headers) => {
      assert.equal(headers['x-goog-api-key'], 'test-secret');
      assert.deepEqual((body.contents as Array<{ role: string }>).map(({ role }) => role), ['user']);
      const config = body.generationConfig as Record<string, unknown>;
      assert.equal(config.responseMimeType, 'application/json');
      assert.equal(typeof config.responseJsonSchema, 'object');
      assert.equal('tools' in body, false);
    },
  },
  {
    id: 'openrouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    envelope: CHAT_ENVELOPE,
    assertRequest: assertOpenAIChatRequest,
  },
  {
    id: 'ollama',
    url: 'http://127.0.0.1:11434/api/chat',
    envelope: (content) => ({
      done: true,
      done_reason: 'stop',
      message: { role: 'assistant', content },
    }),
    assertRequest: (body, headers) => {
      assert.equal(headers.Authorization, undefined);
      assert.equal(body.stream, false);
      assert.equal(body.think, false);
      assert.equal(typeof body.format, 'object');
      assert.deepEqual((body.messages as Array<{ role: string }>).map(({ role }) => role), [
        'system',
        'user',
      ]);
      assert.equal('tools' in body, false);
    },
  },
  {
    id: 'bedrock',
    url: 'https://bedrock-runtime.us-east-1.amazonaws.com/model/us.anthropic.claude-sonnet-4-6/converse',
    envelope: (content) => ({
      stopReason: 'end_turn',
      output: { message: { role: 'assistant', content: [{ text: content }] } },
    }),
    assertRequest: (body, headers) => {
      assert.equal(headers.Authorization, 'Bearer test-secret');
      assert.equal(Array.isArray(body.system), true);
      assert.deepEqual((body.messages as Array<{ role: string }>).map(({ role }) => role), ['user']);
      const output = body.outputConfig as {
        textFormat: { type: string; structure: { jsonSchema: { schema: string } } };
      };
      assert.equal(output.textFormat.type, 'json_schema');
      assert.equal(JSON.parse(output.textFormat.structure.jsonSchema.schema).additionalProperties, false);
      assert.equal('toolConfig' in body, false);
    },
  },
  {
    id: 'grok',
    url: 'https://api.x.ai/v1/chat/completions',
    envelope: CHAT_ENVELOPE,
    assertRequest: assertOpenAIChatRequest,
  },
];

function assertOpenAIChatRequest(
  body: Record<string, unknown>,
  headers: Record<string, string>,
): void {
  assert.equal(headers.Authorization, 'Bearer test-secret');
  assert.equal(body.stream, false);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.deepEqual((body.messages as Array<{ role: string }>).map(({ role }) => role), [
    'system',
    'user',
  ]);
  assert.equal('tools' in body, false);
}

function clientError(code: PlannerError['code']): (error: unknown) => boolean {
  return (error) => error instanceof PlannerError && error.code === code;
}

function optionsFor(id: ProviderId, fetch: typeof globalThis.fetch) {
  return {
    provider: id,
    apiKey: id === 'ollama' ? undefined : 'test-secret',
    fetch,
  };
}

test('descriptors cover exactly the eight supported providers with complete immutable metadata', () => {
  assert.deepEqual(PROVIDER_IDS, [
    'deepseek',
    'anthropic',
    'openai',
    'gemini',
    'openrouter',
    'ollama',
    'bedrock',
    'grok',
  ]);
  assert.deepEqual(PROVIDER_DESCRIPTORS.map(({ id }) => id), PROVIDER_IDS);
  assert.equal(new Set(PROVIDER_DESCRIPTORS.map(({ id }) => id)).size, PROVIDER_IDS.length);
  for (const descriptor of PROVIDER_DESCRIPTORS) {
    assert.ok(descriptor.name.length > 1);
    assert.doesNotThrow(() => new URL(descriptor.defaultEndpoint));
    assert.equal(descriptor.modelEditable, true);
    assert.ok(descriptor.defaultModel.length > 0);
    assert.ok(descriptor.modelPresets.includes(descriptor.defaultModel));
    assert.ok(descriptor.modelPresets.length > 0);
    assert.equal(descriptor.capabilities.systemInstruction, true);
    assert.equal(descriptor.capabilities.streaming, false);
    assert.equal(descriptor.capabilities.tools, false);
    assert.ok(['json-schema', 'json-object', 'prompt-only'].includes(
      descriptor.capabilities.structuredOutput,
    ));
    assert.equal(Object.isFrozen(descriptor), true);
    assert.equal(Object.isFrozen(descriptor.modelPresets), true);
  }
  const ollama = PROVIDER_DESCRIPTORS.find(({ id }) => id === 'ollama');
  assert.deepEqual(ollama?.locality, {
    kind: 'endpoint-dependent',
    defaultIsLocal: true,
    localOnlyWhenLoopback: true,
  });
  assert.equal(PROVIDER_DESCRIPTORS.filter(({ locality }) => locality.kind === 'remote').length, 7);
});

for (const adapter of ADAPTER_CASES) {
  test(`${adapter.id} emits its native non-streaming request and parses the shared plan`, async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const planner = createPlannerClient(optionsFor(adapter.id, async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return Response.json(adapter.envelope(JSON.stringify(VALID_PLAN)));
    }));
    assert.equal(planner.provider, adapter.id);
    assert.deepEqual(await planner.plan(INPUT), VALID_PLAN);
    assert.equal(capturedUrl, adapter.url);
    assert.equal(capturedInit?.method, 'POST');
    assert.ok(capturedInit?.signal instanceof AbortSignal);
    const headers = capturedInit?.headers as Record<string, string>;
    assert.equal(headers['Content-Type'], 'application/json');
    const body = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
    adapter.assertRequest(body, headers);
    assert.equal(String(capturedInit?.body).includes('test-secret'), false);
  });
}

test('only minimal planning context crosses every provider boundary', async () => {
  const sentinels = [
    'DOCUMENT_SENTINEL',
    'CLIPBOARD_SENTINEL',
    'SCREENSHOT_SENTINEL',
    'CHAT_HISTORY_SENTINEL',
    'TERMINAL_HISTORY_SENTINEL',
    'SELECTION_SENTINEL',
    'MAPPING_SENTINEL',
  ];
  const rogue = {
    ...INPUT,
    document: sentinels[0],
    clipboard: sentinels[1],
    screenshot: sentinels[2],
    chatHistory: sentinels[3],
    mappingCatalog: sentinels[6],
    target: {
      ...INPUT.target,
      terminalHistory: sentinels[4],
      selection: sentinels[5],
    },
  } as PlannerInput;
  await Promise.all(ADAPTER_CASES.map(async (adapter) => {
    let requestBody = '';
    const planner = createPlannerClient(optionsFor(adapter.id, async (_input, init) => {
      requestBody = String(init?.body);
      return Response.json(adapter.envelope(JSON.stringify(VALID_PLAN)));
    }));
    await planner.plan(rogue);
    for (const sentinel of sentinels) assert.equal(requestBody.includes(sentinel), false);
  }));
});

test('model, credential, endpoint, and adapter capability validation fail before dispatch', async () => {
  let calls = 0;
  const fetch = async () => {
    calls += 1;
    return Response.json(CHAT_ENVELOPE(JSON.stringify(VALID_PLAN)));
  };
  await assert.rejects(
    createPlannerClient({ provider: 'deepseek', model: 'bad model', apiKey: 'secret', fetch }).plan(INPUT),
    clientError('invalid-input'),
  );
  await assert.rejects(
    createPlannerClient({ provider: 'deepseek', apiKey: '', fetch }).plan(INPUT),
    clientError('invalid-input'),
  );
  await assert.rejects(
    createPlannerClient({
      provider: 'openai', apiKey: 'secret', endpoint: 'http://api.openai.example/v1/responses', fetch,
    }).plan(INPUT),
    clientError('invalid-input'),
  );
  await assert.rejects(
    createPlannerClient({
      provider: 'ollama', endpoint: 'http://192.168.1.5:11434/api/chat', fetch,
    }).plan(INPUT),
    clientError('invalid-input'),
  );
  assert.throws(
    () => new OpenAICompatibleChatPlannerClient('openai' as 'deepseek'),
    clientError('unsupported-capability'),
  );
  assert.throws(
    () => createPlannerClient({ provider: 'unknown' as ProviderId }),
    clientError('invalid-input'),
  );
  assert.equal(calls, 0);
});

test('native response adapters reject refusals, truncation, and authority-bearing blocks', async () => {
  const invalidCases: Array<{ id: ProviderId; envelope: unknown }> = [
    {
      id: 'deepseek',
      envelope: {
        choices: [{
          finish_reason: 'tool_calls',
          message: { content: JSON.stringify(VALID_PLAN), tool_calls: [{ function: { name: 'run' } }] },
        }],
      },
    },
    {
      id: 'openai',
      envelope: {
        status: 'completed',
        output: [{ type: 'function_call', name: 'run_command', arguments: '{}' }],
      },
    },
    {
      id: 'anthropic',
      envelope: {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', name: 'run_command', input: {} }],
      },
    },
    {
      id: 'gemini',
      envelope: {
        candidates: [{
          finishReason: 'MAX_TOKENS',
          content: { parts: [{ text: JSON.stringify(VALID_PLAN) }] },
        }],
      },
    },
    {
      id: 'ollama',
      envelope: {
        done: true,
        message: { content: JSON.stringify(VALID_PLAN), tool_calls: [{ function: { name: 'run' } }] },
      },
    },
    {
      id: 'bedrock',
      envelope: {
        stopReason: 'max_tokens',
        output: { message: { content: [{ text: JSON.stringify(VALID_PLAN) }] } },
      },
    },
  ];
  await Promise.all(invalidCases.map(async ({ id, envelope }) => {
    const planner = createPlannerClient(optionsFor(id, async () => Response.json(envelope)));
    await assert.rejects(planner.plan(INPUT), clientError('invalid-response'));
  }));
});

test('every provider rejects model attempts to grant send-confirmation authority', async () => {
  const authorityExpansion = JSON.stringify({
    ...VALID_PLAN,
    action: 'confirm-send',
    target: 'current',
    content: null,
  });
  assert.equal(REMOTE_PLANNER_ACTIONS.includes('confirm-send' as never), false);
  assert.equal(PLANNER_TARGETS.includes('none'), true);
  assert.throws(() => parseAssistantPlan(authorityExpansion), clientError('invalid-response'));

  await Promise.all(ADAPTER_CASES.map(async (adapter) => {
    const planner = createPlannerClient(optionsFor(
      adapter.id,
      async () => Response.json(adapter.envelope(authorityExpansion)),
    ));
    await assert.rejects(planner.plan(INPUT), clientError('invalid-response'));
  }));
});

test('malformed and oversized responses fail closed', async () => {
  const malformed = createPlannerClient({
    provider: 'deepseek',
    apiKey: 'secret',
    fetch: async () => Response.json(CHAT_ENVELOPE('{"action":')),
  });
  await assert.rejects(malformed.plan(INPUT), clientError('invalid-response'));

  const oversized = createPlannerClient({
    provider: 'deepseek',
    apiKey: 'secret',
    fetch: async () => new Response('x'.repeat(MAX_PLANNER_RESPONSE_BYTES + 1)),
  });
  await assert.rejects(oversized.plan(INPUT), clientError('invalid-response'));
});

test('timeouts remain finite for all providers even when fetch ignores AbortSignal', async () => {
  const started = Date.now();
  await Promise.all(ADAPTER_CASES.map(async ({ id }) => {
    const planner = createPlannerClient({
      provider: id,
      apiKey: id === 'ollama' ? undefined : 'secret',
      timeoutMs: 10,
      fetch: async () => new Promise<Response>(() => undefined),
    });
    await assert.rejects(planner.plan(INPUT), clientError('timed-out'));
  }));
  assert.ok(Date.now() - started < 500);
});

test('a pre-aborted signal prevents dispatch for all providers', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await Promise.all(ADAPTER_CASES.map(async ({ id }) => {
    const planner = createPlannerClient({
      provider: id,
      apiKey: id === 'ollama' ? undefined : 'secret',
      fetch: async () => {
        calls += 1;
        return Response.json({});
      },
    });
    await assert.rejects(planner.plan(INPUT, controller.signal), clientError('aborted'));
  }));
  assert.equal(calls, 0);
});

test('HTTP and network failures are sanitized for every provider', async () => {
  await Promise.all(ADAPTER_CASES.flatMap(({ id }) => [
    (async () => {
      const planner = createPlannerClient(optionsFor(
        id,
        async () => new Response('PROVIDER_SECRET_BODY', { status: 429 }),
      ));
      await assert.rejects(planner.plan(INPUT), (error: unknown) => {
        const rendered = String(error);
        assert.equal(rendered.includes('PROVIDER_SECRET_BODY'), false);
        assert.equal(rendered.includes('test-secret'), false);
        assert.equal(rendered.includes(INPUT.postWakeRequest), false);
        return clientError('http-error')(error);
      });
    })(),
    (async () => {
      const planner = createPlannerClient(optionsFor(id, async () => {
        throw new Error('NETWORK_SECRET_BODY');
      }));
      await assert.rejects(planner.plan(INPUT), (error: unknown) => {
        assert.equal(String(error).includes('NETWORK_SECRET_BODY'), false);
        return clientError('network-error')(error);
      });
    })(),
  ]));
});
