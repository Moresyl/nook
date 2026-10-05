import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { drainDesktopOutput } from '../scripts/desktop-output.mjs';

describe('desktop output draining', () => {
  it('counts bytes without retaining or returning output content', () => {
    const stream = new PassThrough();
    const count = drainDesktopOutput(stream);
    expect(count()).toBe(0);
    stream.write('私密内容');
    stream.end(Buffer.from('test'));
    expect(count()).toBe(Buffer.byteLength('私密内容test'));
  });

  it('allows a real child to flush large stdout before reporting readiness on stderr', async () => {
    const size = 4 * 1024 * 1024;
    const child = spawn(process.execPath, ['-e', `process.stdout.write(Buffer.alloc(${size}, 120), () => process.stderr.write('READY'));`], { stdio: ['ignore', 'pipe', 'pipe'] });
    const closed = once(child, 'close');
    let readiness = '';
    child.stderr.on('data', (chunk) => { readiness += chunk.toString(); });
    const count = drainDesktopOutput(child.stdout);
    try {
      expect(await closed).toEqual([0, null]);
      expect(readiness).toBe('READY');
      expect(count()).toBe(size);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
  }, 10_000);
});
