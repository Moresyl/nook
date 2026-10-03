import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseGitStatus, ProjectGit } from '../desktop/services/project-git';
const directories: string[] = [];
const run = promisify(execFile);
const git = new ProjectGit();
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { force: true, recursive: true }))); });
async function repository() { const path = await mkdtemp(join(tmpdir(), 'qiyao-git-')); directories.push(path); await run('git', ['init', '-q', path]); await run('git', ['-C', path, 'config', 'user.name', 'Qiyao test']); await run('git', ['-C', path, 'config', 'user.email', 'test@localhost']); await run('git', ['-C', path, 'config', 'commit.gpgSign', 'false']); return path; }
describe('project Git workflow', () => {
  it('parses NUL records without splitting Unicode, spaces or line breaks in paths', () => {
    const output = '# branch.oid (initial)\0# branch.head main\0# branch.ab +2 -3\0? 新 文件\n名.ts\0' + '1 .M N... 100644 100644 100644 a b path with spaces.txt\0' + '2 R. N... 100644 100644 100644 a b R100 new name.txt\0old name.txt\0' + 'u UU N... 100644 100644 100644 100644 a b c merge.txt\0';
    expect(parseGitStatus(output)).toMatchObject({ branch: 'main', unborn: true, ahead: 2, behind: 3, files: [{ path: '新 文件\n名.ts' }, { path: 'path with spaces.txt', working: 'M' }, { path: 'new name.txt', originalPath: 'old name.txt' }, { path: 'merge.txt', conflict: true }] });
    expect(parseGitStatus('# branch.head (detached)\0').detached).toBe(true);
    expect(() => parseGitStatus('1 bad\0')).toThrow('invalid status');
  });
  it('stages and unstages an unborn repository without changing worktree contents', async () => {
    const root = await repository(); await writeFile(join(root, '中文 空格.txt'), 'One\n');
    expect((await git.status(root)).unborn).toBe(true);
    expect((await git.stage(root, ['中文 空格.txt'], true)).files[0].index).toBe('A');
    expect(await git.fileView(root, (await git.status(root)).files[0], true)).toMatchObject({ before: '', after: 'One\n', binary: false });
    expect((await git.stage(root, ['中文 空格.txt'], false)).files[0].index).toBe('?');
    expect(await readFile(join(root, '中文 空格.txt'), 'utf8')).toBe('One\n');
    await expect(git.commit(root, 'No staged files')).rejects.toThrow('Stage');
    await git.stage(root, ['中文 空格.txt'], true); expect((await git.commit(root, 'Initial')).files).toEqual([]);
  });
  it('compares HEAD, index and disk separately and commits only explicitly staged files', async () => {
    const root = await repository(); await writeFile(join(root, 'file.txt'), 'Base\n'); await git.stage(root, ['file.txt'], true); await git.commit(root, 'Initial');
    await writeFile(join(root, 'file.txt'), 'Staged\n'); await git.stage(root, ['file.txt'], true); await writeFile(join(root, 'file.txt'), 'Working\n');
    await writeFile(join(root, 'untracked.txt'), 'Keep this file');
    const file = (await git.status(root)).files.find((file) => file.path === 'file.txt')!;
    expect(await git.fileView(root, file, true)).toMatchObject({ before: 'Base\n', after: 'Staged\n', binary: false });
    expect(await git.fileView(root, file, false)).toMatchObject({ before: 'Staged\n', after: 'Working\n', binary: false });
    const status = await git.commit(root, 'Staged only'); expect(status.files).toHaveLength(2);
    expect((await run('git', ['-C', root, 'show', 'HEAD:file.txt'])).stdout).toBe('Staged\n');
    await git.stage(root, ['file.txt'], true); await git.stage(root, ['file.txt'], false);
    expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('Working\n');
  });
  it('handles renames, deletions, literal pathspecs and binary views', async () => {
    const root = await repository(); await writeFile(join(root, 'old.txt'), 'Rename me\n'); await writeFile(join(root, '[literal].txt'), 'Text\n'); await git.stage(root, ['old.txt', '[literal].txt'], true); await git.commit(root, 'Initial');
    await rename(join(root, 'old.txt'), join(root, 'new name.txt')); await git.stage(root, ['old.txt', 'new name.txt'], true);
    const renamed = (await git.status(root)).files.find((file) => file.path === 'new name.txt')!;
    expect(renamed.originalPath).toBe('old.txt'); expect(await git.fileView(root, renamed, true)).toMatchObject({ before: 'Rename me\n', after: 'Rename me\n' });
    await git.stage(root, ['new name.txt', 'old.txt'], false);
    await rm(join(root, '[literal].txt')); const deleted = (await git.status(root)).files.find((file) => file.path === '[literal].txt')!;
    expect(await git.fileView(root, deleted, false)).toMatchObject({ before: 'Text\n', after: '' });
    await writeFile(join(root, 'binary.dat'), Buffer.from([0, 1, 2])); const binary = (await git.status(root)).files.find((file) => file.path === 'binary.dat')!;
    expect((await git.fileView(root, binary, false)).binary).toBe(true);
    await writeFile(join(root, 'non-utf8.bin'), Buffer.from([255, 254, 253])); await git.stage(root, ['non-utf8.bin'], true);
    const nonUtf8 = (await git.status(root)).files.find((file) => file.path === 'non-utf8.bin')!;
    expect((await git.fileView(root, nonUtf8, true)).binary).toBe(true);
  });
  it('validates scope and reports failed Git operations without leaking subprocess output', async () => {
    const root = await repository();
    for (const path of ['../outside', '.git/config', 'C:\\secret', '/absolute', '']) await expect(git.stage(root, [path], true)).rejects.toThrow();
    await expect(git.stage(root, [], true)).rejects.toThrow('Choose');
    await expect(git.stage(root, ['missing'], true)).rejects.toThrow('no longer');
    await expect(git.commit(root, '  ')).rejects.toThrow('message');
    await expect(git.fileView(root, { path: 'missing', index: 'M', working: '.', conflict: false }, true)).rejects.toThrow('no longer');
    const failed = new ProjectGit(vi.fn().mockRejectedValue(new Error('Private credential output')));
    await expect(failed.status(root)).rejects.toThrow('Git could not');
    const conflict = new ProjectGit(vi.fn().mockResolvedValue({ stdout: 'u UU N... 100644 100644 100644 100644 a b c merge.txt\0' }));
    await expect(conflict.commit(root, 'Conflict')).rejects.toThrow('Resolve merge');
  });
});
