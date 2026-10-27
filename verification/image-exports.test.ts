import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageExports } from '../desktop/services/image-exports';
import { parseAttachment } from '../desktop/services/attachment-parser';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function destination() { const directory = await mkdtemp(join(tmpdir(), 'nook-image-export-')); directories.push(directory); return join(directory, '保存图片.jpg'); }
async function image() {
  const png = await sharp({ create: { width: 32, height: 24, channels: 4, background: '#537fe7' } }).png().toBuffer();
  return parseAttachment({ name: '项目截图.png', data: png.toString('base64') });
}

describe('JPEG attachment export', () => {
  it('validates type, canonical image data, dimensions and bounds before opening a dialog', async () => {
    const file = await image(), choose = vi.fn(async () => undefined), exports = new ImageExports(choose);
    for (const input of [null, { id: 'text', name: 'text.txt', content: 'text' }, { ...file, content: 'hidden text' }, { ...file, image: { ...file.image, width: 33 } }, { ...file, image: { ...file.image, data: '/9j/invalid' } }, { ...file, image: { ...file.image, width: 2001 } }]) {
      await expect(exports.export(input)).rejects.toThrow('valid image attachment');
    }
    expect(choose).not.toHaveBeenCalled();
  });

  it('suggests a JPEG name, treats cancellation as a no-op and can retry', async () => {
    const file = await image(), choose = vi.fn(async () => undefined), exports = new ImageExports(choose);
    expect(await exports.export(file)).toBe(false); expect(await exports.export(file)).toBe(false);
    expect(choose).toHaveBeenNthCalledWith(1, '项目截图.jpg'); expect(choose).toHaveBeenCalledTimes(2);
    expect(file.name).toBe('项目截图.png'); expect(file.source?.format).toBe('png');
  });

  it('sanitizes dialog file names without using renderer-provided directories', async () => {
    const file = await image(), choose = vi.fn(async () => undefined), exports = new ImageExports(choose);
    for (const [name, expected] of [['../nested\\bad:?.png', '.._nested_bad__.jpg'], ['CON.png', '_CON.jpg'], ['lpt9.extra.png', '_lpt9.extra.jpg'], ['.png', 'image.jpg'], [' .png', 'image.jpg'], ['screen', 'screen.jpg'], ['x'.repeat(200) + '.png', 'x'.repeat(120) + '.jpg']]) {
      await exports.export({ ...file, name }); expect(choose).toHaveBeenLastCalledWith(expected);
    }
  });

  it('atomically saves exact normalized JPEG bytes and preserves source metadata', async () => {
    const file = await image(), original = structuredClone(file), path = await destination(); await writeFile(path, 'replace only after success');
    const exports = new ImageExports(async () => path);
    expect(await exports.export(file)).toBe(true); expect(await readFile(path)).toEqual(Buffer.from(file.image!.data, 'base64'));
    expect((await sharp(await readFile(path)).metadata()).format).toBe('jpeg'); expect(file).toEqual(original);
    expect(await readdir(join(path, '..'))).toEqual(['保存图片.jpg']);
  });

  it('captures the requested image before a delayed dialog and rejects duplicate work', async () => {
    const file = await image(), original = file.image!.data, path = await destination(); let release!: (path: string) => void;
    const choose = vi.fn(() => new Promise<string>(resolve => { release = resolve; })), exports = new ImageExports(choose);
    const pending = exports.export(file); file.name = 'changed.png'; file.image!.data = 'changed';
    await expect(exports.export(await image())).rejects.toThrow('Another image export');
    expect(choose).toHaveBeenCalledTimes(1); release(path); expect(await pending).toBe(true);
    expect(await readFile(path)).toEqual(Buffer.from(original, 'base64'));
  });

  it('rejects relative and non-JPEG destinations without touching existing files', async () => {
    const file = await image(), jpg = await destination(), png = jpg.replace(/jpg$/, 'png'); await writeFile(png, 'keep original');
    for (const path of ['', 'relative.jpg', png]) await expect(new ImageExports(async () => path).export(file)).rejects.toThrow('Could not save');
    expect(await readFile(png, 'utf8')).toBe('keep original'); expect(await readdir(join(jpg, '..'))).toEqual(['保存图片.png']);
    const jpeg = jpg.replace(/jpg$/, 'JPEG'); expect(await new ImageExports(async () => jpeg).export(file)).toBe(true);
  });

  it('redacts dialog and disk failures, releases the lock, and permits a later successful export', async () => {
    const file = await image(), path = await destination(), choose = vi.fn().mockRejectedValueOnce(new Error('secret device path')).mockResolvedValueOnce(join(path, 'missing', 'image.jpg')).mockResolvedValue(path);
    const exports = new ImageExports(choose);
    await expect(exports.export(file)).rejects.toThrow(/^Could not save the JPEG image\. Choose a writable JPEG destination and retry\.$/);
    await expect(exports.export(file)).rejects.toThrow(/^Could not save the JPEG image\. Choose a writable JPEG destination and retry\.$/);
    expect(await readdir(join(path, '..'))).toEqual([]);
    expect(await exports.export(file)).toBe(true); expect(await readFile(path)).toEqual(Buffer.from(file.image!.data, 'base64'));
  });
});
