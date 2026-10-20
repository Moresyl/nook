import { createHash } from 'node:crypto';
import { mkdir, rename, rm } from 'node:fs/promises';
import { readWorkspaceFile as readFile } from './read-workspace-file';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pinnedReorderSchema } from '../contracts/pinned-order';
import { conversationHistory } from '../contracts/conversations';
import { composerDraftSchema, searchThreads, threadSchema, type Thread } from '../contracts/workspace';
import { reorderPinnedThread } from '../desktop/services/pinned-order';
import { WorkspaceVault } from '../desktop/services/vault';
import { ConversationEngine } from '../desktop/services/conversation-engine';
import { archiveConversation } from '../desktop/services/conversation-archive';
import { ExtensionSettings } from '../desktop/services/extension-settings';
import { LocalSkills } from '../desktop/services/local-skills';
import { codec, request, sampleThread, testVault } from './fixtures';

const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const pinned = (id: string, updatedAt: number, extra: Partial<Thread> = {}) => sampleThread({ id, title: id, pinned: true, updatedAt, ...extra });
const ids = (threads: Thread[]) => searchThreads(threads.filter(thread => thread.pinned && !thread.archived), '').map(thread => thread.id);
const withoutOrder = (threads: Thread[]) => threads.map(thread => { const copy = structuredClone(thread); delete copy.pinOrder; return copy; });
async function setup(threads = [pinned('a', 3), pinned('b', 2), pinned('c', 1), sampleThread({ id: 'ordinary' }), pinned('archive', 9, { archived: true })]) {
  const context = await testVault(); directories.push(context.directory);
  await context.vault.update(state => { state.threads = threads; state.activeThreadId = threads[0]?.id; state.composerDrafts = [composerDraftSchema.parse({ threadId: threads[0]?.id, text: 'UNSENT_KEEP', attachments: [{ id: 'file', name: '资料.txt', content: 'ATTACHMENT_KEEP' }], updatedAt: 1 })]; });
  return context;
}

