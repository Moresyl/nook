import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { directoryRequestSchema, PROJECT_DIRECTORY_PAGE_SIZE } from '../contracts/projects';
import { projectDirectory, projectEntries } from '../desktop/services/project-files';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function directory() { const path = await mkdtemp(join(tmpdir(), 'qiyao-directory-')); directories.push(path); return path; }

describe('revision-bound project directory pages', () => {
  it('validates defaults, safe offsets, exact revision hashes and unknown fields before reading files', () => {
    expect(directoryRequestSchema.parse({})).toEqual({ path: '', offset: 0 });
    expect(directoryRequestSchema.parse({ path: 'source', offset: 200, revision: 'a'.repeat(64) })).toEqual({ path: 'source', offset: 200, revision: 'a'.repeat(64) });
    for (const input of [{ offset: -1 }, { offset: 1.5 }, { offset: Infinity }, { offset: Number.MAX_SAFE_INTEGER + 1 }, { offset: 1 }, { revision: 'A'.repeat(64) }, { revision: 'a'.repeat(63) }, { path: 'x'.repeat(4097) }, { extra: true }]) {
      expect(() => directoryRequestSchema.parse(input)).toThrow();
    }
  });
  it('reads scoped Unicode directories with directory-first ordering, canonical paths and no hidden internal folders or junctions', async () => {
    const root = await directory(); const outside = await directory();
    await mkdir(join(root, 'source')); await mkdir(join(root, 'source', '资料'));
    await mkdir(join(root, 'source', '.git')); await mkdir(join(root, 'source', 'node_modules'));
    await symlink(outside, join(root, 'source', 'escape'), 'junction');
    await writeFile(join(root, 'source', 'note.txt'), 'KEEP_FILE');
    const page = await projectDirectory(root, { path: 'source' });
    expect(page).toMatchObject({ total: 2, nextOffset: null, entries: [{ name: '资料', relativePath: 'source/资料', directory: true }, { name: 'note.txt', relativePath: 'source/note.txt', directory: false }] });
    expect(page.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(await projectDirectory(root, { path: 'source', revision: page.revision })).toEqual(page);
    await expect(projectDirectory(root, { path: '../' })).rejects.toThrow('outside');
    await expect(projectDirectory(root, { path: 'source/escape' })).rejects.toThrow('outside');
    await expect(projectDirectory(root, { path: 'missing' })).rejects.toThrow();
    await expect(projectDirectory(root, { offset: 1 })).rejects.toThrow('revision');
  });
  describe('complete directory pagination', () => {
    let root: string;
    beforeAll(async () => {
      root = await mkdtemp(join(tmpdir(), 'qiyao-directory-pages-'));
      const names = Array.from({ length: 2003 }, (_, index) => `file-${String(index).padStart(4, '0')}.txt`);
      for (let index = 0; index < names.length; index += 32) await Promise.all(names.slice(index, index + 32).map((name) => writeFile(join(root, name), '')));
      await mkdir(join(root, 'z-directory')); await mkdir(join(root, 'a-directory'));
    });
    afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });
    it('retains all entries beyond the former 2000-file cutoff and pages through every sorted entry once', async () => {
      const all = await projectEntries(root, ''); expect(all).toHaveLength(2005);
      const first = await projectDirectory(root, {});
      expect(first.entries).toHaveLength(PROJECT_DIRECTORY_PAGE_SIZE);
      expect(first.entries.slice(0, 2).map((entry) => entry.name)).toEqual(['a-directory', 'z-directory']);
      expect(first.nextOffset).toBe(PROJECT_DIRECTORY_PAGE_SIZE);
      const found = [...first.entries]; let next = first.nextOffset;
      while (next !== null) {
        const page = await projectDirectory(root, { offset: next, revision: first.revision });
        expect(page.entries.length).toBeLessThanOrEqual(PROJECT_DIRECTORY_PAGE_SIZE);
        expect(page.total).toBe(2005); expect(page.revision).toBe(first.revision);
        found.push(...page.entries); next = page.nextOffset;
      }
      expect(found).toEqual(all); expect(new Set(found.map((entry) => entry.relativePath)).size).toBe(2005);
      expect((await projectDirectory(root, { offset: 3000, revision: first.revision })).entries).toEqual([]);
    });
  });
  it('rejects stale pages after listing changes, permits refreshed pages and leaves file contents untouched', async () => {
    const root = await directory(); await writeFile(join(root, 'original.txt'), 'ORIGINAL');
    const initial = await projectDirectory(root, {});
    await writeFile(join(root, 'added.txt'), 'ADDED');
    await expect(projectDirectory(root, { offset: 200, revision: initial.revision })).rejects.toThrow('directory changed');
    const refreshed = await projectDirectory(root, {}); expect(refreshed.revision).not.toBe(initial.revision);
    await writeFile(join(root, 'original.txt'), 'CHANGED_CONTENT_WITH_SAME_LISTING');
    expect((await projectDirectory(root, {})).revision).toBe(refreshed.revision);
    await rm(join(root, 'added.txt'));
    await expect(projectDirectory(root, { revision: refreshed.revision })).rejects.toThrow('directory changed');
  });
  it('returns complete empty-directory metadata without a spurious load-more cursor', async () => {
    const root = await directory(); const page = await projectDirectory(root, {});
    expect(page).toMatchObject({ entries: [], total: 0, nextOffset: null });
    expect((await projectDirectory(root, { offset: 200, revision: page.revision })).entries).toEqual([]);
  });
});
