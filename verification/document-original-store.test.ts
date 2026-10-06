import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { documentOriginalLimits, documentOriginalSchema } from '../contracts/document-originals';
import { DocumentOriginalStore } from '../desktop/services/document-original-store';

const directories: string[] = [];
const pdf = () => Buffer.from('%PDF-1.7\noriginal 中文\0\xff\n%%EOF', 'utf8');
const reference = (bytes = pdf()) => ({ sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, mimeType: 'application/pdf' as const });
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'nook-original-test-')); directories.push(directory);
  const path = join(directory, 'originals'); return { directory, path, store: new DocumentOriginalStore(path) };
}

describe('original document identity and storage', () => {
  it('accepts only bounded PDF references with canonical content identities and no supplied paths', () => {
    expect(documentOriginalSchema.parse(reference())).toEqual(reference());
    for (const item of [null, { ...reference(), sha256: '../private' }, { ...reference(), sha256: reference().sha256.toUpperCase() }, { ...reference(), bytes: 4 }, { ...reference(), bytes: 5.5 }, { ...reference(), bytes: documentOriginalLimits.fileBytes + 1 }, { ...reference(), mimeType: 'text/html' }, { ...reference(), path: 'private' }]) expect(documentOriginalSchema.safeParse(item).success).toBe(false);
    expect(() => new DocumentOriginalStore('relative')).toThrow('absolute');
  });

  it('durably retains exact binary bytes, deduplicates equal originals and reopens after restart', async () => {
    const { path, store } = await fixture(); const bytes = pdf();
    const saved = await store.write(bytes); expect(saved).toEqual(reference(bytes));
    expect(await readFile(join(path, saved.sha256))).toEqual(bytes);
    expect(await store.write(bytes)).toEqual(saved); expect(await readdir(path)).toEqual([saved.sha256]);
    const reopened = new DocumentOriginalStore(path); const loaded = await reopened.read(saved); expect(loaded).toEqual(bytes);
    loaded.fill(0); expect(await reopened.read(saved)).toEqual(bytes);
  });

  it('captures caller bytes before pending I/O and safely converges concurrent writes of the same content', async () => {
    const { path, store } = await fixture(); const bytes = pdf(), expected = Buffer.from(bytes);
    const pending = store.write(bytes); bytes.fill(0); const saved = await pending;
    expect(await store.read(saved)).toEqual(expected);
    const next = Buffer.from('%PDF-1.7\nsecond original');
    const copies = await Promise.all([store.write(next), store.write(next), store.write(next)]);
    expect(copies).toEqual([reference(next), reference(next), reference(next)]);
    expect((await readdir(path)).sort()).toEqual([saved.sha256, reference(next).sha256].sort());
  });

  it('rejects invalid, oversized and cancelled writes without retaining partial originals', async () => {
    const { path, store } = await fixture();
    for (const bytes of [Buffer.alloc(0), Buffer.from('hello'), Buffer.alloc(documentOriginalLimits.fileBytes + 1)]) await expect(store.write(bytes)).rejects.toThrow();
    const controller = new AbortController(); controller.abort(); await expect(store.write(pdf(), controller.signal)).rejects.toThrow();
    await expect(readdir(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('accepts the exact file-size boundary and cancels an in-flight read without changing disk bytes', async () => {
    const { path, store } = await fixture(); const bytes = Buffer.alloc(documentOriginalLimits.fileBytes); bytes.write('%PDF-1.7');
    const saved = await store.write(bytes); expect(saved.bytes).toBe(documentOriginalLimits.fileBytes);
    expect((await store.read(saved)).equals(bytes)).toBe(true);
    const controller = new AbortController(); const pending = store.read(saved, controller.signal); controller.abort();
    await expect(pending).rejects.toThrow(); expect((await readFile(join(path, saved.sha256))).equals(bytes)).toBe(true);
    expect(await readdir(path)).toEqual([saved.sha256]);
  });

  it('rejects missing, changed-size and same-size corrupted content without rewriting corrupt originals', async () => {
    const { path, store } = await fixture(); const bytes = pdf(), saved = reference(bytes);
    await expect(store.read(saved)).rejects.toThrow('missing or damaged');
    await store.write(bytes);
    const corrupt = Buffer.from(bytes); corrupt[10] ^= 1; await writeFile(join(path, saved.sha256), corrupt);
    await expect(store.read(saved)).rejects.toThrow('missing or damaged');
    await expect(store.write(bytes)).rejects.toThrow('could not be saved');
    expect(await readFile(join(path, saved.sha256))).toEqual(corrupt);
    await writeFile(join(path, saved.sha256), Buffer.concat([bytes, Buffer.from('growth')]));
    await expect(store.read(saved)).rejects.toThrow('missing or damaged');
    await writeFile(join(path, saved.sha256), bytes.subarray(0, 5));
    await expect(store.read(saved)).rejects.toThrow('missing or damaged');
  });

  it('rejects malformed references, directories in place of files and non-directory stores with redacted errors', async () => {
    const { directory, path, store } = await fixture();
    await expect(store.read({ ...reference(), sha256: '../private' })).rejects.toThrow('valid original');
    await mkdir(join(path, reference().sha256), { recursive: true });
    await expect(store.read(reference())).rejects.toThrow('missing or damaged');
    await expect(store.write(pdf())).rejects.toThrow('could not be saved');
    const blocked = join(directory, 'blocked'); await writeFile(blocked, 'private');
    await expect(new DocumentOriginalStore(blocked).write(pdf())).rejects.toThrow('could not be saved');
    const controller = new AbortController(); controller.abort(); await expect(store.read(reference(), controller.signal)).rejects.toThrow();
  });

  it('refuses a redirected store directory without modifying its target', async () => {
    const { directory, path, store } = await fixture(); const target = join(directory, 'target');
    await mkdir(target); await writeFile(join(target, 'keep.txt'), 'unchanged');
    await symlink(target, path, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(store.write(pdf())).rejects.toThrow('could not be saved');
    await expect(store.read(reference())).rejects.toThrow('missing or damaged');
    expect(await readdir(target)).toEqual(['keep.txt']); expect(await readFile(join(target, 'keep.txt'), 'utf8')).toBe('unchanged');
  });
});
