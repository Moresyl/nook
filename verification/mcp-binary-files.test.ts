import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mcpBinaryFileName, mcpBinaryImageSupported, mcpBinaryItemSchema, mcpBinaryLimits } from '../contracts/mcp-binary';
import { McpBinaryFiles } from '../desktop/services/mcp-binary-files';
import { parseAttachment } from '../desktop/services/attachment-parser';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => {
  const local = relative(tmpdir(), path);
  if (!local.startsWith('qiyao-mcp-binary-') || local.includes('..') || isAbsolute(local)) throw new Error('Preserve an unexpected test directory.');
  return rm(path, { recursive: true, force: true });
})); });
const item = (bytes: Buffer = Buffer.from([0, 255, 128, 1]), mimeType?: string) => ({ uri: 'fixture://中文/二进制', bytes: bytes.length, data: bytes.toString('base64'), ...(mimeType ? { mimeType } : {}) });

describe('MCP binary snapshots', () => {
  it('validates canonical bytes including zero length and exact size limits without accepting mismatched metadata or extra properties', () => {
    for (const bytes of [Buffer.alloc(0), Buffer.from([255]), Buffer.from([255, 0]), Buffer.from([255, 0, 1]), Buffer.alloc(mcpBinaryLimits.itemBytes)]) expect(mcpBinaryItemSchema.parse(item(bytes))).toEqual(item(bytes));
    for (const invalid of [{ ...item(), data: 'AA==' }, { ...item(), bytes: 3 }, { ...item(), data: 'AP8_' }, { ...item(), data: 'AB==' }, { ...item(), data: 'AP8=\n' }, item(Buffer.alloc(mcpBinaryLimits.itemBytes + 1)), { ...item(), bytes: -1 }, { ...item(), uri: 'fixture://bad\0' }, { ...item(), mimeType: 'image/png\n' }, { ...item(), path: 'SECRET' }]) expect(mcpBinaryItemSchema.safeParse(invalid).success).toBe(false);
  });

  it('uses fixed safe filenames and previews only supported raster formats, including mixed case and media parameters', () => {
    for (const [mimeType, extension] of [['IMAGE/PNG; charset=binary', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp'], ['image/gif', 'gif'], ['application/pdf', 'pdf'], ['image/svg+xml', 'svg'], ['text/plain; charset=utf-8', 'txt'], ['application/json', 'json'], ['audio/mpeg', 'mp3'], ['audio/wav', 'wav'], ['../secret.exe', 'bin'], ['__proto__', 'bin'], ['constructor', 'bin']]) expect(mcpBinaryFileName({ mimeType })).toBe(`mcp-resource.${extension}`);
    expect(mcpBinaryFileName({})).toBe('mcp-resource.bin');
    for (const mimeType of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) expect(mcpBinaryImageSupported({ mimeType })).toBe(true);
    for (const mimeType of ['image/svg+xml', 'text/html', 'application/pdf', undefined]) expect(mcpBinaryImageSupported({ mimeType })).toBe(false);
  });

  it('exports exact original bytes through an explicit selected Unicode path and preserves a zero-byte file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'qiyao-mcp-binary-')); directories.push(directory);
    const path = join(directory, '导出 文件.bin'); const choose = vi.fn().mockResolvedValue(path); const parse = vi.fn();
    const files = new McpBinaryFiles(parse, choose);
    await expect(files.export(item())).resolves.toBe(true); expect(await readFile(path)).toEqual(Buffer.from([0, 255, 128, 1]));
    await expect(files.export(item(Buffer.alloc(0)))).resolves.toBe(true); expect(await readFile(path)).toEqual(Buffer.alloc(0));
    expect(choose).toHaveBeenCalledWith('mcp-resource.bin'); expect(parse).not.toHaveBeenCalled();
  });

  it('cancels without writing and validates before opening a picker or invoking a parser', async () => {
    const choose = vi.fn().mockResolvedValue(undefined); const parse = vi.fn(); const write = vi.fn(); const files = new McpBinaryFiles(parse, choose, write);
    await expect(files.export(item())).resolves.toBe(false); expect(write).not.toHaveBeenCalled();
    choose.mockClear();
    for (const raw of [null, { ...item(), bytes: 12 }, { ...item(), data: undefined }]) {
      await expect(files.export(raw)).rejects.toThrow('valid MCP binary item'); await expect(files.preview(raw)).rejects.toThrow('valid MCP binary item');
    }
    expect(choose).not.toHaveBeenCalled(); expect(parse).not.toHaveBeenCalled();
    await expect(files.preview(item(Buffer.from('SVG'), 'image/svg+xml'))).rejects.toThrow('no image preview'); expect(parse).not.toHaveBeenCalled();
  });

  it('normalizes a real raster image without rewriting the original export bytes or retaining its image metadata', async () => {
    const png = await sharp({ create: { width: 24, height: 12, channels: 4, background: '#0088cc80' } }).png().toBuffer();
    const files = new McpBinaryFiles(parseAttachment, vi.fn()); const preview = await files.preview(item(png, 'image/png'));
    expect(preview.image).toMatchObject({ mimeType: 'image/jpeg', width: 24, height: 12 }); expect(preview.source).toEqual({ format: 'png', bytes: png.length });
    expect((await sharp(Buffer.from(preview.image!.data, 'base64')).metadata()).format).toBe('jpeg'); expect(preview.warnings).toContain('图片已转换为 JPEG，并移除文件元数据。透明区域使用白色背景。');
    expect(png.toString('base64')).toBe(item(png, 'image/png').data);
  });

  it('rejects corrupt raster data and invalid parser output with a recoverable error', async () => {
    const choose = vi.fn(); const files = new McpBinaryFiles(parseAttachment, choose);
    await expect(files.preview(item(Buffer.from('SECRET_NOT_AN_IMAGE'), 'image/png'))).rejects.toThrow('Could not preview this MCP image');
    const parse = vi.fn().mockResolvedValueOnce({ id: 'x', name: 'image.png', content: '' }).mockRejectedValueOnce(new Error('SECRET_PARSE_PATH')).mockResolvedValueOnce({ invalid: 'SECRET' });
    const failures = new McpBinaryFiles(parse, choose);
    for (let attempt = 0; attempt < 3; attempt++) await expect(failures.preview(item(undefined, 'image/png'))).rejects.toThrow('Could not preview this MCP image');
    expect(choose).not.toHaveBeenCalled();
  });

  it('blocks overlapping preview/export while an owned operation is pending and releases the guard after failure or cancellation', async () => {
    let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; });
    const choose = vi.fn(async () => { await held; return undefined; }); const parse = vi.fn(); const files = new McpBinaryFiles(parse, choose, vi.fn());
    const first = files.export(item()); await expect(files.export(item())).rejects.toThrow('Another MCP file operation'); await expect(files.preview(item(undefined, 'image/png'))).rejects.toThrow('Another MCP file operation');
    release(); await expect(first).resolves.toBe(false); await expect(files.export(item())).resolves.toBe(false);
    expect(choose).toHaveBeenCalledTimes(2); expect(parse).not.toHaveBeenCalled();
  });

  it('sanitizes picker/write failures, rejects relative paths and permits a subsequent successful export', async () => {
    const choose = vi.fn().mockRejectedValueOnce(new Error('SECRET_PICKER')).mockResolvedValueOnce('relative-secret.bin').mockResolvedValue('/chosen/file.bin');
    const write = vi.fn().mockRejectedValueOnce(new Error('SECRET_WRITE_PATH')).mockResolvedValue(undefined); const files = new McpBinaryFiles(vi.fn(), choose, write);
    for (let attempt = 0; attempt < 3; attempt++) await expect(files.export(item())).rejects.toThrow('Could not export the MCP file. Choose a writable location and retry.');
    expect(write).toHaveBeenCalledTimes(1); await expect(files.export(item())).resolves.toBe(true); expect(write).toHaveBeenCalledTimes(2);
  });
});
