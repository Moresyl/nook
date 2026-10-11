import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, realpath, rename, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { createWorktreeSnapshotSchema, restoreWorktreeSnapshotSchema, type WorktreeRestored, type WorktreeSnapshot, type WorktreeSnapshotSummary } from '../../contracts/worktree-snapshots';
import { worktreeOwnershipSourceSchema, type WorktreeOwnershipSource } from '../../contracts/worktree-ownership';
import { worktreeNavigationProject } from '../../contracts/worktree-navigation';
import { worktreePathKey } from '../../contracts/worktree-overview';
import type { GitWorktree } from '../../contracts/project-worktrees';
import type { WorkspaceVault } from './vault';
import type { WorktreeOwnership } from './worktree-ownership';
import type { ProjectGit } from './project-git';
import type { WorktreeSnapshotStore } from './worktree-snapshot-store';
import { captureWorktreeSnapshotGit, runGitSnapshotCommand } from './worktree-snapshot-git';
import { captureWorktreeSnapshotFiles, restoreWorktreeSnapshotFiles } from './worktree-snapshot-files';

type Projects = Pick<WorkspaceVault, 'project'>;
type Ownership = Pick<WorktreeOwnership, 'list' | 'recordCreated'>;
type Git = Pick<ProjectGit, 'exclusive' | 'repositoryIdentity' | 'worktrees'>;
const failure = 'The snapshot action could not be completed. Existing worktrees and snapshots were retained.';
const same = (one: unknown, two: unknown) => JSON.stringify(one) === JSON.stringify(two);
const sameDirectory = (one: WorktreeSnapshot['common'], two: WorktreeSnapshot['common']) => worktreePathKey(one.path) === worktreePathKey(two.path) && one.device === two.device && one.inode === two.inode;
const gitText = async (root: string, args: string[]) => new TextDecoder('utf-8', { fatal: true }).decode(await runGitSnapshotCommand(root, args)).replace(/\r?\n$/, '');
function outside(root: string, path: string): boolean { const delta = relative(resolve(root), resolve(path)); return Boolean(delta) && (delta === '..' || delta.startsWith(`..${sep}`) || isAbsolute(delta)); }

