import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorktreeSnapshot } from '../contracts/worktree-snapshots';
import { WorkspaceBackupFiles } from '../desktop/services/backup-files';
import { WorktreeSnapshotStore, validateWorktreeSnapshot, worktreeSnapshotSummary } from '../desktop/services/worktree-snapshot-store';

const directories: string[] = [], stores: WorktreeSnapshotStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.shutdown();
  for (const path of directories.splice(0)) {
    expect(dirname(resolve(path))).toBe(resolve(tmpdir())); expect(basename(path)).toMatch(/^nook-snapshot-store-[A-Za-z0-9]{6}$/);
    await rm(path, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});
function blob(text: string) { const bytes = Buffer.from(text); return { bytes: bytes.length, data: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') }; }
function snapshot(path: string, createdAt = 1): WorktreeSnapshot {
  return { version: 1, id: randomUUID(), receiptId: randomUUID(), originalPath: path, common: { path: join(path, '.git'), device: '1', inode: '2' }, createdAt, head: 'a'.repeat(40), index: blob('index bytes'), pack: blob('pack bytes'), files: { version: 1, entries: [{ kind: 'file', path: '保留.txt', mode: 0o600, ...blob('SOURCE\r\n') }] } };
}
async function fixture(files?: WorkspaceBackupFiles) {
  const root = await mkdtemp(join(tmpdir(), 'nook-snapshot-store-')); directories.push(root);
  const directory = join(root, '本机 快照'), store = new WorktreeSnapshotStore(directory, files); stores.push(store);
  return { root, directory, store };
}
describe('private durable worktree snapshot store', () => {
  it('reads an empty missing store without creating its folder and retains missing-snapshot errors', async () => {
    const { directory, store } = await fixture(); expect(await store.list()).toEqual([]);
    await expect(store.read(randomUUID())).rejects.toThrow('retained'); await expect(readdir(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('atomically saves bounded gzip bytes, verifies readback, lists summaries and reopens exact state', async () => {
    const { root, directory, store } = await fixture(), original = snapshot(root, 1), newer = snapshot(root, 2);
    const summary = await store.save(original); expect(summary).toEqual(worktreeSnapshotSummary(original));
    expect(summary.entries).toBe(1); expect(summary.fileBytes).toBe(8); expect(summary).not.toHaveProperty('pack'); expect(summary).not.toHaveProperty('index'); expect(summary).not.toHaveProperty('files');
    expect((await readFile(join(directory, `${original.id}.json.gz`))).subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
    await store.save(newer); expect((await store.list()).map(item => item.id)).toEqual([newer.id, original.id]);
    await store.shutdown(); const reopened = new WorktreeSnapshotStore(directory); stores.push(reopened);
    expect(await reopened.read(original.id)).toEqual(original); expect(await readdir(directory)).toEqual(expect.arrayContaining([`${original.id}.json.gz`, `${newer.id}.json.gz`]));
  });
  it('retains existing snapshots on duplicate save and permits unrelated saves afterward', async () => {
    const { root, directory, store } = await fixture(), original = snapshot(root); await store.save(original);
    const path = join(directory, `${original.id}.json.gz`), before = await readFile(path);
    await expect(store.save({ ...original, head: 'b'.repeat(40) })).rejects.toThrow('retained'); expect(await readFile(path)).toEqual(before);
    await store.save(snapshot(root, 2)); expect(await store.list()).toHaveLength(2);
  });
  it.each(['pack hash', 'index size', 'files hash', 'identity', 'unknown'] as const)('rejects damaged %s before storage creation', async kind => {
    const { root, directory, store } = await fixture(), original = snapshot(root);
    if (kind === 'pack hash') original.pack.sha256 = '0'.repeat(64);
    if (kind === 'index size') original.index.bytes++;
    if (kind === 'files hash' && original.files.entries[0].kind === 'file') original.files.entries[0].sha256 = '0'.repeat(64);
    if (kind === 'identity') original.common.inode = '0';
    const raw = kind === 'unknown' ? { ...original, force: true } : original;
    expect(() => validateWorktreeSnapshot(raw)).toThrow(); await expect(store.save(raw)).rejects.toThrow('retained');
    await expect(readdir(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it.each(['../escape', 'not-a-uuid', 'C:/escape'])('rejects invalid snapshot id %j before opening storage', async id => {
    const { directory, store } = await fixture(); await expect(store.read(id)).rejects.toThrow('retained'); await expect(readdir(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects damaged gzip and mismatched ids without deleting archives and recovers after explicit byte repair', async () => {
    const { root, directory, store } = await fixture(), original = snapshot(root); await store.save(original);
    const path = join(directory, `${original.id}.json.gz`), before = await readFile(path);
    await writeFile(path, 'DAMAGED'); await expect(store.read(original.id)).rejects.toThrow('retained'); expect(await readFile(path, 'utf8')).toBe('DAMAGED');
    await writeFile(path, gzipSync(JSON.stringify({ ...original, id: randomUUID() }))); await expect(store.list()).rejects.toThrow('retained');
    await writeFile(path, before); expect(await store.read(original.id)).toEqual(original);
  });
  it('rejects oversized decompression using actual bounded gzip reader without modifying stored bytes', async () => {
    const files = new WorkspaceBackupFiles({ textBytes: 2000, compressedBytes: 2000 });
    const { root, directory, store } = await fixture(files), original = snapshot(root); await mkdir(directory);
    const path = join(directory, `${original.id}.json.gz`), bytes = gzipSync('x'.repeat(3000)); await writeFile(path, bytes);
    await expect(store.read(original.id)).rejects.toThrow('retained'); expect(await readFile(path)).toEqual(bytes);
  });
  it('rejects real storage junctions and archive hard links without following or changing their targets', async () => {
    const { root, directory, store } = await fixture(), outside = join(root, 'outside'); await mkdir(outside);
    await symlink(outside, directory, process.platform === 'win32' ? 'junction' : 'dir'); await expect(store.save(snapshot(root))).rejects.toThrow('retained'); expect(await readdir(outside)).toEqual([]);
    await rm(directory); await mkdir(directory); const original = snapshot(root), path = join(directory, `${original.id}.json.gz`);
    const external = join(outside, 'keep'); const bytes = gzipSync(JSON.stringify(original)); await writeFile(external, bytes); await link(external, path);
    await expect(store.read(original.id)).rejects.toThrow('retained'); expect(await readFile(external)).toEqual(bytes);
  });
  it('keeps old archives on injected write failure, hides private error text and releases the operation queue for retry', async () => {
    const files = new WorkspaceBackupFiles(), { root, directory, store } = await fixture(files), old = snapshot(root), next = snapshot(root, 2); await store.save(old);
    const path = join(directory, `${old.id}.json.gz`), before = await readFile(path), injected = vi.spyOn(files, 'write').mockRejectedValueOnce(new Error('PRIVATE CREDENTIAL DETAIL'));
    await expect(store.save(next)).rejects.toThrow('retained'); expect(await readFile(path)).toEqual(before); expect(await readdir(directory)).toEqual([`${old.id}.json.gz`]);
    injected.mockRestore(); await store.save(next); expect(await store.read(next.id)).toEqual(next);
  });
  it('rejects new work after shutdown and rejects relative storage paths', async () => {
    const { root, store } = await fixture(); await store.shutdown(); await expect(store.save(snapshot(root))).rejects.toThrow('closing'); await expect(store.list()).rejects.toThrow('closing'); await expect(store.read(randomUUID())).rejects.toThrow('closing');
    expect(() => new WorktreeSnapshotStore('relative')).toThrow('absolute');
  });
  it('serializes concurrent saves and releases a failed held write before subsequent saves', async () => {
    const files = new WorkspaceBackupFiles(), { root, store } = await fixture(files);
    let release!: () => void, enter!: () => void; const held = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { enter = resolve; });
    const originalWrite = files.write.bind(files), calls: string[] = [];
    vi.spyOn(files, 'write').mockImplementation(async (path, value, signal) => {
      calls.push(path); if (calls.length === 1) { enter(); await held; throw new Error('Injected held failure'); }
      return originalWrite(path, value, signal);
    });
    const first = store.save(snapshot(root)), rejected = expect(first).rejects.toThrow('retained'); await entered;
    const second = snapshot(root, 2), next = store.save(second); await Promise.resolve(); expect(calls).toHaveLength(1);
    release(); await rejected; await next; expect(await store.read(second.id)).toEqual(second);
  });
  it('retains an archive when readback verification fails instead of accepting the save or deleting evidence', async () => {
    const files = new WorkspaceBackupFiles(), { root, directory, store } = await fixture(files), original = snapshot(root);
    const injected = vi.spyOn(files, 'read').mockResolvedValueOnce({ ...original, head: 'b'.repeat(40) });
    await expect(store.save(original)).rejects.toThrow('retained');
    expect(await readdir(directory)).toEqual([`${original.id}.json.gz`]); injected.mockRestore(); expect(await store.read(original.id)).toEqual(original);
  });
});
