import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';

import { captureTargetSnapshot, type TargetProbe } from '../src/assistant/context';
import {
  autoDispatchTargetFingerprint,
  builtinAuthorityFingerprint,
  promptTargetFingerprint,
  targetFingerprint,
} from '../src/platform/promptBinding';

test('host module inventory stays bounded', async () => {
  const sourceFiles = await listTypeScriptFiles(resolve('src'));
  const lineCounts = new Map<string, number>();
  for (const file of sourceFiles) {
    const source = await readFile(file, 'utf8');
    lineCounts.set(relative(process.cwd(), file), source.split('\n').length);
  }

  assert.ok((lineCounts.get('src/extension.ts') ?? Infinity) <= 300);
  const oversized = [...lineCounts]
    .filter(([, lines]) => lines > 500)
    .map(([file]) => file)
    .sort();
  assert.deepEqual(oversized, []);
});

test('production TypeScript imports have no dependency cycles', async () => {
  const files = await listTypeScriptFiles(resolve('src'));
  const known = new Set(files);
  const graph = new Map<string, string[]>();
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const dependencies: string[] = [];
    for (const match of source.matchAll(
      /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"](\.[^'"]+)['"]/gu,
    )) {
      const dependency = resolveLocalImport(file, match[1], known);
      if (dependency) dependencies.push(dependency);
    }
    graph.set(file, dependencies);
  }

  assert.deepEqual(findCycles(graph), []);
});

test('prompt bindings survive a native modal that blurs the window and burns the clock', () => {
  const probe: TargetProbe = {
    requestedTarget: 'here',
    focusedTarget: 'editor',
    vscodeFocused: true,
    activeTabIdentity: 'tab-1',
    activeEditorIdentity: 'editor-1',
    activeTerminalIdentity: null,
  };
  const beforePrompt = captureTargetSnapshot(probe, 1_000);
  // The modal takes focus from its own window and the user reads it for a few seconds.
  const afterPrompt = captureTargetSnapshot({ ...probe, vscodeFocused: false }, 9_000);

  assert.equal(promptTargetFingerprint(beforePrompt), promptTargetFingerprint(afterPrompt));
  assert.notEqual(
    targetFingerprint(beforePrompt),
    targetFingerprint(afterPrompt),
    'the raw snapshot fingerprint is time- and focus-bound, so it can never bind a prompt',
  );
  assert.notEqual(
    targetFingerprint(beforePrompt),
    targetFingerprint(captureTargetSnapshot(probe, 9_000)),
    'capturedAt alone already breaks equality',
  );

  for (const moved of [
    { ...probe, activeEditorIdentity: 'editor-2' },
    { ...probe, activeTabIdentity: 'tab-2' },
    { ...probe, activeTerminalIdentity: 'terminal-1' },
    { ...probe, requestedTarget: 'terminal' as const },
    { ...probe, focusedTarget: 'chat' as const },
  ]) {
    assert.notEqual(
      promptTargetFingerprint(beforePrompt),
      promptTargetFingerprint(captureTargetSnapshot({ ...moved, vscodeFocused: false }, 9_000)),
      `a changed target must not keep the binding: ${JSON.stringify(moved)}`,
    );
  }

  // Auto Mode dispatches without a modal, so only the clock is normalized there.
  const laterSameTarget = captureTargetSnapshot(probe, 9_000);
  assert.equal(
    autoDispatchTargetFingerprint(beforePrompt),
    autoDispatchTargetFingerprint(laterSameTarget),
    'an unchanged target must survive the request-to-dispatch delay',
  );
  assert.notEqual(
    autoDispatchTargetFingerprint(beforePrompt),
    autoDispatchTargetFingerprint(afterPrompt),
    'window focus intentionally still binds the Auto dispatch path',
  );
  for (const moved of [
    { ...probe, activeEditorIdentity: 'editor-2' },
    { ...probe, activeTabIdentity: 'tab-2' },
    { ...probe, activeTerminalIdentity: 'terminal-1' },
    { ...probe, requestedTarget: 'terminal' as const },
  ]) {
    assert.notEqual(
      autoDispatchTargetFingerprint(beforePrompt),
      autoDispatchTargetFingerprint(captureTargetSnapshot(moved, 9_000)),
      `a changed target must break the Auto binding: ${JSON.stringify(moved)}`,
    );
  }

  const bound = builtinAuthorityFingerprint({ panelGeneration: 2, workspaceTrusted: true });
  assert.equal(bound, builtinAuthorityFingerprint({ panelGeneration: 2, workspaceTrusted: true }));
  assert.notEqual(bound, builtinAuthorityFingerprint({ panelGeneration: 3, workspaceTrusted: true }));
  assert.notEqual(bound, builtinAuthorityFingerprint({ panelGeneration: 2, workspaceTrusted: false }));
  assert.equal(builtinAuthorityFingerprint({ panelGeneration: -1, workspaceTrusted: true }), '');
  assert.equal(builtinAuthorityFingerprint({ panelGeneration: 1.5, workspaceTrusted: true }), '');
});

