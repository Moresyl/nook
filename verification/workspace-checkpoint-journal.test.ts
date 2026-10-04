import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceVault } from '../desktop/services/vault';
import type { Message } from '../contracts/workspace';
import { codec, sampleThread, testVault } from './fixtures';

const directories: string[] = [];
vi.mock('node:fs/promises', async importOriginal => { const actual = await importOriginal<typeof import('node:fs/promises')>(); return { ...actual, rename: vi.fn(actual.rename), stat: vi.fn(actual.stat), rm: vi.fn(actual.rm) }; });
afterEach(async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  vi.mocked(rename).mockReset().mockImplementation(actual.rename); vi.mocked(stat).mockReset().mockImplementation(actual.stat); vi.mocked(rm).mockReset().mockImplementation(actual.rm);
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
const message = (content: string, status: Message['status'] = 'complete'): Message => ({ id: 'reply', role: 'assistant', content, status, attachments: [], createdAt: 1 });
async function fixture() {
  const { vault, directory } = await testVault(); directories.push(directory);
  await vault.update(draft => { draft.threads.push(sampleThread({ messages: [message('Before')] })); });
  return { vault, directory, primary: join(directory, 'workspace.json'), backup: join(directory, 'workspace.backup.json'), journal: join(directory, 'workspace.checkpoints.json') };
}

describe('durable response checkpoint journal', () => {
  it('commits the exact previous backup and a recoverable checkpoint without replacing the full primary; flush materializes exact canonical bytes', async () => {
    const { vault, directory, primary, backup, journal } = await fixture();
    const before = await readFile(primary); const primaryId = (await stat(primary, { bigint: true })).ino;
    await vault.checkpointMessages([{ threadId: 'thread', message: message('Unicode 部分 🧪') }]);
    expect(await readFile(primary)).toEqual(before); expect((await stat(primary, { bigint: true })).ino).toBe(primaryId);
    expect(await readFile(backup)).toEqual(before); expect((await readFile(journal, 'utf8'))).toContain('Unicode 部分 🧪');
    const restored = new WorkspaceVault(directory, codec); await restored.initialize();
    expect(restored.snapshot().threads[0].messages[0].content).toBe('Unicode 部分 🧪');
    await vault.flush(); expect(await readFile(primary, 'utf8')).toBe(JSON.stringify(vault.snapshot(), null, 2));
    expect(await readFile(backup)).toEqual(before); await expect(readFile(journal)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('ignores a retired journal when an independent atomic replacement has identical primary bytes', async () => {
    const { vault, directory, primary, journal } = await fixture();
    const before = await readFile(primary);
    await vault.checkpointMessages([{ threadId: 'thread', message: message('Must not replay') }]);
    const replacement = `${primary}.replacement`; await writeFile(replacement, before); await rename(replacement, primary);
    const restored = new WorkspaceVault(directory, codec); await restored.initialize();
    expect(restored.snapshot().threads[0].messages[0].content).toBe('Before');
    await expect(readFile(journal)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('retains committed data through actual journal replacement failure and permits an exact retry', async () => {
    const { vault, primary, backup, journal } = await fixture(); const before = vault.snapshot(); const bytes = await readFile(primary);
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(rename).mockImplementation(async (from, to) => { if (to === journal) throw Object.assign(new Error('PRIVATE_JOURNAL_IO'), { code: 'EIO' }); return actual.rename(from, to); });
    await expect(vault.checkpointMessages([{ threadId: 'thread', message: message('Rejected') }])).rejects.toThrow('Local data could not be saved');
    expect(vault.snapshot()).toEqual(before); expect(await readFile(primary)).toEqual(bytes); expect(await readFile(backup)).toEqual(bytes);
    await expect(readFile(journal)).rejects.toMatchObject({ code: 'ENOENT' });
    vi.mocked(rename).mockImplementation(actual.rename);
    await vault.checkpointMessages([{ threadId: 'thread', message: message('Retry') }]); expect(vault.snapshot().threads[0].messages[0].content).toBe('Retry');
  });
  it('preserves the authoritative journal and exact previous backup through a failed ordinary save, then resets it on retry', async () => {
    const { vault, directory, primary, backup, journal } = await fixture();
    await vault.checkpointMessages([{ threadId: 'thread', message: message('Journal committed') }]);
    const before = vault.snapshot(); const checkpoint = await readFile(journal);
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(rename).mockImplementation(async (from, to) => { if (to === primary) throw Object.assign(new Error('EIO'), { code: 'EIO' }); return actual.rename(from, to); });
    await expect(vault.update(draft => { draft.threads[0].title = 'Failed'; })).rejects.toThrow('Local data could not be saved');
    expect(vault.snapshot()).toEqual(before); expect(await readFile(journal)).toEqual(checkpoint); expect(await readFile(backup, 'utf8')).toBe(JSON.stringify(before, null, 2));
    const restored = new WorkspaceVault(directory, codec); await restored.initialize(); expect(restored.snapshot()).toEqual(before);
    vi.mocked(rename).mockImplementation(actual.rename);
    await vault.update(draft => { draft.threads[0].title = 'Retried'; });
    expect(JSON.parse(await readFile(primary, 'utf8')).threads[0].title).toBe('Retried'); await expect(readFile(journal)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('keeps a checkpoint recoverable when materialization fails and preserves the prior backup on successful retry', async () => {
    const { vault, primary, backup, journal } = await fixture(); const previous = await readFile(primary);
    await vault.checkpointMessages([{ threadId: 'thread', message: message('Retained') }]);
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(rename).mockImplementation(async (from, to) => { if (to === primary) throw Object.assign(new Error('EIO'), { code: 'EIO' }); return actual.rename(from, to); });
    await expect(vault.flush()).rejects.toThrow('Local data could not be saved'); expect((await readFile(journal, 'utf8')).includes('Retained')).toBe(true);
    expect(await readFile(primary)).toEqual(previous); vi.mocked(rename).mockImplementation(actual.rename);
    await vault.flush(); expect(await readFile(backup)).toEqual(previous); expect(JSON.parse(await readFile(primary, 'utf8')).threads[0].messages[0].content).toBe('Retained');
  });
  it('excludes temporary checkpoints from both persistent files and the journal while retaining the live temporary message', async () => {
    const { vault, directory, primary, backup, journal } = await fixture();
    await vault.update(draft => { draft.threads.push(sampleThread({ id: 'temporary', temporary: true, messages: [message('PRIVATE_TEMP_BEFORE')] })); });
    await vault.checkpointMessages([{ threadId: 'temporary', message: message('PRIVATE_TEMP_AFTER') }, { threadId: 'thread', message: message('Regular') }]);
    for (const path of [primary, backup, journal]) expect((await readFile(path, 'utf8')).includes('PRIVATE_TEMP')).toBe(false);
    expect(vault.snapshot().threads[1].messages[0].content).toBe('PRIVATE_TEMP_AFTER');
    const restored = new WorkspaceVault(directory, codec); await restored.initialize(); expect(restored.snapshot().threads).toHaveLength(1); expect(restored.snapshot().threads[0].messages[0].content).toBe('Regular');
  });
  it('recovers running text after an abrupt exit and materializes stopped status with the exact running checkpoint as backup', async () => {
    const { vault, directory, primary, backup, journal } = await fixture();
    await vault.checkpointMessages([{ threadId: 'thread', message: message('Abrupt partial', 'running') }]); const running = JSON.stringify(vault.snapshot(), null, 2);
    const restored = new WorkspaceVault(directory, codec); await restored.initialize();
    expect(restored.snapshot().threads[0].messages[0]).toMatchObject({ content: 'Abrupt partial', status: 'stopped' });
    expect(await readFile(backup, 'utf8')).toBe(running); expect(JSON.parse(await readFile(primary, 'utf8')).threads[0].messages[0].status).toBe('stopped');
    await expect(readFile(journal)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it.each(['owner', 'duplicate', 'index', 'temporary', 'syntax'])('rejects a malformed bound journal (%s) without logging private data or altering any stored bytes', async kind => {
    const { vault, directory, primary, journal } = await fixture(); await vault.checkpointMessages([{ threadId: 'thread', message: message('PRIVATE_CHECKPOINT_TEXT') }]);
    const saved = JSON.parse(await readFile(journal, 'utf8'));
    if (kind === 'owner') saved.threads[0].thread.id = 'missing';
    if (kind === 'duplicate') saved.threads.push(saved.threads[0]);
    if (kind === 'index') saved.threads[0].index = 9999;
    if (kind === 'temporary') saved.threads[0].thread.temporary = true;
    await writeFile(journal, kind === 'syntax' ? '{PRIVATE_INVALID_CHECKPOINT' : JSON.stringify(saved));
    const bytes = await readFile(journal); const base = await readFile(primary);
    const restored = new WorkspaceVault(directory, codec); const error = await restored.initialize().catch(error => error);
    expect(error).toBeInstanceOf(Error); expect(error.message).toContain('Saved response checkpoints could not be read'); expect(error.cause).toBeUndefined();
    expect(await readFile(journal)).toEqual(bytes); expect(await readFile(primary)).toEqual(base);
  });
  it('ignores a journal with a different valid base digest and preserves the current primary revision', async () => {
    const { vault, directory, journal } = await fixture(); await vault.checkpointMessages([{ threadId: 'thread', message: message('Stale') }]);
    const saved = JSON.parse(await readFile(journal, 'utf8')); saved.baseSha256 = 'a'.repeat(64); await writeFile(journal, JSON.stringify(saved));
    const restored = new WorkspaceVault(directory, codec); await restored.initialize(); expect(restored.snapshot().threads[0].messages[0].content).toBe('Before');
  });
  it('uses ordinary atomic persistence when a filesystem cannot provide an independent primary file identity', async () => {
    const { vault, primary, journal } = await fixture(); const info = await stat(primary, { bigint: true });
    Object.defineProperty(info, 'ino', { value: 0n }); vi.mocked(stat).mockResolvedValueOnce(info as unknown as Awaited<ReturnType<typeof stat>>);
    await vault.checkpointMessages([{ threadId: 'thread', message: message('Fallback') }]);
    expect(JSON.parse(await readFile(primary, 'utf8')).threads[0].messages[0].content).toBe('Fallback'); await expect(readFile(journal)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('falls back to the full primary for an oversized active history and rejects oversized recovery files before parsing', async () => {
    const { vault, directory, primary, journal } = await fixture();
    await vault.update(draft => { draft.threads[0].messages = Array.from({ length: 3 }, (_, index) => ({ ...message('x'.repeat(3000000)), id: index ? `other-${index}` : 'reply' })); });
    await vault.checkpointMessages([{ threadId: 'thread', message: message('y'.repeat(3000000)) }]);
    expect(JSON.parse(await readFile(primary, 'utf8')).threads[0].messages[0].content.length).toBe(3000000); await expect(readFile(journal)).rejects.toMatchObject({ code: 'ENOENT' });
    await writeFile(journal, Buffer.alloc(8 * 1024 * 1024 + 1, 32));
    await expect(new WorkspaceVault(directory, codec).initialize()).rejects.toThrow('Saved response checkpoints could not be read');
  });
});
