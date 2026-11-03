import { mkdtemp, readFile, readdir, rm, writeFile, rename, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { atomicJson } from '../desktop/services/atomic-json';

vi.mock('node:fs/promises', async (importOriginal) => { const actual = await importOriginal<typeof import('node:fs/promises')>(); return { ...actual, rename: vi.fn(actual.rename), open: vi.fn(actual.open), rm: vi.fn(actual.rm) }; });
const directories: string[] = [];
afterEach(async () => { vi.mocked(rename).mockReset(); vi.mocked(open).mockReset(); vi.mocked(rm).mockReset(); const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises'); vi.mocked(rename).mockImplementation(actual.rename); vi.mocked(open).mockImplementation(actual.open); vi.mocked(rm).mockImplementation(actual.rm); await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function fixture() { const directory = await mkdtemp(join(tmpdir(), 'qiyao-atomic-')); directories.push(directory); const path = join(directory, 'data.json'); await writeFile(path, '{"before":true}'); return { directory, path }; }
describe('durable atomic JSON replacement', () => {
  it('retains the original failure and saved data when temporary-file cleanup also fails', async () => {
    const { directory, path } = await fixture(); vi.mocked(rename).mockRejectedValueOnce(Object.assign(new Error('Disk full'), { code: 'ENOSPC' })); vi.mocked(rm).mockRejectedValueOnce(Object.assign(new Error('Private cleanup path'), { code: 'EACCES' }));
    const error = await atomicJson(path, { after: true }).catch((error: Error) => error); expect(error).toBeInstanceOf(Error); expect((error as Error).cause).toMatchObject({ code: 'ENOSPC' }); expect(String(error)).not.toContain('Private'); expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ before: true }); expect(await readdir(directory)).toHaveLength(2);
  });
  it('writes UTF-8 JSON, syncs/closes before replacing and leaves no staging file', async () => {
    const { directory, path } = await fixture(); const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises'); let synced = false; let closed = false;
    vi.mocked(open).mockImplementationOnce(async (...args) => { const file = await actual.open(...args); const sync = file.sync.bind(file); const close = file.close.bind(file); file.sync = async () => { await sync(); synced = true; }; file.close = async () => { await close(); closed = true; }; return file; });
    vi.mocked(rename).mockImplementationOnce(async (...args) => { expect(synced && closed).toBe(true); await actual.rename(...args); });
    await atomicJson(path, { text: 'UTF-8 文本' }); expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ text: 'UTF-8 文本' }); expect(await readdir(directory)).toEqual(['data.json']);
  });
  it.each(['EPERM', 'EACCES', 'EBUSY'])('recovers a transient Windows rename failure (%s) without replacing the original prematurely', async (code) => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!; Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
    const { directory, path } = await fixture(); const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(rename).mockRejectedValueOnce(Object.assign(new Error('Locked'), { code })).mockImplementationOnce(async (...args) => { expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ before: true }); await actual.rename(...args); });
    await atomicJson(path, { after: true }); expect(rename).toHaveBeenCalledTimes(2); expect(await readdir(directory)).toEqual(['data.json']); expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ after: true });
    } finally { Object.defineProperty(process, 'platform', descriptor); }
  });
  it('bounds persistent sharing failures, removes its temporary file and retains the original', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!; Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
    const { directory, path } = await fixture(); vi.mocked(rename).mockRejectedValue(Object.assign(new Error('Sensitive path and content'), { code: 'EPERM' }));
    await expect(atomicJson(path, { after: true })).rejects.toThrow('Local data could not be saved'); expect(rename).toHaveBeenCalledTimes(7); expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ before: true }); expect(await readdir(directory)).toEqual(['data.json']);
    } finally { Object.defineProperty(process, 'platform', descriptor); }
  });
  it('does not retry disk-full errors and permits a subsequent successful write', async () => {
    const { directory, path } = await fixture(); vi.mocked(rename).mockRejectedValueOnce(Object.assign(new Error('Sensitive content'), { code: 'ENOSPC' }));
    const error = await atomicJson(path, { after: true }).catch((problem: Error) => problem); expect(String(error)).not.toContain('Sensitive'); expect(rename).toHaveBeenCalledOnce(); expect(await readdir(directory)).toEqual(['data.json']);
    await atomicJson(path, { recovered: true }); expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ recovered: true });
  });
  it('does not retry permission errors outside Windows', async () => {
    const { path } = await fixture(); const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!; Object.defineProperty(process, 'platform', { value: 'linux' });
    try { vi.mocked(rename).mockRejectedValue(Object.assign(new Error('Denied'), { code: 'EACCES' })); await expect(atomicJson(path, {})).rejects.toThrow('Local data could not be saved'); expect(rename).toHaveBeenCalledOnce(); }
    finally { Object.defineProperty(process, 'platform', descriptor); }
  });
  it('keeps the original after staging creation/write/flush errors without masking them during cleanup', async () => {
    const { directory, path } = await fixture(); vi.mocked(open).mockRejectedValueOnce(new Error('Disk unavailable'));
    await expect(atomicJson(path, {})).rejects.toThrow('Local data could not be saved'); expect(rename).not.toHaveBeenCalled(); expect(await readdir(directory)).toEqual(['data.json']);
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    for (const method of ['writeFile', 'sync'] as const) { vi.mocked(open).mockImplementationOnce(async (...args) => { const file = await actual.open(...args); file[method] = vi.fn().mockRejectedValue(new Error('Disk unavailable')); return file; }); await expect(atomicJson(path, {})).rejects.toThrow('Local data could not be saved'); expect(await readdir(directory)).toEqual(['data.json']); }
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ before: true });
  });
  it('rejects unserializable data, closes its staging file and retains the saved JSON', async () => {
    const { directory, path } = await fixture(); const cyclic: { self?: unknown } = {}; cyclic.self = cyclic;
    for (const value of [cyclic, { value: 1n }]) { await expect(atomicJson(path, value)).rejects.toThrow('Local data could not be saved'); expect(await readdir(directory)).toEqual(['data.json']); }
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ before: true }); expect(rename).not.toHaveBeenCalled();
  });
});
