import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { optionalProjectDocument, saveProjectDocument, writableProjectPath } from '../desktop/services/project-writes';
const directories: string[] = [];
vi.mock('node:fs/promises', async importOriginal => { const actual = await importOriginal<typeof import('node:fs/promises')>(); return { ...actual, rename: vi.fn(actual.rename) }; });
afterEach(async () => { vi.mocked(rename).mockReset(); const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises'); vi.mocked(rename).mockImplementation(actual.rename); await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function directory() { const path = await mkdtemp(join(tmpdir(), 'qiyao-edit-')); directories.push(path); return path; }
describe('manual editor saves', () => {
  it.each(['EIO', 'ENOSPC', 'EACCES'])('sanitizes %s, retains original bytes, cleans staging and permits retry', async code => {
    const root = await directory(), first = await saveProjectDocument(root, 'notes.txt', 'ORIGINAL', null);
    const cause = Object.assign(new Error('PRIVATE_PATH_AND_DIAGNOSTIC'), { code }); vi.mocked(rename).mockRejectedValueOnce(cause);
    const failure = await saveProjectDocument(root, 'notes.txt', 'RETRY_中文😀', first.sha256).catch(error => error);
    expect(failure).toBeInstanceOf(Error); expect(failure.message).toBe('The project file could not be saved. Check disk space and directory permissions.'); expect(failure.cause).toBe(cause);
    expect(await readFile(join(root, 'notes.txt'), 'utf8')).toBe('ORIGINAL'); expect(await readdir(root)).toEqual(['notes.txt']);
    expect((await saveProjectDocument(root, 'notes.txt', 'RETRY_中文😀', first.sha256)).text).toBe('RETRY_中文😀'); expect(await readdir(root)).toEqual(['notes.txt']);
  });
  it('creates and edits explicit user files, preserves UTF-8 BOM and line endings', async () => {
    const root = await directory(); expect(await optionalProjectDocument(root, 'new.txt')).toBeNull();
    const first = await saveProjectDocument(root, '.env', '\ufeffUSER_VALUE=one\r\n', null);
    expect(first).toMatchObject({ path: '.env', text: '\ufeffUSER_VALUE=one\r\n' });
    expect(await optionalProjectDocument(root, '.env')).toEqual({ text: first.text, sha256: first.sha256 });
    await saveProjectDocument(root, '.env', 'USER_VALUE=two\r\n', first.sha256);
    expect(await readFile(join(root, '.env'), 'utf8')).toBe('USER_VALUE=two\r\n'); expect(await readdir(root)).toEqual(['.env']);
  });
  it('serializes competing editor and agent writes so only one stale-revision save succeeds', async () => {
    const root = await directory(); const first = await saveProjectDocument(root, 'file.txt', 'Base', null);
    const results = await Promise.allSettled([saveProjectDocument(root, 'file.txt', 'One', first.sha256), saveProjectDocument(root, 'file.txt', 'Two', first.sha256)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(['One', 'Two']).toContain(await readFile(join(root, 'file.txt'), 'utf8'));
    await expect(saveProjectDocument(root, 'file.txt', 'Stale', first.sha256)).rejects.toThrow('changed');
  });
  it('rejects internal Git files, escapes, links, changed targets, binary and oversized text', async () => {
    const root = await directory(); const outside = await directory(); await mkdir(join(root, '.git')); await writeFile(join(outside, 'file'), 'outside'); await symlink(outside, join(root, 'escape'), 'junction');
    for (const path of ['', '../file', '.git/config', 'escape/file', 'C:\\secret', '/secret', 'bad\0path']) await expect(writableProjectPath(root, path)).rejects.toThrow();
    await expect(saveProjectDocument(root, 'new.txt', '\0binary', null)).rejects.toThrow('text'); await expect(saveProjectDocument(root, 'new.txt', '字'.repeat(100_000), null)).rejects.toThrow('256 KB');
    await expect(saveProjectDocument(root, 'new.txt', 'Text', null, join(outside, 'file'))).rejects.toThrow('changed');
    await writeFile(join(root, 'binary'), Buffer.from([0, 1])); await expect(optionalProjectDocument(root, 'binary')).rejects.toThrow('binary');
    expect(await readFile(join(outside, 'file'), 'utf8')).toBe('outside');
  });
});
