import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { projectDiff, projectEntries, projectText, scopedPath } from '../desktop/services/project-files';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { force: true, recursive: true }))); });
async function directory() { const path = await mkdtemp(join(tmpdir(), 'qiyao-project-')); directories.push(path); return path; }
describe('project filesystem scope', () => {
  it('sorts directories first, omits internal folders, and reads text within the root', async () => {
    const root = await directory();
    await Promise.all([mkdir(join(root, '.git')), mkdir(join(root, 'node_modules')), mkdir(join(root, 'source')), writeFile(join(root, 'readme.md'), 'Project notes')]);
    const entries = await projectEntries(root, '');
    expect(entries.map((entry) => entry.name)).toEqual(['source', 'readme.md']);
    expect(await projectText(root, 'readme.md')).toBe('Project notes');
    expect(await scopedPath(root, '.')).toBe(root);
  });
  it('blocks traversal and junction paths that escape the project', async () => {
    const root = await directory(); const outside = await directory();
    await writeFile(join(outside, 'secret.txt'), 'Secret');
    await symlink(outside, join(root, 'escape'), 'junction');
    await expect(projectText(root, join(outside, 'secret.txt'))).rejects.toThrow('outside');
    await expect(projectText(root, 'escape/secret.txt')).rejects.toThrow('outside');
    expect(await projectEntries(root, '')).toEqual([]);
    await expect(scopedPath(root, '..')).rejects.toThrow('outside');
  });
  it('rejects binary files, directories and oversized text files', async () => {
    const root = await directory();
    await writeFile(join(root, 'binary.bin'), new Uint8Array([0, 1, 2]));
    await writeFile(join(root, 'large.txt'), 'a'.repeat(256_001));
    await expect(projectText(root, 'binary.bin')).rejects.toThrow('binary');
    await expect(projectText(root, '.')).rejects.toThrow('text file');
    await expect(projectText(root, 'large.txt')).rejects.toThrow('256 KB');
  });
  it('runs Git without a shell or external diff commands and reports errors clearly', async () => {
    const root = await directory();
    const runner = vi.fn().mockResolvedValueOnce({ stdout: 'diff' }).mockResolvedValueOnce({ stdout: '' }).mockRejectedValueOnce(new Error('Private path'));
    expect(await projectDiff(root, runner)).toBe('diff');
    expect(runner.mock.calls[0][1]).toContain('--no-ext-diff');
    expect(runner.mock.calls[0][1]).toContain('--no-textconv');
    expect(await projectDiff(root, runner)).toBe('No tracked changes.');
    await expect(projectDiff(root, runner)).rejects.toThrow('Could not read the Git diff');
  });
});
