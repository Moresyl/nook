import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseGitBranches, parseGitStatus, ProjectGit } from '../desktop/services/project-git';
const directories: string[] = [];
const run = promisify(execFile);
const git = new ProjectGit();
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { force: true, recursive: true }))); });
async function repository() { const path = await mkdtemp(join(tmpdir(), 'qiyao-git-')); directories.push(path); await run('git', ['init', '-q', path]); await run('git', ['-C', path, 'config', 'user.name', 'Qiyao test']); await run('git', ['-C', path, 'config', 'user.email', 'test@localhost']); await run('git', ['-C', path, 'config', 'commit.gpgSign', 'false']); return path; }
describe('project Git workflow', () => {
  it('parses NUL branch records with literal Unicode and newline worktree paths', () => {
    expect(parseGitBranches('功能/中文🧭\0*\0C:/项目\n路径\0\nother\0 \0\0\n')).toEqual([{ name: '功能/中文🧭', current: true, worktreePath: 'C:/项目\n路径' }, { name: 'other', current: false, worktreePath: '' }]);
    expect(parseGitBranches('')).toEqual([]);
    for (const output of ['bad', 'branch\0?\0path\0\n', '\0 \0path\0\n']) expect(() => parseGitBranches(output)).toThrow('invalid branch');
  });
  it('lists, creates and switches real local branches, including unborn and detached HEAD', async () => {
    const root = await repository(); const initial = (await git.status(root)).branch;
    expect((await git.branches(root)).branches).toEqual([{ name: initial, current: true, worktreePath: root.replace(/\\/g, '/') }]);
    expect((await git.createBranch(root, '功能/中文🧭')).status).toMatchObject({ branch: '功能/中文🧭', unborn: true });
    await writeFile(join(root, 'file.txt'), 'BASE'); await git.stage(root, ['file.txt'], true); await git.commit(root, 'Base');
    const created = await git.createBranch(root, 'second'); expect(created.status.branch).toBe('second'); expect(created.branches).toHaveLength(2);
    expect((await git.switchBranch(root, '功能/中文🧭')).status.branch).toBe('功能/中文🧭');
    expect((await git.switchBranch(root, '功能/中文🧭')).status.branch).toBe('功能/中文🧭');
    await run('git', ['-C', root, 'switch', '--detach', 'HEAD']); expect((await git.branches(root)).status.detached).toBe(true);
    expect((await git.createBranch(root, 'from-detached')).status).toMatchObject({ branch: 'from-detached', detached: false });
  });
  it('retains harmless staged and untracked changes and refuses an overwriting switch', async () => {
    const root = await repository(); await writeFile(join(root, 'file.txt'), 'BASE'); await git.stage(root, ['file.txt'], true); await git.commit(root, 'Base'); const base = (await git.status(root)).branch;
    await git.createBranch(root, 'changed'); await writeFile(join(root, 'file.txt'), 'CHANGED'); await git.stage(root, ['file.txt'], true); await git.commit(root, 'Changed'); await git.switchBranch(root, base);
    await writeFile(join(root, 'keep.txt'), 'KEEP'); await git.stage(root, ['keep.txt'], true); await writeFile(join(root, 'untracked.txt'), 'UNTRACKED');
    await git.switchBranch(root, 'changed'); expect(await readFile(join(root, 'keep.txt'), 'utf8')).toBe('KEEP'); expect(await readFile(join(root, 'untracked.txt'), 'utf8')).toBe('UNTRACKED');
    expect((await git.status(root)).files.find(file => file.path === 'keep.txt')?.index).toBe('A');
    await writeFile(join(root, 'file.txt'), 'DO_NOT_LOSE'); await expect(git.switchBranch(root, base)).rejects.toThrow('Git could not');
    expect((await git.status(root)).branch).toBe('changed'); expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('DO_NOT_LOSE');
  });
  it('renames current and unused Unicode branches without changing commits, index, files or tracking settings', async () => {
    const root = await repository(); await writeFile(join(root, 'file.txt'), 'BASE'); await git.stage(root, ['file.txt'], true); await git.commit(root, 'Base'); const base = (await git.status(root)).branch;
    await git.createBranch(root, 'old'); await run('git', ['-C', root, 'config', 'branch.old.remote', '.']); await run('git', ['-C', root, 'config', 'branch.old.merge', `refs/heads/${base}`]);
    await writeFile(join(root, 'file.txt'), 'INDEX'); await git.stage(root, ['file.txt'], true); await writeFile(join(root, 'file.txt'), 'WORKING'); await writeFile(join(root, 'keep.txt'), 'UNTRACKED');
    const head = (await run('git', ['-C', root, 'rev-parse', 'HEAD'])).stdout, index = await readFile(join(root, '.git/index'));
    const renamed = await git.renameBranch(root, 'old', '功能/改名🧭'); expect(renamed.status.branch).toBe('功能/改名🧭'); expect(renamed.branches.some(branch => branch.name === 'old')).toBe(false);
    expect((await run('git', ['-C', root, 'config', 'branch.功能/改名🧭.merge'])).stdout.trim()).toBe(`refs/heads/${base}`);
    expect((await run('git', ['-C', root, 'reflog', 'show', '--format=%gs', '功能/改名🧭'])).stdout).toContain('renamed');
    expect((await run('git', ['-C', root, 'rev-parse', 'HEAD'])).stdout).toBe(head); expect(await readFile(join(root, '.git/index'))).toEqual(index);
    expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('WORKING'); expect(await readFile(join(root, 'keep.txt'), 'utf8')).toBe('UNTRACKED');
    expect((await git.renameBranch(root, base, 'unused-renamed')).status.branch).toBe('功能/改名🧭'); expect((await git.renameBranch(root, '功能/改名🧭', '功能/改名🧭')).status.branch).toBe('功能/改名🧭');
  });
  it('renames an unborn current branch and an unused branch from detached HEAD', async () => {
    const root = await repository(), base = (await git.status(root)).branch;
    expect((await git.renameBranch(root, base, '功能/初始')).status).toMatchObject({ branch: '功能/初始', unborn: true });
    await writeFile(join(root, 'file.txt'), 'BASE'); await git.stage(root, ['file.txt'], true); await git.commit(root, 'Base');
    await run('git', ['-C', root, 'switch', '--detach', 'HEAD']);
    expect((await git.renameBranch(root, '功能/初始', 'detached-renamed')).status.detached).toBe(true);
  });
  it('rejects invalid, duplicate, missing and occupied rename targets without replacing any refs', async () => {
    const root = await repository(); await writeFile(join(root, 'file.txt'), 'BASE'); await git.stage(root, ['file.txt'], true); await git.commit(root, 'Base'); const base = (await git.status(root)).branch;
    await git.createBranch(root, 'occupied'); await git.switchBranch(root, base); const linked = join(root, 'linked'); await run('git', ['-C', root, 'worktree', 'add', linked, 'occupied']);
    for (const name of ['', '-M', 'a b', '@{-1}', 'HEAD', 'a..b', 'a.lock', 'a\0b']) { await expect(git.renameBranch(root, base, name)).rejects.toThrow(); await expect(git.renameBranch(root, name, 'safe')).rejects.toThrow(); }
    await expect(git.renameBranch(root, base, 'occupied')).rejects.toThrow('already exists'); await expect(git.renameBranch(root, 'missing', 'safe')).rejects.toThrow('no longer'); await expect(git.renameBranch(root, 'occupied', 'safe')).rejects.toThrow('another worktree');
    expect((await git.branches(root)).branches.map(branch => branch.name).sort()).toEqual([base, 'occupied'].sort()); expect((await git.status(linked)).branch).toBe('occupied');
  });
  it('deletes only merged unused local refs while preserving HEAD, staged bytes, files and remote refs', async () => {
    const root = await repository(); await writeFile(join(root, 'file.txt'), 'BASE'); await git.stage(root, ['file.txt'], true); await git.commit(root, 'Base'); const base = (await git.status(root)).branch;
    await git.createBranch(root, '功能/已合并🧭'); await git.switchBranch(root, base); const head = (await run('git', ['-C', root, 'rev-parse', 'HEAD'])).stdout.trim();
    await run('git', ['-C', root, 'update-ref', 'refs/remotes/origin/功能/已合并🧭', head]); await writeFile(join(root, 'file.txt'), 'INDEX'); await git.stage(root, ['file.txt'], true); await writeFile(join(root, 'file.txt'), 'WORKING'); await writeFile(join(root, 'keep.txt'), 'KEEP'); const index = await readFile(join(root, '.git/index'));
    const result = await git.deleteBranch(root, '功能/已合并🧭'); expect(result.status.branch).toBe(base); expect(result.branches.map(branch => branch.name)).toEqual([base]);
    expect((await run('git', ['-C', root, 'rev-parse', 'HEAD'])).stdout.trim()).toBe(head); expect((await run('git', ['-C', root, 'rev-parse', 'refs/remotes/origin/功能/已合并🧭'])).stdout.trim()).toBe(head);
    expect(await readFile(join(root, '.git/index'))).toEqual(index); expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('WORKING'); expect(await readFile(join(root, 'keep.txt'), 'utf8')).toBe('KEEP');
    await git.createBranch(root, 'detached-delete'); await run('git', ['-C', root, 'switch', '--detach', 'HEAD']); expect((await git.deleteBranch(root, 'detached-delete')).status.detached).toBe(true);
  });
  it('retains unmerged commits even when a configured upstream already contains them', async () => {
    const root = await repository(); await writeFile(join(root, 'file.txt'), 'BASE'); await git.stage(root, ['file.txt'], true); await git.commit(root, 'Base'); const base = (await git.status(root)).branch;
    await git.createBranch(root, 'unmerged'); await writeFile(join(root, 'new.txt'), 'UNMERGED'); await git.stage(root, ['new.txt'], true); await git.commit(root, 'Unmerged'); const tip = (await run('git', ['-C', root, 'rev-parse', 'HEAD'])).stdout.trim();
    await run('git', ['-C', root, 'update-ref', 'refs/remotes/origin/unmerged', tip]); await run('git', ['-C', root, 'config', 'branch.unmerged.remote', 'origin']); await run('git', ['-C', root, 'config', 'branch.unmerged.merge', 'refs/heads/unmerged']); await git.switchBranch(root, base);
    await expect(git.deleteBranch(root, 'unmerged')).rejects.toThrow('not fully merged'); expect((await run('git', ['-C', root, 'rev-parse', 'refs/heads/unmerged'])).stdout.trim()).toBe(tip);
  });
  it('retains current and occupied branches, rejects missing or invalid delete requests and honors Git upstream protection', async () => {
    const root = await repository(); const initial = (await git.status(root)).branch; await expect(git.deleteBranch(root, initial)).rejects.toThrow('current branch');
    await writeFile(join(root, 'file.txt'), 'BASE'); await git.stage(root, ['file.txt'], true); await git.commit(root, 'Base'); const base = (await git.status(root)).branch;
    const old = (await run('git', ['-C', root, 'rev-parse', 'HEAD'])).stdout.trim(); await git.createBranch(root, 'protected'); await writeFile(join(root, 'next.txt'), 'NEXT'); await git.stage(root, ['next.txt'], true); await git.commit(root, 'Next'); await run('git', ['-C', root, 'update-ref', 'refs/heads/upstream-behind', old]);
    await run('git', ['-C', root, 'config', 'branch.protected.remote', '.']); await run('git', ['-C', root, 'config', 'branch.protected.merge', 'refs/heads/upstream-behind']); await git.switchBranch(root, base); await run('git', ['-C', root, 'merge', '--ff-only', 'protected']);
    await expect(git.deleteBranch(root, 'protected')).rejects.toThrow('Git could not'); expect((await git.branches(root)).branches.some(branch => branch.name === 'protected')).toBe(true);
    const linked = join(root, 'linked'); await run('git', ['-C', root, 'worktree', 'add', linked, 'protected']); await expect(git.deleteBranch(root, 'protected')).rejects.toThrow('another worktree'); await expect(git.deleteBranch(root, base)).rejects.toThrow('current branch'); await expect(git.deleteBranch(root, 'missing')).rejects.toThrow('no longer');
    for (const name of ['-D', 'HEAD', 'a..b', '@{-1}', 'a\0b']) await expect(git.deleteBranch(root, name)).rejects.toThrow();
  });
  it('queues rename/delete across linked worktrees and revalidates the source after an earlier rename', async () => {
    const root = await repository(); await writeFile(join(root, 'file.txt'), 'BASE'); await git.stage(root, ['file.txt'], true); await git.commit(root, 'Base'); const base = (await git.status(root)).branch;
    await git.createBranch(root, 'linked'); await git.switchBranch(root, base); const linked = join(root, 'linked'); await run('git', ['-C', root, 'worktree', 'add', linked, 'linked']); await run('git', ['-C', root, 'branch', 'unused']);
    let release!: () => void, entered!: () => void; const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    const runner = vi.fn(async (file, args, options) => { if (args.includes('-m')) { entered(); await held; } return run(file, args, options); }); const queued = new ProjectGit(runner as unknown as ConstructorParameters<typeof ProjectGit>[0]);
    const renaming = queued.renameBranch(root, 'unused', 'renamed'); await started; const deleting = queued.deleteBranch(linked, 'unused'), failed = expect(deleting).rejects.toThrow('no longer');
    expect(runner.mock.calls.some(([, args]) => args.includes('-d'))).toBe(false); release(); await renaming; await failed; expect((await queued.deleteBranch(linked, 'renamed')).branches.some(branch => branch.name === 'renamed')).toBe(false);
  });
  it('sanitizes failed metadata mutations and retains the branch when ancestry cannot be verified', async () => {
    const root = await repository(); await writeFile(join(root, 'file.txt'), 'BASE'); await git.stage(root, ['file.txt'], true); await git.commit(root, 'Base'); await run('git', ['-C', root, 'branch', 'unused']);
    const runner = vi.fn(async (file, args, options) => { if (args.includes('-m') || args.includes('merge-base')) throw new Error('PRIVATE_TOKEN_DIAGNOSTICS'); return run(file, args, options); }); const failed = new ProjectGit(runner as unknown as ConstructorParameters<typeof ProjectGit>[0]);
    await expect(failed.renameBranch(root, 'unused', 'renamed')).rejects.toThrow('Git could not complete'); await expect(failed.deleteBranch(root, 'unused')).rejects.toThrow('not fully merged'); expect((await git.branches(root)).branches.some(branch => branch.name === 'unused')).toBe(true); expect(runner.mock.calls.some(([, args]) => args.includes('-d'))).toBe(false);
  });
  it('rejects invalid names, duplicate or missing branches, and worktree occupancy without leaking output', async () => {
    const root = await repository(); await writeFile(join(root, 'file.txt'), 'BASE'); await git.stage(root, ['file.txt'], true); await git.commit(root, 'Base'); const base = (await git.status(root)).branch;
    for (const name of ['', '-f', 'a b', '@{-1}', 'HEAD', 'a..b', 'a.lock', 'a/../b', 'a\0b']) await expect(git.createBranch(root, name)).rejects.toThrow();
    await expect(git.createBranch(root, base)).rejects.toThrow('already exists'); await expect(git.switchBranch(root, 'missing')).rejects.toThrow('no longer');
    await git.createBranch(root, 'occupied'); await git.switchBranch(root, base); const linked = join(root, 'linked worktree'); await run('git', ['-C', root, 'worktree', 'add', linked, 'occupied']);
    expect((await git.branches(root)).branches.find(branch => branch.name === 'occupied')?.worktreePath).toBe(linked.replace(/\\/g, '/'));
    await expect(git.switchBranch(root, 'occupied')).rejects.toThrow('another worktree'); expect((await git.status(root)).branch).toBe(base);
    const failed = new ProjectGit(vi.fn().mockRejectedValue(new Error('PRIVATE_TOKEN_DIAGNOSTICS'))); await expect(failed.branches(root)).rejects.toThrow('Git could not');
  });
  it('serializes mutations within one project, permits other projects and releases failed queues', async () => {
    const root = await repository(), other = await repository(); let release!: () => void; let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    const runner = vi.fn(async (_file, args) => { if (args.includes('--git-common-dir')) return run(_file, args); if (args.includes('commit')) { started(); await held; throw new Error('private'); } return { stdout: args.includes('status') ? '# branch.head main\0' + '1 A. N... 100644 100644 100644 a b file.txt\0' : 'main\0*\0\0\n' }; });
    const queued = new ProjectGit(runner as unknown as ConstructorParameters<typeof ProjectGit>[0]);
    const commit = queued.commit(root, 'Held'); const failed = expect(commit).rejects.toThrow('Git could not'); await entered;
    const waiting = queued.createBranch(root, 'next'); await queued.createBranch(other, 'parallel');
    expect(runner.mock.calls.some(([, args]) => args.includes('switch') && args.includes('parallel'))).toBe(true);
    expect(runner.mock.calls.some(([, args]) => args.includes('switch') && args.includes('next'))).toBe(false); release(); await failed; await waiting;
    expect(runner.mock.calls.some(([, args]) => args.includes('switch') && args.includes('next'))).toBe(true);
    await expect(queued.createBranch(root, 'again')).resolves.toMatchObject({ status: { branch: 'main' } });
  });
  it('returns the actual changed branch with a warning when a post-checkout hook fails', async () => {
    const root = await repository(); await writeFile(join(root, 'file.txt'), 'BASE'); await git.stage(root, ['file.txt'], true); await git.commit(root, 'Base'); const base = (await git.status(root)).branch;
    const hook = join(root, '.git/hooks/post-checkout'); await writeFile(hook, '#!/bin/sh\necho PRIVATE_HOOK_TOKEN >&2\nexit 1\n'); await chmod(hook, 0o755);
    expect(await git.createBranch(root, 'hook-branch')).toMatchObject({ status: { branch: 'hook-branch' }, warning: 'post-switch-error' });
    expect(await git.switchBranch(root, base)).toMatchObject({ status: { branch: base }, warning: 'post-switch-error' });
  });
  it('refuses both branch actions during a real unresolved merge without changing HEAD or conflict bytes', async () => {
    const root = await repository(); await writeFile(join(root, 'file.txt'), 'BASE\n'); await git.stage(root, ['file.txt'], true); await git.commit(root, 'Base'); const base = (await git.status(root)).branch;
    await git.createBranch(root, 'other'); await writeFile(join(root, 'file.txt'), 'OTHER\n'); await git.stage(root, ['file.txt'], true); await git.commit(root, 'Other');
    await git.switchBranch(root, base); await writeFile(join(root, 'file.txt'), 'CURRENT\n'); await git.stage(root, ['file.txt'], true); await git.commit(root, 'Current');
    await expect(run('git', ['-C', root, 'merge', 'other'])).rejects.toThrow(); const bytes = await readFile(join(root, 'file.txt'));
    await expect(git.switchBranch(root, 'other')).rejects.toThrow('Resolve merge conflicts'); await expect(git.createBranch(root, 'new')).rejects.toThrow('Resolve merge conflicts');
    expect((await git.status(root)).branch).toBe(base); expect(await readFile(join(root, 'file.txt'))).toEqual(bytes);
  });
  it('parses NUL records without splitting Unicode, spaces or line breaks in paths', () => {
    const output = '# branch.oid (initial)\0# branch.head main\0# branch.ab +2 -3\0? 新 文件\n名.ts\0' + '1 .M N... 100644 100644 100644 a b path with spaces.txt\0' + '2 R. N... 100644 100644 100644 a b R100 new name.txt\0old name.txt\0' + 'u UU N... 100644 100644 100644 100644 a b c merge.txt\0';
    expect(parseGitStatus(output)).toMatchObject({ branch: 'main', unborn: true, ahead: 2, behind: 3, files: [{ path: '新 文件\n名.ts' }, { path: 'path with spaces.txt', working: 'M' }, { path: 'new name.txt', originalPath: 'old name.txt' }, { path: 'merge.txt', conflict: true }] });
    expect(parseGitStatus('# branch.head (detached)\0').detached).toBe(true);
    expect(() => parseGitStatus('1 bad\0')).toThrow('invalid status');
  });
  it('stages and unstages an unborn repository without changing worktree contents', async () => {
    const root = await repository(); await writeFile(join(root, '中文 空格.txt'), 'One\n');
    expect((await git.status(root)).unborn).toBe(true);
    expect((await git.stage(root, ['中文 空格.txt'], true)).files[0].index).toBe('A');
    expect(await git.fileView(root, (await git.status(root)).files[0], true)).toMatchObject({ before: '', after: 'One\n', binary: false });
    expect((await git.stage(root, ['中文 空格.txt'], false)).files[0].index).toBe('?');
    expect(await readFile(join(root, '中文 空格.txt'), 'utf8')).toBe('One\n');
    await expect(git.commit(root, 'No staged files')).rejects.toThrow('Stage');
    await git.stage(root, ['中文 空格.txt'], true); expect((await git.commit(root, 'Initial')).files).toEqual([]);
  });
  it('compares HEAD, index and disk separately and commits only explicitly staged files', async () => {
    const root = await repository(); await writeFile(join(root, 'file.txt'), 'Base\n'); await git.stage(root, ['file.txt'], true); await git.commit(root, 'Initial');
    await writeFile(join(root, 'file.txt'), 'Staged\n'); await git.stage(root, ['file.txt'], true); await writeFile(join(root, 'file.txt'), 'Working\n');
    await writeFile(join(root, 'untracked.txt'), 'Keep this file');
    const file = (await git.status(root)).files.find((file) => file.path === 'file.txt')!;
    expect(await git.fileView(root, file, true)).toMatchObject({ before: 'Base\n', after: 'Staged\n', binary: false });
    expect(await git.fileView(root, file, false)).toMatchObject({ before: 'Staged\n', after: 'Working\n', binary: false });
    const status = await git.commit(root, 'Staged only'); expect(status.files).toHaveLength(2);
    expect((await run('git', ['-C', root, 'show', 'HEAD:file.txt'])).stdout).toBe('Staged\n');
    await git.stage(root, ['file.txt'], true); await git.stage(root, ['file.txt'], false);
    expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('Working\n');
  });
  it('handles renames, deletions, literal pathspecs and binary views', async () => {
    const root = await repository(); await writeFile(join(root, 'old.txt'), 'Rename me\n'); await writeFile(join(root, '[literal].txt'), 'Text\n'); await git.stage(root, ['old.txt', '[literal].txt'], true); await git.commit(root, 'Initial');
    await rename(join(root, 'old.txt'), join(root, 'new name.txt')); await git.stage(root, ['old.txt', 'new name.txt'], true);
    const renamed = (await git.status(root)).files.find((file) => file.path === 'new name.txt')!;
    expect(renamed.originalPath).toBe('old.txt'); expect(await git.fileView(root, renamed, true)).toMatchObject({ before: 'Rename me\n', after: 'Rename me\n' });
    await git.stage(root, ['new name.txt', 'old.txt'], false);
    await rm(join(root, '[literal].txt')); const deleted = (await git.status(root)).files.find((file) => file.path === '[literal].txt')!;
    expect(await git.fileView(root, deleted, false)).toMatchObject({ before: 'Text\n', after: '' });
    await writeFile(join(root, 'binary.dat'), Buffer.from([0, 1, 2])); const binary = (await git.status(root)).files.find((file) => file.path === 'binary.dat')!;
    expect((await git.fileView(root, binary, false)).binary).toBe(true);
    await writeFile(join(root, 'non-utf8.bin'), Buffer.from([255, 254, 253])); await git.stage(root, ['non-utf8.bin'], true);
    const nonUtf8 = (await git.status(root)).files.find((file) => file.path === 'non-utf8.bin')!;
    expect((await git.fileView(root, nonUtf8, true)).binary).toBe(true);
  });
  it('validates scope and reports failed Git operations without leaking subprocess output', async () => {
    const root = await repository();
    for (const path of ['../outside', '.git/config', 'C:\\secret', '/absolute', '']) await expect(git.stage(root, [path], true)).rejects.toThrow();
    await expect(git.stage(root, [], true)).rejects.toThrow('Choose');
    await expect(git.stage(root, ['missing'], true)).rejects.toThrow('no longer');
    await expect(git.commit(root, '  ')).rejects.toThrow('message');
    await expect(git.fileView(root, { path: 'missing', index: 'M', working: '.', conflict: false }, true)).rejects.toThrow('no longer');
    const failed = new ProjectGit(vi.fn().mockRejectedValue(new Error('Private credential output')));
    await expect(failed.status(root)).rejects.toThrow('Git could not');
    const conflict = new ProjectGit(vi.fn(async (file, args) => args.includes('--git-common-dir') ? run(file, args) : { stdout: 'u UU N... 100644 100644 100644 100644 a b c merge.txt\0' }) as unknown as ConstructorParameters<typeof ProjectGit>[0]);
    await expect(conflict.commit(root, 'Conflict')).rejects.toThrow('Resolve merge');
  });
});
