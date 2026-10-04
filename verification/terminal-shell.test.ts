import { mkdir, mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { terminalShell } from '../desktop/services/terminal-shell';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe('project terminal shell selection', () => {
  it('retains the configured Unix shell and bash fallback without checking Windows installations', async () => {
    const exists = vi.fn(); expect(await terminalShell('linux', { SHELL: '/bin/zsh' }, exists)).toBe('/bin/zsh');
    expect(await terminalShell('darwin', {}, exists)).toBe('/bin/bash'); expect(await terminalShell('linux', { SHELL: '' }, exists)).toBe('/bin/bash'); expect(exists).not.toHaveBeenCalled();
  });
  it('prefers an actual PowerShell 7 installation with Unicode and spaces and falls back across native Program Files locations', async () => {
    const roots = ['C:\\Program Files😀', 'D:\\Native Program Files']; const candidates = roots.map((root) => win32.join(root, 'PowerShell', '7', 'pwsh.exe'));
    const exists = vi.fn(async (path: string) => path === candidates[1]);
    expect(await terminalShell('win32', { ProgramFiles: roots[0], ProgramW6432: roots[1] }, exists)).toBe(candidates[1]); expect(exists.mock.calls.map(([path]) => path)).toEqual(candidates);
    exists.mockClear(); expect(await terminalShell('win32', { ProgramFiles: roots[1], ProgramW6432: roots[1] }, exists)).toBe(candidates[1]); expect(exists).toHaveBeenCalledTimes(1);
  });
  it('retains legacy Windows PowerShell for absent, unreadable or invalid installation roots without exposing failures', async () => {
    const exists = vi.fn(async () => false); expect(await terminalShell('win32', { ProgramFiles: 'C:\\Program Files' }, exists)).toBe('powershell.exe');
    const unavailable = vi.fn(async () => { throw new Error('PRIVATE_INSTALLATION_PATH'); }); expect(await terminalShell('win32', { ProgramFiles: 'C:\\Program Files' }, unavailable)).toBe('powershell.exe');
    exists.mockClear();
    expect(await terminalShell('win32', { ProgramFiles: 'relative', ProgramW6432: 'C:\\bad\0path' }, exists)).toBe('powershell.exe'); expect(await terminalShell('win32', {}, exists)).toBe('powershell.exe');
    expect(exists).not.toHaveBeenCalled();
  });
  it('uses the real filesystem probe and ignores a directory named as the executable', async () => {
    if (process.platform !== 'win32') return;
    const root = await mkdtemp(join(tmpdir(), 'qiyao-terminal-shell-')); directories.push(root); const directory = join(root, 'PowerShell', '7'); await mkdir(directory, { recursive: true });
    const executable = join(directory, 'pwsh.exe'); await mkdir(executable); expect(await terminalShell('win32', { ProgramFiles: root })).toBe('powershell.exe');
    await rmdir(executable); await writeFile(executable, 'TEST_ONLY_NOT_EXECUTED'); expect(await terminalShell('win32', { ProgramFiles: root })).toBe(executable);
  });
});
