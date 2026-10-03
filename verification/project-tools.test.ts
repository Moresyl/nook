import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import type { Project } from '../contracts/workspace';
import { ProjectTools, projectToolDefinitions } from '../desktop/services/project-tools';
import { projectEntries } from '../desktop/services/project-files';

const directories: string[] = [];
const tools = new ProjectTools();
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { force: true, recursive: true }))); });
async function project(): Promise<Project> {
  const path = await mkdtemp(join(tmpdir(), 'qiyao-tools-')); directories.push(path);
  return { id: 'project', name: 'Project', path, instructions: '', createdAt: 1 };
}
function execute(root: Project, name: string, args: unknown, signal = new AbortController().signal) {
  return tools.execute({ id: 'call', name, arguments: JSON.stringify(args) }, root, signal);
}

describe('project analysis tools', () => {
  it('declares strict schemas with every property required', () => {
    expect(projectToolDefinitions.map((tool) => tool.name)).toEqual(['list_files', 'read_file', 'search_files', 'git_diff']);
    for (const tool of projectToolDefinitions) {
      expect(tool.parameters.additionalProperties).toBe(false);
      expect(tool.parameters.required ?? []).toEqual(Object.keys(tool.parameters.properties as object));
    }
  });
  it('lists project files and reads a selected numbered line range', async () => {
    const root = await project();
    await mkdir(join(root.path, 'src'));
    await writeFile(join(root.path, 'src', 'code.ts'), 'First\r\nSecond\r\nThird');
    expect(JSON.parse((await execute(root, 'list_files', { path: 'src' })).output)[0].name).toBe('code.ts');
    const result = await execute(root, 'read_file', { path: 'src/code.ts', start_line: 2, max_lines: 1 });
    expect(result).toMatchObject({ callId: 'call', error: false });
    expect(result.output).toMatch(/^File: src\/code.ts\nSHA-256: [a-f0-9]{64}\nTotal lines: 3\n2: Second$/);
    expect((await execute(root, 'read_file', { path: 'src/code.ts', start_line: 9, max_lines: 20 })).error).toBe(false);
  });
  it('searches literal text recursively with case and result limits, skipping binary and credentials', async () => {
    const root = await project();
    await mkdir(join(root.path, 'src'));
    await Promise.all([
      writeFile(join(root.path, 'src', 'code.ts'), 'Needle\nneedle in code'), writeFile(join(root.path, 'binary.bin'), 'needle\0'),
      writeFile(join(root.path, '.env'), 'needle PRIVATE'), writeFile(join(root.path, '.env.example'), 'needle sample'),
    ]);
    const args = { path: '', query: 'needle', case_sensitive: false, max_results: 100 };
    const found = JSON.parse((await execute(root, 'search_files', args)).output);
    expect(found.matches).toHaveLength(3);
    expect(found.matches.some((match: { path: string }) => match.path === '.env')).toBe(false);
    expect(found.matches.some((match: { path: string; line: number }) => match.path === 'src/code.ts' && match.line === 2)).toBe(true);
    expect(found.skippedFiles).toBe(1);
    const sensitive = JSON.parse((await execute(root, 'search_files', { ...args, path: 'src', case_sensitive: true })).output);
    expect(sensitive.matches).toHaveLength(1);
    expect(JSON.parse((await execute(root, 'search_files', { ...args, max_results: 1 })).output).truncated).toBe(true);
    expect(JSON.parse((await execute(root, 'search_files', { ...args, query: '[regex.*' })).output).matches).toEqual([]);
  });
  it('blocks outside paths, directory aliases to secrets and credential names', async () => {
    const root = await project(); const outside = await project();
    await mkdir(join(root.path, '.aws'));
    await writeFile(join(root.path, '.aws', 'config'), 'secret');
    await symlink(join(root.path, '.aws'), join(root.path, 'alias'), 'junction');
    await symlink(outside.path, join(root.path, 'escape'), 'junction');
    for (const path of ['../', outside.path, 'escape', 'alias']) {
      expect((await execute(root, 'list_files', { path })).error).toBe(true);
    }
    for (const name of ['.env.local', 'credentials.json', 'id_ed25519', 'private.key', 'certificate.pem', 'certificate.pfx']) {
      await writeFile(join(root.path, name), 'secret');
      expect((await execute(root, 'read_file', { path: name, start_line: 1, max_lines: 10 })).output).toContain('excluded');
    }
    const listed = JSON.parse((await execute(root, 'list_files', { path: '' })).output);
    expect(listed.some((entry: { name: string }) => entry.name.startsWith('.env'))).toBe(false);
  });
  it('keeps paths relative when the selected project root itself is a junction', async () => {
    const actual = await project(); const parent = await project();
    await writeFile(join(actual.path, 'notes.txt'), 'Content');
    await symlink(actual.path, join(parent.path, 'project'), 'junction');
    expect((await projectEntries(join(parent.path, 'project'), ''))[0].relativePath).toBe('notes.txt');
  });
  it('reports invalid, unknown, missing and disallowed inputs without exposing filesystem paths', async () => {
    const root = await project();
    for (const [name, args] of [['read_file', { path: 'a', start_line: 0, max_lines: 2 }], ['git_diff', { extra: true }], ['write_file', {}]]) {
      expect((await execute(root, String(name), args)).error).toBe(true);
    }
    expect((await tools.execute({ id: 'call', name: 'read_file', arguments: '{bad' }, root, new AbortController().signal)).error).toBe(true);
    const missing = await execute(root, 'read_file', { path: 'missing.txt', start_line: 1, max_lines: 10 });
    expect(missing.output).not.toContain(root.path);
    expect(missing.error).toBe(true);
  });
  it('caps large tool outputs and accepts cancellation', async () => {
    const root = await project();
    await writeFile(join(root.path, 'long.txt'), 'a'.repeat(100_000));
    const result = await execute(root, 'read_file', { path: 'long.txt', start_line: 1, max_lines: 1 });
    expect(result.output.length).toBeLessThanOrEqual(64_000);
    expect(result.output).toContain('truncated');
    const controller = new AbortController(); controller.abort();
    await expect(execute(root, 'list_files', { path: '' }, controller.signal)).rejects.toThrow();
  });
  it('reads a real tracked Git diff without modifying the project', async () => {
    const root = await project(); const run = promisify(execFile);
    await run('git', ['init', '-q', root.path], { windowsHide: true });
    await writeFile(join(root.path, 'tracked.txt'), 'before\n');
    await run('git', ['-C', root.path, 'add', 'tracked.txt'], { windowsHide: true });
    await run('git', ['-C', root.path, '-c', 'user.name=Qiyao verification', '-c', 'user.email=verification@localhost', 'commit', '-qm', 'fixture', '--no-gpg-sign'], { windowsHide: true });
    await writeFile(join(root.path, 'tracked.txt'), 'after\n');
    const result = await execute(root, 'git_diff', {});
    expect(result.error).toBe(false);
    expect(result.output).toContain('-before');
    expect(result.output).toContain('+after');
  });
});
