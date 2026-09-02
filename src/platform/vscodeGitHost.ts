import { createHash } from 'node:crypto';
import * as vscode from 'vscode';

import {
  MAX_REF_CANDIDATES,
  BuiltinTargetChangedError,
  PartialBuiltinExecutionError,
  parseCommitMessage,
  parseExistingRef,
  parseNewRef,
  type BuiltinCommandDefinition,
  type BuiltinSlotValues,
  type BuiltinTargetSnapshot,
  type GitCommandHost,
} from '../commands';

interface GitChange {
  uri: vscode.Uri;
}

interface GitBranch {
  name?: string;
  commit?: string;
  upstream?: { remote: string; name: string };
}

interface GitRepository {
  rootUri: vscode.Uri;
  state: {
    HEAD?: GitBranch;
    refs: readonly GitBranch[];
    indexChanges: readonly GitChange[];
    workingTreeChanges: readonly GitChange[];
    mergeChanges: readonly GitChange[];
  };
  add(resources: readonly vscode.Uri[]): Promise<void>;
  revert(resources: readonly vscode.Uri[]): Promise<void>;
  commit(message: string): Promise<void>;
  push(): Promise<void>;
  pull(): Promise<void>;
  fetch(): Promise<void>;
  checkout(treeish: string): Promise<void>;
  branch(name: string, checkout: boolean, ref?: string): Promise<void>;
}

interface GitApi {
  repositories: readonly GitRepository[];
}

interface GitExtension {
  enabled: boolean;
  getAPI(version: 1): GitApi;
}

/** Git built-in extension API adapter. There is intentionally no shell fallback. */
export class VsCodeGitHost implements GitCommandHost {
  async captureTarget(definition: BuiltinCommandDefinition): Promise<BuiltinTargetSnapshot> {
    const repository = await this.resolveRepository();
    return this.snapshotFor(repository, definition);
  }

  private snapshotFor(
    repository: GitRepository,
    definition: BuiltinCommandDefinition,
  ): BuiltinTargetSnapshot {
    const state = repository.state;
    const editor = vscode.window.activeTextEditor;
    const payload = {
      commandId: definition.id,
      root: repository.rootUri.toString(),
      head: state.HEAD?.commit ?? null,
      branch: state.HEAD?.name ?? null,
      upstream: state.HEAD?.upstream ?? null,
      index: identities(state.indexChanges),
      working: identities(state.workingTreeChanges),
      merge: identities(state.mergeChanges),
      workspaceFolders: (vscode.workspace.workspaceFolders ?? [])
        .map((folder) => folder.uri.toString())
        .sort(),
      editor: editor ? {
        uri: editor.document.uri.toString(),
        version: editor.document.version,
        lineCount: editor.document.lineCount,
        selections: editor.selections.map((selection) => [
          selection.anchor.line,
          selection.anchor.character,
          selection.active.line,
          selection.active.character,
        ]),
      } : null,
      workspaceTrusted: vscode.workspace.isTrusted,
      remoteName: vscode.env.remoteName ?? null,
    };
    return {
      fingerprint: digest(payload),
      workspaceTrusted: payload.workspaceTrusted,
      ...(vscode.env.remoteName === undefined ? {} : { remoteName: vscode.env.remoteName }),
    };
  }

  async isAvailable(definition: BuiltinCommandDefinition): Promise<boolean> {
    if (!vscode.workspace.isTrusted || vscode.env.remoteName !== undefined) return false;
    try {
      const repository = await this.resolveRepository();
      const state = repository.state;
      switch (definition.executorId) {
        case 'git.commitStaged': return state.indexChanges.length > 0;
        case 'git.commitAll': return dirtyChanges(state).length + state.indexChanges.length > 0;
        case 'git.push':
        case 'git.sync': return Boolean(state.HEAD?.name && state.HEAD.upstream);
        case 'git.pull': return Boolean(state.HEAD?.name);
        case 'git.fetch': return true;
        case 'git.checkoutExistingRef': return state.refs.length > 0 && state.refs.length <= MAX_REF_CANDIDATES;
        case 'git.createBranch': return Boolean(state.HEAD?.commit);
        case 'git.addCurrentResource': return this.currentIn(repository, state.workingTreeChanges);
        case 'git.unstageCurrentResource': return this.currentIn(repository, state.indexChanges);
        case 'git.addDirtyResources': return dirtyChanges(state).length > 0;
        case 'git.unstageIndexedResources': return state.indexChanges.length > 0;
        default: return false;
      }
    } catch {
      return false;
    }
  }

  async existingRefs(): Promise<readonly string[]> {
    if (vscode.env.remoteName !== undefined) return [];
    return refsFor(await this.resolveRepository());
  }

