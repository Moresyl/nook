import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { worktreeSnapshotSchema, worktreeSnapshotStorageLimits, type WorktreeSnapshot, type WorktreeSnapshotSummary } from '../../contracts/worktree-snapshots';
import { WorkspaceBackupFiles } from './backup-files';
import { validateWorktreeSnapshotFiles } from './worktree-snapshot-files';

const failure = 'The local worktree snapshot could not be verified. Existing worktrees and snapshot files were retained.';
const canonicalKey = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path;
export function validateWorktreeSnapshot(raw: unknown): WorktreeSnapshot {
  const snapshot = worktreeSnapshotSchema.parse(raw);
  validateWorktreeSnapshotFiles(snapshot.files);
  for (const blob of [snapshot.index, snapshot.pack]) {
    const bytes = Buffer.from(blob.data, 'base64');
    if (bytes.length !== blob.bytes || bytes.toString('base64') !== blob.data || createHash('sha256').update(bytes).digest('hex') !== blob.sha256) throw new Error(failure);
  }
  return snapshot;
}
export function worktreeSnapshotSummary(snapshot: WorktreeSnapshot): WorktreeSnapshotSummary {
  const { index: _index, pack: _pack, files, ...metadata } = snapshot;
  return { ...metadata, entries: files.entries.length, fileBytes: files.entries.reduce((total, entry) => total + (entry.kind === 'file' ? entry.bytes : 0), 0) };
}

/** Private snapshots never enter the shared workspace backup or grant worktree ownership. */
export class WorktreeSnapshotStore {
  private pending: Promise<unknown> = Promise.resolve(); private closed = false;
  constructor(private readonly directory: string, private readonly files = new WorkspaceBackupFiles(worktreeSnapshotStorageLimits)) {
    if (!isAbsolute(directory)) throw new Error('Choose an absolute local snapshot storage folder.');
  }
  private run<T>(action: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('The snapshot service is closing. Reopen the workspace to retry.'));
    const operation = this.pending.catch(() => {}).then(async () => {
      if (this.closed) throw new Error('The snapshot service is closing. Reopen the workspace to retry.');
      try { return await action(); } catch (cause) { throw new Error(failure, { cause }); }
    });
    this.pending = operation; return operation;
  }
  private async root(): Promise<string> {
    await mkdir(this.directory, { recursive: true });
    const actual = await realpath(this.directory), info = await lstat(this.directory);
    if (!info.isDirectory() || info.isSymbolicLink() || canonicalKey(actual) !== canonicalKey(resolve(this.directory))) throw new Error(failure);
    return actual;
  }
  private async names(root: string): Promise<string[]> {
    const names = (await readdir(root)).filter(name => /^[a-f0-9-]+\.json\.gz$/i.test(name));
    if (names.length > worktreeSnapshotStorageLimits.snapshots) throw new Error(failure);
    for (const name of names) z.uuid().parse(name.slice(0, -8));
    return names.sort();
  }
  private async readAt(root: string, id: string): Promise<WorktreeSnapshot> {
    z.uuid().parse(id); const path = join(root, `${id}.json.gz`), before = await lstat(path, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > BigInt(worktreeSnapshotStorageLimits.compressedBytes) || canonicalKey(await realpath(path)) !== canonicalKey(path)) throw new Error(failure);
    const snapshot = validateWorktreeSnapshot(await this.files.read(path)), after = await lstat(path, { bigint: true });
    if (snapshot.id !== id || [before.dev, before.ino, before.size, before.mtimeNs, before.ctimeNs].map(String).join(':') !== [after.dev, after.ino, after.size, after.mtimeNs, after.ctimeNs].map(String).join(':')) throw new Error(failure);
    return snapshot;
  }
  save(raw: unknown): Promise<WorktreeSnapshotSummary> {
    return this.run(async () => {
      const snapshot = validateWorktreeSnapshot(raw), root = await this.root();
      if ((await this.names(root)).length >= worktreeSnapshotStorageLimits.snapshots) throw new Error('The local snapshot store is full. Existing snapshots were retained.');
      const path = join(root, `${snapshot.id}.json.gz`);
      const existing = await lstat(path).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
      if (existing) throw new Error('This snapshot already exists. Existing snapshots were retained.');
      await this.files.write(path, snapshot);
      const stored = await this.readAt(root, snapshot.id);
      if (JSON.stringify(stored) !== JSON.stringify(snapshot)) throw new Error(failure);
      return worktreeSnapshotSummary(stored);
    });
  }
  read(id: string): Promise<WorktreeSnapshot> { return this.run(async () => { z.uuid().parse(id); return this.readAt(await this.root(), id); }); }
  list(): Promise<WorktreeSnapshotSummary[]> {
    return this.run(async () => {
      const root = await this.root(), summaries: WorktreeSnapshotSummary[] = [];
      for (const name of await this.names(root)) summaries.push(worktreeSnapshotSummary(await this.readAt(root, name.slice(0, -8))));
      return summaries.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
    });
  }
  async shutdown(): Promise<void> { this.closed = true; await this.files.shutdown(); await this.pending.catch(() => {}); }
}
