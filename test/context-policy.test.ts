import assert from 'node:assert/strict';
import test from 'node:test';

import {
  captureTargetSnapshot,
  revalidateTargetSnapshot,
  type RequestedTargetKind,
  type ResolvedTargetKind,
  type TargetSnapshot,
} from '../src/assistant/context';
import {
  MAX_REPEAT_AGE_MS,
  SAFE_ASSISTANT_ACTIONS,
  SafeActionPolicy,
  insertTerminalText,
  isSafeAssistantAction,
  validateTerminalText,
} from '../src/assistant/policy';
import {
  BUILTIN_CHAT_OPEN_COMMAND,
  builtInChatDraftArguments,
} from '../src/assistant/chat';

function snapshot(options: {
  requested?: RequestedTargetKind;
  focused?: ResolvedTargetKind;
  vscodeFocused?: boolean;
  tab?: string | null;
  editor?: string | null;
  terminal?: string | null;
  now?: number;
} = {}): TargetSnapshot {
  return captureTargetSnapshot(
    {
      requestedTarget: options.requested ?? 'here',
      focusedTarget:
        options.focused === undefined || options.focused === 'unknown'
          ? null
          : options.focused,
      vscodeFocused: options.vscodeFocused ?? true,
      activeTabIdentity: options.tab === undefined ? 'tab-1' : options.tab,
      activeEditorIdentity: options.editor ?? 'editor-1',
      activeTerminalIdentity: options.terminal ?? 'terminal-1',
    },
    options.now ?? 1_000,
  );
}

test('write-here uses known focus instead of mistaking an active editor for focus', () => {
  const chat = snapshot({ focused: 'chat', editor: 'editor-still-active' });
  assert.equal(chat.resolvedTarget, 'chat');

  const decision = new SafeActionPolicy().authorizeWrite(
    'write-here',
    'שלום',
    chat,
    chat,
  );
  assert.equal(decision.allowed, true);
  if (!decision.allowed || decision.instruction.kind !== 'write') {
    assert.fail('write should be authorized for the focused chat');
  }
  assert.equal(decision.instruction.target, 'chat');
});

test('opaque focus is represented honestly as a generic focused control', () => {
  const ambiguous = snapshot({ focused: 'unknown' });
  assert.equal(ambiguous.resolvedTarget, 'focused-control');
  assert.equal(ambiguous.focusedTarget, 'focused-control');
  const decision = new SafeActionPolicy().authorizeWrite(
    'write-here',
    'write to the actual focused control without naming it',
    ambiguous,
    ambiguous,
  );
  assert.equal(decision.allowed, true);
  if (!decision.allowed || decision.instruction.kind !== 'write') {
    assert.fail('the generic current control should be usable without mislabeling it');
  }
  assert.equal(decision.instruction.target, 'focused-control');
});

test('revalidation cancels on focus, tab, editor, and terminal changes', () => {
  const editor = snapshot({ requested: 'editor', focused: 'editor' });
  assert.deepEqual(revalidateTargetSnapshot(editor, { ...editor, vscodeFocused: false }), {
    valid: false,
    reason: 'vscode-not-focused',
  });
  assert.deepEqual(
    revalidateTargetSnapshot(editor, { ...editor, activeTabIdentity: 'tab-2' }),
    { valid: false, reason: 'tab-changed' },
  );
  assert.deepEqual(
    revalidateTargetSnapshot(editor, { ...editor, activeEditorIdentity: 'editor-2' }),
    { valid: false, reason: 'editor-changed' },
  );

  const terminal = snapshot({ requested: 'terminal', focused: 'terminal' });
  assert.deepEqual(
    revalidateTargetSnapshot(terminal, {
      ...terminal,
      activeTerminalIdentity: 'terminal-2',
    }),
    { valid: false, reason: 'terminal-changed' },
  );
});

test('the action vocabulary is closed and excludes commands, keys, selectors, and coordinates', () => {
  assert.deepEqual(SAFE_ASSISTANT_ACTIONS, [
    'write-here',
    'write-editor',
    'write-terminal',
    'write-chat',
    'repeat-last',
    'open-chat',
    'open-terminal',
    'open-settings',
    'request-send',
    'confirm-send',
    'stop-listening',
    'answer-only',
  ]);
  for (const unsafe of ['run-command', 'press-key', 'click-selector', 'click-coordinate']) {
    assert.equal(isSafeAssistantAction(unsafe), false);
  }
});