  async execute(
    definition: BuiltinCommandDefinition,
    slots: BuiltinSlotValues,
    expectedTargetFingerprint: string,
  ): Promise<void> {
    if (!vscode.workspace.isTrusted) throw new TypeError('workspace untrusted');
    if (vscode.env.remoteName !== undefined) throw new TypeError('remote git blocked');
    const repository = await this.resolveRepository();
    if (this.snapshotFor(repository, definition).fingerprint !== expectedTargetFingerprint) {
      throw new BuiltinTargetChangedError();
    }
    const state = repository.state;
    switch (definition.executorId) {
      case 'git.commitStaged':
        if (state.indexChanges.length < 1) throw new TypeError('no staged resources');
        await repository.commit(commitMessage(slots.message));
        return;
      case 'git.commitAll': {
        const resources = dirtyChanges(state).map((change) => change.uri);
        if (resources.length + state.indexChanges.length < 1) throw new TypeError('no changes');
        if (resources.length > 0) await repository.add(resources);
        try {
          await repository.commit(commitMessage(slots.message));
        } catch (error) {
          if (resources.length > 0) throw new PartialBuiltinExecutionError();
          throw error;
        }
        return;
      }
      case 'git.push':
        if (!state.HEAD?.name || !state.HEAD.upstream) throw new TypeError('upstream unavailable');
        await repository.push(); return;
      case 'git.pull':
        if (!state.HEAD?.name) throw new TypeError('branch unavailable');
        await repository.pull(); return;
      case 'git.fetch': await repository.fetch(); return;
      case 'git.sync':
        if (!state.HEAD?.name || !state.HEAD.upstream) throw new TypeError('upstream unavailable');
        await repository.pull();
        try {
          await repository.push();
        } catch {
          throw new PartialBuiltinExecutionError();
        }
        return;
      case 'git.checkoutExistingRef': {
        const parsed = parseExistingRef(stringSlot(slots.branch), refsFor(repository));
        if (!parsed.ok || typeof parsed.value !== 'string') throw new TypeError('invalid existing ref');
        await repository.checkout(parsed.value);
        return;
      }
      case 'git.createBranch': {
        const parsed = parseNewRef(stringSlot(slots.branch));
        if (!parsed.ok || typeof parsed.value !== 'string') throw new TypeError('invalid new ref');
        if (state.refs.some((ref) => ref.name === parsed.value)) throw new TypeError('ref exists');
        await repository.branch(parsed.value, true, state.HEAD?.commit);
        return;
      }
      case 'git.addCurrentResource':
        await repository.add([this.currentResource(repository, state.workingTreeChanges)]);
        return;
      case 'git.unstageCurrentResource':
        await repository.revert([this.currentResource(repository, state.indexChanges)]);
        return;
      case 'git.addDirtyResources':
        if (dirtyChanges(state).length < 1) throw new TypeError('no dirty resources');
        try {
          await repository.add(dirtyChanges(state).map((change) => change.uri));
        } catch {
          throw new PartialBuiltinExecutionError();
        }
        return;
      case 'git.unstageIndexedResources':
        if (state.indexChanges.length < 1) throw new TypeError('no indexed resources');
        try {
          await repository.revert(state.indexChanges.map((change) => change.uri));
        } catch {
          throw new PartialBuiltinExecutionError();
        }
        return;
      default:
        throw new TypeError('unknown git executor');
    }
  }

  private async resolveRepository(): Promise<GitRepository> {
    const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!extension) throw new TypeError('git extension unavailable');
    const git = extension.isActive ? extension.exports : await extension.activate();
    if (!git.enabled) throw new TypeError('git disabled');
    const repositories = git.getAPI(1).repositories;
    if (repositories.length === 1) return repositories[0];
    const active = vscode.window.activeTextEditor?.document.uri;
    if (!active) throw new TypeError('repository ambiguous');
    const matches = repositories.filter((repository) => contains(repository.rootUri, active));
    if (matches.length !== 1) throw new TypeError('repository ambiguous');
    return matches[0];
  }

  private currentIn(repository: GitRepository, changes: readonly GitChange[]): boolean {
    try {
      this.currentResource(repository, changes);
      return true;
    } catch {
      return false;
    }
  }

  private currentResource(repository: GitRepository, changes: readonly GitChange[]): vscode.Uri {
    const active = vscode.window.activeTextEditor?.document.uri;
    if (!active || !contains(repository.rootUri, active)) throw new TypeError('active file outside repository');
    const matches = changes.filter((change) => change.uri.toString() === active.toString());
    if (matches.length !== 1) throw new TypeError('active resource unavailable');
    return matches[0].uri;
  }
}

function dirtyChanges(state: GitRepository['state']): GitChange[] {
  const unique = new Map<string, GitChange>();
  for (const change of [...state.workingTreeChanges, ...state.mergeChanges]) {
    unique.set(change.uri.toString(), change);
  }
  return [...unique.values()];
}

function commitMessage(value: unknown): string {
  const parsed = parseCommitMessage(stringSlot(value));
  if (!parsed.ok || typeof parsed.value !== 'string') throw new TypeError('invalid commit message');
  return parsed.value;
}

function stringSlot(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('invalid slot');
  return value;
}

function identities(changes: readonly GitChange[]): string[] {
  return changes.map((change) => change.uri.toString()).sort();
}

function refsFor(repository: GitRepository): readonly string[] {
  const refs = repository.state.refs.flatMap((ref) => ref.name ? [ref.name] : []);
  return refs.length <= MAX_REF_CANDIDATES ? Object.freeze([...new Set(refs)]) : [];
}

function contains(root: vscode.Uri, candidate: vscode.Uri): boolean {
  if (root.scheme !== candidate.scheme || root.authority !== candidate.authority) return false;
  const rootPath = root.path.endsWith('/') ? root.path : `${root.path}/`;
  return candidate.path === root.path || candidate.path.startsWith(rootPath);
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
