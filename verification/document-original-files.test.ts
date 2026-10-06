import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentOriginalFiles } from '../desktop/services/document-original-files';
import { originalDocumentIdentity } from '../desktop/services/document-original-store';

const bytes = Buffer.from('%PDF-1.7\nexport exact bytes\n%%EOF'), reference = originalDocumentIdentity(bytes);
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function destination() { const directory = await mkdtemp(join(tmpdir(), 'nook-original-export-')); directories.push(directory); return join(directory, 'saved.pdf'); }

describe('owned original file access', () => {
  it('validates references before reading or opening a file dialog', async () => {
    const read = vi.fn(async () => bytes), choose = vi.fn(async () => undefined), files = new DocumentOriginalFiles(read, choose);
    expect(() => files.read({ ...reference, sha256: '../outside' })).toThrow();
    await expect(files.export({ ...reference, path: 'outside.pdf' })).rejects.toThrow();
    expect(read).not.toHaveBeenCalled(); expect(choose).not.toHaveBeenCalled();
    expect(await files.read(reference)).toEqual(bytes); expect(read).toHaveBeenCalledWith(reference);
  });

  it('does not read or write on dialog cancellation', async () => {
    const read = vi.fn(async () => bytes), files = new DocumentOriginalFiles(read, async () => undefined);
    expect(await files.export(reference)).toBe(false); expect(read).not.toHaveBeenCalled();
  });

  it('writes exact verified bytes to the selected destination', async () => {
    const path = await destination(); await writeFile(path, 'old contents');
    const files = new DocumentOriginalFiles(async () => bytes, async () => path);
    expect(await files.export(reference)).toBe(true); expect(await readFile(path)).toEqual(bytes);
  });

  it('rechecks ownership after the dialog and preserves existing destination bytes on failure', async () => {
    const path = await destination(); await writeFile(path, 'keep this file'); let owned = true;
    const files = new DocumentOriginalFiles(async () => { if (!owned) throw new Error('Original no longer owned'); return bytes; }, async () => { owned = false; return path; });
    await expect(files.export(reference)).rejects.toThrow('no longer owned');
    expect(await readFile(path, 'utf8')).toBe('keep this file');
    const corrupt = new DocumentOriginalFiles(async () => { throw new Error('Original damaged'); }, async () => path);
    await expect(corrupt.export(reference)).rejects.toThrow('damaged');
    expect(await readFile(path, 'utf8')).toBe('keep this file');
  });
});
