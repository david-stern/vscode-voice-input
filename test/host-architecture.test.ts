import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';

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