test('terminal text rejects line breaks and all C0/C1 controls and never executes', () => {
  for (const unsafe of ['echo one\necho two', 'echo one\recho two', 'tab\ttext', `nul${String.fromCharCode(0)}text`, `c1${String.fromCharCode(0x85)}text`, 'line\u2028separator', 'paragraph\u2029separator']) {
    assert.equal(validateTerminalText(unsafe)?.code, 'unsafe-terminal-text');
  }

  const calls: Array<[string, boolean]> = [];
  const terminal = snapshot({ requested: 'terminal', focused: 'terminal' });
  const result = insertTerminalText(
    { sendText: (text, shouldExecute) => calls.push([text, shouldExecute]) },
    'npm test',
    terminal,
    terminal,
  );
  assert.equal(result.allowed, true);
  assert.deepEqual(calls, [['npm test', false]]);

  const changed = insertTerminalText(
    { sendText: (text, shouldExecute) => calls.push([text, shouldExecute]) },
    'npm test',
    terminal,
    { ...terminal, activeTerminalIdentity: 'terminal-2' },
  );
  assert.equal(changed.allowed, false);
  assert.deepEqual(calls, [['npm test', false]]);
});

test('an explicitly requested chat cannot arm send unless chat focus was actually proven', () => {
  const policy = new SafeActionPolicy();
  const editorFocused = snapshot({ requested: 'chat', focused: 'editor', tab: 'editor-tab' });
  assert.equal(editorFocused.resolvedTarget, 'chat');
  assert.equal(editorFocused.focusedTarget, 'editor');
  const refused = policy.requestSend(editorFocused, 'request-editor', 10_000);
  assert.equal(refused.allowed, false);
  if (refused.allowed) assert.fail('requested target must not override actual focus proof');
  assert.equal(refused.explanation.code, 'send-target-not-chat');

  const noTab = snapshot({ requested: 'chat', focused: 'chat', tab: null });
  assert.equal(policy.requestSend(noTab, 'request-no-tab', 10_000).allowed, false);
});

test('send confirmation must be later and cannot be replayed across requests', () => {
  const policy = new SafeActionPolicy();
  const chat = snapshot({ requested: 'chat', focused: 'chat', tab: 'chat-tab' });
  assert.equal(policy.requestSend(chat, 'request-1', 10_000).allowed, true);
  const notLater = policy.confirmSend(chat, 'confirmation-1', 10_000);
  assert.equal(notLater.allowed, false);
  if (notLater.allowed) assert.fail('same-time confirmation must fail');
  assert.equal(notLater.explanation.code, 'confirmation-not-later');

  assert.equal(policy.requestSend(chat, 'request-2', 20_000).allowed, true);
  assert.equal(policy.confirmSend(chat, 'confirmation-1', 20_001).allowed, true);
  assert.equal(policy.requestSend(chat, 'request-3', 30_000).allowed, true);
  const replay = policy.confirmSend(chat, 'confirmation-1', 30_001);
  assert.equal(replay.allowed, false);
  if (replay.allowed) assert.fail('confirmation ID replay must fail');
  assert.equal(replay.explanation.code, 'confirmation-replayed');
});

test('a documented partial-query draft can arm confirmation without claiming DOM focus', () => {
  const policy = new SafeActionPolicy();
  const generic = snapshot({ focused: 'unknown', tab: 'editor-tab' });
  assert.equal(generic.focusedTarget, 'focused-control');
  assert.equal(policy.requestPreparedChatSend(generic, 'request-draft', 5_000).allowed, true);
  const confirmed = policy.confirmSend(generic, 'explicit-confirmation', 5_001);
  assert.equal(confirmed.allowed, true);
  if (!confirmed.allowed) assert.fail('supported API draft should accept a later local confirmation');
  assert.equal(confirmed.instruction.kind, 'emit-enter');
});

