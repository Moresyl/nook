import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { threadMetadataSchema } from '../contracts/thread-metadata';
import { composerDraftSchema, type Thread } from '../contracts/workspace';
import { updateThreadMetadata } from '../desktop/services/thread-metadata';
import { WorkspaceVault } from '../desktop/services/vault';
import { codec, sampleThread, testVault } from './fixtures';
import { readWorkspaceFile as readFile } from './read-workspace-file';

const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const idle = () => {};
async function setup(threads: Thread[] = [sampleThread()]) {
  const context = await testVault(); directories.push(context.directory);
  await context.vault.update(state => { state.threads = threads; state.activeThreadId = threads[0]?.id; state.composerDrafts = [composerDraftSchema.parse({ threadId: threads[0]?.id, text: 'KEEP_DRAFT', attachments: [{ id: 'file', name: '资料.txt', content: 'KEEP_ATTACHMENT' }], updatedAt: 1 })]; });
  return context;
}

describe('conversation metadata updates', () => {
  it('accepts only bounded explicit metadata and trims names', () => {
    expect(threadMetadataSchema.parse({ id: 'thread', title: '  新名称  ', pinned: false })).toEqual({ id: 'thread', title: '新名称', pinned: false });
    for (const raw of [{ id: 'thread' }, { id: '' , pinned: true }, { id: 'x\0', archived: true }, { id: 'x'.repeat(129), pinned: true }, { id: 'thread', title: ' ' }, { id: 'thread', title: 'x'.repeat(161) }, { id: 'thread', title: 'valid', messages: [] }, { id: 'thread', pinned: 'true' }, { id: 'thread', archived: null }, { id: 'thread', pinOrder: 0 }, { id: 'thread', title: 'valid', temporary: true }]) expect(threadMetadataSchema.safeParse(raw).success).toBe(false);
  });
  it('preserves newer queued messages, pin rank, context and drafts when renaming', async () => {
    const { vault } = await setup([sampleThread({ pinned: true, pinOrder: 3 })]);
    const before = vault.snapshot();
    const appended = vault.update(state => { state.threads[0].messages.push({ id: 'new', role: 'assistant', content: 'NEW_REPLY', status: 'complete', createdAt: 3, attachments: [] }); state.threads[0].pinOrder = 1; });
    const renamed = updateThreadMetadata(vault, { id: 'thread', title: 'renamed' }, idle);
    await appended; const next = await renamed;
    expect(next.threads[0].messages[0].content).toBe('NEW_REPLY'); expect(next.threads[0].pinOrder).toBe(1); expect(next.threads[0].title).toBe('renamed');
    expect(next.composerDrafts).toEqual(before.composerDrafts); expect(next.activeThreadId).toBe(before.activeThreadId); expect(next.threads[0].createdAt).toBe(1);
  });
  it('changes independent flags without replacing other metadata and removes an unpinned rank', async () => {
    const { vault } = await setup([sampleThread({ pinned: true, pinOrder: 7, branchOrder: 2 })]);
    const next = await updateThreadMetadata(vault, { id: 'thread', pinned: false, archived: true }, idle);
    expect(next.threads[0]).toMatchObject({ pinned: false, archived: true, branchOrder: 2 }); expect(next.threads[0]).not.toHaveProperty('pinOrder');
    const restored = await updateThreadMetadata(vault, { id: 'thread', pinned: true, archived: false }, idle);
    expect(restored.threads[0]).toMatchObject({ pinned: true, archived: false, branchOrder: 2 }); expect(restored.threads[0]).not.toHaveProperty('pinOrder');
  });
  it('keeps no-op metadata and disk bytes unchanged', async () => {
    const { vault, directory } = await setup(); const before = vault.snapshot(); const path = join(directory, 'workspace.json'), bytes = await readFile(path);
    expect(await updateThreadMetadata(vault, { id: 'thread', title: before.threads[0].title, pinned: false, archived: false }, idle)).toEqual(before);
    expect(await readFile(path)).toEqual(bytes);
  });
  it('rejects missing and duplicated identities without mutation', async () => {
    for (const threads of [[], [sampleThread(), sampleThread()]]) {
      const { vault } = await setup(threads); const before = vault.snapshot();
      await expect(updateThreadMetadata(vault, { id: 'thread', title: 'changed' }, idle)).rejects.toThrow('missing or its identifier is duplicated'); expect(vault.snapshot()).toEqual(before);
    }
  });
  it('checks the running guard inside the queued transaction', async () => {
    const { vault } = await setup(); let running = false;
    const queued = vault.update(() => { running = true; });
    const change = updateThreadMetadata(vault, { id: 'thread', archived: true }, () => { if (running) throw new Error('busy'); });
    await queued; const before = vault.snapshot(); await expect(change).rejects.toThrow('busy'); expect(vault.snapshot()).toEqual(before);
  });
  it('also rejects a saved running message even when the external guard is idle', async () => {
    const { vault } = await setup([sampleThread({ messages: [{ id: 'run', role: 'assistant', content: '', status: 'running', createdAt: 3, attachments: [] }] })]); const before = vault.snapshot();
    await expect(updateThreadMetadata(vault, { id: 'thread', pinned: true }, idle)).rejects.toThrow('finish'); expect(vault.snapshot()).toEqual(before);
  });
  it('preserves live state on a real write failure and permits retry and disk reopening', async () => {
    const { vault, directory } = await setup(); const before = vault.snapshot(); const path = join(directory, 'workspace.json'), retained = join(directory, 'retained.json');
    await rename(path, retained); await mkdir(path);
    try { await expect(updateThreadMetadata(vault, { id: 'thread', title: 'retry' }, idle)).rejects.toThrow(); expect(vault.snapshot()).toEqual(before); }
    finally { await rm(path, { recursive: true }); await rename(retained, path); }
    await updateThreadMetadata(vault, { id: 'thread', title: 'retry' }, idle);
    const reopened = new WorkspaceVault(directory, codec); await reopened.initialize(); expect(reopened.snapshot().threads[0].title).toBe('retry'); expect(reopened.snapshot().composerDrafts).toEqual(before.composerDrafts);
  });
  it('keeps temporary conversation metadata out of the persistent workspace', async () => {
    const { vault, directory } = await setup([sampleThread({ id: 'private-thread', title: 'PRIVATE_OLD', temporary: true })]);
    expect((await updateThreadMetadata(vault, { id: 'private-thread', title: 'PRIVATE_NEW', pinned: true }, idle)).threads[0].title).toBe('PRIVATE_NEW');
    const saved = (await readFile(join(directory, 'workspace.json'))).toString(); expect(saved).not.toContain('private-thread'); expect(saved).not.toContain('PRIVATE_NEW');
  });
});
