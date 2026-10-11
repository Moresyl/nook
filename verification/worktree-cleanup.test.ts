import { execFile } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeManagedWorktreeSchema, worktreeRemovalError } from '../contracts/worktree-cleanup';
import { WorktreeActivity } from '../desktop/services/worktree-activity';
import { WorktreeCleanup } from '../desktop/services/worktree-cleanup';
import { WorktreeOwnership } from '../desktop/services/worktree-ownership';
import { WorktreeSnapshots } from '../desktop/services/worktree-snapshots';
import { WorktreeSnapshotStore } from '../desktop/services/worktree-snapshot-store';
import { ProjectGit } from '../desktop/services/project-git';
import { WorkspaceVault } from '../desktop/services/vault';
import { atomicJson } from '../desktop/services/atomic-json';
import { codec, sampleThread } from './fixtures';

const run = promisify(execFile), directories: string[] = [], stores: WorktreeSnapshotStore[] = [];
async function command(root: string, ...args: string[]) { return (await run('git', ['-C', root, ...args], { windowsHide: true, timeout: 30000 })).stdout.trim(); }
function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'nook-cleanup-')); directories.push(directory);
  const root = join(directory, '源仓库'), path = join(directory, '本机工作树'), profile = join(directory, '配置'); await mkdir(root); await mkdir(profile);
  await command(root, 'init', '-b', 'main');
  for (const [name, value] of [['user.name', 'Nook test'], ['user.email', 'test@example.invalid'], ['commit.gpgSign', 'false'], ['core.autocrlf', 'false']]) await command(root, 'config', name, value);
  await writeFile(join(root, 'file.txt'), 'EXACT BASE\n'); await writeFile(join(root, '.gitignore'), 'ignored\n'); await command(root, 'add', '.'); await command(root, 'commit', '-qm', 'Base');
  const vault = new WorkspaceVault(profile, codec); await vault.initialize(); await vault.update(state => { state.projects.push({ id: 'source', path: root, name: '源项目', instructions: '', createdAt: 1 }); });
  const git = new ProjectGit(), ledger = join(profile, 'managed-worktrees.json'), ownership = new WorktreeOwnership(ledger, root => git.worktrees(root));
  await git.createWorktree(root, { mode: 'new', path, branch: 'feature/cleanup' }); const receipt = await ownership.recordCreated(root, path);
  const store = new WorktreeSnapshotStore(join(profile, 'snapshots')); stores.push(store);
  const snapshots = new WorktreeSnapshots(vault, ownership, git, store), activity = new WorktreeActivity(), busy = vi.fn(() => false);
  const service = new WorktreeCleanup(vault, ownership, git, snapshots, store, activity, busy), source = { projectId: 'source', path: root }, request = { source, path, receiptId: receipt.id };
  return { directory, root, path, profile, ledger, vault, git, ownership, receipt, store, snapshots, activity, busy, service, source, request };
}
afterEach(async () => {
  vi.restoreAllMocks(); for (const store of stores.splice(0)) await store.shutdown();
  for (const directory of directories.splice(0)) { expect(dirname(resolve(directory))).toBe(resolve(tmpdir())); expect(basename(directory)).toMatch(/^nook-cleanup-[A-Za-z0-9]{6}$/); await rm(directory, { recursive: true, force: true }); }
});
describe('managed worktree removal contract', () => {
  it('requires an exact local receipt and rejects force, adoption, relative paths and coercion', () => {
    const request = { source: { projectId: 'source', path: 'E:/repo' }, path: 'E:/tree', receiptId: 'e0502d20-4555-4db7-99c0-92947476e6a1' };
    expect(removeManagedWorktreeSchema.parse(request)).toEqual(request);
    for (const raw of [{ ...request, force: true }, { ...request, receiptId: 'old' }, { ...request, path: 'relative' }, { ...request, source: { ...request.source, adopt: true } }]) expect(removeManagedWorktreeSchema.safeParse(raw).success).toBe(false);
  });
  it('shows safe actionable failures and hides arbitrary private errors, including Electron wrappers', () => {
    expect(worktreeRemovalError(new Error("Error invoking remote method 'removeManagedWorktree': Error: The private snapshot could not be saved. Worktree files were retained."))).toContain('文件已保留');
    expect(worktreeRemovalError(new Error('PRIVATE_TOKEN E:/private/path'))).not.toContain('PRIVATE');
    expect(worktreeRemovalError(new Error('The linked worktree project changed. Refresh the worktree list.'))).toContain('关联项目已变更');
  });
});
describe('actual clean-worktree removal with restorable private snapshots', () => {
  let f: Awaited<ReturnType<typeof fixture>>;
  beforeEach(async () => { f = await fixture(); });
  it('removes only the verified linked folder, keeps its branch and main bytes, and restores the exact snapshot into a new folder', async () => {
    const index = await readFile(join(f.root, '.git', 'index')), workspace = JSON.stringify(f.vault.snapshot()), branch = await command(f.root, 'rev-parse', 'feature/cleanup');
    const removed = await f.service.remove(f.request); expect(removed.managedRecord).toBe('saved');
    await expect(lstat(f.path)).rejects.toMatchObject({ code: 'ENOENT' }); expect(await f.ownership.list(f.root)).toEqual([]);
    expect(await command(f.root, 'rev-parse', 'feature/cleanup')).toBe(branch); expect(await readFile(join(f.root, '.git', 'index'))).toEqual(index); expect(JSON.stringify(f.vault.snapshot())).toBe(workspace);
    const target = join(f.directory, '恢复目录'), restored = await f.snapshots.restore({ source: f.source, path: target, snapshotId: removed.snapshot.id });
    expect(restored.worktree.detached).toBe(true); expect(await readFile(join(target, 'file.txt'), 'utf8')).toBe('EXACT BASE\n'); expect(await f.store.list()).toHaveLength(1);
  });
  it.each(['modified', 'staged', 'untracked', 'ignored'])('retains %s files, exact receipt bytes and creates no deletion snapshot', async kind => {
    const ledger = await readFile(f.ledger), name = kind === 'ignored' ? 'ignored' : kind === 'untracked' ? 'new.txt' : 'file.txt';
    await writeFile(join(f.path, name), 'LOCAL BYTES\n'); if (kind === 'staged') await command(f.path, 'add', name);
    await expect(f.service.remove(f.request)).rejects.toThrow('modified, untracked or ignored');
    expect(await readFile(join(f.path, name), 'utf8')).toBe('LOCAL BYTES\n'); expect(await readFile(f.ledger)).toEqual(ledger); expect(await f.store.list()).toEqual([]);
  });
  it('refuses pinned, main, external and incorrect-receipt targets before snapshot creation', async () => {
    await f.ownership.setPinned(f.root, { path: f.path, pinned: true }); await expect(f.service.remove(f.request)).rejects.toThrow('unpinned');
    await expect(f.service.remove({ ...f.request, path: f.root })).rejects.toThrow();
    const external = join(f.directory, 'external'); await command(f.root, 'worktree', 'add', '--detach', external);
    await expect(f.service.remove({ ...f.request, path: external })).rejects.toThrow();
    await expect(f.service.remove({ ...f.request, receiptId: 'e0502d20-4555-4db7-99c0-92947476e6a1' })).rejects.toThrow(); expect(await f.store.list()).toEqual([]);
  });
  it('protects registered projects and live response/terminal activity before creating a snapshot', async () => {
    f.busy.mockReturnValue(true); await expect(f.service.remove(f.request)).rejects.toThrow('active'); f.busy.mockReturnValue(false);
    await f.vault.update(state => { state.projects.push({ id: 'tree', name: '工作树', path: f.path, instructions: '', createdAt: 2 }); });
    await expect(f.service.remove(f.request)).rejects.toThrow('registered'); expect(await f.store.list()).toEqual([]);
  });
  it('protects unsaved file drafts and orphaned pinned chats without creating snapshots or deleting folders', async () => {
    await f.vault.update(state => { state.editorDrafts.push({ projectId: 'removed-project', path: 'file.txt', text: 'UNSAVED', baseText: 'BASE', baseSha256: null, updatedAt: 1 }); });
    await expect(f.service.remove(f.request)).rejects.toThrow('drafts');
    await f.vault.update(state => { state.editorDrafts = []; state.threads.push(sampleThread({ projectId: 'removed-project', pinned: true })); });
    await expect(f.service.remove(f.request)).rejects.toThrow('pinned conversation'); expect(await f.store.list()).toEqual([]); expect(await lstat(f.path)).toBeDefined();
  });
  it('keeps a privately associated pinned chat protected after its project id has been cleared, including after reopening receipts', async () => {
    await f.ownership.rememberConversations(f.path, ['preserved-chat']); await f.vault.update(state => { state.threads.push(sampleThread({ id: 'preserved-chat', pinned: true })); });
    const ownership = new WorktreeOwnership(f.ledger, root => f.git.worktrees(root)), service = new WorktreeCleanup(f.vault, ownership, f.git, f.snapshots, f.store, f.activity, f.busy);
    await expect(service.remove(f.request)).rejects.toThrow('pinned conversation'); expect(await f.store.list()).toEqual([]); expect(await lstat(f.path)).toBeDefined();
    await f.vault.update(state => { state.threads[0].pinned = false; }); expect((await service.remove(f.request)).managedRecord).toBe('saved');
  });
  it('refuses a locked tree and a physically replaced folder without adopting the replacement', async () => {
    await command(f.root, 'worktree', 'lock', f.path); await expect(f.service.remove(f.request)).rejects.toThrow('locked'); await command(f.root, 'worktree', 'unlock', f.path);
    const moved = join(f.directory, 'moved'); await command(f.root, 'worktree', 'move', f.path, moved); await command(f.root, 'worktree', 'add', '--detach', f.path);
    await expect(f.service.remove(f.request)).rejects.toThrow('verified'); expect(await readFile(join(moved, 'file.txt'), 'utf8')).toBe('EXACT BASE\n'); expect(await f.store.list()).toEqual([]);
  });
  it('retains the folder and receipt when private snapshot publication fails', async () => {
    const ledger = await readFile(f.ledger); vi.spyOn(f.store, 'save').mockRejectedValueOnce(new Error('publication failed'));
    await expect(f.service.remove(f.request)).rejects.toThrow('snapshot could not be saved'); expect(await readFile(f.ledger)).toEqual(ledger); expect(await readFile(join(f.path, 'file.txt'), 'utf8')).toBe('EXACT BASE\n'); expect(await f.store.list()).toEqual([]);
  });
  it('detects an intervening pin after snapshot publication and retains that snapshot and folder', async () => {
    const read = f.store.read.bind(f.store); vi.spyOn(f.store, 'read').mockImplementationOnce(async id => { const saved = await read(id); await f.ownership.setPinned(f.root, { path: f.path, pinned: true }); return saved; });
    await expect(f.service.remove(f.request)).rejects.toThrow('pinned'); expect((await f.ownership.list(f.root))[0].pinned).toBe(true); expect(await f.store.list()).toHaveLength(1); expect(await lstat(f.path)).toBeDefined();
  });
  it('rejects newly changed files after saving and retains the exact intervening bytes and snapshot', async () => {
    const read = f.store.read.bind(f.store); vi.spyOn(f.store, 'read').mockImplementationOnce(async id => { const saved = await read(id); await writeFile(join(f.path, 'file.txt'), 'INTERVENING\n'); return saved; });
    await expect(f.service.remove(f.request)).rejects.toThrow('snapshot was retained'); expect(await readFile(join(f.path, 'file.txt'), 'utf8')).toBe('INTERVENING\n'); expect(await f.store.list()).toHaveLength(1);
  });
  it('blocks application actions during an accepted held save and releases the lease on failure', async () => {
    const entered = gate(), held = gate(), capture = f.snapshots.capture.bind(f.snapshots);
    vi.spyOn(f.snapshots, 'capture').mockImplementationOnce(async input => { entered.release(); await held.promise; return capture(input); });
    const pending = f.service.remove(f.request), rejected = expect(pending).rejects.toThrow('active'); await entered.promise;
    await expect(f.activity.run(() => true)).rejects.toThrow('cleanup'); f.busy.mockReturnValue(true); held.release(); await rejected;
    expect(await f.activity.run(() => 'available')).toBe('available'); expect(await f.store.list()).toHaveLength(1); expect(await lstat(f.path)).toBeDefined();
  });
  it('reports a completed removal separately when receipt publication fails and preserves the stale receipt and complete snapshot', async () => {
    const ledger = await readFile(f.ledger), ownership = new WorktreeOwnership(f.ledger, root => f.git.worktrees(root), async () => { throw new Error('PRIVATE WRITE ERROR'); });
    const service = new WorktreeCleanup(f.vault, ownership, f.git, f.snapshots, f.store, f.activity, f.busy), result = await service.remove(f.request);
    expect(result.managedRecord).toBe('failed'); await expect(lstat(f.path)).rejects.toMatchObject({ code: 'ENOENT' }); expect(await readFile(f.ledger)).toEqual(ledger); expect(await f.store.list()).toHaveLength(1); expect((await ownership.list(f.root))[0].verified).toBe(false);
  });
  it('keeps pin serialization and exact receipt bytes when the removal callback fails', async () => {
    const ledger = await readFile(f.ledger), entered = gate(), held = gate();
    const pending = f.ownership.removeVerified(f.root, f.path, f.receipt.id, async () => { entered.release(); await held.promise; throw new Error('remove failed'); }, () => {}), rejected = expect(pending).rejects.toThrow('remove failed');
    await entered.promise; const pin = f.ownership.setPinned(f.root, { path: f.path, pinned: true }); expect(await readFile(f.ledger)).toEqual(ledger); held.release(); await rejected; await pin;
    expect((await f.ownership.list(f.root))[0].pinned).toBe(true); expect(await lstat(f.path)).toBeDefined();
  });
  it('rechecks the physical receipt inside the final removal callback and preserves both moved and replacement folders', async () => {
    const ledger = await readFile(f.ledger), moved = join(f.directory, 'moved');
    await expect(f.ownership.removeVerified(f.root, f.path, f.receipt.id, async verify => {
      await command(f.root, 'worktree', 'move', f.path, moved); await command(f.root, 'worktree', 'add', '--detach', f.path); await verify();
      throw new Error('Deletion should not be reached');
    }, () => {})).rejects.toThrow('folder changed');
    expect(await readFile(f.ledger)).toEqual(ledger); expect(await readFile(join(f.path, 'file.txt'), 'utf8')).toBe('EXACT BASE\n'); expect(await readFile(join(moved, 'file.txt'), 'utf8')).toBe('EXACT BASE\n');
  });
  it('drains an accepted held removal before closing and rejects new cleanup during shutdown', async () => {
    const held = gate(), entered = gate(), capture = f.snapshots.capture.bind(f.snapshots);
    vi.spyOn(f.snapshots, 'capture').mockImplementationOnce(async input => { entered.release(); await held.promise; return capture(input); });
    const removal = f.service.remove(f.request); await entered.promise; let closed = false;
    const closing = f.service.shutdown().then(() => { closed = true; }); await expect(f.service.remove(f.request)).rejects.toThrow('shutting down'); expect(closed).toBe(false);
    held.release(); const result = await removal; await closing; expect(closed).toBe(true); expect(result.managedRecord).toBe('saved'); expect(await f.store.read(result.snapshot.id)).toBeDefined();
  });
  it('retains an intervening source change, completed snapshot and original folder', async () => {
    const read = f.store.read.bind(f.store);
    vi.spyOn(f.store, 'read').mockImplementationOnce(async id => { const saved = await read(id); await f.vault.update(state => { state.projects[0].path = join(f.directory, 'other-root'); }); return saved; });
    await expect(f.service.remove(f.request)).rejects.toThrow('linked worktree project changed'); expect(f.vault.snapshot().projects[0].path).toBe(join(f.directory, 'other-root')); expect(await f.store.list()).toHaveLength(1); expect(await lstat(f.path)).toBeDefined();
  });
  async function additionalTrees() {
    const middle = join(f.directory, '中间工作树'), newest = join(f.directory, '最新工作树');
    for (const [path, branch] of [[middle, 'feature/middle'], [newest, 'feature/newest']]) { await f.git.createWorktree(f.root, { mode: 'new', path, branch }); await f.ownership.recordCreated(f.root, path); }
    const ledger = JSON.parse(await readFile(f.ledger, 'utf8')); ledger.records.forEach((record: { createdAt: number }, index: number) => { record.createdAt = index + 1; }); await atomicJson(f.ledger, ledger);
    return { middle, newest };
  }
  it('trims only the oldest clean local trees while retaining the newest requested count and one complete snapshot per removal', async () => {
    const { middle, newest } = await additionalTrees(), result = await f.service.trim(f.source, 1);
    expect(result.considered).toBe(2); expect(result.skipped).toBe(0); expect(result.removed.map(row => row.path)).toEqual([f.path, middle]);
    await expect(lstat(f.path)).rejects.toMatchObject({ code: 'ENOENT' }); await expect(lstat(middle)).rejects.toMatchObject({ code: 'ENOENT' }); expect(await lstat(newest)).toBeDefined(); expect(await f.store.list()).toHaveLength(2);
  });
  it('keeps the newest count even when older pinned or ignored trees prevent reaching the requested total', async () => {
    const { middle, newest } = await additionalTrees(); await f.ownership.setPinned(f.root, { path: f.path, pinned: true }); await writeFile(join(middle, 'ignored'), 'KEEP IGNORED');
    const ledger = await readFile(f.ledger), result = await f.service.trim(f.source, 1);
    expect(result).toEqual({ removed: [], considered: 2, skipped: 2 }); expect(await readFile(f.ledger)).toEqual(ledger); expect(await f.store.list()).toEqual([]); expect(await lstat(newest)).toBeDefined(); expect(await readFile(join(middle, 'ignored'), 'utf8')).toBe('KEEP IGNORED');
  });
  it('rejects invalid retention counts without touching folders or receipts and refuses trimming after shutdown', async () => {
    const ledger = await readFile(f.ledger);
    for (const count of [0, 51, 1.5, '1']) await expect(f.service.trim(f.source, count)).rejects.toThrow();
    expect(await readFile(f.ledger)).toEqual(ledger); expect(await f.store.list()).toEqual([]); await f.service.shutdown(); await expect(f.service.trim(f.source, 1)).rejects.toThrow('shutting down');
  });
});
