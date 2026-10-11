import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { worktreeRegistrationError, worktreeRegistrationSchema } from '../contracts/worktree-registration';
import type { GitWorktree } from '../contracts/project-worktrees';
import { ProjectGit } from '../desktop/services/project-git';
import { registerWorktreeProject } from '../desktop/services/worktree-registration';
import { WorkspaceVault } from '../desktop/services/vault';
import { codec, sampleThread } from './fixtures';

const run = promisify(execFile), directories: string[] = [];
const input = { source: { projectId: 'source', path: 'E:/Trees/源项目' }, projectId: 'registered', name: '新 项目', path: 'E:/Trees/中文工作树' };
async function git(root: string, args: string[]) { return (await run('git', ['--no-pager', '-C', root, ...args], { encoding: 'utf8', windowsHide: true, timeout: 30000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })).stdout.trim(); }
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'nook-registration-')); directories.push(directory);
  const root = join(directory, '源 项目'), path = join(directory, '中文 工作树'), profile = join(directory, '资料'); await mkdir(root);
  await git(root, ['init', '-q', '-b', 'main']); await git(root, ['config', 'user.name', 'Test']); await git(root, ['config', 'user.email', 'test@example.invalid']); await git(root, ['config', 'commit.gpgSign', 'false']); await git(root, ['config', 'core.autocrlf', 'false']);
  await writeFile(join(root, '保留.txt'), 'BASE\n'); await git(root, ['add', '.']); await git(root, ['commit', '-qm', 'Base']); await git(root, ['worktree', 'add', '-q', '-b', 'feature/中文', '--', path, 'HEAD']);
  const vault = new WorkspaceVault(profile, codec); await vault.initialize();
  await vault.update(draft => { draft.projects.push({ id: 'source', name: '源项目', path: root, instructions: 'PRIVATE_SOURCE_INSTRUCTIONS', createdAt: 1 }); draft.threads.push(sampleThread({ projectId: 'source', pinned: true, archived: true })); draft.preferences.worktrees = { root: directory, upstreamRefresh: 'best-effort' }; });
  const request = { ...input, source: { projectId: 'source', path: root }, path }, service = new ProjectGit();
  const read = vi.fn((root: string) => service.worktrees(root));
  return { directory, root, path, profile, vault, request, read, service };
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) { expect(dirname(directory)).toBe(resolve(tmpdir())); expect(directory.split(/[\\/]/).at(-1)).toMatch(/^nook-registration-[A-Za-z0-9]{6}$/); await rm(directory, { recursive: true, force: true }); }
});

describe('worktree registration contract', () => {
  it('normalizes valid names and rejects relative, empty, control-character and spoofed fields', () => {
    expect(worktreeRegistrationSchema.parse({ ...input, name: '  新 项目  ' }).name).toBe('新 项目');
    for (const invalid of [{ ...input, path: '' }, { ...input, path: 'relative' }, { ...input, path: 'E:/bad\0' }, { ...input, name: '  ' }, { ...input, name: 'bad\n' }, { ...input, name: 'x'.repeat(101) }, { ...input, projectId: '' }, { ...input, source: { ...input.source, path: '' } }, { ...input, source: { ...input.source, path: 'relative' } }, { ...input, source: { ...input.source, force: true } }, { ...input, instructions: 'spoof' }, { ...input, force: true }]) expect(worktreeRegistrationSchema.safeParse(invalid).success).toBe(false);
  });
  it.each([null, undefined, 42, 'PRIVATE_KEY SECRET_PATH', new Error('PRIVATE_KEY SECRET_PATH')])('sanitizes an unknown failure: %s', failure => {
    expect(worktreeRegistrationError(failure)).toBe('未能登记工作树项目。请检查文件夹与仓库，然后刷新重试。');
  });
  it('preserves known source-change and durable-save guidance through IPC errors', () => {
    expect(worktreeRegistrationError(new Error('The linked worktree project changed. Refresh the worktree list.'))).toBe('关联项目已变更，请刷新工作树列表后重试。');
    expect(worktreeRegistrationError(new Error("Error invoking remote method 'qiyao:invoke': Error: Local data could not be saved. Check disk space and directory permissions."))).toBe('本地数据未能保存。请检查磁盘空间和文件夹权限，再重试。');
  });
});

