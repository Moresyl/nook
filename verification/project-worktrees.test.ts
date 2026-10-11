import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorktreeSchema } from '../contracts/project-worktrees';
import { parseGitWorktrees, ProjectGit } from '../desktop/services/project-git';
import { ManagedWorktreeRoots } from '../desktop/services/managed-worktree-roots';

const run = promisify(execFile), git = new ProjectGit(), directories: string[] = [];
async function fixture(commit = true) {
  const directory = await mkdtemp(join(tmpdir(), 'nook-worktrees-')); directories.push(directory);
  const root = join(directory, '项目 原始'); await mkdir(root);
  await run('git', ['init', '-b', 'main', root]);
  await run('git', ['-C', root, 'config', 'user.name', 'Test']); await run('git', ['-C', root, 'config', 'user.email', 'test@example.invalid']);
  await run('git', ['-C', root, 'config', 'core.autocrlf', 'false']); await run('git', ['-C', root, 'config', 'commit.gpgSign', 'false']);
  await writeFile(join(root, '文件.txt'), 'BASE\n');
  if (commit) { await git.stage(root, ['文件.txt'], true); await git.commit(root, 'Base'); }
  return { root, directory, path: join(directory, '独立 工作树') };
}
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    expect(dirname(directory)).toBe(resolve(tmpdir())); expect(directory.split(/[\\/]/).at(-1)).toMatch(/^nook-worktrees-[A-Za-z0-9]{6}$/);
    await rm(directory, { recursive: true, force: true });
  }
});

describe('worktree input and porcelain records', () => {
  it('requires explicit creation mode and rejects unknown force or reset fields', () => {
    const path = join(tmpdir(), 'new');
    expect(createWorktreeSchema.parse({ mode: 'new', path, branch: '中文/新功能', baseBranch: 'main' })).toMatchObject({ mode: 'new', baseBranch: 'main' });
    expect(createWorktreeSchema.parse({ mode: 'existing', path, branch: 'feature' })).toMatchObject({ mode: 'existing' });
    for (const input of [{ mode: 'new', path, branch: 'main', force: true }, { mode: 'existing', path, branch: 'main', baseBranch: 'main' }, { mode: 'guess', path, branch: 'main' }, { mode: 'new', path: '', branch: 'main' }, { mode: 'new', path: 'unsafe\0folder', branch: 'main' }, { mode: 'new', path, branch: '--force' }]) expect(createWorktreeSchema.safeParse(input).success).toBe(false);
  });
  it('retains NUL-delimited Unicode, newline paths, locks, pruning reasons and SHA-256 commits', () => {
    const result = parseGitWorktrees(`worktree /root/中文\n文件夹\0HEAD ${'a'.repeat(40)}\0branch refs/heads/中文\0locked pending\0\0worktree /other\0HEAD ${'b'.repeat(64)}\0detached\0prunable gitdir missing\0\0worktree /bare\0bare\0\0`);
    expect(result).toEqual([{ path: '/root/中文\n文件夹', head: 'a'.repeat(40), branch: '中文', bare: false, detached: false, locked: 'pending' }, { path: '/other', head: 'b'.repeat(64), bare: false, detached: true, prunable: 'gitdir missing' }, { path: '/bare', bare: true, detached: false }]);
    expect(parseGitWorktrees(`worktree /root\0HEAD ${'0'.repeat(40)}\0branch refs/heads/main\0locked\0prunable\0\0`)[0]).toMatchObject({ locked: '', prunable: '' });
  });
  it('rejects incomplete, contradictory, duplicate and unsupported worktree records', () => {
    const head = `HEAD ${'a'.repeat(40)}\0`, valid = `worktree /root\0${head}branch refs/heads/main\0\0`;
    for (const output of ['', 'HEAD abc\0', 'worktree \0', 'worktree /root\0HEAD bad\0\0', `worktree /root\0${head}\0`, `worktree /root\0${head}branch refs/heads/main\0detached\0\0`, `worktree /root\0${head}branch refs/tags/main\0\0`, `worktree /root\0${head}branch refs/heads/main\0locked one\0locked two\0\0`, 'worktree /bare\0bare reason\0\0', `worktree /bare\0bare\0${head}\0`, `worktree /root\0${head}branch refs/heads/main\0future value\0\0`, `worktree /root\0${head}branch refs/heads/main`, valid + valid]) expect(() => parseGitWorktrees(output)).toThrow('Git returned');
  });
});

