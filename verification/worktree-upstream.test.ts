import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { worktreePreferencesSchema } from '../contracts/project-worktrees';
import { emptyWorkspace, workspaceSchema } from '../contracts/workspace';
import { ProjectGit } from '../desktop/services/project-git';

const run = promisify(execFile), directories: string[] = [];
async function command(root: string, args: string[]) { return (await run('git', ['--no-pager', '-C', root, ...args], { encoding: 'utf8', windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })).stdout.trim(); }
async function identity(root: string) {
  await command(root, ['config', 'user.name', 'Test']); await command(root, ['config', 'user.email', 'test@example.invalid']);
  await command(root, ['config', 'commit.gpgSign', 'false']); await command(root, ['config', 'core.autocrlf', 'false']);
}
async function fixture(remote = false) {
  const directory = await mkdtemp(join(tmpdir(), 'nook-upstream-')); directories.push(directory);
  const root = join(directory, '本地 项目'), path = join(directory, '新 工作树'); await mkdir(root); await command(root, ['init', '-q', '-b', 'main']); await identity(root);
  await writeFile(join(root, '保留.txt'), 'BASE\n'); await command(root, ['add', '.']); await command(root, ['commit', '-qm', 'Base']); const head = await command(root, ['rev-parse', 'HEAD']);
  if (remote) {
    const upstream = join(directory, '本地 上游.git'), peer = join(directory, '上游 更新'); await command(directory, ['init', '-q', '--bare', upstream]); await command(root, ['remote', 'add', 'origin', upstream]); await command(root, ['push', '-qu', 'origin', 'main']);
    await command(directory, ['clone', '-q', '-b', 'main', upstream, peer]); await identity(peer); await writeFile(join(peer, '保留.txt'), 'REMOTE\n'); await command(peer, ['add', '.']); await command(peer, ['commit', '-qm', 'Remote update']); await command(peer, ['push', '-q', 'origin', 'main']);
  }
  return { root, directory, path, head };
}
afterEach(async () => {
  for (const directory of directories.splice(0)) { expect(dirname(directory)).toBe(resolve(tmpdir())); expect(directory.split(/[\\/]/).at(-1)).toMatch(/^nook-upstream-[A-Za-z0-9]{6}$/); await rm(directory, { recursive: true, force: true }); }
});
const trackedRunner = () => vi.fn(async (file: string, args: string[], options: Parameters<typeof run>[2]) => run(file, args, options));
const service = (runner: ReturnType<typeof trackedRunner>) => new ProjectGit(runner as unknown as ConstructorParameters<typeof ProjectGit>[0]);

