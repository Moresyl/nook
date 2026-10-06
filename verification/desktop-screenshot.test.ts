import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { captureDesktopScreenshot } from '../scripts/desktop-screenshot.mjs';

const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=', 'base64');

async function withTarget(test: (path: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'nook-capture-'));
  try { await test(join(directory, 'window.png')); } finally { await rm(directory, { recursive: true, force: true }); }
}

describe('native desktop screenshot bounds', () => {
  it('writes the exact native PNG when its dimensions match the entire content area', async () => withTarget(async path => {
    const evaluateMain = vi.fn(async () => ({ png: pixel.toString('base64'), size: [1, 1] }));
    await captureDesktopScreenshot({ evaluateMain }, path);
    expect(evaluateMain).toHaveBeenCalledOnce(); expect(await readFile(path)).toEqual(pixel);
  }));

  it('rejects a cropped capture before writing it', async () => withTarget(async path => {
    await expect(captureDesktopScreenshot({ evaluateMain: async () => ({ png: pixel.toString('base64'), size: [2, 1] }) }, path)).rejects.toThrow('entire unscaled content bounds');
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
  }));

  it('rejects a non-PNG native result before writing it', async () => withTarget(async path => {
    await expect(captureDesktopScreenshot({ evaluateMain: async () => ({ png: Buffer.from('not a screenshot').toString('base64'), size: [1, 1] }) }, path)).rejects.toThrow('must be a PNG');
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
  }));

  it('propagates a failed native capture without creating a misleading artifact', async () => withTarget(async path => {
    const failure = new Error('Owned native window was unavailable');
    await expect(captureDesktopScreenshot({ evaluateMain: async () => { throw failure; } }, path)).rejects.toBe(failure);
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
  }));
});