describe('real Git worktree creation', () => {
  it('creates from the committed snapshot while preserving source branch, index and unsaved disk edits', async () => {
    const { root, directory, path } = await fixture();
    await writeFile(join(root, '文件.txt'), 'STAGED\n'); await git.stage(root, ['文件.txt'], true); await writeFile(join(root, '文件.txt'), 'WORKING\n'); await writeFile(join(root, 'untracked.txt'), 'KEEP');
    const before = await git.status(root), index = await readFile(join(root, '.git/index'));
    const result = await git.createWorktree(root, { mode: 'new', path, branch: 'feature/中文' });
    expect(result.warning).toBeUndefined(); expect(result.worktree).toMatchObject({ branch: 'feature/中文', detached: false, path: await realpath(path) });
    expect(result.branches.status).toEqual(before); expect(await readFile(join(root, '.git/index'))).toEqual(index);
    expect(await readFile(join(root, '文件.txt'), 'utf8')).toBe('WORKING\n'); expect(await readFile(join(root, 'untracked.txt'), 'utf8')).toBe('KEEP'); expect(await readFile(join(path, '文件.txt'), 'utf8')).toBe('BASE\n');
    expect((await git.worktrees(root)).map(item => item.branch)).toEqual(['main', 'feature/中文']);
    await expect(run('git', ['-C', root, 'config', '--get-regexp', '^branch\\.feature/中文\\.'])).rejects.toMatchObject({ code: 1 });
    expect(directory).toBe(dirname(path));
  });
  it('creates from an explicit base and checks out an existing branch without switching the source', async () => {
    const { root, directory, path } = await fixture();
    await git.createBranch(root, 'other'); await writeFile(join(root, '文件.txt'), 'OTHER\n'); await git.stage(root, ['文件.txt'], true); await git.commit(root, 'Other'); await git.switchBranch(root, 'main');
    const created = await git.createWorktree(root, { mode: 'new', path, branch: 'derived', baseBranch: 'other' });
    expect(created.worktree.branch).toBe('derived'); expect(await readFile(join(path, '文件.txt'), 'utf8')).toBe('OTHER\n');
    const existing = await git.createWorktree(root, { mode: 'existing', path: join(directory, 'existing'), branch: 'other' });
    expect(existing.worktree.branch).toBe('other'); expect(await readFile(join(existing.worktree.path, '文件.txt'), 'utf8')).toBe('OTHER\n'); expect((await git.status(root)).branch).toBe('main');
  });
  it('rejects existing destinations, nested worktrees, missing parents, duplicates and occupied branches without overwriting', async () => {
    const { root, directory, path } = await fixture(); await mkdir(path); await writeFile(join(path, 'sentinel'), 'KEEP');
    await expect(git.createWorktree(root, { mode: 'new', path, branch: 'one' })).rejects.toThrow('already exists');
    await expect(git.createWorktree(root, { mode: 'new', path: join(root, 'nested'), branch: 'one' })).rejects.toThrow('outside');
    await expect(git.createWorktree(root, { mode: 'new', path: join(directory, 'missing/new'), branch: 'one' })).rejects.toThrow('parent folder');
    await expect(git.createWorktree(root, { mode: 'new', path: 'relative', branch: 'one' })).rejects.toThrow('absolute');
    await expect(git.createWorktree(root, { mode: 'new', path: join(directory, 'new'), branch: 'main' })).rejects.toThrow('already exists');
    await expect(git.createWorktree(root, { mode: 'existing', path: join(directory, 'new'), branch: 'main' })).rejects.toThrow('another worktree');
    await expect(git.createWorktree(root, { mode: 'existing', path: join(directory, 'new'), branch: 'absent' })).rejects.toThrow('no longer exists');
    await expect(git.createWorktree(root, { mode: 'new', path: join(directory, 'new'), branch: 'one', baseBranch: 'absent' })).rejects.toThrow('base branch');
    await expect(git.createWorktree(root, { mode: 'new', path: join(directory, 'new'), branch: 'bad..branch' })).rejects.toThrow('valid Git branch');
    expect(await readFile(join(path, 'sentinel'), 'utf8')).toBe('KEEP'); expect((await git.branches(root)).branches.map(item => item.name)).toEqual(['main']);
    await git.createWorktree(root, { mode: 'new', path: join(directory, 'linked'), branch: 'linked' });
    await expect(git.createWorktree(root, { mode: 'new', path: join(directory, 'linked/inside'), branch: 'inside' })).rejects.toThrow('outside');
    await expect(git.createWorktree(root, { mode: 'existing', path: join(directory, 'new'), branch: 'linked' })).rejects.toThrow('another worktree');
  });
  it('canonicalizes a selected parent junction while preserving a dangling destination junction', async () => {
    const { root, directory } = await fixture(); await mkdir(join(directory, 'parent')); await symlink(join(directory, 'parent'), join(directory, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
    const created = await git.createWorktree(root, { mode: 'new', path: join(directory, 'alias/new'), branch: 'alias' });
    expect(created.worktree.path).toBe(await realpath(join(directory, 'parent/new')));
    await symlink(join(directory, 'absent'), join(directory, 'dangling'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(git.createWorktree(root, { mode: 'new', path: join(directory, 'dangling'), branch: 'dangling' })).rejects.toThrow('already exists');
  });
  it('refuses an unborn repository before creating a target or branch', async () => {
    const { root, path } = await fixture(false);
    await expect(git.createWorktree(root, { mode: 'new', path, branch: 'new' })).rejects.toThrow('Create a commit'); expect((await git.status(root)).unborn).toBe(true);
  });
  it('pins the selected base commit even when another Git process advances that branch', async () => {
    const { root, path } = await fixture(); const base = (await run('git', ['-C', root, 'rev-parse', 'HEAD'])).stdout.trim();
    await git.createBranch(root, 'future'); await writeFile(join(root, '文件.txt'), 'FUTURE\n'); await git.stage(root, ['文件.txt'], true); await git.commit(root, 'Future');
    const future = (await run('git', ['-C', root, 'rev-parse', 'HEAD'])).stdout.trim(); await git.switchBranch(root, 'main');
    await run('git', ['-C', root, 'branch', 'base', base]);
    const runner = vi.fn(async (file, args, options) => { if (args.includes('worktree') && args.includes('add')) await run('git', ['-C', root, 'update-ref', 'refs/heads/base', future]); return run(file, args, options); });
    const service = new ProjectGit(runner as unknown as ConstructorParameters<typeof ProjectGit>[0]);
    const result = await service.createWorktree(root, { mode: 'new', path, branch: 'pinned', baseBranch: 'base' });
    expect(result.worktree.head).toBe(base); expect(result.warning).toBeUndefined(); expect(await readFile(join(path, '文件.txt'), 'utf8')).toBe('BASE\n');
    expect((await run('git', ['-C', root, 'rev-parse', 'base'])).stdout.trim()).toBe(future);
  });
  it('reports a branch changed by a successful post-checkout hook using the actual worktree state', async () => {
    const { root, path } = await fixture(); const hook = join(root, '.git/hooks/post-checkout');
    await writeFile(hook, '#!/bin/sh\nif [ ! -f hook-once ]; then\n  touch hook-once\n  git switch -c hook-actual\nfi\n'); await chmod(hook, 0o755);
    const result = await git.createWorktree(root, { mode: 'new', path, branch: 'requested' });
    expect(result).toMatchObject({ worktree: { branch: 'hook-actual' }, warning: 'post-add-error', branches: { status: { branch: 'main' } } });
    expect((await run('git', ['-C', path, 'branch', '--show-current'])).stdout.trim()).toBe('hook-actual');
  });
  it('reports the actual created tree when a post-checkout hook fails without leaking its output', async () => {
    const { root, path } = await fixture(); const hook = join(root, '.git/hooks/post-checkout'); await writeFile(hook, '#!/bin/sh\necho PRIVATE_HOOK_TOKEN >&2\nexit 1\n'); await chmod(hook, 0o755);
    const result = await git.createWorktree(root, { mode: 'new', path, branch: 'hook-branch' });
    expect(result).toMatchObject({ worktree: { branch: 'hook-branch' }, warning: 'post-add-error', branches: { status: { branch: 'main' } } });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_HOOK_TOKEN'); expect(await readFile(join(path, '文件.txt'), 'utf8')).toBe('BASE\n');
  });
  it('preserves a partial failed destination and releases the mutation queue', async () => {
    const { root, path } = await fixture();
    const runner = vi.fn(async (file, args, options) => { if (args.includes('worktree') && args.includes('add')) { await mkdir(path); await writeFile(join(path, 'partial'), 'KEEP'); throw new Error('PRIVATE_TOKEN'); } return run(file, args, options); });
    const service = new ProjectGit(runner as unknown as ConstructorParameters<typeof ProjectGit>[0]);
    await expect(service.createWorktree(root, { mode: 'new', path, branch: 'failed' })).rejects.toThrow('existing files are retained');
    expect(await readFile(join(path, 'partial'), 'utf8')).toBe('KEEP'); await expect(service.createBranch(root, 'next')).resolves.toMatchObject({ status: { branch: 'next' } });
  });
  it('prepares a missing managed root inside the serialized Git operation while preserving the source', async () => {
    const { root, directory } = await fixture(), profile = join(directory, 'managed-profile'); await mkdir(profile);
    const manager = new ManagedWorktreeRoots(join(profile, 'worktrees')), path = join(manager.defaultRoot, 'nook-managed');
    await writeFile(join(root, '文件.txt'), 'DIRTY_KEEP\n'); await writeFile(join(root, '未跟踪.txt'), 'UNTRACKED_KEEP\n');
    const before = await git.status(root), index = await readFile(join(root, '.git/index'));
    const prepare = vi.fn(async (target: string, worktrees: { path: string }[]) => {
      expect(target).toBe(path); expect(worktrees.map(tree => resolve(tree.path))).toContain(await realpath(root));
      await manager.prepare('', target, worktrees.map(tree => tree.path));
    });
    const service = new ProjectGit(undefined, prepare), result = await service.createWorktree(root, { mode: 'new', path, branch: 'feature/managed-root' });
    expect(resolve(result.worktree.path)).toBe(resolve(path)); expect(prepare).toHaveBeenCalledTimes(1);
    expect(await readFile(join(path, '文件.txt'), 'utf8')).toBe('BASE\n'); expect(await git.status(root)).toEqual(before);
    expect(await readFile(join(root, '.git/index'))).toEqual(index); expect(await readFile(join(root, '未跟踪.txt'), 'utf8')).toBe('UNTRACKED_KEEP\n');
  });
  it('does not prepare directories before rejecting invalid, duplicate or unborn worktree requests', async () => {
    const { root, path } = await fixture(), unborn = await fixture(false), prepare = vi.fn(async () => {}), service = new ProjectGit(undefined, prepare);
    await expect(service.createWorktree(root, { mode: 'new', path, branch: 'main' })).rejects.toThrow('already exists');
    await expect(service.createWorktree(root, { mode: 'new', path: 'relative', branch: 'valid' })).rejects.toThrow('absolute');
    await expect(service.createWorktree(unborn.root, { mode: 'new', path: unborn.path, branch: 'valid' })).rejects.toThrow('Create a commit');
    expect(prepare).not.toHaveBeenCalled();
  });
  it('retains source and conflicting default-root bytes when preparation fails and releases the Git queue', async () => {
    const { root, directory } = await fixture(), defaultRoot = join(directory, 'conflicting-root'); await writeFile(defaultRoot, 'EXACT_ROOT_KEEP\n');
    const manager = new ManagedWorktreeRoots(defaultRoot), path = join(defaultRoot, 'nook-managed');
    await writeFile(join(root, '文件.txt'), 'SOURCE_KEEP\n'); const before = await git.status(root), index = await readFile(join(root, '.git/index'));
    const service = new ProjectGit(undefined, (target, worktrees) => manager.prepare('', target, worktrees.map(tree => tree.path)));
    await expect(service.createWorktree(root, { mode: 'new', path, branch: 'failed-preparation' })).rejects.toThrow('The default worktree directory could not be prepared.');
    expect(await readFile(defaultRoot, 'utf8')).toBe('EXACT_ROOT_KEEP\n'); expect(await git.status(root)).toEqual(before); expect(await readFile(join(root, '.git/index'))).toEqual(index);
    expect((await service.branches(root)).branches.some(branch => branch.name === 'failed-preparation')).toBe(false);
    await expect(service.createBranch(root, 'next-after-preparation')).resolves.toMatchObject({ status: { branch: 'next-after-preparation' } });
  });
  it('serializes worktree creation with source mutations and allows independent projects to proceed', async () => {
    const { root, path } = await fixture(), other = await fixture(); let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    const runner = vi.fn(async (file, args, options) => { if (args.includes('worktree') && args.includes('add')) { entered(); await gate; } return run(file, args, options); });
    const service = new ProjectGit(runner as unknown as ConstructorParameters<typeof ProjectGit>[0]);
    const creating = service.createWorktree(root, { mode: 'new', path, branch: 'held' }); await started;
    const queued = service.createBranch(root, 'later'); await service.createBranch(other.root, 'parallel');
    expect((await git.status(root)).branch).toBe('main'); expect((await git.status(other.root)).branch).toBe('parallel');
    release(); expect((await creating).branches.status.branch).toBe('main'); await queued; expect((await git.status(root)).branch).toBe('later');
  });
});
