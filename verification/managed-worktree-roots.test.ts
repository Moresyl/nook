import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ManagedWorktreeRoots } from '../desktop/services/managed-worktree-roots';
import { uiErrorMessage } from '../contracts/ui-errors';

const directories: string[] = [];
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'nook-managed-roots-')); directories.push(directory);
  const profile = join(directory, '本地 配置 🧭'); await mkdir(profile);
  const sentinel = join(profile, '保留.txt'); await writeFile(sentinel, 'EXACT_PROFILE_KEEP\n');
  const root = join(profile, 'worktrees'), target = join(root, 'nook-example');
  return { directory, profile, sentinel, root, target, manager: new ManagedWorktreeRoots(root) };
}
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    expect(dirname(resolve(directory))).toBe(resolve(tmpdir())); expect(basename(directory)).toMatch(/^nook-managed-roots-[A-Za-z0-9]{6}$/);
    await rm(directory, { recursive: true, force: true });
  }
});

describe('managed worktree roots', () => {
  it.each(['', 'relative', 'C:relative', 'E:\\bad\npath'])('rejects an invalid default directory before filesystem work: %j', root => {
    expect(() => new ManagedWorktreeRoots(root)).toThrow();
  });

  it('reports the stable absolute default without creating it', async () => {
    const { root, manager, sentinel } = await fixture();
    expect(manager.defaultRoot).toBe(resolve(root));
    await expect(lstat(root)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(sentinel, 'utf8')).toBe('EXACT_PROFILE_KEEP\n');
  });

  it('prepares only the default root on demand and leaves target creation to Git', async () => {
    const { root, target, manager, sentinel } = await fixture();
    await manager.prepare('', target, []);
    expect((await lstat(root)).isDirectory()).toBe(true);
    await expect(lstat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(sentinel, 'utf8')).toBe('EXACT_PROFILE_KEEP\n');
  });

  it('reuses an existing directory without changing its contents', async () => {
    const { root, target, manager } = await fixture(); await mkdir(root);
    const retained = join(root, '已有工作树.txt'); await writeFile(retained, 'EXACT_TREE_KEEP\n');
    await manager.prepare('', target, []); await manager.prepare('', target, []);
    expect(await readFile(retained, 'utf8')).toBe('EXACT_TREE_KEEP\n');
    await expect(lstat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('leaves explicit root configuration under user control', async () => {
    const { root, target, manager, profile } = await fixture();
    await manager.prepare(profile, target, []);
    await expect(lstat(root)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['relative', 'custom', 'nested', 'root'])('does not create a default root for an unrelated or invalid target: %s', async kind => {
    const { root, target, manager, directory } = await fixture();
    const path = kind === 'relative' ? 'relative' : kind === 'custom' ? join(directory, 'custom') : kind === 'nested' ? join(target, 'nested') : root;
    await manager.prepare('', path, []);
    await expect(lstat(root)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not invent a missing profile parent and localizes the safe error while retaining its cause', async () => {
    const { directory } = await fixture(), profile = join(directory, 'missing-profile'), root = join(profile, 'worktrees');
    const error = await new ManagedWorktreeRoots(root).prepare('', join(root, 'nook-example'), []).catch(failure => failure);
    expect(error.cause).toMatchObject({ code: 'ENOENT' });
    expect(uiErrorMessage(error)).toBe('默认工作树目录未能准备。请在设置中选择已有文件夹，再重试。');
    expect(uiErrorMessage(`Error invoking remote method 'qiyao:invoke': Error: ${error.message}`)).toBe(uiErrorMessage(error));
    expect(error.message).not.toContain(profile); await expect(lstat(profile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves a conflicting file instead of replacing it', async () => {
    const { root, target, manager } = await fixture(); await writeFile(root, 'EXACT_FILE_KEEP\n');
    await expect(manager.prepare('', target, [])).rejects.toThrow('The default worktree directory could not be prepared.');
    expect(await readFile(root, 'utf8')).toBe('EXACT_FILE_KEEP\n');
  });

  it('refuses a linked default leaf without writing through or removing the link', async () => {
    const { directory, root, target, manager } = await fixture();
    const external = join(directory, 'other-owner'); await mkdir(external); const retained = join(external, '原始.txt'); await writeFile(retained, 'EXACT_OTHER_KEEP\n');
    await symlink(external, root, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(manager.prepare('', target, [])).rejects.toThrow('The default worktree directory could not be prepared.');
    expect((await lstat(root)).isSymbolicLink()).toBe(true); expect(await readFile(retained, 'utf8')).toBe('EXACT_OTHER_KEEP\n');
    await expect(lstat(join(external, basename(target)))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects default creation inside an existing worktree before adding a directory', async () => {
    const { root, target, manager, profile, sentinel } = await fixture();
    await expect(manager.prepare('', target, [profile])).rejects.toThrow('The default worktree directory could not be prepared.');
    await expect(lstat(root)).rejects.toMatchObject({ code: 'ENOENT' }); expect(await readFile(sentinel, 'utf8')).toBe('EXACT_PROFILE_KEEP\n');
  });

  it('resolves a linked profile parent before checking existing worktree ownership', async () => {
    const { directory, profile, root, sentinel } = await fixture(), alias = join(directory, 'profile-alias');
    await symlink(profile, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const aliasedRoot = join(alias, 'worktrees');
    await expect(new ManagedWorktreeRoots(aliasedRoot).prepare('', join(aliasedRoot, 'nook-example'), [await realpath(profile)])).rejects.toThrow('The default worktree directory could not be prepared.');
    await expect(lstat(root)).rejects.toMatchObject({ code: 'ENOENT' }); expect((await lstat(alias)).isSymbolicLink()).toBe(true);
    expect(await readFile(sentinel, 'utf8')).toBe('EXACT_PROFILE_KEEP\n');
  });

  it('accepts a separate worktree with a similar prefix', async () => {
    const { target, manager, profile, root } = await fixture();
    await manager.prepare('', target, [`${profile}-neighbor`]); expect((await lstat(root)).isDirectory()).toBe(true);
  });

  it('rejects invalid configured roots without filesystem effects', async () => {
    const { target, manager, root } = await fixture();
    await expect(manager.prepare('relative', target, [])).rejects.toThrow(); await expect(lstat(root)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('handles simultaneous preparation without resetting existing profile data', async () => {
    const { root, target, manager, sentinel } = await fixture();
    await Promise.all(Array.from({ length: 4 }, () => manager.prepare('', target, [])));
    expect((await lstat(root)).isDirectory()).toBe(true); expect(await readFile(sentinel, 'utf8')).toBe('EXACT_PROFILE_KEEP\n');
    await expect(lstat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
