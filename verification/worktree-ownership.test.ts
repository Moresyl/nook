import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ownedWorktreePathSchema, worktreePinSchema } from '../contracts/worktree-ownership';
import { ProjectGit } from '../desktop/services/project-git';
import { WorktreeOwnership } from '../desktop/services/worktree-ownership';
import { atomicJson } from '../desktop/services/atomic-json';
import { WorkspaceVault } from '../desktop/services/vault';
import { codec } from './fixtures';

const run = promisify(execFile), directories: string[] = [];
const git = (root: string, args: string[]) => run('git', ['-C', root, ...args], { windowsHide: true, timeout: 30_000 });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'nook-ownership-')); directories.push(directory);
  const root = join(directory, '源 仓库 🧭'), profile = join(directory, '配置'); await mkdir(root); await mkdir(profile);
  await git(root, ['init', '-b', 'main']); await git(root, ['config', 'user.name', 'Nook test']); await git(root, ['config', 'user.email', 'nook-test@example.invalid']);
  await git(root, ['config', 'commit.gpgSign', 'false']); await git(root, ['config', 'core.autocrlf', 'false']);
  await writeFile(join(root, '原文.txt'), 'EXACT_SOURCE\n'); await git(root, ['add', '.']); await git(root, ['commit', '-m', 'initial']);
  const path = join(directory, '独立 工作树'), file = join(profile, 'managed-worktrees.json');
  await git(root, ['worktree', 'add', '-b', 'feature/example', '--', path]);
  const projectGit = new ProjectGit(), readTrees = (root: string) => projectGit.worktrees(root);
  return { directory, root, path, file, readTrees, manager: new WorktreeOwnership(file, readTrees) };
}
afterEach(async () => {
  for (const path of directories.splice(0)) {
    expect(dirname(resolve(path))).toBe(resolve(tmpdir())); expect(basename(path)).toMatch(/^nook-ownership-[A-Za-z0-9]{6}$/);
    await rm(path, { recursive: true, force: true });
  }
});