describe('verified worktree project registration', () => {
  it('registers an actual Unicode worktree without altering Git, files, histories or preferences and survives restart', async () => {
    const f = await fixture(); await writeFile(join(f.root, '保留.txt'), 'STAGED\n'); await git(f.root, ['add', '保留.txt']); await writeFile(join(f.root, '保留.txt'), 'DIRTY_KEEP\n'); await writeFile(join(f.root, '未跟踪.txt'), 'UNTRACKED_KEEP\n');
    const before = f.vault.snapshot(), index = await readFile(join(f.root, '.git/index')), head = await git(f.root, ['rev-parse', 'HEAD']);
    const state = await registerWorktreeProject(f.vault, f.read, f.request);
    expect(state.projects).toHaveLength(2); expect(state.projects[0]).toEqual(before.projects[0]); expect(state.projects[1]).toMatchObject({ id: f.request.projectId, name: f.request.name, path: await realpath(f.path), instructions: '' });
    expect(state.threads).toEqual(before.threads); expect(state.preferences).toEqual(before.preferences); expect(state.composerDrafts).toEqual(before.composerDrafts); expect(f.read).toHaveBeenCalledTimes(2);
    expect(await readFile(join(f.root, '.git/index'))).toEqual(index); expect(await git(f.root, ['rev-parse', 'HEAD'])).toBe(head); expect(await readFile(join(f.root, '保留.txt'), 'utf8')).toBe('DIRTY_KEEP\n'); expect(await readFile(join(f.root, '未跟踪.txt'), 'utf8')).toBe('UNTRACKED_KEEP\n'); expect(await readFile(join(f.path, '保留.txt'), 'utf8')).toBe('BASE\n');
    const restarted = new WorkspaceVault(f.profile, codec); await restarted.initialize(); expect(restarted.snapshot().projects).toEqual(state.projects);
  });
  it('retains an existing registration, instructions and identity instead of duplicating or overwriting it', async () => {
    const f = await fixture(); await f.vault.update(draft => { draft.projects.push({ id: 'existing', name: '保留名称', path: f.path, instructions: 'KEEP', createdAt: 2 }); }); const before = f.vault.snapshot(), bytes = await readFile(join(f.profile, 'workspace.json'));
    const state = await registerWorktreeProject(f.vault, f.read, { ...f.request, path: process.platform === 'win32' ? f.path.toUpperCase().replaceAll('\\', '/') : f.path }); expect(state).toEqual(before); expect(await readFile(join(f.profile, 'workspace.json'))).toEqual(bytes);
  });
  it('serializes concurrent registration requests and keeps one durable project', async () => {
    const f = await fixture(); const states = await Promise.all([registerWorktreeProject(f.vault, f.read, f.request), registerWorktreeProject(f.vault, f.read, { ...f.request, projectId: 'second', name: '第二名称' })]); expect(states.every(state => state.projects.length === 2)).toBe(true); expect(f.vault.snapshot().projects).toHaveLength(2); expect(['registered', 'second']).toContain(f.vault.snapshot().projects[1].id);
  });
  it.each(['detached', 'locked'])('permits metadata registration of an otherwise valid %s worktree', async kind => {
    const f = await fixture(); if (kind === 'detached') await git(f.path, ['checkout', '-q', '--detach', 'HEAD']); else await git(f.root, ['worktree', 'lock', '--', f.path]);
    const state = await registerWorktreeProject(f.vault, f.read, f.request); expect(state.projects).toHaveLength(2); expect(state.projects[1].path).toBe(await realpath(f.path)); expect(await readFile(join(f.path, '保留.txt'), 'utf8')).toBe('BASE\n');
  });
  it('rejects malformed input and missing source projects before invoking Git or persistence', async () => {
    const f = await fixture(); const bytes = await readFile(join(f.profile, 'workspace.json'));
    await expect(registerWorktreeProject(f.vault, f.read, { ...f.request, force: true })).rejects.toThrow(); await expect(registerWorktreeProject(f.vault, f.read, { ...f.request, source: { ...f.request.source, projectId: 'missing' } })).rejects.toThrow('project changed'); expect(f.read).not.toHaveBeenCalled(); expect(await readFile(join(f.profile, 'workspace.json'))).toEqual(bytes);
  });
  it.each(['move', 'remove'])('rejects a source %s during held repository reads without discarding the intervening change', async action => {
    const f = await fixture(), trees = await f.service.worktrees(f.root); let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; }); let entered!: () => void; const observing = new Promise<void>(resolve => { entered = resolve; });
    const read = vi.fn(async () => { entered(); await held; return trees; }); const pending = registerWorktreeProject(f.vault, read, f.request); await observing;
    try { await f.vault.update(draft => { if (action === 'move') draft.projects[0].path = join(f.directory, '已迁移'); else draft.projects = []; }); const before = f.vault.snapshot(), bytes = await readFile(join(f.profile, 'workspace.json')); release(); await expect(pending).rejects.toThrow('project changed'); expect(f.vault.snapshot()).toEqual(before); expect(await readFile(join(f.profile, 'workspace.json'))).toEqual(bytes); } finally { release(); }
  });
  it.each(['missing', 'bare', 'prunable', 'headless'])('rejects a %s worktree without writing metadata', async kind => {
    const f = await fixture(), tree: GitWorktree = { path: f.path, head: 'a'.repeat(40), detached: false, bare: kind === 'bare', ...(kind === 'prunable' ? { prunable: 'missing' } : {}) }; if (kind === 'headless') delete tree.head;
    const read = vi.fn(async () => kind === 'missing' ? [] : [tree]), before = f.vault.snapshot(); await expect(registerWorktreeProject(f.vault, read, f.request)).rejects.toThrow('no longer available'); expect(f.vault.snapshot()).toEqual(before);
  });
  it.each(['missing', 'file'])('rejects a target folder that is a %s', async kind => {
    const f = await fixture(), path = join(f.directory, '不可用'); if (kind === 'file') await writeFile(path, 'KEEP\n'); const tree: GitWorktree = { path, head: 'a'.repeat(40), detached: false, bare: false }, before = f.vault.snapshot(); await expect(registerWorktreeProject(f.vault, async () => [tree], { ...f.request, path })).rejects.toThrow('folder is unavailable'); expect(f.vault.snapshot()).toEqual(before); if (kind === 'file') expect(await readFile(path, 'utf8')).toBe('KEEP\n');
  });
  it('rejects a junction or symbolic-link alias that resolves to a different target', async () => {
    const f = await fixture(), path = join(f.directory, '别名'); await symlink(f.path, path, process.platform === 'win32' ? 'junction' : 'dir'); const before = f.vault.snapshot(); await expect(registerWorktreeProject(f.vault, async () => [{ path, head: 'a'.repeat(40), detached: false, bare: false }], { ...f.request, path })).rejects.toThrow('folder changed'); expect(f.vault.snapshot()).toEqual(before); expect(await readFile(join(f.path, '保留.txt'), 'utf8')).toBe('BASE\n');
  });
  it('rechecks the actual target repository and rejects a replacement repository behind a stale list', async () => {
    const f = await fixture(), original = await f.service.worktrees(f.root); await rename(f.path, join(f.directory, '保留 旧工作树')); await mkdir(f.path); await git(f.path, ['init', '-q', '-b', 'other']);
    const read = vi.fn(async (path: string) => path === f.root ? original : f.service.worktrees(path)), before = f.vault.snapshot(); await expect(registerWorktreeProject(f.vault, read, f.request)).rejects.toThrow('repository changed'); expect(f.vault.snapshot()).toEqual(before); expect(await readFile(join(f.directory, '保留 旧工作树', '保留.txt'), 'utf8')).toBe('BASE\n');
  });
  it('rejects an unrelated project identifier and sanitizes read failures before persistence', async () => {
    const f = await fixture(), before = f.vault.snapshot(); await expect(registerWorktreeProject(f.vault, f.read, { ...f.request, projectId: 'source' })).rejects.toThrow('identifier'); await expect(registerWorktreeProject(f.vault, async () => { throw new Error('PRIVATE_KEY SECRET_PATH'); }, f.request)).rejects.toThrow('worktree list could not be read'); expect(f.vault.snapshot()).toEqual(before);
  });
  it.each(['error', 'missing', 'bare', 'prunable', 'headless'])('rejects a target repository whose fresh read is %s', async kind => {
    const f = await fixture(), trees = await f.service.worktrees(f.root), before = f.vault.snapshot();
    const read = vi.fn(async (path: string) => {
      if (path === f.root) return trees;
      if (kind === 'error') throw new Error('PRIVATE_KEY SECRET_PATH');
      if (kind === 'missing') return [];
      return trees.map(tree => tree.path.replaceAll('\\', '/').toLowerCase() === f.path.replaceAll('\\', '/').toLowerCase() ? { ...tree, ...(kind === 'bare' ? { bare: true } : kind === 'headless' ? { head: undefined } : { prunable: 'missing' }) } : tree);
    });
    await expect(registerWorktreeProject(f.vault, read, f.request)).rejects.toThrow(kind === 'error' ? 'repository is unavailable' : 'repository changed'); expect(f.vault.snapshot()).toEqual(before);
  });
  it('retains actual metadata bytes on a mocked write failure and retries the same identity and name', async () => {
    const f = await fixture(), before = f.vault.snapshot(), bytes = await readFile(join(f.profile, 'workspace.json')); vi.spyOn(f.vault, 'update').mockRejectedValueOnce(new Error('Local data could not be saved. Check disk space and directory permissions.'));
    await expect(registerWorktreeProject(f.vault, f.read, f.request)).rejects.toThrow('could not be saved'); expect(f.vault.snapshot()).toEqual(before); expect(await readFile(join(f.profile, 'workspace.json'))).toEqual(bytes);
    const state = await registerWorktreeProject(f.vault, f.read, f.request); expect(state.projects[1]).toMatchObject({ id: f.request.projectId, name: f.request.name }); expect(state.projects).toHaveLength(2);
  });
  it('fails at the existing project capacity without changing durable state', async () => {
    const f = await fixture(); await f.vault.update(draft => { for (let index = 1; index < 1000; index++) draft.projects.push({ id: `capacity-${index}`, name: '容量', path: join(f.directory, `容量-${index}`), instructions: '', createdAt: 1 }); }); const before = f.vault.snapshot(), bytes = await readFile(join(f.profile, 'workspace.json')); await expect(registerWorktreeProject(f.vault, f.read, f.request)).rejects.toThrow(); expect(f.vault.snapshot()).toEqual(before); expect(await readFile(join(f.profile, 'workspace.json'))).toEqual(bytes);
  });
});
