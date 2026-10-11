import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorktreeSnapshotSchema, restoreWorktreeSnapshotSchema } from '../contracts/worktree-snapshots';
import { ProjectGit } from '../desktop/services/project-git';
import { WorkspaceVault } from '../desktop/services/vault';
import { WorktreeOwnership } from '../desktop/services/worktree-ownership';
import { WorktreeSnapshotStore } from '../desktop/services/worktree-snapshot-store';
import { WorktreeSnapshots } from '../desktop/services/worktree-snapshots';
import { codec } from './fixtures';

const run = promisify(execFile), directories: string[] = [], stores: WorktreeSnapshotStore[] = [];
async function command(root: string, ...args: string[]) { return (await run('git', ['-C', root, ...args], { windowsHide: true })).stdout.trim(); }
function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'nook-snapshot-service-')); directories.push(directory);
  const root = join(directory, '源 项目'), path = join(directory, '本机 工作树'), target = join(directory, '恢复 工作树'), profile = join(directory, '资料'); await mkdir(root);
  await command(root, 'init', '-q', '-b', 'main');
  for (const [key, value] of [['user.name', 'Nook test'], ['user.email', 'test@localhost'], ['commit.gpgSign', 'false'], ['core.autocrlf', 'false']]) await command(root, 'config', key, value);
  await writeFile(join(root, 'file.txt'), 'BASE\r\n'); await writeFile(join(root, '.gitignore'), 'ignored\n'); await command(root, 'add', '.'); await command(root, 'commit', '-qm', 'Base');
  const vault = new WorkspaceVault(profile, codec); await vault.initialize(); await vault.update(state => { state.projects.push({ id: 'source', path: root, name: '源项目', instructions: 'KEEP', createdAt: 1 }); });
  let ownership!: WorktreeOwnership;
  const git = new ProjectGit(undefined, undefined, async (root, tree) => { await ownership.recordCreated(root, tree.path); });
  const ledger = join(profile, 'managed-worktrees.json'); ownership = new WorktreeOwnership(ledger, root => git.worktrees(root));
  await git.createWorktree(root, { mode: 'new', path, branch: 'feature/snapshot' });
  await writeFile(join(path, 'file.txt'), 'STAGED\r\n'); await command(path, 'add', 'file.txt'); await writeFile(join(path, 'file.txt'), 'WORKING\r\n');
  await writeFile(join(path, 'untracked.bin'), Buffer.from([0, 255, 1])); await writeFile(join(path, 'ignored'), 'LOCAL IGNORE');
  await writeFile(join(root, 'file.txt'), 'MAIN STAGED\r\n'); await command(root, 'add', 'file.txt'); await writeFile(join(root, 'file.txt'), 'MAIN WORKING\r\n');
  const directoryStore = join(profile, 'worktree-snapshots'), store = new WorktreeSnapshotStore(directoryStore); stores.push(store);
  const service = new WorktreeSnapshots(vault, ownership, git, store), source = { projectId: 'source', path: root };
  const saved = await service.capture({ source, path });
  return { directory, root, path, target, profile, directoryStore, ledger, vault, ownership, git, store, service, source, saved };
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) await store.shutdown();
  for (const directory of directories.splice(0)) { expect(dirname(resolve(directory))).toBe(resolve(tmpdir())); expect(basename(directory)).toMatch(/^nook-snapshot-service-[A-Za-z0-9]{6}$/); await rm(directory, { recursive: true, force: true }); }
});

