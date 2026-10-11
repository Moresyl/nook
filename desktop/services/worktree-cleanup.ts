import { lstat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { removeManagedWorktreeSchema, worktreeKeepCountSchema, type WorktreeCleanupResult, type WorktreeRemoved } from '../../contracts/worktree-cleanup';
import { worktreeNavigationProject } from '../../contracts/worktree-navigation';
import { worktreePathKey } from '../../contracts/worktree-overview';
import type { WorktreeOwnershipSource } from '../../contracts/worktree-ownership';
import type { WorktreeSnapshotSummary } from '../../contracts/worktree-snapshots';
import { worktreeOwnershipSourceSchema } from '../../contracts/worktree-ownership';
import type { WorkspaceVault } from './vault';
import type { WorktreeOwnership } from './worktree-ownership';
import type { ProjectGit } from './project-git';
import type { WorktreeSnapshots } from './worktree-snapshots';
import type { WorktreeSnapshotStore } from './worktree-snapshot-store';
import { captureWorktreeSnapshotFiles } from './worktree-snapshot-files';
import { captureWorktreeSnapshotGit, runGitSnapshotCommand } from './worktree-snapshot-git';
import { WorktreeActivity } from './worktree-activity';

const same = (one: unknown, two: unknown) => JSON.stringify(one) === JSON.stringify(two);
const failure = 'Worktree removal could not be completed. The saved snapshot was retained. Refresh the list and inspect the folder before retrying.';
function contains(root: string, path: string) { const delta = relative(resolve(root), resolve(path)); return !delta || delta !== '..' && !delta.startsWith(`..${sep}`) && !isAbsolute(delta); }

/** Remove only clean, idle, unregistered local worktrees after a verified private snapshot. */
export class WorktreeCleanup {
  private closed = false;
  private readonly pending = new Set<Promise<unknown>>();
  constructor(private readonly vault: Pick<WorkspaceVault, 'project' | 'snapshot'>, private readonly ownership: Pick<WorktreeOwnership, 'list' | 'removeVerified'>, private readonly git: Pick<ProjectGit, 'exclusive' | 'repositoryIdentity' | 'worktrees'>, private readonly snapshots: Pick<WorktreeSnapshots, 'capture'>, private readonly store: Pick<WorktreeSnapshotStore, 'read'>, private readonly activity: WorktreeActivity, private readonly busy: () => boolean) {}

  private run<T>(action: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Worktree cleanup is shutting down. Reopen the workspace to retry.'));
    const operation = Promise.resolve().then(action); this.pending.add(operation);
    void operation.then(() => this.pending.delete(operation), () => this.pending.delete(operation)); return operation;
  }
  async shutdown(): Promise<void> { this.closed = true; await Promise.allSettled([...this.pending]); }

  trim(raw: unknown, rawKeepCount: unknown): Promise<WorktreeCleanupResult> {
    return this.run(async () => {
      const source = worktreeOwnershipSourceSchema.parse(raw), keepCount = worktreeKeepCountSchema.parse(rawKeepCount);
      const rows = await this.activity.run(async () => { const root = this.source(source).path, records = await this.ownership.list(root); this.source(source); return records.filter(record => record.verified); });
      rows.sort((one, two) => one.createdAt - two.createdAt || one.id.localeCompare(two.id));
      // Always retain the newest requested count, even if older protected trees cannot be removed.
      const candidates = rows.slice(0, Math.max(0, rows.length - keepCount)), result: WorktreeCleanupResult = { removed: [], skipped: 0, considered: candidates.length };
      for (const record of candidates) {
        if (this.closed) { result.skipped++; continue; }
        if (record.pinned) { result.skipped++; continue; }
        try { result.removed.push(await this.removeWorktree({ source, path: record.path, receiptId: record.id })); }
        catch { result.skipped++; }
      }
      return result;
    });
  }

  private source(source: WorktreeOwnershipSource) {
    const project = this.vault.project(source.projectId);
    return worktreeNavigationProject({ projects: project ? [project] : [] }, source);
  }
  private protect(path: string, conversationIds: string[] = []): void {
    const state = this.vault.snapshot();
    if (this.busy()) throw new Error('A response or terminal is active. Stop it before removing a worktree.');
    if (state.projects.some(project => contains(project.path, path) || contains(path, project.path))) throw new Error('This worktree is registered as a project. Remove the project entry before removing its folder.');
    if (state.editorDrafts.length || state.threads.some(thread => thread.pinned && (conversationIds.includes(thread.id) || thread.projectId && !state.projects.some(project => project.id === thread.projectId)))) throw new Error('Unsaved editor drafts or a pinned conversation still need protection. Resolve them before removing a worktree.');
  }
  private async clean(path: string): Promise<void> {
    const output = await runGitSnapshotCommand(path, ['status', '--porcelain=v2', '-z', '--untracked-files=all', '--ignored=matching']);
    if (output.length) throw new Error('This worktree has modified, untracked or ignored files. Its files were retained. Commit or move them before removing the folder.');
  }
  remove(raw: unknown): Promise<WorktreeRemoved> { return this.run(() => this.removeWorktree(raw)); }
  private async removeWorktree(raw: unknown): Promise<WorktreeRemoved> {
    const input = removeManagedWorktreeSchema.parse(raw);
    return this.activity.exclusive(async () => {
      const root = this.source(input.source).path; this.protect(input.path);
      const record = (await this.ownership.list(root)).find(row => row.id === input.receiptId && worktreePathKey(row.path) === worktreePathKey(input.path));
      this.source(input.source);
      if (!record?.verified || record.pinned) throw new Error('Only an unpinned worktree with a verified local creation receipt can be removed. Its files were retained.');
      this.protect(input.path, record.conversationIds);
      const before = (await this.git.worktrees(root)).find(row => worktreePathKey(row.path) === worktreePathKey(input.path));
      if (!before || before.bare || before.locked !== undefined || before.prunable !== undefined) throw new Error('The worktree is unavailable or locked. Its files were retained.');
      await this.clean(input.path); this.protect(input.path, record.conversationIds); this.source(input.source);
      // Capture takes the Git queue itself; never call it from inside another Git/receipt transaction.
      let snapshot: WorktreeSnapshotSummary;
      try { snapshot = await this.snapshots.capture({ source: input.source, path: input.path }); }
      catch (cause) { throw new Error('The private snapshot could not be saved. Worktree files were retained.', { cause }); }
      const saved = await this.store.read(snapshot.id);
      if (saved.receiptId !== input.receiptId || worktreePathKey(saved.originalPath) !== worktreePathKey(input.path)) throw new Error(failure);
      return this.git.exclusive(root, async identity => {
        const current = async () => {
          this.source(input.source); this.protect(input.path, record.conversationIds);
          const source = await this.git.repositoryIdentity(root), target = (await this.git.repositoryIdentity(input.path)).common;
          this.source(input.source); this.protect(input.path, record.conversationIds);
          const matchesSaved = (common: typeof target) => worktreePathKey(common.path) === worktreePathKey(saved.common.path) && common.device === saved.common.device && common.inode === saved.common.inode;
          if (!same(source, identity) || !matchesSaved(source.common) || !matchesSaved(target)) throw new Error(failure);
        };
        await current();
        const managedRecord = await this.ownership.removeVerified(root, input.path, input.receiptId, async verify => {
          await current();
          const tree = (await this.git.worktrees(root)).find(row => worktreePathKey(row.path) === worktreePathKey(input.path));
          if (!tree || tree.locked !== undefined || tree.prunable !== undefined) throw new Error(failure);
          const git = await captureWorktreeSnapshotGit(input.path), files = await captureWorktreeSnapshotFiles(input.path);
          if (git.head !== saved.head || !same(git.index, saved.index) || !same(files, saved.files)) throw new Error(failure);
          await runGitSnapshotCommand(root, ['index-pack', '--stdin', '--strict'], Buffer.from(saved.pack.data, 'base64'));
          await this.clean(input.path); await current(); await verify();
          try {
            await runGitSnapshotCommand(root, ['worktree', 'remove', '--', input.path]);
            const remaining = await lstat(input.path).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
            if (remaining || (await this.git.worktrees(root)).some(row => worktreePathKey(row.path) === worktreePathKey(input.path))) throw new Error(failure);
          } catch (cause) { throw new Error(failure, { cause }); }
        }, () => { this.source(input.source); this.protect(input.path, record.conversationIds); });
        return { path: input.path, snapshot, managedRecord };
      });
    });
  }
}
