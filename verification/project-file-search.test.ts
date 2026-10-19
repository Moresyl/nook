import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchProjectFiles } from '../desktop/services/project-file-search';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function directory() { const path = await mkdtemp(join(tmpdir(), 'nook-file-search-')); roots.push(path); return path; }
const entry = (relativePath: string, directory = false) => ({ name: relativePath.split('/').at(-1)!, relativePath, directory });

describe('project filename search', () => {
  it('matches normalized relative paths without reading file contents or following excluded directories and junctions', async () => {
    const root = await directory(), outside = await directory();
    await mkdir(join(root, 'source')); await mkdir(join(root, '.git')); await mkdir(join(root, 'node_modules'));
    await writeFile(join(root, 'source', '资料.TXT'), Buffer.from([0, 255, 254]));
    await writeFile(join(root, 'source', 'other.txt'), '资料.TXT');
    await writeFile(join(root, '.git', '资料.txt'), 'INTERNAL'); await writeFile(join(root, 'node_modules', '资料.txt'), 'DEPENDENCY');
    await writeFile(join(outside, '资料.txt'), 'OUTSIDE'); await symlink(outside, join(root, 'escape'), 'junction');
    expect(await searchProjectFiles(root, ' SOURCE\\资料.txt ')).toEqual({ entries: [entry('source/资料.TXT')], truncated: false, skippedDirectories: 0 });
    expect(await searchProjectFiles(root, '资料')).toEqual({ entries: [entry('source/资料.TXT')], truncated: false, skippedDirectories: 0 });
    expect((await searchProjectFiles(root, '../')).entries).toEqual([]);
  });
  it('rejects invalid queries before any directory access', async () => {
    const list = vi.fn(async () => []);
    for (const query of ['', '   ', 'x'.repeat(257), null, 42]) await expect(searchProjectFiles('root', query as string, list)).rejects.toThrow();
    expect(list).not.toHaveBeenCalled();
  });
  it('reports no matches and does not match directory names as file results', async () => {
    const list = vi.fn(async (_root: string, path: string) => path ? [] : [entry('needle', true), entry('other.txt')]);
    expect(await searchProjectFiles('root', 'needle', list)).toEqual({ entries: [], truncated: false, skippedDirectories: 0 });
    expect(list.mock.calls.map(call => call[1])).toEqual(['', 'needle']);
  });
  it('retains readable matches and marks unreadable child directories without exposing their errors', async () => {
    const list = vi.fn(async (_root: string, path: string) => {
      if (path) throw new Error('PRIVATE_DIRECTORY_DETAILS');
      return [entry('blocked', true), entry('readable.txt')];
    });
    expect(await searchProjectFiles('root', '.txt', list)).toEqual({ entries: [entry('readable.txt')], truncated: false, skippedDirectories: 1 });
  });
  it('fails when the root is unavailable so an empty result cannot masquerade as a successful search', async () => {
    await expect(searchProjectFiles('root', 'x', async () => { throw new Error('ROOT_UNAVAILABLE'); })).rejects.toThrow('ROOT_UNAVAILABLE');
  });
  it('limits result count and explicitly reports incompleteness', async () => {
    const list = vi.fn(async () => Array.from({ length: 105 }, (_, index) => entry(`file-${index}.txt`)));
    const result = await searchProjectFiles('root', 'file-', list);
    expect(result.entries).toHaveLength(100); expect(result.truncated).toBe(true); expect(result.entries.at(-1)?.relativePath).toBe('file-99.txt'); expect(list).toHaveBeenCalledTimes(1);
  });
  it('bounds nonmatching traversal, including directories, without silently reporting a complete empty result', async () => {
    const list = vi.fn(async () => Array.from({ length: 10_001 }, (_, index) => entry(`directory-${index}`, true)));
    expect(await searchProjectFiles('root', 'missing', list)).toEqual({ entries: [], truncated: true, skippedDirectories: 0 });
    expect(list).toHaveBeenCalledTimes(1);
  });
});
