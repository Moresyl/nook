import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { Readable } from 'node:stream';
import { WorkspaceBackupFiles } from '../desktop/services/backup-files';

vi.mock('node:fs/promises', async (importOriginal) => { const actual = await importOriginal<typeof import('node:fs/promises')>(); return { ...actual, open: vi.fn(actual.open) }; });
const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.mocked(open).mockReset(); const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises'); vi.mocked(open).mockImplementation(actual.open); await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
async function fixture(name = 'backup.json') { const directory = await mkdtemp(join(tmpdir(), 'qiyao-backup-')); directories.push(directory); return { directory, path: join(directory, name) }; }
describe('complete workspace backup files', () => {
  it('round trips plain JSON and gzip JSON without losing Unicode, escaped text, optional fields or repeated object references', async () => {
    const shared = { text: '中文🧪\n"quoted"\t\\path\u0000', absent: undefined }; const value = { first: shared, second: shared, null: null, true: true, false: false, number: 42, array: [undefined, , shared], '\\key"': '\ud800' };
    const expected = JSON.parse(JSON.stringify(value)); const files = new WorkspaceBackupFiles(); expect(await files.size(value)).toBe(Buffer.byteLength(JSON.stringify(value), 'utf8'));
    for (const name of ['backup.json', 'backup.JSON.GZ']) { const { directory, path } = await fixture(name); await files.write(path, value); const bytes = await readFile(path); expect(name.endsWith('GZ') ? JSON.parse(gunzipSync(bytes).toString('utf8')) : JSON.parse(bytes.toString('utf8'))).toEqual(expected); expect(await files.read(path)).toEqual(expected); expect(await readdir(directory)).toEqual([name]); }
  });
  it('detects compression by content and accepts legacy formatted/BOM JSON regardless of its filename', async () => {
    const { path } = await fixture('renamed.json'); const files = new WorkspaceBackupFiles(); await writeFile(path, gzipSync('{"value":"text"}')); expect(await files.read(path)).toEqual({ value: 'text' }); await writeFile(path, '\ufeff' + JSON.stringify({ text: '旧备份' }, null, 2)); expect(await files.read(path)).toEqual({ text: '旧备份' });
  });
  it('uses exact UTF-8 serialized-byte limits and preserves an existing backup before rejecting larger snapshots', async () => {
    const value = { text: '汉字🧪'.repeat(10) }; const bytes = Buffer.byteLength(JSON.stringify(value)); const files = new WorkspaceBackupFiles({ textBytes: bytes, compressedBytes: 1000 }); const { directory, path } = await fixture(); await files.write(path, value); const before = await readFile(path);
    expect(await files.size(value)).toBe(bytes); await expect(files.write(path, { text: value.text + 'a' })).rejects.toThrow(/size limit/); expect(await readFile(path)).toEqual(before); await expect(files.read(path)).resolves.toEqual(value); await writeFile(path, Buffer.concat([before, Buffer.from(' ')])); await expect(files.read(path)).rejects.toThrow(/size limit/); expect(await readdir(directory)).toEqual(['backup.json']);
  });
  it('rejects compressed output and input limits without replacing an existing destination or leaving temporary files', async () => {
    const files = new WorkspaceBackupFiles({ textBytes: 10_000, compressedBytes: 32 }); const { directory, path } = await fixture('backup.json.gz'); const before = gzipSync('{"before":true}'); await writeFile(path, before);
    await expect(files.write(path, { data: randomBytes(256).toString('base64') })).rejects.toThrow(/size limit/); expect(await readFile(path)).toEqual(before); expect(await readdir(directory)).toEqual(['backup.json.gz']); await writeFile(path, gzipSync(JSON.stringify({ data: randomBytes(256).toString('base64') }))); await expect(files.read(path)).rejects.toThrow(/size limit/);
  });
  it('enforces expanded gzip limits, validates checksums and rejects truncation, trailing junk and invalid UTF-8', async () => {
    const files = new WorkspaceBackupFiles({ textBytes: 128, compressedBytes: 1000 }); const { path } = await fixture(); await writeFile(path, gzipSync(JSON.stringify({ text: 'a'.repeat(1024) }))); await expect(files.read(path)).rejects.toThrow(/size limit/);
    const valid = gzipSync('{"value":"text"}'); const corrupt = Buffer.from(valid); corrupt[corrupt.length - 5] ^= 1;
    for (const bytes of [corrupt, valid.subarray(0, -4), Buffer.concat([valid, Buffer.from('junk')]), Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]), Buffer.from('not JSON'), Buffer.alloc(0)]) { await writeFile(path, bytes); await expect(files.read(path)).rejects.toThrow(/complete JSON or gzip/); }
  });
  it('rejects cycles, non-JSON types and excessive nesting before modifying files', async () => {
    const files = new WorkspaceBackupFiles(); const { directory, path } = await fixture(); await writeFile(path, '{"before":true}'); const cycle: Record<string, unknown> = {}; cycle.self = cycle; let nested: unknown = {}; for (let index = 0; index < 130; index++) nested = { nested };
    for (const value of [cycle, nested, { value: 1n }, { value: NaN }, { value: Infinity }, { value: () => {} }, new Date(), undefined]) { await expect(files.write(path, value)).rejects.toThrow(/backup contains/); expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ before: true }); }
    expect(await readdir(directory)).toEqual(['backup.json']); for (const limit of [0, -1, Infinity, 1.5]) expect(() => new WorkspaceBackupFiles({ textBytes: limit, compressedBytes: 1 })).toThrow(/positive integers/);
  });
  it('redacts filesystem errors and rejects directories while allowing a subsequent valid write', async () => {
    const files = new WorkspaceBackupFiles(); const { directory, path } = await fixture(); await expect(files.read(join(directory, 'private-key-not-found'))).rejects.not.toThrow(/private-key/); await expect(files.read(directory)).rejects.toThrow(/backup could not be read/); await expect(files.write(join(directory, 'missing', 'private-key'), {})).rejects.not.toThrow(/private-key/); await files.write(path, { recovered: true }); expect(await files.read(path)).toEqual({ recovered: true });
  });
  it('cancels active serialization/writes on shutdown, preserves the destination and refuses later operations', async () => {
    const files = new WorkspaceBackupFiles(); const { directory, path } = await fixture('backup.json.gz'); const before = gzipSync('{"before":true}'); await writeFile(path, before); const value = { texts: new Array(100).fill('text'.repeat(20_000)) }; let passes = 0; let started!: () => void; const writing = new Promise<void>((resolve) => { started = resolve; });
    Object.defineProperty(value, 'texts', { enumerable: true, get() { if (++passes === 2) started(); return new Array(100).fill('text'.repeat(20_000)); } });
    const pending = files.write(path, value); const rejected = expect(pending).rejects.toThrow(/abort/i); await writing; await files.shutdown(); await rejected; expect(await readFile(path)).toEqual(before); expect(await readdir(directory)).toEqual(['backup.json.gz']); await expect(files.read(path)).rejects.toThrow(/closing/); await expect(files.write(path, {})).rejects.toThrow(/closing/); await expect(files.size({})).rejects.toThrow(/closing/); await files.shutdown();
  });
  it('honors an already aborted caller signal before opening files', async () => {
    const files = new WorkspaceBackupFiles(); const { directory, path } = await fixture(); const controller = new AbortController(); controller.abort(); await expect(files.write(path, {}, controller.signal)).rejects.toThrow(/abort/i); await expect(files.read(path, controller.signal)).rejects.toThrow(/abort/i); await expect(files.size({}, controller.signal)).rejects.toThrow(/abort/i); expect(await readdir(directory)).toEqual([]);
  });
  it('checks cancellation after flushing the file and before replacing a previous backup', async () => {
    const files = new WorkspaceBackupFiles(); const { directory, path } = await fixture(); await writeFile(path, '{"before":true}'); const controller = new AbortController(); const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(open).mockImplementationOnce(async (...args) => { const file = await actual.open(...args); const sync = file.sync.bind(file); file.sync = async () => { await sync(); controller.abort(); }; return file; });
    await expect(files.write(path, { after: true }, controller.signal)).rejects.toThrow(/abort/i); expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ before: true }); expect(await readdir(directory)).toEqual(['backup.json']);
  });
  it('handles short filesystem writes and rejects a zero-byte write without replacing saved data', async () => {
    const files = new WorkspaceBackupFiles(); const { directory, path } = await fixture(); const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(open).mockImplementationOnce(async (...args) => { const file = await actual.open(...args); const write = file.write.bind(file); file.write = ((buffer: Buffer, offset: number, length: number) => write(buffer, offset, Math.min(length, 2))) as typeof file.write; return file; });
    await files.write(path, { full: '中文🧪完整' }); const before = await readFile(path); expect(JSON.parse(before.toString('utf8'))).toEqual({ full: '中文🧪完整' });
    vi.mocked(open).mockImplementationOnce(async (...args) => { const file = await actual.open(...args); file.write = vi.fn(async () => ({ bytesWritten: 0, buffer: Buffer.alloc(0) })) as unknown as typeof file.write; return file; });
    await expect(files.write(path, { full: 'changed' })).rejects.toThrow(/could not be saved/); expect(await readFile(path)).toEqual(before); expect(await readdir(directory)).toEqual(['backup.json']);
  });
  it('bounds actual bytes even when a file grows beyond the size reported before reading', async () => {
    const files = new WorkspaceBackupFiles({ textBytes: 128, compressedBytes: 128 }); const { path } = await fixture(); await writeFile(path, JSON.stringify({ text: 'x'.repeat(200) })); const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(open).mockImplementationOnce(async (...args) => { const file = await actual.open(...args); const stat = file.stat.bind(file); file.stat = (async () => ({ ...await stat(), size: 64, isFile: () => true })) as typeof file.stat; return file; }); await expect(files.read(path)).rejects.toThrow(/size limit/);
  });
  it('cancels a blocked reader on shutdown and closes the selected file', async () => {
    const files = new WorkspaceBackupFiles(); const { path } = await fixture(); await writeFile(path, '{}'); const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises'); let start!: () => void; const started = new Promise<void>((resolve) => { start = resolve; }); let closed = false; const source = new Readable({ read() { start(); } });
    vi.mocked(open).mockImplementationOnce(async (...args) => { const file = await actual.open(...args); file.createReadStream = (() => source) as typeof file.createReadStream; const close = file.close.bind(file); file.close = async () => { await close(); closed = true; }; return file; });
    const pending = files.read(path); const rejected = expect(pending).rejects.toThrow(/abort/i); await started; await expect(files.read(path)).rejects.toThrow(/Another backup/); await expect(files.write(path, {})).rejects.toThrow(/Another backup/); await expect(files.size({})).rejects.toThrow(/Another backup/); await files.shutdown(); await rejected; expect(source.destroyed).toBe(true); expect(closed).toBe(true);
  });
  it('redacts file-close errors after completing a read', async () => {
    const files = new WorkspaceBackupFiles(); const { path } = await fixture(); await writeFile(path, '{}'); const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(open).mockImplementationOnce(async (...args) => { const file = await actual.open(...args); const close = file.close.bind(file); file.close = async () => { await close(); throw new Error('Private filesystem path'); }; return file; }); await expect(files.read(path)).rejects.toThrow(/could not be closed/);
  });
});
