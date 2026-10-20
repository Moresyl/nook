import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { verifyDesktopExit } from '../scripts/desktop-exit.mjs';

describe('desktop native exit gate', () => {
  it('accepts a successful native exit', () => {
    expect(() => verifyDesktopExit(0, null)).not.toThrow();
  });

  it.each([[null, null], [1, null], [3221225477, null], [3221226505, null], [null, 'SIGTERM'], [0, 'SIGTERM']] as const)('rejects unsuccessful, unobserved or terminated exits (%s, %s)', (code, signal) => {
    expect(() => verifyDesktopExit(code, signal)).toThrow(/desktop must/);
  });

  it('rejects the actual nonzero exit of an owned child process', async () => {
    const child = spawn(process.execPath, ['-e', 'process.stderr.write("OWNED_NATIVE_EXIT_DIAGNOSTIC", () => process.exit(7))'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let diagnostics = ''; child.stderr.on('data', data => { diagnostics += data.toString(); });
    try {
      await once(child, 'close');
      expect(child.exitCode).toBe(7);
      expect(() => verifyDesktopExit(child.exitCode, child.signalCode, diagnostics)).toThrow('OWNED_NATIVE_EXIT_DIAGNOSTIC');
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
  });

  it('retains bounded failure details and redacts websocket debugger endpoints before truncating', () => {
    const diagnostics = `OLD_DIAGNOSTIC${'x'.repeat(5000)}\nws://127.0.0.1:1234/private-token\nwss://localhost/private-secure-token\nNATIVE_ABORT_DETAIL`;
    let message = '';
    try { verifyDesktopExit(3221226505, null, diagnostics); } catch (error) { message = (error as Error).message; }
    expect(message).toContain('NATIVE_ABORT_DETAIL');
    expect(message.match(/\[test debugger\]/g)).toHaveLength(2);
    expect(message).not.toContain('OLD_DIAGNOSTIC'); expect(message).not.toContain('private-token'); expect(message).not.toContain('private-secure-token');
    const tail = message.split('Desktop stderr tail:\n')[1];
    expect(tail.slice(0, tail.indexOf('NATIVE_ABORT_DETAIL') + 'NATIVE_ABORT_DETAIL'.length)).toHaveLength(4000);
  });

  it('includes signal failure diagnostics and accepts successful exits despite stderr output', () => {
    expect(() => verifyDesktopExit(0, 'SIGTERM', 'SIGNAL_DETAIL')).toThrow('SIGNAL_DETAIL');
    expect(() => verifyDesktopExit(0, null, 'NON_FATAL_STDERR')).not.toThrow();
  });
});