describe('saved pinned conversation order', () => {
  it('accepts legacy histories and validates bounded metadata and exact requests', () => {
    expect(threadSchema.parse(sampleThread())).not.toHaveProperty('pinOrder');
    for (const pinOrder of [0, 9999]) expect(threadSchema.parse(sampleThread({ pinOrder })).pinOrder).toBe(pinOrder);
    for (const pinOrder of [-1, 10000, 0.5, '1', null]) expect(threadSchema.safeParse({ ...sampleThread(), pinOrder }).success).toBe(false);
    expect(pinnedReorderSchema.parse({ threadId: '__proto__', targetId: 'target', position: 'before' })).toEqual({ threadId: '__proto__', targetId: 'target', position: 'before' });
    for (const raw of [{ threadId: '', targetId: 'b', position: 'before' }, { threadId: 'a\0', targetId: 'b', position: 'before' }, { threadId: 'a', targetId: 'b'.repeat(129), position: 'after' }, { threadId: 'a', targetId: 'b', position: 'left' }, { threadId: 'a', targetId: 'b', position: 'after', messages: [] }]) expect(pinnedReorderSchema.safeParse(raw).success).toBe(false);
  });
  it('moves before and after without changing histories, timestamps, drafts, selection or archive metadata', async () => {
    const { vault } = await setup(); const before = vault.snapshot();
    const first = await reorderPinnedThread(vault, { threadId: 'c', targetId: 'a', position: 'before' }); expect(ids(first.threads)).toEqual(['c', 'a', 'b']);
    const next = await reorderPinnedThread(vault, { threadId: 'c', targetId: 'b', position: 'after' }); expect(ids(next.threads)).toEqual(['a', 'b', 'c']);
    expect(withoutOrder(next.threads)).toEqual(before.threads); expect(next.composerDrafts).toEqual(before.composerDrafts); expect(next.activeThreadId).toBe(before.activeThreadId);
    expect(next.threads.find(thread => thread.id === 'archive')).not.toHaveProperty('pinOrder');
    expect(next.threads.find(thread => thread.id === 'ordinary')).not.toHaveProperty('pinOrder');
  });
  it('keeps adjacent no-op moves byte-identical without manufacturing ordering metadata', async () => {
    const { vault, directory } = await setup(); const before = vault.snapshot(); const bytes = await readFile(join(directory, 'workspace.json'));
    expect(await reorderPinnedThread(vault, { threadId: 'a', targetId: 'b', position: 'before' })).toEqual(before);
    expect(await readFile(join(directory, 'workspace.json'))).toEqual(bytes);
  });
  it('uses saved ordering for filtered search while unpinned results still use recency', () => {
    const rows = [pinned('match-a', 100, { pinOrder: 1 }), pinned('match-b', 1, { pinOrder: 0 }), sampleThread({ id: 'old', title: 'match-old', pinOrder: 0, updatedAt: 0 }), sampleThread({ id: 'new', title: 'match-new', updatedAt: 200 }), pinned('excluded', 999)];
    expect(searchThreads(rows, 'match').map(thread => thread.id)).toEqual(['match-b', 'match-a', 'new', 'old']);
    expect(rows[0].id).toBe('match-a');
  });
  it('retains order after disk restart and backup restoration with new identifiers', async () => {
    const { vault, directory } = await setup(); await reorderPinnedThread(vault, { threadId: 'c', targetId: 'a', position: 'before' }); const expected = vault.snapshot();
    const reopened = new WorkspaceVault(directory, codec); await reopened.initialize(); expect(reopened.snapshot()).toEqual(expected);
    const settings = new ExtensionSettings(vault, new LocalSkills(join(directory, 'skills'))); const backup = await settings.backup();
    await vault.update(state => { state.threads = []; state.composerDrafts = []; delete state.activeThreadId; });
    const restored = await settings.restore(backup);
    expect(searchThreads(restored.threads.filter(thread => thread.pinned && !thread.archived), '').map(thread => thread.title)).toEqual(['c', 'a', 'b']);
    expect(restored.threads.map(thread => thread.messages)).toEqual(expected.threads.map(thread => thread.messages));
    expect(restored.composerDrafts[0].text).toBe('UNSENT_KEEP');
  });
  it('serializes reorder and concurrent message appends without dropping either change', async () => {
    const { vault } = await setup();
    await Promise.all([reorderPinnedThread(vault, { threadId: 'b', targetId: 'a', position: 'before' }), vault.update(state => { state.threads.find(thread => thread.id === 'b')!.messages.push({ id: 'concurrent', role: 'assistant', content: 'STREAM_KEEP', createdAt: 10, status: 'running', attachments: [] }); }), reorderPinnedThread(vault, { threadId: 'c', targetId: 'a', position: 'before' })]);
    expect(ids(vault.snapshot().threads)).toEqual(['b', 'c', 'a']); expect(vault.snapshot().threads.find(thread => thread.id === 'b')?.messages.at(-1)?.content).toBe('STREAM_KEEP');
  });
  it.each(['send', 'retry'])('retains newer ordering across a stale %s snapshot and an actual held stream', async action => {
    const { vault } = await setup(); await vault.update(state => { state.threads.find(thread => thread.id === 'b')!.messages = [{ id: 'question', role: 'user', content: 'QUESTION_KEEP', createdAt: 1, status: 'complete', attachments: [] }, { id: 'answer', role: 'assistant', content: 'ANSWER_KEEP', createdAt: 2, status: 'complete', attachments: [] }]; });
    let releaseCommit!: () => void, captured!: () => void, releaseStream!: () => void;
    const heldCommit = new Promise<void>(resolve => { releaseCommit = resolve; }), snapshotCaptured = new Promise<void>(resolve => { captured = resolve; }), heldStream = new Promise<void>(resolve => { releaseStream = resolve; });
    const update = vault.commit.bind(vault); const spy = vi.spyOn(vault, 'commit').mockImplementationOnce(async change => { captured(); await heldCommit; return update(change); });
    const gateway = { stream: vi.fn(async (_input, onText) => { onText('STREAM_BEFORE'); await heldStream; onText('STREAM_AFTER'); }) }; const engine = new ConversationEngine(vault, gateway, () => {});
    const thread = vault.snapshot().threads.find(thread => thread.id === 'b')!;
    const pending = engine.start({ ...request, threadId: 'b', ...(action === 'retry' ? { replay: { action: 'retry' as const, messageId: 'question', revision: createHash('sha256').update(conversationHistory(thread)).digest('hex') } } : {}) });
    try { await snapshotCaptured; await reorderPinnedThread(vault, { threadId: 'b', targetId: 'a', position: 'before' }); releaseCommit(); await pending; expect(vault.snapshot().threads.find(thread => thread.id === 'b')?.pinOrder).toBe(0); await reorderPinnedThread(vault, { threadId: 'b', targetId: 'c', position: 'after' }); releaseStream(); await engine.settle('b'); expect(ids(vault.snapshot().threads)).toEqual(['a', 'c', 'b']); expect(vault.snapshot().threads.find(thread => thread.id === 'b')?.messages.at(-1)?.content).toBe('STREAM_BEFORESTREAM_AFTER'); }
    finally { releaseCommit(); releaseStream(); await pending.catch(() => {}); await engine.settle('b'); spy.mockRestore(); }
  });
  it('rejects stale, unpinned, archived, self and duplicate destinations without changing disk data', async () => {
    const { vault, directory } = await setup(); const before = vault.snapshot(), bytes = await readFile(join(directory, 'workspace.json'));
    for (const [threadId, targetId] of [['missing', 'a'], ['a', 'missing'], ['ordinary', 'a'], ['a', 'archive'], ['a', 'a']]) await expect(reorderPinnedThread(vault, { threadId, targetId, position: 'after' })).rejects.toThrow(/list changed|different pinned/);
    expect(() => reorderPinnedThread(vault, { threadId: 'a', targetId: 'b', position: 'sideways' })).toThrow(); expect(vault.snapshot()).toEqual(before); expect(await readFile(join(directory, 'workspace.json'))).toEqual(bytes);
    await vault.update(state => { state.threads.push(sampleThread({ id: 'a', title: 'PRIVATE_TITLE' })); }); await expect(reorderPinnedThread(vault, { threadId: 'a', targetId: 'b', position: 'before' })).rejects.toThrow('duplicate conversation IDs');
  });
  it('retains live state after a real write failure and supports retry', async () => {
    const { vault, directory } = await setup(); const before = vault.snapshot(), path = join(directory, 'workspace.json'), retained = join(directory, 'retained.json'); await rename(path, retained); await mkdir(path);
    try { await expect(reorderPinnedThread(vault, { threadId: 'b', targetId: 'a', position: 'before' })).rejects.toThrow(); expect(vault.snapshot()).toEqual(before); }
    finally { await rm(path, { recursive: true }); await rename(retained, path); }
    expect(ids((await reorderPinnedThread(vault, { threadId: 'b', targetId: 'a', position: 'before' })).threads)).toEqual(['b', 'a', 'c']);
  });
  it('never persists temporary chat identities, content or ranks into history and backup', async () => {
    const { vault, directory } = await setup(); await vault.update(state => { state.threads.push(pinned('temporary-secret', 10, { temporary: true, title: 'PRIVATE_TEMP_TITLE' })); });
    await reorderPinnedThread(vault, { threadId: 'temporary-secret', targetId: 'c', position: 'after' });
    expect(ids(vault.snapshot().threads)).toEqual(['a', 'b', 'c', 'temporary-secret']);
    expect(JSON.stringify(vault.backup())).not.toContain('PRIVATE_TEMP_TITLE'); expect(await readFile(join(directory, 'workspace.json'), 'utf8')).not.toContain('temporary-secret');
    const reopened = new WorkspaceVault(directory, codec); await reopened.initialize(); expect(ids(reopened.snapshot().threads)).toEqual(['a', 'b', 'c']);
  });
  it('drops inherited pin ranks on reply archives', async () => {
    const { vault } = await setup([pinned('a', 1, { pinOrder: 4 })]); await vault.update(state => { const archive = archiveConversation(state, state.threads[0], 'question', 'reply', 5); expect(archive).not.toHaveProperty('pinOrder'); expect(state.threads[0].pinOrder).toBe(4); });
  });
  it('handles the actual 10,000-chat limit without losing members', async () => {
    const { vault } = await setup(Array.from({ length: 10000 }, (_, index) => pinned(String(index), 10000 - index)));
    const next = await reorderPinnedThread(vault, { threadId: '9999', targetId: '0', position: 'before' });
    expect(ids(next.threads).slice(0, 3)).toEqual(['9999', '0', '1']); expect(new Set(ids(next.threads)).size).toBe(10000); expect(next.threads.find(thread => thread.id === '9998')?.pinOrder).toBe(9999);
  });
});
