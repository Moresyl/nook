import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitOperationQueue, type GitRepositoryIdentity } from '../desktop/services/git-operation-queue';
import { ProjectGit } from '../desktop/services/project-git';

const run = promisify(execFile), directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0)) {
    expect(dirname(resolve(path))).toBe(resolve(tmpdir())); expect(basename(path)).toMatch(/^nook-git-queue-[A-Za-z0-9]{6}$/);
    await rm(path, { recursive: true, force: true });
  }
});
function identity(root: string, common = 'shared'): GitRepositoryIdentity {
  return { root: { path: root, device: '1', inode: root }, common: { path: common, device: '1', inode: common } };
}
function gate() {
  let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
describe('common Git repository operation queue', () => {
  it('serializes different linked roots while independent repositories continue and failed actions release the queue', async () => {
    const queue = new GitOperationQueue(async root => identity(root, root === 'independent' ? root : 'shared'));
    const held = gate(), entered = gate(), calls: string[] = [];
    const first = queue.run('main', async () => { calls.push('main'); entered.release(); await held.promise; throw new Error('Failed action'); });
    const rejected = expect(first).rejects.toThrow('Failed action'); await entered.promise;
    const next = queue.run('linked', async () => { calls.push('linked'); return 'completed'; });
    await queue.run('independent', async () => { calls.push('independent'); });
    expect(calls).toEqual(['main', 'independent']); held.release(); await rejected;
    await expect(next).resolves.toBe('completed'); expect(calls).toEqual(['main', 'independent', 'linked']);
    await expect(queue.run('main', async () => 'retry')).resolves.toBe('retry');
  });
  it.each(['root', 'common'] as const)('rejects a replaced %s identity after waiting, before the requested mutation', async field => {
    const roots = { main: identity('main'), linked: identity('linked') }, observed = gate(), held = gate(), entered = gate();
    const queue = new GitOperationQueue(async root => { const result = structuredClone(roots[root as keyof typeof roots]); if (root === 'linked') observed.release(); return result; });
    const first = queue.run('main', async () => { entered.release(); await held.promise; }); await entered.promise;
    const mutation = vi.fn(async () => {}), next = queue.run('linked', mutation);
    const rejected = expect(next).rejects.toThrow('repository changed'); await observed.promise;
    roots.linked[field].inode = 'replacement'; held.release(); await first; await rejected; expect(mutation).not.toHaveBeenCalled();
    await expect(queue.run('linked', async () => 'new identity')).resolves.toBe('new identity');
  });
  it('rejects failed identity reads and recovers after an identity check fails while queued', async () => {
    const held = gate(), entered = gate(), observed = gate(); let unavailable = false;
    const queue = new GitOperationQueue(async root => { if (unavailable) throw new Error('Identity unavailable'); const result = identity(root); if (root === 'linked') observed.release(); return result; });
    const mutation = vi.fn(async () => {}); unavailable = true; await expect(queue.run('main', mutation)).rejects.toThrow('Identity unavailable'); expect(mutation).not.toHaveBeenCalled(); unavailable = false;
    const first = queue.run('main', async () => { entered.release(); await held.promise; }); await entered.promise;
    const next = queue.run('linked', mutation), rejected = expect(next).rejects.toThrow('Identity unavailable'); await observed.promise;
    unavailable = true; held.release(); await first; await rejected; expect(mutation).not.toHaveBeenCalled(); unavailable = false;
    await expect(queue.run('linked', async () => 'recovered')).resolves.toBe('recovered');
  });
  it('uses actual common Git metadata across a main and linked Unicode worktree without blocking another repository', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'nook-git-queue-')); directories.push(parent);
    const root = join(parent, '源仓库'), linked = join(parent, '关联 工作树'), other = join(parent, '独立仓库');
    for (const path of [root, other]) {
      await run('git', ['init', '-q', '-b', 'main', path]);
      for (const [key, value] of [['user.name', 'Nook test'], ['user.email', 'test@localhost'], ['commit.gpgSign', 'false'], ['core.autocrlf', 'false']]) await run('git', ['-C', path, 'config', key, value]);
      await writeFile(join(path, '保留.txt'), 'BASE\n'); await run('git', ['-C', path, 'add', '--', '保留.txt']); await run('git', ['-C', path, 'commit', '-qm', 'Base']);
    }
    await run('git', ['-C', root, 'worktree', 'add', '-q', '-b', 'linked', '--', linked]);
    await writeFile(join(root, '保留.txt'), 'STAGED\n'); await run('git', ['-C', root, 'add', '--', '保留.txt']);
    const beforeHead = (await run('git', ['-C', root, 'rev-parse', 'HEAD'])).stdout, beforeIndex = await readFile(join(root, '.git', 'index'));
    const held = gate(), entered = gate(), calls: string[][] = [];
    const runner = vi.fn(async (file, args, options) => { calls.push(args); if (args.includes('commit')) { entered.release(); await held.promise; throw new Error('Private failure'); } return run(file, args, options); });
    const git = new ProjectGit(runner as unknown as ConstructorParameters<typeof ProjectGit>[0]);
    const first = git.commit(root, 'Held'), rejected = expect(first).rejects.toThrow('Git could not'); await entered.promise;
    const next = git.createBranch(linked, 'after-held'); await git.createBranch(other, 'independent');
    expect(calls.some(args => args.includes('switch') && args.includes('after-held'))).toBe(false);
    held.release(); await rejected; await next;
    expect((await git.status(linked)).branch).toBe('after-held'); expect((await git.status(other)).branch).toBe('independent');
    expect((await run('git', ['-C', root, 'rev-parse', 'HEAD'])).stdout).toBe(beforeHead); expect(await readFile(join(root, '.git', 'index'))).toEqual(beforeIndex);
    expect(await readFile(join(root, '保留.txt'), 'utf8')).toBe('STAGED\n');
  });
});