/** Save and restore explicit snapshots without adopting external trees or removing any worktree. */
export class WorktreeSnapshots {
  private closed = false;
  private readonly pending = new Set<Promise<unknown>>();
  constructor(private readonly vault: Projects, private readonly ownership: Ownership, private readonly git: Git, private readonly store: WorktreeSnapshotStore, private readonly prepareTarget?: (path: string, trees: GitWorktree[]) => Promise<void>) {}
  private run<T>(action: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('The snapshot service is closing. Reopen the workspace to retry.'));
    const operation = Promise.resolve().then(action);
    this.pending.add(operation);
    void operation.then(() => this.pending.delete(operation), () => this.pending.delete(operation));
    return operation;
  }
  capture(raw: unknown): Promise<WorktreeSnapshotSummary> { return this.run(() => this.captureSnapshot(raw)); }
  list(raw: unknown): Promise<WorktreeSnapshotSummary[]> { return this.run(() => this.listSnapshots(raw)); }
  restore(raw: unknown): Promise<WorktreeRestored> { return this.run(() => this.restoreSnapshot(raw)); }
  async shutdown(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([...this.pending]);
    await this.store.shutdown();
  }
  private project(source: WorktreeOwnershipSource) {
    const project = this.vault.project(source.projectId);
    return worktreeNavigationProject({ projects: project ? [project] : [] }, source);
  }
  private async owned(root: string, path: string) {
    const record = (await this.ownership.list(root)).find(row => worktreePathKey(row.path) === worktreePathKey(path));
    if (!record?.verified) throw new Error('Only a verified worktree created on this computer can be snapshotted. Existing files were retained.');
    return record;
  }
  private async captureSnapshot(raw: unknown) {
    const input = createWorktreeSnapshotSchema.parse(raw), root = this.project(input.source).path;
    return this.git.exclusive(root, async () => {
      this.project(input.source); const record = await this.owned(root, input.path); this.project(input.source);
      const before = await captureWorktreeSnapshotGit(input.path), files = await captureWorktreeSnapshotFiles(input.path), after = await captureWorktreeSnapshotGit(input.path);
      if (!sameDirectory(before.common, after.common) || before.head !== after.head || !same(before.index, after.index)) throw new Error(failure);
      const current = await this.owned(root, input.path); this.project(input.source);
      if (current.id !== record.id) throw new Error(failure);
      const saved = await this.store.save({ version: 1, id: randomUUID(), receiptId: record.id, createdAt: Date.now(), originalPath: input.path, ...before, files });
      this.project(input.source); return saved;
    });
  }
  private async listSnapshots(raw: unknown) {
    const source = worktreeOwnershipSourceSchema.parse(raw), root = this.project(source).path;
    const snapshots = await this.store.list(); this.project(source);
    if (!snapshots.length) return [];
    const identity = await this.git.repositoryIdentity(root);
    this.project(source);
    const current = await this.git.repositoryIdentity(root);
    this.project(source);
    if (!same(identity, current)) throw new Error(failure);
    return snapshots.filter(snapshot => sameDirectory(snapshot.common, current.common));
  }
  private async restoreSnapshot(raw: unknown): Promise<WorktreeRestored> {
    const input = restoreWorktreeSnapshotSchema.parse(raw), root = this.project(input.source).path, snapshot = await this.store.read(input.snapshotId);
    const indexBytes = this.indexBytes(snapshot);
    this.project(input.source);
    return this.git.exclusive(root, async identity => {
      const currentRepository = async () => { this.project(input.source); if (!same(await this.git.repositoryIdentity(root), identity)) throw new Error(failure); };
      await currentRepository();
      if (!sameDirectory(snapshot.common, identity.common)) throw new Error('This snapshot belongs to another local Git repository. Existing files were retained.');
      const path = resolve(input.path);
      if (!isAbsolute(input.path) || ['.', '..'].includes(basename(input.path))) throw new Error(failure);
      const trees = await this.git.worktrees(root);
      if (trees.some(tree => !outside(tree.path, path))) throw new Error('Choose a new folder outside the existing worktrees. Existing files were retained.');
      const existing = await lstat(path).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
      if (existing) throw new Error('Choose a folder that does not already exist. Existing files were retained.');
      await this.prepareTarget?.(path, trees);
      const parent = await lstat(dirname(path));
      if (!parent.isDirectory() || parent.isSymbolicLink() || worktreePathKey(await realpath(dirname(path))) !== worktreePathKey(dirname(path))) throw new Error(failure);
      await currentRepository();
      await runGitSnapshotCommand(root, ['index-pack', '--stdin', '--strict'], Buffer.from(snapshot.pack.data, 'base64'));
      await currentRepository();
      await runGitSnapshotCommand(root, ['worktree', 'add', '--no-checkout', '--detach', '--', path, snapshot.head]);
      const tree = (await this.git.worktrees(root)).find(row => worktreePathKey(row.path) === worktreePathKey(path));
      if (!tree?.detached || tree.head !== snapshot.head || tree.bare || tree.prunable !== undefined || tree.locked !== undefined) throw new Error(failure);
      await currentRepository();
      await this.restoreContents(path, snapshot, indexBytes);
      await currentRepository();
      if (!sameDirectory((await this.git.repositoryIdentity(path)).common, snapshot.common)) throw new Error(failure);
      let managedRecord: WorktreeRestored['managedRecord'] = 'saved';
      try { await this.ownership.recordCreated(root, path); } catch { managedRecord = 'failed'; }
      this.project(input.source);
      return { worktree: { ...tree, path }, managedRecord };
    }).catch(cause => {
      const safe = ['The linked worktree project changed. Refresh the worktree list.', 'This snapshot belongs to another local Git repository. Existing files were retained.', 'Choose a new folder outside the existing worktrees. Existing files were retained.', 'Choose a folder that does not already exist. Existing files were retained.'];
      if (cause instanceof Error && safe.includes(cause.message)) throw cause;
      throw new Error(failure, { cause });
    });
  }
  private indexBytes(snapshot: WorktreeSnapshot): Buffer {
    const bytes = Buffer.from(snapshot.index.data, 'base64'), hash = snapshot.head.length === 64 ? 'sha256' : 'sha1', trailer = snapshot.head.length / 2;
    if (bytes.length < 12 + trailer || bytes.subarray(0, 4).toString('ascii') !== 'DIRC' || ![2, 3, 4].includes(bytes.readUInt32BE(4)) || !createHash(hash).update(bytes.subarray(0, -trailer)).digest().equals(bytes.subarray(-trailer))) throw new Error(failure);
    return bytes;
  }
  private async restoreContents(path: string, snapshot: WorktreeSnapshot, indexBytes: Buffer): Promise<void> {
    const admin = await gitText(path, ['rev-parse', '--path-format=absolute', '--git-dir']);
    const index = await gitText(path, ['rev-parse', '--path-format=absolute', '--git-path', 'index']);
    const displacement = relative(snapshot.common.path, admin);
    if (!isAbsolute(admin) || !isAbsolute(index) || !displacement.startsWith(`worktrees${sep}`) || worktreePathKey(dirname(index)) !== worktreePathKey(admin) || basename(index) !== 'index' || worktreePathKey(await realpath(admin)) !== worktreePathKey(admin) || (await lstat(admin)).isSymbolicLink()) throw new Error(failure);
    const existing = await lstat(index).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
    if (existing) throw new Error(failure);
    const lock = `${index}.lock`, file = await open(lock, 'wx', 0o600), opened = await file.stat({ bigint: true });
    let closed = false;
    try {
      await file.writeFile(indexBytes); await file.sync();
      await restoreWorktreeSnapshotFiles(path, snapshot.files);
      await file.close(); closed = true;
      const current = await lstat(lock, { bigint: true });
      if (current.ino !== opened.ino || current.isSymbolicLink()) throw new Error(failure);
      await rename(lock, index);
      const staged = await gitText(path, ['ls-files', '--stage', '-z']), objects = new Set<string>();
      for (const entry of staged.split('\0').filter(Boolean)) {
        const record = entry.match(/^(100644|100755) ([a-f0-9]{40}(?:[a-f0-9]{24})?) [0-3]\t[\s\S]+$/);
        if (!record) throw new Error(failure);
        objects.add(record[2]);
      }
      if (objects.size) {
        const checked = new TextDecoder('utf-8', { fatal: true }).decode(await runGitSnapshotCommand(path, ['cat-file', '--batch-check'], Buffer.from([...objects].join('\n') + '\n'))).trim().split(/\r?\n/);
        if (checked.length !== objects.size || checked.some(line => !/^[a-f0-9]{40}(?:[a-f0-9]{24})? blob \d+$/.test(line))) throw new Error(failure);
      }
    } finally {
      if (!closed) await file.close();
      const current = await lstat(lock, { bigint: true }).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
      if (current && !current.isSymbolicLink() && current.ino === opened.ino) await rm(lock);
    }
  }
}
