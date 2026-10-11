import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { worktreeOwnershipSourceSchema, worktreePinError, worktreePinRequestSchema, type ManagedWorktree } from '../contracts/worktree-ownership';
import { ProjectGit } from '../desktop/services/project-git';
import { WorktreeOwnership } from '../desktop/services/worktree-ownership';
import { managedWorktrees, setWorktreePinned } from '../desktop/services/worktree-pinning';
import { WorkspaceVault } from '../desktop/services/vault';
import { atomicJson } from '../desktop/services/atomic-json';
import { loadWorktreeOwnership } from '../workbench/lib/worktree-ownership';
import { codec } from './fixtures';

const run = promisify(execFile), directories: string[] = [];
const source = { projectId: 'source', path: 'E:/源项目' }, input = { source, path: 'E:/工作树', pinned: true };
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'nook-pinning-')); directories.push(directory);
  const root = join(directory, '源 项目 🧭'), path = join(directory, '独立 工作树'), profile = join(directory, '资料'); await mkdir(root);
  const git = (args: string[]) => run('git', ['-C', root, ...args], { windowsHide: true, timeout: 30000 });
  await git(['init', '-q', '-b', 'main']);
  for (const [key, value] of [['user.name', 'Nook test'], ['user.email', 'test@example.invalid'], ['commit.gpgSign', 'false'], ['core.autocrlf', 'false']]) await git(['config', key, value]);
  await writeFile(join(root, '保留.txt'), 'BASE\n'); await git(['add', '.']); await git(['commit', '-qm', 'Base']); await git(['worktree', 'add', '-q', '-b', 'feature/pin', path]);
  const vault = new WorkspaceVault(profile, codec); await vault.initialize(); await vault.update(state => { state.projects.push({ id: 'source', name: '源项目', path: root, instructions: 'SOURCE_KEEP', createdAt: 1 }); });
  const projectGit = new ProjectGit(), reader = (root: string) => projectGit.worktrees(root), file = join(profile, 'managed-worktrees.json'), ownership = new WorktreeOwnership(file, reader);
  await ownership.recordCreated(root, path);
  return { directory, root, path, profile, file, vault, reader, ownership, input: { ...input, source: { ...source, path: root }, path } };
}
afterEach(async () => { vi.restoreAllMocks(); for (const directory of directories.splice(0)) { expect(dirname(resolve(directory))).toBe(resolve(tmpdir())); expect(basename(directory)).toMatch(/^nook-pinning-[A-Za-z0-9]{6}$/); await rm(directory, { recursive: true, force: true }); } });

describe('managed worktree bridge contracts', () => {
  it('preserves existing project identifiers and requires strict explicit absolute source and target paths', () => {
    expect(worktreeOwnershipSourceSchema.parse(source)).toEqual(source); expect(worktreePinRequestSchema.parse(input)).toEqual(input);
    for (const invalid of [{ ...input, pinned: 'true' }, { ...input, force: true }, { ...input, path: 'relative' }, { ...input, source: { ...source, projectId: '' } }, { ...input, source: { ...source, path: 'relative' } }, { ...input, source: { ...source, adopt: true } }]) expect(worktreePinRequestSchema.safeParse(invalid).success).toBe(false);
  });
  it.each([undefined, null, 42, 'PRIVATE_KEY E:/secret', new Error('PRIVATE_KEY E:/secret')])('sanitizes pin failures: %s', problem => {
    expect(worktreePinError(problem)).toBe('未能保存工作树固定状态。请刷新列表后重试。');
  });
  it('preserves known stale-source guidance through the IPC envelope', () => {
    expect(worktreePinError(new Error("Error invoking remote method 'qiyao:invoke': Error: The linked worktree project changed. Refresh the worktree list."))).toBe('关联项目已变更，请刷新工作树列表后重试。');
  });
});

