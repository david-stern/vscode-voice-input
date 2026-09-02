import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Git adapter uses vscode.git APIs only and contains no shell fallback', async () => {
  const source = await readFile('src/platform/vscodeGitHost.ts', 'utf8');
  assert.match(source, /getExtension<GitExtension>\('vscode\.git'\)/u);
  assert.doesNotMatch(source, /from ['"]node:child_process['"]|execFile\(|spawn\(|createTerminal\(|sendText\(/u);
  for (const method of [
    'repository.commit', 'repository.push', 'repository.pull', 'repository.fetch',
    'repository.checkout', 'repository.branch', 'repository.add', 'repository.revert',
  ]) assert.match(source, new RegExp(method.replace('.', '\\.'), 'u'));
  assert.match(source, /vscode\.env\.remoteName !== undefined/u);
});
