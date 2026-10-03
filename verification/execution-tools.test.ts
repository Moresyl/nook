import { link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../contracts/workspace';
import type { ApprovalDetails } from '../contracts/tools';
import { ExecutionTools, executionToolDefinitions } from '../desktop/services/execution-tools';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
const tools = new ExecutionTools();
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
async function project(): Promise<Project> {
  const path = await mkdtemp(join(tmpdir(), 'qiyao-execution-')); directories.push(path);
  return { id: 'project', name: 'Fixture', path, instructions: '', createdAt: 1 };
}
function execute(root: Project, name: string, args: unknown, approve: (details: ApprovalDetails) => Promise<boolean> = async () => true, signal = new AbortController().signal, onProgress = vi.fn()) {
  return tools.execute({ id: 'call', name, arguments: JSON.stringify(args) }, root, signal, { approve, onProgress });
}
describe('approved project execution', () => {
  it('declares execution capabilities and still supports read-only tools', async () => {
    expect(executionToolDefinitions.map((tool) => tool.name)).toContain('write_file');
    expect(executionToolDefinitions.every((tool) => tool.parameters.additionalProperties === false)).toBe(true);
    const root = await project();
    expect((await execute(root, 'list_files', { path: '' })).error).toBe(false);
  });
  it('reviews actual old/new contents before creating or replacing a file atomically', async () => {
    const root = await project();
    const create = await execute(root, 'write_file', { path: 'notes.txt', content: 'Before', expected_sha256: null }, async (details) => {
      expect(details).toMatchObject({ kind: 'file', path: 'notes.txt', exists: false, before: '', after: 'Before' });
      expect(await readdir(root.path)).toEqual([]); return true;
    });
    expect(create.error).toBe(false); expect(create.output).toContain(hash('Before'));
    expect((await execute(root, 'write_file', { path: 'notes.txt', content: 'After', expected_sha256: hash('Before') }, async (details) => {
      expect(details).toMatchObject({ exists: true, before: 'Before', after: 'After' });
      expect(await readFile(join(root.path, 'notes.txt'), 'utf8')).toBe('Before'); return true;
    })).error).toBe(false);
    expect(await readFile(join(root.path, 'notes.txt'), 'utf8')).toBe('After');
    expect(await readdir(root.path)).toEqual(['notes.txt']);
  });
  it('requires approval and leaves files unchanged when denied or stopped', async () => {
    const root = await project(); const args = { path: 'notes.txt', content: 'Contents', expected_sha256: null };
    expect((await tools.execute({ id: 'call', name: 'write_file', arguments: JSON.stringify(args) }, root, new AbortController().signal)).error).toBe(true);
    expect((await execute(root, 'write_file', args, async () => false)).error).toBe(true);
    expect(await readdir(root.path)).toEqual([]);
    const controller = new AbortController();
    await expect(execute(root, 'write_file', args, async () => { controller.abort(); return true; }, controller.signal)).rejects.toThrow();
    expect(await readdir(root.path)).toEqual([]);
  });
  it('detects stale revisions and changes made during approval', async () => {
    const root = await project(); await writeFile(join(root.path, 'notes.txt'), 'Before');
    const approve = vi.fn(async () => true);
    expect((await execute(root, 'write_file', { path: 'notes.txt', content: 'After', expected_sha256: null }, approve)).output).toContain('revision');
    expect(approve).not.toHaveBeenCalled();
    const result = await execute(root, 'write_file', { path: 'notes.txt', content: 'After', expected_sha256: hash('Before') }, async () => { await writeFile(join(root.path, 'notes.txt'), 'Other work'); return true; });
    expect(result.output).toContain('changed while approval');
    expect(await readFile(join(root.path, 'notes.txt'), 'utf8')).toBe('Other work');
    expect((await execute(root, 'write_file', { path: 'new.txt', content: 'After', expected_sha256: null }, async () => { await writeFile(join(root.path, 'new.txt'), 'Other work'); return true; })).error).toBe(true);
  });
  it('edits exact text without special replacement expansion and handles ambiguous matches', async () => {
    const root = await project(); await writeFile(join(root.path, 'notes.txt'), 'one one');
    const args = { path: 'notes.txt', old_text: 'one', new_text: '$&', replace_all: false, expected_sha256: hash('one one') };
    expect((await execute(root, 'edit_file', args)).output).toContain('ambiguous');
    expect((await execute(root, 'edit_file', { ...args, old_text: 'missing' })).error).toBe(true);
    expect((await execute(root, 'edit_file', { ...args, replace_all: true })).error).toBe(false);
    expect(await readFile(join(root.path, 'notes.txt'), 'utf8')).toBe('$& $&');
    expect((await execute(root, 'edit_file', { ...args, old_text: '$& $&', expected_sha256: hash('$& $&') })).error).toBe(false);
    expect(await readFile(join(root.path, 'notes.txt'), 'utf8')).toBe('$&');
    expect((await execute(root, 'edit_file', { ...args, path: 'missing.txt', expected_sha256: null })).error).toBe(true);
  });
  it('blocks traversal, credentials, symbolic links and missing parents without asking for approval', async () => {
    const root = await project(); const outside = await project(); const approve = vi.fn(async () => true);
    await writeFile(join(outside.path, 'secret.txt'), 'Secret');
    await symlink(outside.path, join(root.path, 'escape'), 'junction');
    for (const path of ['../outside.txt', outside.path, '.env', 'escape/secret.txt', 'missing/notes.txt', '.', 'notes.txt:stream']) {
      expect((await execute(root, 'write_file', { path, content: 'Contents', expected_sha256: null }, approve)).error).toBe(true);
    }
    await mkdir(join(root.path, 'folder'));
    await symlink(join(root.path, 'folder'), join(root.path, 'folder-alias'), 'junction');
    expect((await execute(root, 'write_file', { path: 'folder-alias', content: 'Contents', expected_sha256: null }, approve)).error).toBe(true);
    expect((await execute(root, 'write_file', { path: 'folder', content: 'Contents', expected_sha256: null }, approve)).error).toBe(true);
    expect(approve).not.toHaveBeenCalled();
    expect(await readFile(join(outside.path, 'secret.txt'), 'utf8')).toBe('Secret');
  });
  it('replaces a hard-linked project file without changing the outside file', async () => {
    const root = await project(); const outside = await project();
    await writeFile(join(outside.path, 'shared.txt'), 'Original');
    await link(join(outside.path, 'shared.txt'), join(root.path, 'shared.txt'));
    expect((await execute(root, 'write_file', { path: 'shared.txt', content: 'Project edit', expected_sha256: hash('Original') })).error).toBe(false);
    expect(await readFile(join(root.path, 'shared.txt'), 'utf8')).toBe('Project edit');
    expect(await readFile(join(outside.path, 'shared.txt'), 'utf8')).toBe('Original');
  });
  it('rejects invalid arguments, oversized edits and non-UTF-8 files', async () => {
    const root = await project();
    expect((await tools.execute({ id: 'call', name: 'write_file', arguments: '{bad' }, root, new AbortController().signal, { approve: async () => true, onProgress: () => {} })).error).toBe(true);
    expect((await execute(root, 'run_command', { program: 'node', args: [], timeout_ms: -1 })).error).toBe(true);
    expect((await execute(root, 'write_file', { path: 'binary.txt', content: 'Text\0', expected_sha256: null })).error).toBe(true);
    await writeFile(join(root.path, 'notes.txt'), 'one '.repeat(20_000));
    expect((await execute(root, 'edit_file', { path: 'notes.txt', old_text: 'one', new_text: 'many many words', replace_all: true, expected_sha256: hash('one '.repeat(20_000)) })).output).toContain('256 KB');
    await writeFile(join(root.path, 'invalid.txt'), new Uint8Array([0xff, 0xfe]));
    expect((await execute(root, 'write_file', { path: 'invalid.txt', content: 'New', expected_sha256: hash('') })).output).toContain('UTF-8');
  });
  it('reviews and executes exact commands, returns failure status and respects denial', async () => {
    const root = await project(); const progress = vi.fn();
    const args = { program: process.execPath, args: ['-e', 'process.stdout.write("Command evidence")'], timeout_ms: 5000 };
    const approve = vi.fn(async (details: ApprovalDetails) => { expect(details).toMatchObject({ kind: 'command', program: args.program, args: args.args, cwd: root.path }); return true; });
    const result = await execute(root, 'run_command', args, approve, new AbortController().signal, progress);
    expect(result).toMatchObject({ error: false, output: expect.stringContaining('Command evidence') });
    expect(progress).toHaveBeenCalled();
    expect((await execute(root, 'run_command', { ...args, args: ['-e', 'process.exit(2)'] })).error).toBe(true);
    expect((await execute(root, 'run_command', { ...args, args: ['-e', 'setInterval(()=>{},1000)'], timeout_ms: 100 })).output).toContain('timed out');
    expect((await execute(root, 'run_command', args, async () => false)).output).toContain('denied');
  });
});
