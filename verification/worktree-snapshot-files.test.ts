import { createHash } from 'node:crypto';
import { link, mkdir, mkdtemp, readFile, readdir, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { worktreeSnapshotLimits } from '../contracts/worktree-snapshot-files';
import { captureWorktreeSnapshotFiles, restoreWorktreeSnapshotFiles, validateWorktreeSnapshotFiles } from '../desktop/services/worktree-snapshot-files';

const hooks = vi.hoisted(() => ({ beforeOpen: undefined as undefined | ((path: string) => Promise<void>) }));
vi.mock('node:fs/promises', async importOriginal => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, open: async (...args: Parameters<typeof original.open>) => { await hooks.beforeOpen?.(String(args[0])); return original.open(...args); } };
});
const directories: string[] = [];
afterEach(async () => {
  hooks.beforeOpen = undefined;
  for (const path of directories.splice(0)) {
    expect(dirname(resolve(path))).toBe(resolve(tmpdir())); expect(basename(path)).toMatch(/^nook-snapshot-files-[A-Za-z0-9]{6}$/);
    await rm(path, { recursive: true, force: true });
  }
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'nook-snapshot-files-')); directories.push(root);
  const source = join(root, '源目录'), target = join(root, '恢复目录'); await mkdir(source); await mkdir(target);
  return { root, source, target };
}
function file(path: string, bytes = Buffer.from('original\r\n')) {
  return { kind: 'file' as const, path, mode: 0o600, bytes: bytes.length, data: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') };
}
const manifest = (entries: unknown[]) => ({ version: 1, entries });

describe('bounded worktree snapshot bytes', () => {
  it('round trips exact binary, Unicode, CRLF, ignored and untracked files and empty directories without copying Git metadata', async () => {
    const { source, target } = await fixture();
    await mkdir(join(source, '空 目录')); await mkdir(join(source, '嵌套'));
    const bytes = Buffer.from([0, 255, 1, 13, 10, 128]);
    await writeFile(join(source, '嵌套', '二进制.bin'), bytes); await writeFile(join(source, '.gitignore'), '忽略文件\n');
    await writeFile(join(source, '忽略文件'), 'SECRET LOCAL\r\n'); await writeFile(join(source, '未跟踪.txt'), '未跟踪\r\n');
    await writeFile(join(source, '.git'), 'gitdir: separate\n'); await writeFile(join(target, '.git'), 'gitdir: restored\n');
    const captured = await captureWorktreeSnapshotFiles(source); expect(captured.entries.some(entry => entry.path === '.git')).toBe(false);
    await restoreWorktreeSnapshotFiles(target, { ...captured, entries: [...captured.entries].reverse() });
    expect(await readFile(join(target, '嵌套', '二进制.bin'))).toEqual(bytes);
    expect(await readFile(join(target, '忽略文件'), 'utf8')).toBe('SECRET LOCAL\r\n');
    expect(await readFile(join(target, '未跟踪.txt'), 'utf8')).toBe('未跟踪\r\n'); expect(await readdir(join(target, '空 目录'))).toEqual([]);
    expect(await readFile(join(target, '.git'), 'utf8')).toBe('gitdir: restored\n');
    expect(await captureWorktreeSnapshotFiles(target)).toEqual(captured);
  });
  it('supports empty trees and rejects a populated restoration folder without changing its bytes', async () => {
    const { source, target } = await fixture(); expect(await captureWorktreeSnapshotFiles(source)).toEqual(manifest([]));
    await writeFile(join(target, 'existing'), 'KEEP'); await expect(restoreWorktreeSnapshotFiles(target, manifest([file('new')]))).rejects.toThrow('empty worktree');
    expect(await readFile(join(target, 'existing'), 'utf8')).toBe('KEEP'); expect(await readdir(target)).toEqual(['existing']);
  });
  it.each(['../escape', '/absolute', 'C:/escape', 'a\\b', '.git', 'dir/.GiT/config', 'a//b', './a', 'nul.txt', 'COM1', 'a:stream', 'a.', 'a ', 'a\u0000b'])('rejects unsafe or unsupported path %j before any restoration writes', async path => {
    const { target } = await fixture(); await expect(restoreWorktreeSnapshotFiles(target, manifest([file(path)]))).rejects.toThrow(); expect(await readdir(target)).toEqual([]);
  });
  it.each([
    [file('A'), file('a')],
    [file('parent/child')],
    [file('parent'), file('parent/child')],
    [{ kind: 'directory', path: 'parent', mode: 0o700 }, file('Parent/child'), file('parent/CHILD')],
  ])('rejects conflicting and missing parent paths before writes', async (...entries) => {
    const { target } = await fixture(); await expect(restoreWorktreeSnapshotFiles(target, manifest(entries))).rejects.toThrow(); expect(await readdir(target)).toEqual([]);
  });
  it.each(['hash', 'length', 'base64', 'unknown', 'mode'] as const)('rejects damaged %s metadata before writes', async kind => {
    const { target } = await fixture(), entry: Record<string, unknown> = file('file');
    if (kind === 'hash') entry.sha256 = '0'.repeat(64);
    if (kind === 'length') entry.bytes = 0;
    if (kind === 'base64') entry.data = `${entry.data}\n`;
    if (kind === 'unknown') entry.force = true;
    if (kind === 'mode') entry.mode = 0o4777;
    await expect(restoreWorktreeSnapshotFiles(target, manifest([entry]))).rejects.toThrow(); expect(await readdir(target)).toEqual([]);
  });
  it('rejects oversized files and excessive manifest entries while retaining source files', async () => {
    const { source } = await fixture(), path = join(source, 'large'); await writeFile(path, ''); await truncate(path, worktreeSnapshotLimits.fileBytes + 1);
    await expect(captureWorktreeSnapshotFiles(source)).rejects.toThrow('retained');
    expect(() => validateWorktreeSnapshotFiles(manifest(Array.from({ length: worktreeSnapshotLimits.entries + 1 }, (_, i) => file(`file${i}`))))).toThrow();
  });
  it('rejects aggregate content over the total byte limit before any restoration writes', async () => {
    const { target } = await fixture(), large = file('large', Buffer.alloc(worktreeSnapshotLimits.fileBytes));
    const entries = Array.from({ length: worktreeSnapshotLimits.totalBytes / worktreeSnapshotLimits.fileBytes }, (_, i) => ({ ...large, path: `large${i}` }));
    entries.push(file('overflow', Buffer.from('x')));
    await expect(restoreWorktreeSnapshotFiles(target, manifest(entries))).rejects.toThrow('retained'); expect(await readdir(target)).toEqual([]);
  });
  it('rejects actual directory junctions and hard links rather than following them', async () => {
    const { root, source } = await fixture(), outside = join(root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'keep'), 'KEEP');
    await symlink(outside, join(source, 'redirect'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(captureWorktreeSnapshotFiles(source)).rejects.toThrow('retained'); await rm(join(source, 'redirect'));
    await link(join(outside, 'keep'), join(source, 'linked')); await expect(captureWorktreeSnapshotFiles(source)).rejects.toThrow('retained');
    expect(await readFile(join(outside, 'keep'), 'utf8')).toBe('KEEP');
  });
  it('rejects a file changed between inspection and opening, then recovers on retry', async () => {
    const { source } = await fixture(), path = join(source, 'file'); await writeFile(path, 'BEFORE');
    hooks.beforeOpen = async candidate => { if (candidate === path) await writeFile(path, 'CHANGED'); };
    await expect(captureWorktreeSnapshotFiles(source)).rejects.toThrow('retained'); hooks.beforeOpen = undefined;
    const captured = await captureWorktreeSnapshotFiles(source); expect(captured.entries).toEqual([file('file', Buffer.from('CHANGED'))].map(entry => ({ ...entry, mode: captured.entries[0].mode })));
  });
  it('preserves a partial restore after an actual write failure and allows retry into a fresh folder', async () => {
    const { source, target } = await fixture(); await writeFile(join(source, 'a'), 'A'); await writeFile(join(source, 'b'), 'B');
    const captured = await captureWorktreeSnapshotFiles(source);
    hooks.beforeOpen = async path => { if (path === join(target, 'b')) throw Object.assign(new Error('Private storage detail'), { code: 'EIO' }); };
    await expect(restoreWorktreeSnapshotFiles(target, captured)).rejects.toThrow('snapshot were retained');
    expect(await readFile(join(target, 'a'), 'utf8')).toBe('A'); expect(await readFile(join(source, 'b'), 'utf8')).toBe('B');
    hooks.beforeOpen = undefined; const retry = join(dirname(target), 'retry'); await mkdir(retry); await restoreWorktreeSnapshotFiles(retry, captured);
    expect(await captureWorktreeSnapshotFiles(retry)).toEqual(captured);
  });
});