describe('explicit snapshot contracts', () => {
  it('accepts existing project ids and strict absolute paths while rejecting adoption, forcing and invalid snapshot ids', () => {
    const source = { projectId: 'source', path: 'E:/源项目' }, capture = { source, path: 'E:/工作树' }, restore = { source, path: 'E:/新目录', snapshotId: 'e0502d20-4555-4db7-99c0-92947476e6a1' };
    expect(createWorktreeSnapshotSchema.parse(capture)).toEqual(capture); expect(restoreWorktreeSnapshotSchema.parse(restore)).toEqual(restore);
    for (const raw of [{ ...capture, force: true }, { ...capture, path: 'relative' }, { ...capture, source: { ...source, adopt: true } }]) expect(createWorktreeSnapshotSchema.safeParse(raw).success).toBe(false);
    for (const raw of [{ ...restore, force: true }, { ...restore, snapshotId: '../escape' }, { ...restore, path: 'relative' }]) expect(restoreWorktreeSnapshotSchema.safeParse(raw).success).toBe(false);
  });
});

describe('actual local worktree snapshot lifecycle', () => {
  let f: Awaited<ReturnType<typeof fixture>>;
  beforeEach(async () => { f = await fixture(); });
  it('lists an absent private store without Git reads or creating a folder', async () => {
    const path = join(f.profile, 'absent-snapshots'), store = new WorktreeSnapshotStore(path); stores.push(store);
    const service = new WorktreeSnapshots(f.vault, f.ownership, f.git, store), identity = vi.spyOn(f.git, 'repositoryIdentity');
    expect(await service.list(f.source)).toEqual([]); expect(identity).not.toHaveBeenCalled(); await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('discards saved summaries when the source changes during a held repository identity read', async () => {
    const held = gate(), entered = gate(), identity = f.git.repositoryIdentity.bind(f.git);
    vi.spyOn(f.git, 'repositoryIdentity').mockImplementationOnce(async root => { const result = await identity(root); entered.release(); await held.promise; return result; });
    const pending = f.service.list(f.source), rejected = expect(pending).rejects.toThrow('linked worktree project changed'); await entered.promise;
    await f.vault.update(state => { state.projects[0].path = join(f.directory, 'relocated'); state.projects[0].instructions = 'INTERVENING'; }); held.release(); await rejected;
    expect(f.vault.snapshot().projects[0].instructions).toBe('INTERVENING'); expect(await f.store.list()).toHaveLength(1);
  });
  it('rejects summaries when the actual common directory is replaced during an identity read and retains the previous index and snapshots', async () => {
    const held = gate(), entered = gate(), identity = f.git.repositoryIdentity.bind(f.git), index = await readFile(join(f.root, '.git', 'index'));
    vi.spyOn(f.git, 'repositoryIdentity').mockImplementationOnce(async root => { const result = await identity(root); entered.release(); await held.promise; return result; });
    const pending = f.service.list(f.source), rejected = expect(pending).rejects.toThrow('retained'); await entered.promise;
    await rename(join(f.root, '.git'), join(f.root, '.git-original')); await command(f.root, 'init', '-q', '-b', 'main'); held.release(); await rejected;
    expect(await readFile(join(f.root, '.git-original', 'index'))).toEqual(index); expect(await readFile(join(f.root, 'file.txt'), 'utf8')).toBe('MAIN WORKING\r\n'); expect(await f.store.list()).toHaveLength(1);
  });
  it('rejects a rehashed truncated Git pack before creating a destination and preserves the malformed snapshot for inspection', async () => {
    const snapshot = await f.store.read(f.saved.id), bytes = Buffer.from(snapshot.pack.data, 'base64').subarray(0, -1);
    snapshot.pack = { bytes: bytes.length, data: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') };
    const path = join(f.directoryStore, `${snapshot.id}.json.gz`), stored = gzipSync(JSON.stringify(snapshot)), trees = await f.git.worktrees(f.root), index = await readFile(join(f.root, '.git', 'index'));
    await writeFile(path, stored); await expect(f.service.restore({ source: f.source, snapshotId: snapshot.id, path: f.target })).rejects.toThrow('retained');
    expect(await f.git.worktrees(f.root)).toEqual(trees); expect(await readFile(join(f.root, '.git', 'index'))).toEqual(index); expect(await readFile(path)).toEqual(stored); await expect(lstat(f.target)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('drains an accepted capture before closing storage and rejects new actions during and after shutdown', async () => {
    const entered = gate(), release = gate(), original = f.ownership.list.bind(f.ownership);
    vi.spyOn(f.ownership, 'list').mockImplementationOnce(async root => { entered.release(); await release.promise; return original(root); });
    const capture = f.service.capture({ source: f.source, path: f.path }); await entered.promise;
    let closed = false; const shutdown = f.service.shutdown().then(() => { closed = true; });
    await expect(f.service.list(f.source)).rejects.toThrow('closing');
    await expect(f.service.capture({ source: f.source, path: f.path })).rejects.toThrow('closing');
    await expect(f.service.restore({ source: f.source, snapshotId: f.saved.id, path: f.target })).rejects.toThrow('closing');
    expect(closed).toBe(false); release.release();
    const saved = await capture; await shutdown; expect(closed).toBe(true);
    const reopened = new WorktreeSnapshotStore(f.directoryStore); stores.push(reopened);
    expect((await reopened.list()).map(row => row.id)).toContain(saved.id);
    await expect(f.service.list(f.source)).rejects.toThrow('closing');
  });
  it('closes after a failed accepted capture without discarding the previous private snapshot', async () => {
    const path = join(f.directoryStore, `${f.saved.id}.json.gz`), bytes = await readFile(path);
    vi.spyOn(f.ownership, 'list').mockRejectedValueOnce(new Error('PRIVATE_READ_FAILURE'));
    const pending = f.service.capture({ source: f.source, path: f.path }), rejected = expect(pending).rejects.toThrow();
    await f.service.shutdown(); await rejected; expect(await readFile(path)).toEqual(bytes);
    const reopened = new WorktreeSnapshotStore(f.directoryStore); stores.push(reopened); expect(await reopened.read(f.saved.id)).toBeDefined();
  });
  it('captures an owned pinned tree without changing files, index, workspace or pin metadata and lists durable summaries after reopen', async () => {
    await f.ownership.setPinned(f.root, { path: f.path, pinned: true });
    const workspace = await readFile(join(f.profile, 'workspace.json')), receipt = await readFile(f.ledger), index = await readFile(await command(f.path, 'rev-parse', '--path-format=absolute', '--git-path', 'index'));
    const second = await f.service.capture({ source: f.source, path: f.path }); expect(second.id).not.toBe(f.saved.id);
    expect(await readFile(join(f.profile, 'workspace.json'))).toEqual(workspace); expect(await readFile(f.ledger)).toEqual(receipt); expect(await readFile(await command(f.path, 'rev-parse', '--path-format=absolute', '--git-path', 'index'))).toEqual(index);
    const reopened = new WorktreeSnapshotStore(f.directoryStore); stores.push(reopened);
    const service = new WorktreeSnapshots(f.vault, f.ownership, f.git, reopened); expect((await service.list(f.source)).map(row => row.id)).toEqual([second.id, f.saved.id]);
    expect(JSON.stringify(f.vault.snapshot())).not.toContain(second.id); expect(await readFile(join(f.path, 'file.txt'), 'utf8')).toBe('WORKING\r\n');
  });
  it('restores exact staged and working bytes into a new detached tree, saves a fresh receipt and leaves both original trees and workspace intact', async () => {
    const mainHead = await command(f.root, 'rev-parse', 'HEAD'), mainIndex = await readFile(join(f.root, '.git', 'index')), workspace = await readFile(join(f.profile, 'workspace.json'));
    const oldIndex = await readFile(await command(f.path, 'rev-parse', '--path-format=absolute', '--git-path', 'index'));
    const result = await f.service.restore({ source: f.source, snapshotId: f.saved.id, path: f.target });
    expect(result).toMatchObject({ managedRecord: 'saved', worktree: { path: f.target, head: f.saved.head, detached: true } });
    expect(await command(f.target, 'show', ':file.txt')).toBe('STAGED'); expect(await readFile(join(f.target, 'file.txt'), 'utf8')).toBe('WORKING\r\n');
    expect(await readFile(join(f.target, 'untracked.bin'))).toEqual(Buffer.from([0, 255, 1])); expect(await readFile(join(f.target, 'ignored'), 'utf8')).toBe('LOCAL IGNORE');
    expect(await readFile(join(f.root, '.git', 'index'))).toEqual(mainIndex); expect(await command(f.root, 'rev-parse', 'HEAD')).toBe(mainHead); expect(await readFile(join(f.root, 'file.txt'), 'utf8')).toBe('MAIN WORKING\r\n');
    expect(await readFile(await command(f.path, 'rev-parse', '--path-format=absolute', '--git-path', 'index'))).toEqual(oldIndex); expect(await readFile(join(f.profile, 'workspace.json'))).toEqual(workspace);
    const restored = (await f.ownership.list(f.root)).find(row => row.path === f.target); expect(restored).toMatchObject({ verified: true, pinned: false }); expect(restored?.id).not.toBe(f.saved.receiptId);
  });
  it('keeps the exact snapshot commit after the original branch advances and never switches that branch', async () => {
    await writeFile(join(f.path, 'file.txt'), 'LATER'); await command(f.path, 'add', 'file.txt'); await command(f.path, 'commit', '-qm', 'Later'); const later = await command(f.path, 'rev-parse', 'HEAD');
    await f.service.restore({ source: f.source, snapshotId: f.saved.id, path: f.target });
    expect(await command(f.target, 'rev-parse', 'HEAD')).toBe(f.saved.head); expect(await command(f.path, 'rev-parse', 'HEAD')).toBe(later); expect(await command(f.path, 'branch', '--show-current')).toBe('feature/snapshot');
  });
  it('rejects the main and an external worktree without saving another snapshot or adopting ownership', async () => {
    const external = join(f.directory, 'external'); await command(f.root, 'worktree', 'add', '-q', '-b', 'external', '--', external);
    const ledger = await readFile(f.ledger), count = (await f.store.list()).length;
    await expect(f.service.capture({ source: f.source, path: f.root })).rejects.toThrow('verified worktree'); await expect(f.service.capture({ source: f.source, path: external })).rejects.toThrow('verified worktree');
    expect(await readFile(f.ledger)).toEqual(ledger); expect(await f.store.list()).toHaveLength(count); expect(await readFile(join(external, 'file.txt'), 'utf8')).toBe('BASE\r\n');
  });
  it.each(['inside', 'existing', 'missing parent'] as const)('rejects a %s restore target before creating a worktree or replacing files', async kind => {
    const path = kind === 'inside' ? join(f.root, 'new') : kind === 'existing' ? f.target : join(f.directory, 'missing', 'new');
    if (kind === 'existing') { await mkdir(path); await writeFile(join(path, 'sentinel'), 'KEEP'); }
    const trees = await f.git.worktrees(f.root), index = await readFile(join(f.root, '.git', 'index'));
    await expect(f.service.restore({ source: f.source, snapshotId: f.saved.id, path })).rejects.toThrow(); expect(await f.git.worktrees(f.root)).toEqual(trees); expect(await readFile(join(f.root, '.git', 'index'))).toEqual(index);
    if (kind === 'existing') expect(await readFile(join(path, 'sentinel'), 'utf8')).toBe('KEEP');
  });
  it('rejects another actual common repository and filters its snapshot list before any restore mutation', async () => {
    const root = join(f.directory, 'other'); await mkdir(root); await command(root, 'init', '-q', '-b', 'main');
    await f.vault.update(state => { state.projects.push({ id: 'other', path: root, name: 'Other', instructions: '', createdAt: 2 }); }); const source = { projectId: 'other', path: root };
    expect(await f.service.list(source)).toEqual([]); await expect(f.service.restore({ source, snapshotId: f.saved.id, path: f.target })).rejects.toThrow('another local Git repository'); await expect(lstat(f.target)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects a source relocated while ownership reads are held and retains the intervening workspace edit', async () => {
    const held = gate(), entered = gate(), read = f.ownership.list.bind(f.ownership);
    vi.spyOn(f.ownership, 'list').mockImplementationOnce(async root => { const rows = await read(root); entered.release(); await held.promise; return rows; });
    const pending = f.service.capture({ source: f.source, path: f.path }), rejected = expect(pending).rejects.toThrow('linked worktree project changed'); await entered.promise;
    const moved = join(f.directory, 'relocated'); await f.vault.update(state => { state.projects[0].path = moved; state.projects[0].instructions = 'INTERVENING'; }); held.release(); await rejected;
    expect(f.vault.snapshot().projects[0]).toMatchObject({ path: moved, instructions: 'INTERVENING' }); expect(await f.store.list()).toHaveLength(1);
  });
  it('rejects a queued restore after its source changes, before creating the destination', async () => {
    const held = gate(), entered = gate(), queued = gate(); const first = f.git.exclusive(f.root, async () => { entered.release(); await held.promise; }); await entered.promise;
    const exclusive = f.git.exclusive.bind(f.git); vi.spyOn(f.git, 'exclusive').mockImplementation((root, action) => { queued.release(); return exclusive(root, action); });
    const pending = f.service.restore({ source: f.source, snapshotId: f.saved.id, path: f.target }), rejected = expect(pending).rejects.toThrow('linked worktree project changed'); await queued.promise;
    await f.vault.update(state => { state.projects[0].path = join(f.directory, 'moved'); }); held.release(); await first; await rejected; await expect(lstat(f.target)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('retains a partially created tree and snapshot on a real new-index lock conflict, hides the storage path and leaves it unmanaged', async () => {
    const original = f.git.worktrees.bind(f.git); let injected = false;
    vi.spyOn(f.git, 'worktrees').mockImplementation(async root => {
      const trees = await original(root);
      if (!injected && trees.some(tree => resolve(tree.path) === f.target)) { injected = true; const index = await command(f.target, 'rev-parse', '--path-format=absolute', '--git-path', 'index'); await writeFile(`${index}.lock`, 'PRIVATE LOCK'); }
      return trees;
    });
    await expect(f.service.restore({ source: f.source, snapshotId: f.saved.id, path: f.target })).rejects.toThrow('retained'); expect(injected).toBe(true);
    expect((await f.git.worktrees(f.root)).some(tree => resolve(tree.path) === f.target)).toBe(true); expect((await f.ownership.list(f.root)).some(row => row.path === f.target)).toBe(false); expect(await f.store.read(f.saved.id)).toBeDefined();
  });
  it('reports a completed restore with failed local receipt persistence without deleting the new files or creating twice', async () => {
    const before = await readFile(f.ledger); vi.spyOn(f.ownership, 'recordCreated').mockRejectedValueOnce(new Error('PRIVATE RECEIPT FAILURE'));
    const result = await f.service.restore({ source: f.source, snapshotId: f.saved.id, path: f.target }); expect(result.managedRecord).toBe('failed');
    expect(await readFile(f.ledger)).toEqual(before); expect(await readFile(join(f.target, 'file.txt'), 'utf8')).toBe('WORKING\r\n'); expect((await f.git.worktrees(f.root)).filter(tree => resolve(tree.path) === f.target)).toHaveLength(1);
  });
  it('rejects a tampered but rehashed index checksum before installing objects or creating a destination', async () => {
    const snapshot = await f.store.read(f.saved.id), bytes = Buffer.from(snapshot.index.data, 'base64'); bytes[bytes.length - 1] ^= 1;
    snapshot.index = { bytes: bytes.length, data: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') };
    await writeFile(join(f.directoryStore, `${snapshot.id}.json.gz`), gzipSync(JSON.stringify(snapshot))); const exclusive = vi.spyOn(f.git, 'exclusive');
    await expect(f.service.restore({ source: f.source, snapshotId: snapshot.id, path: f.target })).rejects.toThrow('retained'); expect(exclusive).not.toHaveBeenCalled(); await expect(lstat(f.target)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