describe('local worktree creation receipts', () => {
  it('retains private chat associations without creating authority for an external folder and preserves legacy no-op bytes', async () => {
    const { manager, root, path, file, readTrees } = await fixture();
    await manager.rememberConversations(path, ['external-chat']); await expect(lstat(file)).rejects.toMatchObject({ code: 'ENOENT' });
    const receipt = await manager.recordCreated(root, path), before = await readFile(file);
    await manager.rememberConversations(path, []); expect(await readFile(file)).toEqual(before);
    await manager.rememberConversations(path, ['one', 'one', 'two']);
    const rows = await new WorktreeOwnership(file, readTrees).list(root); expect(rows).toEqual([{ ...receipt, conversationIds: ['one', 'two'] }]);
    const remembered = await readFile(file); await manager.rememberConversations(path, ['two']); expect(await readFile(file)).toEqual(remembered);
    expect(await manager.recordCreated(root, path)).toEqual(rows[0]); rows[0].conversationIds!.push('mutated-copy'); expect((await manager.list(root))[0].conversationIds).toEqual(['one', 'two']);
  });
  it('rejects invalid or oversized association publication while preserving exact receipts on writer failure', async () => {
    const { manager, root, path, file, readTrees } = await fixture(); await manager.recordCreated(root, path); const before = await readFile(file);
    for (const raw of [null, [1], [''], ['x'.repeat(129)]]) await expect(manager.rememberConversations(path, raw)).rejects.toThrow();
    const failed = new WorktreeOwnership(file, readTrees, async () => { throw new Error('private write failed'); });
    await expect(failed.rememberConversations(path, ['chat'])).rejects.toThrow('could not be saved'); expect(await readFile(file)).toEqual(before);
    await manager.rememberConversations(path, Array.from({ length: 10000 }, (_, index) => `chat-${index}`)); const full = await readFile(file);
    await expect(manager.rememberConversations(path, ['extra'])).rejects.toThrow('could not be saved'); expect(await readFile(file)).toEqual(full);
  });
  it('refuses a new ledger larger than its readable limit without overwriting the last readable receipts', async () => {
    const { manager, root, path, file } = await fixture(); await manager.recordCreated(root, path);
    const ledger = JSON.parse(await readFile(file, 'utf8')), original = ledger.records[0];
    for (let index = 0; index < 200; index++) ledger.records.push({ ...structuredClone(original), id: randomUUID(), identity: { ...structuredClone(original.identity), directory: { ...original.identity.directory, path: join(dirname(path), String(index).padStart(3, '0') + 'x'.repeat(3900)) } } });
    await atomicJson(file, ledger); const before = await readFile(file); expect(before.length).toBeLessThan(2_000_000);
    await expect(manager.rememberConversations(path, Array.from({ length: 10000 }, (_, index) => String(index).padStart(5, '0') + 'x'.repeat(120)))).rejects.toThrow('could not be saved');
    expect(await readFile(file)).toEqual(before);
  });
  it.each(['', 'relative', 'C:relative', 'E:\\bad\npath'])('rejects invalid receipt paths before filesystem work: %j', path => {
    expect(ownedWorktreePathSchema.safeParse(path).success).toBe(false);
    expect(() => new WorktreeOwnership(path, vi.fn())).toThrow();
  });

  it('uses strict pin input and rejects coercion or extra cleanup authority', () => {
    expect(worktreePinSchema.safeParse({ path: resolve(tmpdir(), 'tree'), pinned: true }).success).toBe(true);
    expect(worktreePinSchema.safeParse({ path: resolve(tmpdir(), 'tree'), pinned: 'true' }).success).toBe(false);
    expect(worktreePinSchema.safeParse({ path: resolve(tmpdir(), 'tree'), pinned: true, force: true }).success).toBe(false);
  });

  it('does not adopt or write receipts for existing external Git worktrees during list or pin', async () => {
    const { root, path, file, manager } = await fixture();
    expect(await manager.list(root)).toEqual([]);
    await expect(manager.setPinned(root, { path, pinned: true })).rejects.toThrow('was not created');
    await expect(lstat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('records actual linked identities, reopens them and pins without changing Git or file bytes', async () => {
    const { root, path, file, manager, readTrees } = await fixture();
    await writeFile(join(path, '未跟踪.txt'), 'EXACT_UNTRACKED\n');
    const head = (await git(root, ['rev-parse', 'HEAD'])).stdout, index = await readFile(join(root, '.git', 'index')), marker = await readFile(join(path, '.git'));
    const receipt = await manager.recordCreated(root, path); expect(receipt.verified).toBe(true); expect(receipt.pinned).toBe(false);
    await manager.setPinned(root, { path, pinned: true });
    const reopened = await new WorktreeOwnership(file, readTrees).list(root);
    expect(reopened).toEqual([{ ...receipt, pinned: true }]);
    expect((await git(root, ['rev-parse', 'HEAD'])).stdout).toBe(head); expect(await readFile(join(root, '.git', 'index'))).toEqual(index);
    expect(await readFile(join(path, '.git'))).toEqual(marker); expect(await readFile(join(path, '未跟踪.txt'), 'utf8')).toBe('EXACT_UNTRACKED\n');
  });

  it('deduplicates concurrent creation receipts while retaining the original ID, time and pin', async () => {
    const { root, path, file, manager } = await fixture();
    const [one, two] = await Promise.all([manager.recordCreated(root, path), manager.recordCreated(root, path)]);
    expect(two).toEqual(one); await manager.setPinned(root, { path, pinned: true });
    expect(await manager.recordCreated(root, path)).toEqual({ ...one, pinned: true });
    expect(JSON.parse(await readFile(file, 'utf8')).records).toHaveLength(1);
  });

  it('keeps the ledger byte-for-byte for no-op pins', async () => {
    const { root, path, file, manager } = await fixture(); await manager.recordCreated(root, path);
    const before = await readFile(file); await manager.setPinned(root, { path, pinned: false }); expect(await readFile(file)).toEqual(before);
  });

  it('refuses the main worktree, absent targets and ordinary folders without changing the ledger', async () => {
    const { directory, root, file, manager } = await fixture(), ordinary = join(directory, 'ordinary'); await mkdir(ordinary);
    for (const path of [root, join(directory, 'missing'), ordinary]) await expect(manager.recordCreated(root, path)).rejects.toThrow('could not be verified');
    await expect(lstat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('detects a removed and recreated worktree even when path and branch are reused', async () => {
    const { directory, root, path, file, manager } = await fixture(); await manager.recordCreated(root, path); const before = await readFile(file);
    const retained = join(directory, 'retained-original'); await rename(path, retained); await git(root, ['worktree', 'prune']); await git(root, ['worktree', 'add', '--', path, 'feature/example']);
    expect((await manager.list(root))[0].verified).toBe(false);
    await expect(manager.recordCreated(root, path)).rejects.toThrow('folder changed');
    await expect(manager.setPinned(root, { path, pinned: true })).rejects.toThrow('folder changed'); expect(await readFile(file)).toEqual(before);
    expect(await readFile(join(retained, '原文.txt'), 'utf8')).toBe('EXACT_SOURCE\n');
  });

  it('marks missing worktrees unverified and retains stale receipt data for later recovery', async () => {
    const { root, path, file, manager } = await fixture(); const receipt = await manager.recordCreated(root, path), before = await readFile(file);
    await git(root, ['worktree', 'remove', '--', path]);
    expect(await manager.list(root)).toEqual([{ ...receipt, verified: false }]);
    await expect(manager.setPinned(root, { path, pinned: true })).rejects.toThrow('folder changed'); expect(await readFile(file)).toEqual(before);
  });

  it('rejects linked folder aliases and never writes through or deletes them', async () => {
    const { directory, root, path, file, manager } = await fixture(); const alias = join(directory, 'alias'); await symlink(path, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(manager.recordCreated(root, alias)).rejects.toThrow('could not be verified');
    expect((await lstat(alias)).isSymbolicLink()).toBe(true); await expect(lstat(file)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(path, '原文.txt'), 'utf8')).toBe('EXACT_SOURCE\n');
  });

  it('does not reassign a receipt to a different repository or a moved folder', async () => {
    const { directory, root, path, file, manager } = await fixture(); await manager.recordCreated(root, path); const before = await readFile(file);
    const moved = join(directory, 'retained-tree'); await rename(path, moved); await mkdir(path); await git(path, ['init', '-b', 'main']);
    expect((await manager.list(root))[0].verified).toBe(false);
    await expect(manager.setPinned(root, { path, pinned: true })).rejects.toThrow('folder changed');
    expect(await readFile(file)).toEqual(before); expect(await readFile(join(moved, '原文.txt'), 'utf8')).toBe('EXACT_SOURCE\n');
  });

  it.each(['invalid-json', 'invalid-shape', 'directory', 'symlink'])('retains an unreadable or untrusted ledger instead of replacing it: %s', async kind => {
    const { directory, root, file, manager } = await fixture();
    const external = join(directory, 'external.json'); await writeFile(external, 'EXACT_EXTERNAL_KEEP\n');
    if (kind === 'directory') await mkdir(file);
    else if (kind === 'symlink') await symlink(external, file, process.platform === 'win32' ? 'file' : undefined);
    else await writeFile(file, kind === 'invalid-json' ? '{broken' : '{"version":1,"records":[],"force":true}');
    const error = await manager.list(root).catch(error => error);
    expect(error.message).toBe('Managed worktree records could not be read. Existing files were retained.'); expect(error.message).not.toContain(file);
    expect(await readFile(external, 'utf8')).toBe('EXACT_EXTERNAL_KEEP\n');
    if (kind === 'directory') expect((await lstat(file)).isDirectory()).toBe(true);
    else if (kind === 'symlink') expect((await lstat(file)).isSymbolicLink()).toBe(true);
    else expect(await readFile(file, 'utf8')).toBe(kind === 'invalid-json' ? '{broken' : '{"version":1,"records":[],"force":true}');
  });

  it('does not expose a failed pin update and permits a later queued retry', async () => {
    const { root, path, file, readTrees } = await fixture(); let failing = false;
    const writer = vi.fn(async (file: string, value: unknown) => { if (failing) throw new Error('EIO secret path'); await atomicJson(file, value); });
    const manager = new WorktreeOwnership(file, readTrees, writer); const receipt = await manager.recordCreated(root, path), before = await readFile(file);
    failing = true;
    const error = await manager.setPinned(root, { path, pinned: true }).catch(error => error);
    expect(error.message).toBe('Managed worktree records could not be saved. Existing worktrees were retained.'); expect(error.message).not.toContain('secret');
    expect(await readFile(file)).toEqual(before);
    expect(await manager.list(root)).toEqual([receipt]); failing = false; await manager.setPinned(root, { path, pinned: true });
    expect(await manager.list(root)).toEqual([{ ...receipt, pinned: true }]);
  });

  it('retains an actual worktree when its first receipt save fails and retries without adopting any other tree', async () => {
    const { root, path, file, readTrees } = await fixture(); let failing = true;
    const manager = new WorktreeOwnership(file, readTrees, async (file, value) => { if (failing) throw new Error('EIO'); await atomicJson(file, value); });
    await expect(manager.recordCreated(root, path)).rejects.toThrow('could not be saved');
    expect(await manager.list(root)).toEqual([]); expect(await readFile(join(path, '原文.txt'), 'utf8')).toBe('EXACT_SOURCE\n');
    failing = false; const receipt = await manager.recordCreated(root, path); expect(await manager.list(root)).toEqual([receipt]);
  });

  it('serializes conflicting pins without returning uncommitted state', async () => {
    const { root, path, manager } = await fixture(); const receipt = await manager.recordCreated(root, path);
    await Promise.all([manager.setPinned(root, { path, pinned: true }), manager.setPinned(root, { path, pinned: false })]);
    expect(await manager.list(root)).toEqual([receipt]);
  });

  it('retains locked and detached ownership for read-only listing and explicit pinning', async () => {
    const { root, path, manager } = await fixture(); const receipt = await manager.recordCreated(root, path);
    await git(root, ['worktree', 'lock', '--reason', 'keep', path]); expect(await manager.list(root)).toEqual([receipt]);
    await git(root, ['-C', path, 'checkout', '--detach']); await manager.setPinned(root, { path, pinned: true });
    expect(await manager.list(root)).toEqual([{ ...receipt, pinned: true }]);
  });

  it('detects changed Git pointer bytes, retains the marker and refuses pinning', async () => {
    const { root, path, file, manager } = await fixture(); await manager.recordCreated(root, path); const before = await readFile(file), marker = join(path, '.git');
    const original = await readFile(marker, 'utf8'), changed = Buffer.from(original.endsWith('\r\n') ? original.replace(/\r\n$/, '\n') : original.replace(/\n$/, '\r\n'));
    expect(changed.toString()).not.toBe(original);
    const handle = await open(marker, 'r+');
    try { await handle.writeFile(changed); await handle.truncate(changed.length); }
    finally { await handle.close(); }
    expect((await manager.list(root))[0].verified).toBe(false);
    await expect(manager.setPinned(root, { path, pinned: true })).rejects.toThrow('folder changed'); expect(await readFile(file)).toEqual(before);
  });

  it('excludes receipts from another repository and sanitizes missing source errors', async () => {
    const { directory, root, path, manager } = await fixture(); await manager.recordCreated(root, path);
    const other = join(directory, 'other-repository'); await mkdir(other); await git(other, ['init', '-b', 'main']);
    expect(await manager.list(other)).toEqual([]);
    const error = await manager.list(join(directory, 'missing-private-root')).catch(error => error);
    expect(error.message).toBe('The managed worktree repository could not be checked. Refresh the list.'); expect(error.message).not.toContain(directory);
  });

  it('rejects duplicate record identity and oversized ledger files while preserving exact bytes', async () => {
    const { root, path, file, manager } = await fixture(); await manager.recordCreated(root, path);
    const ledger = JSON.parse(await readFile(file, 'utf8')); ledger.records.push(ledger.records[0]);
    for (const content of [JSON.stringify(ledger), ' '.repeat(2_000_001)]) {
      await writeFile(file, content); await expect(manager.list(root)).rejects.toThrow('could not be read'); expect(await readFile(file, 'utf8')).toBe(content);
    }
  });

  it('records only the actual newly created tree through the Git queue callback', async () => {
    const { directory, root, path: external, manager } = await fixture(), target = join(directory, 'app-created');
    const service = new ProjectGit(undefined, undefined, async (root, tree) => { await manager.recordCreated(root, tree.path); });
    const result = await service.createWorktree(root, { mode: 'new', branch: 'feature/app-created', path: target });
    expect(result.managedRecord).toBe('saved');
    const records = await manager.list(root); expect(records).toHaveLength(1); expect(records[0]).toMatchObject({ path: await realpath(target), verified: true, pinned: false });
    expect(records.some(record => record.path === external)).toBe(false);
  });

  it('returns the real creation result when receipt saving fails and never records failed creation', async () => {
    const { directory, root, path: existing } = await fixture(), target = join(directory, 'save-failed');
    const callback = vi.fn(async () => { throw new Error('secret EIO'); }), service = new ProjectGit(undefined, undefined, callback);
    const result = await service.createWorktree(root, { mode: 'new', branch: 'feature/save-failed', path: target });
    expect(result).toMatchObject({ managedRecord: 'failed', worktree: { branch: 'feature/save-failed' } }); expect(JSON.stringify(result)).not.toContain('secret');
    expect(await readFile(join(target, '原文.txt'), 'utf8')).toBe('EXACT_SOURCE\n');
    await expect(service.createWorktree(root, { mode: 'new', branch: 'feature/not-created', path: existing })).rejects.toThrow('Choose a folder outside this repository’s existing worktrees.'); expect(callback).toHaveBeenCalledTimes(1);
  });

  it('keeps the Git mutation queue locked until the creation receipt callback completes', async () => {
    const { directory, root } = await fixture();
    let release!: () => void, begin!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { begin = resolve; });
    const service = new ProjectGit(undefined, undefined, async () => { begin(); await held; });
    const creation = service.createWorktree(root, { mode: 'new', branch: 'feature/held-receipt', path: join(directory, 'held-tree') }); await started;
    let completed = false; const mutation = service.createBranch(root, 'feature/queued').then(() => { completed = true; });
    await new Promise(resolve => setImmediate(resolve)); expect(completed).toBe(false);
    expect((await git(root, ['branch', '--list', 'feature/queued'])).stdout.trim()).toBe('');
    release(); expect((await creation).managedRecord).toBe('saved'); await mutation; expect(completed).toBe(true);
  });

  it('exports project metadata without creation authority and reopening the backup in another profile cannot adopt the tree', async () => {
    const { directory, root, path, file, manager, readTrees } = await fixture(); const receipt = await manager.recordCreated(root, path);
    const vault = new WorkspaceVault(dirname(file), codec); await vault.initialize();
    await vault.update(draft => { draft.projects.push({ id: 'project', name: '项目', path, instructions: '', createdAt: 1 }); });
    const backup = await vault.backupWithOriginals(), text = JSON.stringify(backup);
    expect(text).not.toContain(receipt.id); expect(text).not.toContain('gitFileSha256'); expect(backup.projects[0].path).toBe(path);
    const otherProfile = join(directory, 'other-profile'); await mkdir(otherProfile); await writeFile(join(otherProfile, 'workspace.json'), text);
    const restored = new WorkspaceVault(otherProfile, codec); await restored.initialize(); expect(restored.snapshot().projects).toEqual(backup.projects);
    expect(await new WorktreeOwnership(join(otherProfile, 'managed-worktrees.json'), readTrees).list(root)).toEqual([]);
    expect(await manager.list(root)).toEqual([receipt]); await vault.flush(); await restored.flush();
  });
});