test('native confirmation paths bind trust before the modal and never re-check focus after', async () => {
  // A native modal takes focus away from the window that requested it, so a post-modal
  // focus recheck cancels the confirmation it belongs to. src/inject.ts is exempt because
  // its focus reads guard OS-level keystroke delivery, not a prompt binding.
  const exempt = new Set(['src/inject.ts']);
  const offenders: string[] = [];
  for (const file of await listTypeScriptFiles(resolve('src'))) {
    const relativePath = relative(process.cwd(), file);
    if (exempt.has(relativePath)) continue;
    const source = await readFile(file, 'utf8');
    const modal = source.indexOf('showWarningMessage(');
    if (modal < 0) continue;
    if (source.slice(modal).includes('window.state.focused')) offenders.push(relativePath);
  }
  assert.deepEqual(offenders, []);

  // The assistant listens in the background, so a spoken builtin command must be able to
  // raise its confirmation while the user works in another application. Workspace trust
  // still gates that modal, and it is still checked before the modal is raised.
  const builtin = await readFile(resolve('src/platform/builtinVoiceCoordinator.ts'), 'utf8');
  const trustGate = builtin.indexOf(
    'allowsBuiltinConfirmationPrompt({ workspaceTrusted: vscode.workspace.isTrusted })',
  );
  assert.ok(trustGate >= 0, 'builtinVoiceCoordinator must still require a trusted workspace');
  assert.ok(
    trustGate < builtin.indexOf('showWarningMessage('),
    'the builtin trust gate must precede the modal',
  );

  // One read each, so focus cannot creep back into a binding that is composed before the
  // modal and compared after it. The behavioural fingerprint test above covers the rest.
  for (const [path, reads] of [
    ['src/platform/builtinVoiceCoordinator.ts', 0],
    ['src/platform/builtinConfirmationGate.ts', 0],
    ['src/platform/runtimeCoordinator.ts', 0],
    ['src/platform/voiceAuthorityCoordinator.ts', 1],
    ['src/platform/promptBinding.ts', 0],
  ] as const) {
    const source = await readFile(resolve(path), 'utf8');
    assert.equal(source.split('window.state.focused').length - 1, reads, `${path} focus reads`);
  }
});

test('feature layer has no VS Code runtime dependency', async () => {
  const files = await listTypeScriptFiles(resolve('src/features'));
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /from\s+['"]vscode['"]|\bvscode\./u, relative(process.cwd(), file));
  }
});

async function listTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  }));
  return files.flat();
}

function resolveLocalImport(
  importer: string,
  specifier: string,
  known: ReadonlySet<string>,
): string | undefined {
  const base = resolve(dirname(importer), specifier);
  return [`${base}.ts`, join(base, 'index.ts')].find((candidate) => known.has(candidate));
}

function findCycles(graph: ReadonlyMap<string, readonly string[]>): string[][] {
  const visiting = new Set<string>();
  const completed = new Set<string>();
  const cycles: string[][] = [];
  const visit = (file: string, stack: string[]) => {
    if (visiting.has(file)) {
      const start = stack.indexOf(file);
      cycles.push(stack.slice(start).concat(file).map((entry) => relative(process.cwd(), entry)));
      return;
    }
    if (completed.has(file)) return;
    visiting.add(file);
    stack.push(file);
    for (const dependency of graph.get(file) ?? []) visit(dependency, stack);
    stack.pop();
    visiting.delete(file);
    completed.add(file);
  };
  for (const file of graph.keys()) visit(file, []);
  return cycles;
}
