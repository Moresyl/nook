import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { verifyDesktopExit } from '../scripts/desktop-exit.mjs';

describe('desktop native exit gate', () => {
  it('accepts a successful native exit', () => {
    expect(() => verifyDesktopExit(0, null)).not.toThrow();
  });

  it.each([[null, null], [1, null], [3221225477, null], [null, 'SIGTERM'], [0, 'SIGTERM']] as const)('rejects unsuccessful, unobserved or terminated exits (%s, %s)', (code, signal) => {
    expect(() => verifyDesktopExit(code, signal)).toThrow(/desktop must/);
  });

  it('rejects the actual nonzero exit of an owned child process', async () => {
    const child = spawn(process.execPath, ['-e', 'process.exit(7)'], { windowsHide: true, stdio: 'ignore' });
    try {
      await once(child, 'exit');
      expect(child.exitCode).toBe(7);
      expect(() => verifyDesktopExit(child.exitCode, child.signalCode)).toThrow('successful native exit');
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
  });
});
