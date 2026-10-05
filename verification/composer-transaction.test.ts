import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { composerDraftSchema, workspaceSchema } from '../contracts/workspace';
import { WorkspaceVault, type ComposerTransaction } from '../desktop/services/vault';
import { codec, sampleThread, testVault } from './fixtures';

const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function setup() { const context = await testVault(); directories.push(context.directory); await context.vault.update(state => { state.threads.push(sampleThread()); }); return context; }
const draft = (text = '中文草稿 😀') => composerDraftSchema.parse({ threadId: 'thread', text, updatedAt: 1 });

describe('bounded composer transactions', () => {
  it('keeps canonical bytes, exact previous backup and restart recovery without cloning full histories', async () => {
    const { vault, directory } = await setup();
    await vault.update(state => { state.threads[0].messages.push({ id: 'large', role: 'user', content: '保留历史😀'.repeat(100_000), attachments: [], createdAt: 1, status: 'complete' }); });
    const before = vault.snapshot(); const expected = workspaceSchema.parse({ ...before, composerDrafts: [draft()], activeThreadId: 'thread' });
    const clones = vi.spyOn(globalThis, 'structuredClone'); const snapshot = vi.spyOn(vault, 'snapshot');
    await vault.commitComposer(state => { state.composerDrafts = [draft()]; state.activeThreadId = 'thread'; });
    expect(snapshot).not.toHaveBeenCalled();
    expect(clones.mock.calls.some(([value]) => value && typeof value === 'object' && ('schemaVersion' in value || 'messages' in value))).toBe(false);
    clones.mockRestore(); snapshot.mockRestore();
    expect(vault.snapshot()).toEqual(expected);
    expect((await readFile(join(directory, 'workspace.backup.json'))).equals(Buffer.from(JSON.stringify(before, null, 2)))).toBe(true);
    const restarted = new WorkspaceVault(directory, codec); await restarted.initialize(); expect(restarted.snapshot()).toEqual(expected);
    await vault.flush(); expect((await readFile(join(directory, 'workspace.json'))).equals(Buffer.from(JSON.stringify(expected, null, 2)))).toBe(true);
  });

  it('protects histories, metadata and committed drafts from callback-held references', async () => {
    const { vault } = await setup(); const before = vault.snapshot(); let held!: ComposerTransaction;
    await vault.commitComposer(state => {
      held = state;
      (state.threads[0] as { id: string }).id = 'changed-copy';
      (state as unknown as { notes: unknown[] }).notes = [];
      state.composerDrafts = [draft()];
    });
    held.composerDrafts[0].text = 'changed after acknowledgement';
    expect(vault.snapshot().threads).toEqual(before.threads); expect(vault.snapshot().notes).toEqual(before.notes);
    expect(vault.snapshot().composerDrafts).toEqual([draft()]);
  });

  it('retains generic transaction ordering and clears the active owner durably', async () => {
    const { vault, directory } = await setup(); const seen: string[] = [];
    const one = vault.update(state => { state.threads[0].title = 'Latest'; state.threads.push(sampleThread({ id: 'second' })); seen.push('generic'); });
    const two = vault.commitComposer(state => { expect(state.threads.some(thread => thread.id === 'second')).toBe(true); seen.push('composer'); state.activeThreadId = 'second'; state.composerDrafts = [draft()]; });
    const three = vault.update(state => { seen.push(state.activeThreadId!); state.notes.push({ id: 'note', title: 'Note', content: 'Keep', createdAt: 1 }); });
    await Promise.all([one, two, three]); expect(seen).toEqual(['generic', 'composer', 'second']);
    await vault.commitComposer(state => { delete state.activeThreadId; state.composerDrafts = []; });
    const restarted = new WorkspaceVault(directory, codec); await restarted.initialize();
    expect(restarted.snapshot().activeThreadId).toBeUndefined(); expect(restarted.snapshot().composerDrafts).toEqual([]);
    expect(restarted.snapshot().notes).toHaveLength(1); expect(restarted.snapshot().threads[0].title).toBe('Latest');
  });

  it('rejects invalid drafts and callback errors before writes, and recovers after actual filesystem failure', async () => {
    const { vault, directory } = await setup(); const before = vault.snapshot(); const primary = join(directory, 'workspace.json'); const bytes = await readFile(primary);
    await expect(vault.commitComposer(state => { state.composerDrafts = [draft(), draft()]; })).rejects.toThrow('unique owners');
    await expect(vault.commitComposer(state => { state.activeThreadId = 'x'.repeat(129); })).rejects.toThrow();
    await expect(vault.commitComposer(() => { throw new Error('callback failed'); })).rejects.toThrow('callback failed');
    expect(await readFile(primary)).toEqual(bytes); expect(vault.snapshot()).toEqual(before);
    const backup = join(directory, 'workspace.backup.json'); const held = join(directory, 'held-backup.json'); await rename(backup, held); await mkdir(backup);
    try {
      await expect(vault.commitComposer(state => { state.composerDrafts = [draft()]; })).rejects.toThrow('could not be saved');
      expect(vault.snapshot()).toEqual(before); expect(await readFile(primary)).toEqual(bytes);
    } finally { await rm(backup, { recursive: true }); await rename(held, backup); }
    await vault.commitComposer(state => { state.composerDrafts = [draft()]; }); expect(vault.snapshot().composerDrafts).toEqual([draft()]);
  });
});