describe('managed worktree project boundary', () => {
  it('reads a shared repository list once for multiple receipts and retains safe unverified records on query failure', async () => {
    const { root, file, vault, reader, input } = await fixture(), read = vi.fn(reader), ownership = new WorktreeOwnership(file, read);
    for (const name of ['second', 'third']) { const path = join(dirname(root), name); await run('git', ['-C', root, 'worktree', 'add', '-b', `feature/${name}`, path], { windowsHide: true, timeout: 30000 }); await ownership.recordCreated(root, path); }
    const bytes = await readFile(file); read.mockClear();
    expect((await managedWorktrees(vault, ownership, input.source)).map(record => record.verified)).toEqual([true, true, true]); expect(read).toHaveBeenCalledTimes(1); expect(await readFile(file)).toEqual(bytes);
    read.mockRejectedValueOnce(new Error('PRIVATE_QUERY_FAILURE')); expect((await managedWorktrees(vault, ownership, input.source)).map(record => record.verified)).toEqual([false, false, false]); expect(await readFile(file)).toEqual(bytes);
    expect((await managedWorktrees(vault, ownership, input.source)).every(record => record.verified)).toBe(true); expect(await readFile(file)).toEqual(bytes);
  });
  it('lists and pins an actual owned tree without changing workspace or Git bytes, then reopens local pin metadata', async () => {
    const fixtureState = await fixture(), { root, path, profile, file, vault, ownership, reader, input } = fixtureState;
    const bytes = await readFile(join(profile, 'workspace.json')), index = await readFile(join(root, '.git/index'));
    const initial = await managedWorktrees(vault, ownership, input.source); expect(initial).toHaveLength(1); expect(initial[0]).toMatchObject({ path, pinned: false, verified: true });
    await setWorktreePinned(vault, ownership, input); expect(await managedWorktrees(vault, new WorktreeOwnership(file, reader), input.source)).toEqual([{ ...initial[0], pinned: true }]);
    expect(await readFile(join(profile, 'workspace.json'))).toEqual(bytes); expect(await readFile(join(root, '.git/index'))).toEqual(index); expect(await readFile(join(root, '保留.txt'), 'utf8')).toBe('BASE\n');
    const saved = await readFile(file); await setWorktreePinned(vault, ownership, input); expect(await readFile(file)).toEqual(saved);
    await setWorktreePinned(vault, ownership, { ...input, pinned: false }); expect((await managedWorktrees(vault, ownership, input.source))[0].pinned).toBe(false);
  });
  it('rejects missing or changed sources before invoking any ownership operation', async () => {
    const ownership = { list: vi.fn(), setPinned: vi.fn() }, vault = { project: vi.fn(() => undefined) };
    await expect(managedWorktrees(vault, ownership, source)).rejects.toThrow('linked worktree project changed'); await expect(setWorktreePinned(vault, ownership, input)).rejects.toThrow('linked worktree project changed'); expect(ownership.list).not.toHaveBeenCalled(); expect(ownership.setPinned).not.toHaveBeenCalled();
  });
  it('rejects a source changed while a list is pending and does not return stale records', async () => {
    const { vault, ownership, input } = await fixture(); let release!: (records: ManagedWorktree[]) => void;
    vi.spyOn(ownership, 'list').mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const pending = managedWorktrees(vault, ownership, input.source); const rejected = expect(pending).rejects.toThrow('linked worktree project changed'); await vault.update(state => { state.projects[0].path = 'E:/changed'; }); release([]); await rejected;
  });
  it('rechecks source identity inside the metadata queue after actual Git validation and retains bytes on change', async () => {
    const { root, path, file, vault, input, reader } = await fixture(), original = await readFile(file); let changed = false;
    const ownership = new WorktreeOwnership(file, async path => { if (!changed) { changed = true; await vault.update(state => { state.projects[0].path = 'E:/changed'; }); } return reader(path); });
    await expect(setWorktreePinned(vault, ownership, input)).rejects.toThrow('linked worktree project changed'); expect(await readFile(file)).toEqual(original); expect(await readFile(join(path, '保留.txt'), 'utf8')).toBe('BASE\n'); expect(await readFile(join(root, '保留.txt'), 'utf8')).toBe('BASE\n');
  });
  it('retains old pin bytes after real ownership writer failure and succeeds on a later retry', async () => {
    const { file, vault, input, reader } = await fixture(), original = await readFile(file); let failed = true;
    const ownership = new WorktreeOwnership(file, reader, async (...args) => { if (failed) throw new Error('PRIVATE_WRITE_FAILURE'); await atomicJson(...args); });
    await expect(setWorktreePinned(vault, ownership, input)).rejects.toThrow('could not be saved'); expect(await readFile(file)).toEqual(original); failed = false; await setWorktreePinned(vault, ownership, input); expect((await managedWorktrees(vault, ownership, input.source))[0].pinned).toBe(true);
  });
  it('never adopts an external tree through the project pin boundary', async () => {
    const { root, file, vault, ownership, input } = await fixture(), external = join(dirname(root), '外部 工作树'), bytes = await readFile(file);
    await run('git', ['-C', root, 'worktree', 'add', '-b', 'feature/external', external], { windowsHide: true, timeout: 30000 });
    await expect(setWorktreePinned(vault, ownership, { ...input, path: external })).rejects.toThrow('not created by this application'); expect(await readFile(file)).toEqual(bytes); expect(await readFile(join(external, '保留.txt'), 'utf8')).toBe('BASE\n');
  });
  it('does not call filesystem services for malformed bridge input', async () => {
    const ownership = { list: vi.fn(), setPinned: vi.fn() }, vault = { project: vi.fn() };
    await expect(managedWorktrees(vault, ownership, { ...source, adopt: true })).rejects.toThrow(); await expect(setWorktreePinned(vault, ownership, { ...input, force: true })).rejects.toThrow(); expect(vault.project).not.toHaveBeenCalled();
  });
});