describe('worktree upstream preferences', () => {
  it('keeps old root-only preferences unchanged and retains both explicit policies in workspace serialization', () => {
    expect(worktreePreferencesSchema.parse({ root: '' })).toEqual({ root: '' });
    for (const upstreamRefresh of ['never', 'best-effort'] as const) { const workspace = emptyWorkspace(); workspace.preferences.worktrees = { root: '', upstreamRefresh }; expect(workspaceSchema.parse(JSON.parse(JSON.stringify(workspace))).preferences.worktrees).toEqual(workspace.preferences.worktrees); }
    for (const upstreamRefresh of [true, 'always', '', null, 42]) expect(worktreePreferencesSchema.safeParse({ root: '', upstreamRefresh }).success).toBe(false);
  });
});
describe('real upstream fetching before worktree creation', () => {
  it('fetches the configured tracking branch without changing the pinned local commit, source index, dirty or untracked bytes', async () => {
    const { root, path, head } = await fixture(true), runner = trackedRunner();
    await writeFile(join(root, '保留.txt'), 'STAGED\n'); await command(root, ['add', '.']); await writeFile(join(root, '保留.txt'), 'DIRTY\n'); await writeFile(join(root, '未跟踪.txt'), 'KEEP\n'); const index = await readFile(join(root, '.git/index'));
    const result = await service(runner).createWorktree(root, { mode: 'new', path, branch: 'feature/刷新' }, 'best-effort');
    expect(result.upstreamRefresh).toBe('fetched'); expect(result.worktree.head).toBe(head); expect(await command(root, ['rev-parse', 'HEAD'])).toBe(head); expect(await command(root, ['rev-parse', 'refs/remotes/origin/main'])).not.toBe(head);
    expect(await readFile(join(root, '.git/index'))).toEqual(index); expect(await readFile(join(root, '保留.txt'), 'utf8')).toBe('DIRTY\n'); expect(await readFile(join(root, '未跟踪.txt'), 'utf8')).toBe('KEEP\n'); expect(await readFile(join(path, '保留.txt'), 'utf8')).toBe('BASE\n');
    const fetch = runner.mock.calls.find(([, args]) => args.includes('fetch'))!; expect(fetch[1]).toContain('refs/heads/main:refs/remotes/origin/main'); expect(fetch[1]).toContain('--no-write-fetch-head'); expect(fetch[1]).toContain('credential.interactive=false'); expect(fetch[2]).toMatchObject({ timeout: 30_000, env: { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } });
    await expect(readFile(join(root, '.git/FETCH_HEAD'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it.each([['legacy', undefined], ['explicit never', 'never']] as const)('does not fetch under the %s policy', async (_name, policy) => {
    const { root, path, head } = await fixture(true), runner = trackedRunner(); const result = await service(runner).createWorktree(root, { mode: 'new', path, branch: 'feature/local' }, policy); expect(result.upstreamRefresh).toBeUndefined(); expect(runner.mock.calls.some(([, args]) => args.includes('fetch'))).toBe(false); expect(await command(root, ['rev-parse', 'refs/remotes/origin/main'])).toBe(head);
  });
  it.each(['new', 'existing'] as const)('fetches the selected %s branch upstream instead of the current branch', async mode => {
    const { root, path, head } = await fixture(true), runner = trackedRunner();
    await command(root, ['branch', 'topic']); await command(root, ['config', 'branch.topic.remote', 'origin']); await command(root, ['config', 'branch.topic.merge', 'refs/heads/main']);
    await command(root, ['config', '--unset', 'branch.main.remote']); await command(root, ['config', '--unset', 'branch.main.merge']);
    const input = mode === 'new' ? { mode, path, branch: 'feature/from-topic', baseBranch: 'topic' } : { mode, path, branch: 'topic' };
    const result = await service(runner).createWorktree(root, input, 'best-effort');
    expect(result.upstreamRefresh).toBe('fetched'); expect(result.worktree.head).toBe(head); expect(await command(root, ['branch', '--show-current'])).toBe('main');
    expect(runner.mock.calls.some(([, args]) => args.includes('--format=%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream)') && args.at(-1) === 'refs/heads/topic')).toBe(true);
    expect(await command(root, ['rev-parse', 'refs/remotes/origin/main'])).not.toBe(head);
  });
  it.each(['missing', 'local', 'detached'])('skips the %s upstream without inventing a remote', async kind => {
    const { root, path } = await fixture(), runner = trackedRunner();
    if (kind === 'local') { await command(root, ['config', 'branch.main.remote', '.']); await command(root, ['config', 'branch.main.merge', 'refs/heads/main']); }
    if (kind === 'detached') await command(root, ['switch', '--detach']);
    expect((await service(runner).createWorktree(root, { mode: 'new', path, branch: 'feature/local' }, 'best-effort')).upstreamRefresh).toBe('not-configured'); expect(runner.mock.calls.some(([, args]) => args.includes('fetch'))).toBe(false);
  });
  it('continues with the local commit after an actual fetch boundary failure and never exposes its secret error', async () => {
    const { root, path, head } = await fixture(true), runner = trackedRunner(); runner.mockImplementation(async (file, args, options) => { if (args.includes('fetch')) throw new Error('PRIVATE_KEY SECRET_REMOTE_PASSWORD'); return run(file, args, options); });
    const result = await service(runner).createWorktree(root, { mode: 'new', path, branch: 'feature/retry' }, 'best-effort'); expect(result.upstreamRefresh).toBe('failed'); expect(result.worktree.head).toBe(head); expect(JSON.stringify(result)).not.toMatch(/PRIVATE_KEY|SECRET_REMOTE_PASSWORD/); expect(await command(root, ['rev-parse', 'refs/remotes/origin/main'])).toBe(head);
  });
  it('rejects invalid requests and occupied destinations before making any fetch request', async () => {
    const { root, path } = await fixture(true), runner = trackedRunner(), git = service(runner); await mkdir(path); await writeFile(join(path, '哨兵.txt'), 'EXACT_KEEP');
    await expect(git.createWorktree(root, { mode: 'new', path, branch: 'feature/blocked' }, 'force' as never)).rejects.toThrow(); expect(runner).not.toHaveBeenCalled();
    await expect(git.createWorktree(root, { mode: 'new', path, branch: 'feature/blocked' }, 'best-effort')).rejects.toThrow('already exists');
    await expect(git.createWorktree(root, { mode: 'new', path: 'relative', branch: 'feature/relative' }, 'best-effort')).rejects.toThrow('absolute');
    await expect(git.createWorktree(root, { mode: 'new', path, branch: 'main' }, 'best-effort')).rejects.toThrow('already exists'); expect(runner.mock.calls.some(([, args]) => args.includes('fetch'))).toBe(false); expect(await readFile(join(path, '哨兵.txt'), 'utf8')).toBe('EXACT_KEEP');
  });
  it('keeps later Git mutations queued behind a held fetch and releases the queue after failure', async () => {
    const { root, path } = await fixture(true), runner = trackedRunner(); let enter!: () => void, release!: () => void; const entered = new Promise<void>(resolve => { enter = resolve; }), pending = new Promise<void>(resolve => { release = resolve; });
    runner.mockImplementation(async (file, args, options) => { if (args.includes('fetch')) { enter(); await pending; throw new Error('Fixture fetch failure'); } return run(file, args, options); });
    const git = service(runner), create = git.createWorktree(root, { mode: 'new', path, branch: 'feature/queued' }, 'best-effort'); await entered; const following = git.createBranch(root, 'after-fetch');
    try { await new Promise(resolve => setTimeout(resolve, 20)); expect(runner.mock.calls.some(([, args]) => args.includes('switch'))).toBe(false); expect(await command(root, ['branch', '--show-current'])).toBe('main'); }
    finally { release(); }
    expect((await create).upstreamRefresh).toBe('failed'); expect((await following).status.branch).toBe('after-fetch');
  });
});