test('send needs a distinct confirmation and matching focused chat snapshot', () => {
  const policy = new SafeActionPolicy({ sendConfirmationTtlMs: 2_000 });
  const chat = snapshot({ requested: 'chat', focused: 'chat', tab: 'chat-tab' });
  const pending = policy.requestSend(chat, 'utterance-request', 10_000);
  assert.equal(pending.allowed, true);

  const sameUtterance = policy.confirmSend(chat, 'utterance-request', 10_100);
  assert.equal(sameUtterance.allowed, false);
  if (sameUtterance.allowed) assert.fail('same utterance must not confirm sending');
  assert.equal(sameUtterance.explanation.code, 'same-utterance-confirmation');
  assert.equal(policy.getPendingSend(10_100), null);

  policy.requestSend(chat, 'utterance-request-2', 20_000);
  const changedTab = policy.confirmSend(
    { ...chat, activeTabIdentity: 'different-chat-tab' },
    'utterance-confirm-2',
    20_100,
  );
  assert.equal(changedTab.allowed, false);
  if (changedTab.allowed) assert.fail('changed chat must not receive Enter');
  assert.equal(changedTab.explanation.code, 'tab-changed');
  assert.equal(policy.getPendingSend(20_100), null);

  policy.requestSend(chat, 'utterance-request-3', 30_000);
  const confirmed = policy.confirmSend(chat, 'utterance-confirm-3', 30_100);
  assert.equal(confirmed.allowed, true);
  if (!confirmed.allowed) assert.fail('separate matching confirmation should pass');
  assert.equal(confirmed.instruction.kind, 'emit-enter');
});

test('pending send expires, clears itself, and rejects focus loss', () => {
  const policy = new SafeActionPolicy({ sendConfirmationTtlMs: 1_000 });
  const chat = snapshot({ requested: 'chat', focused: 'chat' });
  policy.requestSend(chat, 'request-1', 1_000);
  const expired = policy.confirmSend(chat, 'confirm-1', 2_001);
  assert.equal(expired.allowed, false);
  if (expired.allowed) assert.fail('expired confirmation must fail');
  assert.equal(expired.explanation.code, 'send-confirmation-expired');

  policy.requestSend(chat, 'request-2', 3_000);
  const unfocused = policy.confirmSend(
    { ...chat, vscodeFocused: false },
    'confirm-2',
    3_100,
  );
  assert.equal(unfocused.allowed, false);
  if (unfocused.allowed) assert.fail('focus loss must fail');
  assert.equal(unfocused.explanation.code, 'vscode-not-focused');
  assert.equal(policy.getPendingSend(3_100), null);
});

test('repeat-last is in memory for at most five minutes and targets current context', () => {
  const policy = new SafeActionPolicy();
  assert.equal(
    policy.rememberLast({ action: 'write-chat', text: 'repeat me' }, 10_000).allowed,
    true,
  );

  const currentEditor = snapshot({
    requested: 'here',
    focused: 'editor',
    tab: 'new-tab',
    editor: 'new-editor',
    now: 20_000,
  });
  const repeated = policy.repeatLast(currentEditor, 20_000);
  assert.equal(repeated.allowed, true);
  if (!repeated.allowed) assert.fail('recent action should repeat');
  assert.equal(repeated.instruction.action, 'write-editor');
  assert.equal(repeated.instruction.snapshot, currentEditor);
  assert.equal(repeated.instruction.text, 'repeat me');

  const expired = policy.repeatLast(currentEditor, 10_000 + MAX_REPEAT_AGE_MS + 1);
  assert.equal(expired.allowed, false);
  if (expired.allowed) assert.fail('old action must be forgotten');
  assert.equal(expired.explanation.code, 'repeat-action-expired');
});

test('built-in chat drafts use the documented partial-query command shape', () => {
  assert.equal(BUILTIN_CHAT_OPEN_COMMAND, 'workbench.action.chat.open');
  assert.deepEqual(builtInChatDraftArguments('שלום'), {
    query: 'שלום',
    isPartialQuery: true,
  });
  assert.throws(() => builtInChatDraftArguments('   '), RangeError);
});
