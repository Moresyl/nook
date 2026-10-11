import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { captureWorktreeSnapshotGit, runGitSnapshotCommand } from '../desktop/services/worktree-snapshot-git';
import { captureWorktreeSnapshotFiles, restoreWorktreeSnapshotFiles } from '../desktop/services/worktree-snapshot-files';

const run = promisify(execFile), directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0)) {
    expect(dirname(resolve(path))).toBe(resolve(tmpdir())); expect(basename(path)).toMatch(/^nook-snapshot-git-[A-Za-z0-9]{6}$/);
    await rm(path, { recursive: true, force: true });
  }
});
async function git(root: string, ...args: string[]) { return (await run('git', ['-C', root, ...args], { windowsHide: true })).stdout.trim(); }
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'nook-snapshot-git-')); directories.push(root);
  const source = join(root, '源 仓库'), recovery = join(root, '对象 恢复'), target = join(root, '恢复 工作树'); await mkdir(source); await mkdir(recovery);
  for (const path of [source, recovery]) {
    await git(path, 'init', '-q', '-b', 'main');
    for (const [key, value] of [['user.name', 'Nook test'], ['user.email', 'test@localhost'], ['commit.gpgSign', 'false'], ['core.autocrlf', 'false']]) await git(path, 'config', key, value);
  }
  await writeFile(join(source, 'file.txt'), 'BASE\r\n'); await writeFile(join(source, '.gitignore'), '忽略\n'); await git(source, 'add', '.'); await git(source, 'commit', '-qm', 'Base');
  return { root, source, recovery, target };
}
describe('complete bounded Git snapshot objects', () => {
  it('restores committed history, unreachable staged blobs, exact index and working/ignored/untracked bytes into an independent linked checkout', async () => {
    const { source, recovery, target } = await fixture();
    await writeFile(join(source, 'history.txt'), 'SECOND'); await git(source, 'add', 'history.txt'); await git(source, 'commit', '-qm', 'Second');
    await writeFile(join(source, 'file.txt'), 'STAGED\r\n'); await git(source, 'add', 'file.txt'); await writeFile(join(source, 'file.txt'), 'WORKING\r\n');
    await writeFile(join(source, '未跟踪.bin'), Buffer.from([0, 255, 1])); await writeFile(join(source, '忽略'), 'LOCAL IGNORE');
    const head = await git(source, 'rev-parse', 'HEAD'), originalIndex = await readFile(join(source, '.git', 'index'));
    const objects = await captureWorktreeSnapshotGit(source), files = await captureWorktreeSnapshotFiles(source);
    expect(await readFile(join(source, '.git', 'index'))).toEqual(originalIndex); expect(await git(source, 'rev-parse', 'HEAD')).toBe(head);
    await runGitSnapshotCommand(recovery, ['index-pack', '--stdin'], Buffer.from(objects.pack.data, 'base64'));
    await git(recovery, 'worktree', 'add', '--no-checkout', '--detach', '--', target, objects.head);
    const index = await git(target, 'rev-parse', '--path-format=absolute', '--git-path', 'index'); await writeFile(index, Buffer.from(objects.index.data, 'base64'));
    expect(await readFile(index)).toEqual(originalIndex); await restoreWorktreeSnapshotFiles(target, files);
    expect(await git(target, 'show', 'HEAD:file.txt')).toBe('BASE'); expect(await git(target, 'show', ':file.txt')).toBe('STAGED');
    expect(await git(target, 'show', 'HEAD~1:file.txt')).toBe('BASE'); expect(await git(target, 'rev-list', '--count', 'HEAD')).toBe('2');
    expect(await readFile(join(target, 'file.txt'), 'utf8')).toBe('WORKING\r\n'); expect(await readFile(join(target, '未跟踪.bin'))).toEqual(Buffer.from([0, 255, 1])); expect(await readFile(join(target, '忽略'), 'utf8')).toBe('LOCAL IGNORE');
    expect(await git(target, 'symbolic-ref', '-q', 'HEAD').catch(() => '')).toBe('');
    expect(await git(target, 'status', '--porcelain=v2', '-z')).toBe(await git(source, 'status', '--porcelain=v2', '-z'));
  });
  it('packs all three real conflict stages including unreachable blobs and preserves the original index', async () => {
    const { source, recovery, target } = await fixture();
    const base = await git(source, 'rev-parse', 'HEAD:file.txt');
    const ours = (await runGitSnapshotCommand(source, ['hash-object', '-w', '--stdin'], Buffer.from('OURS\n'))).toString().trim();
    const theirs = (await runGitSnapshotCommand(source, ['hash-object', '-w', '--stdin'], Buffer.from('THEIRS\n'))).toString().trim();
    await runGitSnapshotCommand(source, ['update-index', '--index-info'], Buffer.from(`0 ${'0'.repeat(40)}\tfile.txt\n100644 ${base} 1\tfile.txt\n100644 ${ours} 2\tfile.txt\n100644 ${theirs} 3\tfile.txt\n`));
    const before = await readFile(join(source, '.git', 'index')), captured = await captureWorktreeSnapshotGit(source);
    expect(await readFile(join(source, '.git', 'index'))).toEqual(before);
    await runGitSnapshotCommand(recovery, ['index-pack', '--stdin'], Buffer.from(captured.pack.data, 'base64'));
    await git(recovery, 'worktree', 'add', '--no-checkout', '--detach', '--', target, captured.head);
    await writeFile(await git(target, 'rev-parse', '--path-format=absolute', '--git-path', 'index'), Buffer.from(captured.index.data, 'base64'));
    expect(await git(target, 'show', ':1:file.txt')).toBe('BASE'); expect(await git(target, 'show', ':2:file.txt')).toBe('OURS'); expect(await git(target, 'show', ':3:file.txt')).toBe('THEIRS');
  });
  it('captures a real linked index and common repository without confusing it with the main index', async () => {
    const { source, target } = await fixture(); await git(source, 'worktree', 'add', '-q', '-b', 'linked', '--', target);
    await writeFile(join(target, 'file.txt'), 'LINKED'); await git(target, 'add', 'file.txt');
    const captured = await captureWorktreeSnapshotGit(target);
    expect(resolve(captured.common.path)).toBe(resolve(await git(source, 'rev-parse', '--path-format=absolute', '--git-common-dir')));
    expect(Buffer.from(captured.index.data, 'base64')).toEqual(await readFile(await git(target, 'rev-parse', '--path-format=absolute', '--git-path', 'index')));
    expect(Buffer.from(captured.index.data, 'base64')).not.toEqual(await readFile(join(source, '.git', 'index')));
  });
  it.each([['core.sparseCheckout', 'true'], ['core.fsmonitor', 'true'], ['extensions.worktreeConfig', 'true']])('rejects unsupported %s configuration without index or working-file changes', async (name, value) => {
    const { source } = await fixture(); await git(source, 'config', name, value); const before = await readFile(join(source, '.git', 'index'));
    await expect(captureWorktreeSnapshotGit(source)).rejects.toThrow('retained'); expect(await readFile(join(source, '.git', 'index'))).toEqual(before); expect(await readFile(join(source, 'file.txt'), 'utf8')).toBe('BASE\r\n');
  });
  it('rejects split indexes and linked index entries while retaining the source', async () => {
    const { source } = await fixture(); await git(source, 'update-index', '--split-index'); const split = await readFile(join(source, '.git', 'index'));
    await expect(captureWorktreeSnapshotGit(source)).rejects.toThrow('retained'); expect(await readFile(join(source, '.git', 'index'))).toEqual(split);
    await git(source, 'update-index', '--no-split-index'); const blob = await git(source, 'rev-parse', 'HEAD:file.txt'); await git(source, 'update-index', '--add', '--cacheinfo', `120000,${blob},link`);
    const linked = await readFile(join(source, '.git', 'index')); await expect(captureWorktreeSnapshotGit(source)).rejects.toThrow('retained'); expect(await readFile(join(source, '.git', 'index'))).toEqual(linked);
  });
  it('bounds command output, rejects malformed packs, preserves ordinary files and hides Git diagnostics', async () => {
    const { source } = await fixture();
    await expect(runGitSnapshotCommand(source, ['rev-parse', 'HEAD'], Buffer.alloc(0), 1)).rejects.toThrow('retained');
    await expect(runGitSnapshotCommand(source, ['index-pack', '--stdin'], Buffer.from('PRIVATE BAD PACK'))).rejects.toThrow('retained');
    await expect(runGitSnapshotCommand('relative', ['status'])).rejects.toThrow('retained');
    await expect(runGitSnapshotCommand(source, ['status'], Buffer.alloc(0), Infinity)).rejects.toThrow('retained');
    expect(await readFile(join(source, 'file.txt'), 'utf8')).toBe('BASE\r\n');
  });
  it.each(['HEAD', 'index'] as const)('rejects an actual %s change during object capture instead of returning a mixed snapshot', async changed => {
    const { source } = await fixture(); let mutated = false;
    const command: typeof runGitSnapshotCommand = async (root, args, input, maximum) => {
      const result = await runGitSnapshotCommand(root, args, input, maximum);
      if (args[0] === 'pack-objects') {
        await writeFile(join(source, 'file.txt'), 'CONCURRENT'); await git(source, 'add', 'file.txt');
        if (changed === 'HEAD') await git(source, 'commit', '-qm', 'Concurrent');
        mutated = true;
      }
      return result;
    };
    await expect(captureWorktreeSnapshotGit(source, command)).rejects.toThrow('retained'); expect(mutated).toBe(true);
    expect(await readFile(join(source, 'file.txt'), 'utf8')).toBe('CONCURRENT');
    const captured = await captureWorktreeSnapshotGit(source); expect(captured.head).toBe(await git(source, 'rev-parse', 'HEAD'));
  });
  it('captures SHA-256 repositories and restores their packed history using the matching object format', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nook-snapshot-git-')); directories.push(root);
    const source = join(root, 'sha256源'), recovery = join(root, 'sha256恢复'); await mkdir(source); await mkdir(recovery);
    for (const path of [source, recovery]) await git(path, 'init', '-q', '--object-format=sha256', '-b', 'main');
    await git(source, 'config', 'user.name', 'Nook test'); await git(source, 'config', 'user.email', 'test@localhost'); await git(source, 'config', 'commit.gpgSign', 'false');
    await writeFile(join(source, 'file.txt'), 'SHA256'); await git(source, 'add', 'file.txt'); await git(source, 'commit', '-qm', 'Base');
    const captured = await captureWorktreeSnapshotGit(source); expect(captured.head).toHaveLength(64);
    await runGitSnapshotCommand(recovery, ['index-pack', '--stdin'], Buffer.from(captured.pack.data, 'base64'));
    expect(await git(recovery, 'show', `${captured.head}:file.txt`)).toBe('SHA256');
  });
  it('rejects a malformed ordinary index and recovers after restoring the exact index bytes', async () => {
    const { source } = await fixture(), path = join(source, '.git', 'index'), before = await readFile(path); await writeFile(path, 'PRIVATE BROKEN INDEX');
    await expect(captureWorktreeSnapshotGit(source)).rejects.toThrow('retained'); expect(await readFile(path, 'utf8')).toBe('PRIVATE BROKEN INDEX');
    await writeFile(path, before); expect(Buffer.from((await captureWorktreeSnapshotGit(source)).index.data, 'base64')).toEqual(before);
  });
});
