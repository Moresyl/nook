import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const directories: string[] = [];
const command = resolve('scripts/package-windows.mjs');
const failure = process.platform === 'win32' ? 'Unsupported Windows packaging argument' : 'Verified Windows packaging requires Windows';
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

describe('Windows packaging command failure status', () => {
  it('returns a failing native exit code and useful error for invalid arguments', async () => {
    await expect(run(process.execPath, [command, '--unsupported'], { windowsHide: true })).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining(failure) });
  });

  it('retains failure when an earlier dependency exit listener resets the code', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nook-package-exit-')); directories.push(directory);
    const preload = join(directory, 'reset-exit.mjs');
    await writeFile(preload, "process.on('exit', () => { process.exitCode = 0; });\n");
    const arguments_ = ['--import', pathToFileURL(preload).href];
    // Prove that the dependency fixture really masks an ordinary failing code.
    await expect(run(process.execPath, [...arguments_, '--eval', 'process.exitCode = 1'], { windowsHide: true })).resolves.toMatchObject({ stdout: '', stderr: '' });
    await expect(run(process.execPath, [...arguments_, command, '--unsupported'], { windowsHide: true })).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining(failure) });
  });
});
