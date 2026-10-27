import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectEntryActions } from '../desktop/services/project-entry-actions';

vi.mock('node:fs/promises', async importOriginal => { const actual = await importOriginal<typeof import('node:fs/promises')>(); return { ...actual, lstat: vi.fn(actual.lstat) }; });
const directories: string[] = [];
afterEach(async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  vi.mocked(lstat).mockReset(); vi.mocked(lstat).mockImplementation(actual.lstat);
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
async function directory() { const root = await mkdtemp(join(tmpdir(), 'nook-entry-')); directories.push(root); return root; }

describe('project entry paths and file-manager dispatch', () => {
  it('returns canonical absolute paths for existing Unicode files and folders without reading or changing their bytes', async () => {
    const root = await directory(); await mkdir(join(root, '中文 空格')); const file = join(root, '中文 空格', 'binary.bin');
    const bytes = Buffer.alloc(300_000, 0); await writeFile(file, bytes);
    const show = vi.fn(), actions = new ProjectEntryActions(() => root, show);
    expect(await actions.path('project', '中文 空格/binary.bin')).toBe(file);
    expect(await actions.path('project', '中文 空格')).toBe(join(root, '中文 空格'));
    expect(await readFile(file)).toEqual(bytes); expect(show).not.toHaveBeenCalled();
  });
  it('dispatches only the resolved existing file or directory to the file-manager adapter', async () => {
    const root = await directory(); await mkdir(join(root, 'folder')); await writeFile(join(root, 'file.txt'), 'KEEP');
    const show = vi.fn(), actions = new ProjectEntryActions(() => root, show);
    await actions.reveal('project', 'file.txt'); await actions.reveal('project', 'folder');
    expect(show.mock.calls).toEqual([[join(root, 'file.txt')], [join(root, 'folder')]]);
    expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('KEEP');
  });
  it('resolves a selected project-root alias to its actual directory', async () => {
    const root = await directory(), holder = await directory(); await writeFile(join(root, 'file.txt'), 'KEEP');
    await symlink(root, join(holder, 'alias'), 'junction');
    const actions = new ProjectEntryActions(() => join(holder, 'alias'), vi.fn());
    expect(await actions.path('project', 'file.txt')).toBe(join(root, 'file.txt'));
  });
  it('rejects root, absolute, missing, internal and escaping paths without dispatching', async () => {
    const root = await directory(); await mkdir(join(root, '.git')); await writeFile(join(root, '.git', 'config'), 'KEEP');
    await mkdir(join(root, 'NODE_MODULES')); await writeFile(join(root, 'NODE_MODULES', 'file.txt'), 'KEEP');
    const show = vi.fn(), actions = new ProjectEntryActions(() => root, show);
    for (const path of ['', '.', '..', 'folder/..', '../outside', resolve(root, '.git/config'), 'C:\\private', '/private', 'bad\0path', 'x'.repeat(4097), 'missing', '.git/config', 'NODE_MODULES/file.txt', undefined, 2]) {
      await expect(actions.reveal('project', path as string)).rejects.toThrow('Refresh the file tree');
    }
    expect(show).not.toHaveBeenCalled(); expect(await readFile(join(root, '.git', 'config'), 'utf8')).toBe('KEEP');
  });
  it('rejects outside parent junctions and direct junction entries even when they point inside the project', async () => {
    const root = await directory(), outside = await directory(); await writeFile(join(outside, 'private.txt'), 'KEEP'); await mkdir(join(root, 'folder'));
    await symlink(outside, join(root, 'outside'), 'junction'); await symlink(join(root, 'folder'), join(root, 'inside'), 'junction');
    const show = vi.fn(), actions = new ProjectEntryActions(() => root, show);
    for (const path of ['outside/private.txt', 'inside']) await expect(actions.reveal('project', path)).rejects.toThrow('Refresh the file tree');
    expect(show).not.toHaveBeenCalled(); expect(await readFile(join(outside, 'private.txt'), 'utf8')).toBe('KEEP');
  });
  it('rejects a relocated project after path resolution rather than dispatching its former file', async () => {
    const root = await directory(), elsewhere = await directory(); await writeFile(join(root, 'file.txt'), 'KEEP');
    const show = vi.fn(), project = vi.fn().mockReturnValueOnce(root).mockReturnValueOnce(elsewhere);
    await expect(new ProjectEntryActions(project, show).reveal('project', 'file.txt')).rejects.toThrow('selected project changed');
    expect(show).not.toHaveBeenCalled(); expect(project.mock.calls).toEqual([['project'], ['project']]);
  });
  it('rejects a removed or unknown project before exposing a path', async () => {
    const root = await directory(); await writeFile(join(root, 'file.txt'), 'KEEP');
    const show = vi.fn(), missing = () => { throw new Error('The selected project no longer exists.'); };
    await expect(new ProjectEntryActions(missing, show).path('missing', 'file.txt')).rejects.toThrow('no longer exists');
    const project = vi.fn().mockReturnValueOnce(root).mockImplementationOnce(missing);
    await expect(new ProjectEntryActions(project, show).reveal('removed', 'file.txt')).rejects.toThrow('no longer exists');
    expect(show).not.toHaveBeenCalled();
  });
  it('sanitizes filesystem failures and permits a valid retry', async () => {
    const root = await directory(); await writeFile(join(root, 'file.txt'), 'KEEP');
    const cause = Object.assign(new Error('PRIVATE_FILESYSTEM_PATH'), { code: 'EIO' }); vi.mocked(lstat).mockRejectedValueOnce(cause);
    const actions = new ProjectEntryActions(() => root, vi.fn()), error = await actions.path('project', 'file.txt').catch(error => error);
    expect(error.message).toBe('The project entry could not be found. Refresh the file tree and retry.'); expect(error.cause).toBe(cause);
    expect(await actions.path('project', 'file.txt')).toBe(join(root, 'file.txt'));
  });
  it('rejects unsupported filesystem entries without dispatching', async () => {
    const root = await directory(); await writeFile(join(root, 'file.txt'), 'KEEP');
    vi.mocked(lstat).mockResolvedValueOnce({ isSymbolicLink: () => false, isFile: () => false, isDirectory: () => false } as Stats);
    const show = vi.fn(); await expect(new ProjectEntryActions(() => root, show).reveal('project', 'file.txt')).rejects.toThrow('Refresh the file tree');
    expect(show).not.toHaveBeenCalled();
  });
  it('sanitizes a failed native dispatch and allows retry without changing project files', async () => {
    const root = await directory(); await writeFile(join(root, 'file.txt'), 'KEEP');
    const cause = new Error('PRIVATE_NATIVE_FAILURE'), show = vi.fn().mockImplementationOnce(() => { throw cause; });
    const actions = new ProjectEntryActions(() => root, show), error = await actions.reveal('project', 'file.txt').catch(error => error);
    expect(error.message).toBe('The project entry could not be revealed in the file manager. Retry from its file tree.'); expect(error.cause).toBe(cause);
    await expect(actions.reveal('project', 'file.txt')).resolves.toBeUndefined(); expect(show).toHaveBeenCalledTimes(2);
    expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('KEEP');
  });
});