describe('bounded ownership list loading', () => {
  it('reads each supplied repository source sequentially and preserves records without adoption', async () => {
    const sources = [source, { ...source, projectId: 'second', path: 'E:/second' }], record: ManagedWorktree = { id: 'record', path: input.path, pinned: false, verified: true, createdAt: 1 };
    let release!: (records: ManagedWorktree[]) => void; const read = vi.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValueOnce([]);
    const pending = loadWorktreeOwnership(sources, read, () => true); expect(read).toHaveBeenCalledTimes(1); release([record]); expect(await pending).toEqual([{ source, records: [record], failed: false }, { source: sources[1], records: [], failed: false }]); expect(read.mock.calls.map(call => call[0])).toEqual(sources);
  });
  it('continues after a read error and exposes a failed source without inventing records', async () => {
    const second = { ...source, projectId: 'second' }, read = vi.fn().mockRejectedValueOnce(new Error('PRIVATE')).mockResolvedValueOnce([]);
    expect(await loadWorktreeOwnership([source, second], read, () => true)).toEqual([{ source, records: [], failed: true }, { source: second, records: [], failed: false }]);
  });
  it('does not read after close or for an empty page', async () => {
    const read = vi.fn(); expect(await loadWorktreeOwnership([source], read, () => false)).toEqual([]); expect(await loadWorktreeOwnership([], read, () => true)).toEqual([]); expect(read).not.toHaveBeenCalled();
  });
  it('discards an in-flight response after close and stops subsequent source reads', async () => {
    let active = true, release!: (records: ManagedWorktree[]) => void; const read = vi.fn(() => new Promise<ManagedWorktree[]>(resolve => { release = resolve; })), pending = loadWorktreeOwnership([source, source], read, () => active);
    active = false; release([]); expect(await pending).toEqual([]); expect(read).toHaveBeenCalledTimes(1);
  });
});
