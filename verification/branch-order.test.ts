import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { branchReorderSchema, conversationBranches } from '../contracts/conversation-branches';
import { conversationHistory } from '../contracts/conversations';
import { composerDraftSchema, threadSchema, workspaceSchema, type Thread } from '../contracts/workspace';
import { reorderConversationBranch } from '../desktop/services/branch-order';
import { WorkspaceBackupFiles } from '../desktop/services/backup-files';
import { archiveConversation } from '../desktop/services/conversation-archive';
import { ConversationEngine } from '../desktop/services/conversation-engine';
import { ExtensionSettings } from '../desktop/services/extension-settings';
import { LocalSkills } from '../desktop/services/local-skills';
import { WorkspaceVault } from '../desktop/services/vault';
import { codec, request, sampleThread, testVault } from './fixtures';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
const child = (id: string, createdAt: number, parent = 'root', extra: Partial<Thread> = {}) => sampleThread({ id, createdAt, forkedFrom: { threadId: parent, messageId: 'question', kind: 'branch' }, ...extra });
const ids = (threads: Thread[], current = 'root') => conversationBranches(threads, current).map((node) => node.thread.id);
const withoutOrder = (threads: Thread[]) => threads.map((thread) => { const copy = structuredClone(thread); delete copy.branchOrder; return copy; });
async function setup(threads = [sampleThread({ id: 'root' }), child('a', 2), child('b', 3), child('leaf', 4, 'b'), child('c', 5), sampleThread({ id: 'other' })]) {
  const context = await testVault(); directories.push(context.directory);
  await context.vault.update((state) => {
    state.threads = threads; state.activeThreadId = threads[0]?.id;
    state.composerDrafts = [composerDraftSchema.parse({ threadId: threads[0]?.id, text: 'UNSENT_KEEP', attachments: [{ id: 'file', name: '资料.txt', content: 'ATTACHMENT_KEEP' }], updatedAt: 1 })];
  });
  return context;
}

describe('persisted sibling branch ordering', () => {
  it('accepts legacy snapshots without a default ordinal and validates exact bounded metadata and requests', () => {
    expect(threadSchema.parse(sampleThread())).not.toHaveProperty('branchOrder');
    for (const branchOrder of [0, 9999]) expect(threadSchema.parse(sampleThread({ branchOrder })).branchOrder).toBe(branchOrder);
    for (const branchOrder of [-1, 10_000, 0.5, '1', null]) expect(threadSchema.safeParse({ ...sampleThread(), branchOrder }).success).toBe(false);
    expect(branchReorderSchema.parse({ threadId: '__proto__', direction: 'reset' })).toEqual({ threadId: '__proto__', direction: 'reset' });
    for (const raw of [{ threadId: '', direction: 'up' }, { threadId: 'a\0', direction: 'up' }, { threadId: 'a'.repeat(129), direction: 'up' }, { threadId: 'a', direction: 'left' }, { threadId: 'a', direction: 'up', messages: [] }]) expect(branchReorderSchema.safeParse(raw).success).toBe(false);
  });
  it('moves whole sibling subtrees, preserves exact contexts, drafts and selection, and resets only that level', async () => {
    const { vault } = await setup(); const before = vault.snapshot();
    let next = await reorderConversationBranch(vault, { threadId: 'b', direction: 'up' }); expect(ids(next.threads)).toEqual(['root', 'b', 'leaf', 'a', 'c']);
    expect(withoutOrder(next.threads)).toEqual(before.threads); expect(next.composerDrafts).toEqual(before.composerDrafts); expect(next.activeThreadId).toBe('root'); expect(next.threads.find((thread) => thread.id === 'leaf')).not.toHaveProperty('branchOrder');
    next = await reorderConversationBranch(vault, { threadId: 'b', direction: 'down' }); expect(ids(next.threads)).toEqual(ids(before.threads));
    next = await reorderConversationBranch(vault, { threadId: 'a', direction: 'reset' }); expect(next).toEqual(before);
  });
  it('retains order after actual disk restart without changing the stored conversation array or timestamps', async () => {
    const { vault, directory } = await setup(); const expected = await reorderConversationBranch(vault, { threadId: 'c', direction: 'up' });
    const reopened = new WorkspaceVault(directory, codec); await reopened.initialize(); expect(reopened.snapshot()).toEqual(expected); expect(ids(reopened.snapshot().threads)).toEqual(['root', 'a', 'c', 'b', 'leaf']);
    expect(workspaceSchema.parse(JSON.parse(await readFile(join(directory, 'workspace.json'), 'utf8'))).threads.map((thread) => thread.id)).toEqual(['root', 'a', 'b', 'leaf', 'c', 'other']);
  });
  it.each(['json', 'json.gz'])('preserves ordered ancestry and independent drafts through actual %s backup and fresh-ID restoration', async (extension) => {
    const { vault, directory } = await setup(); await reorderConversationBranch(vault, { threadId: 'b', direction: 'up' }); const expected = vault.snapshot();
    const settings = new ExtensionSettings(vault, new LocalSkills(join(directory, 'skills'))); const files = new WorkspaceBackupFiles();
    try {
      const path = join(directory, `ordered.${extension}`); await files.write(path, await settings.backup()); const backup = await files.read(path);
      await vault.update((state) => { state.threads = []; state.composerDrafts = []; delete state.activeThreadId; }); const restored = await settings.restore(backup);
      const root = restored.threads.find((thread) => thread.title === expected.threads[0].title && !thread.forkedFrom && thread.branchOrder === undefined)!;
      expect(restored.threads.map((thread) => thread.branchOrder)).toEqual(expected.threads.map((thread) => thread.branchOrder));
      expect(restored.threads.map((thread) => thread.messages)).toEqual(expected.threads.map((thread) => thread.messages));
      expect(ids(restored.threads, root.id).map((id) => restored.threads.find((thread) => thread.id === id)!.createdAt)).toEqual([1, 3, 4, 2, 5]); expect(restored.composerDrafts[0].text).toBe('UNSENT_KEEP');
    } finally { await files.shutdown(); }
  });
  it('reorders surviving roots sharing a deleted parent while retaining unrelated roots and child-level ordinals', async () => {
    const { vault } = await setup([child('a', 1, 'deleted'), child('b', 2, 'deleted'), child('leaf', 3, 'a', { branchOrder: 4 }), sampleThread({ id: 'other', branchOrder: 7 })]);
    const next = await reorderConversationBranch(vault, { threadId: 'b', direction: 'up' }); expect(ids(next.threads, 'a')).toEqual(['b', 'a', 'leaf']); expect(next.threads.find((thread) => thread.id === 'other')?.branchOrder).toBe(7);
    const reset = await reorderConversationBranch(vault, { threadId: 'a', direction: 'reset' }); expect(ids(reset.threads, 'a')).toEqual(['a', 'leaf', 'b']); expect(reset.threads.find((thread) => thread.id === 'leaf')?.branchOrder).toBe(4);
  });
  it('uses the display cycle cut without rewriting stored parent links', async () => {
    const threads = [child('a', 1, 'b'), child('b', 2, 'a'), child('c', 3, 'a')]; const { vault } = await setup(threads);
    const next = await reorderConversationBranch(vault, { threadId: 'c', direction: 'up' }); expect(ids(next.threads, 'a')).toEqual(['a', 'c', 'b']); expect(withoutOrder(next.threads)).toEqual(threads);
  });
  it('serializes competing metadata changes with a concurrent message update without overwriting context', async () => {
    const { vault } = await setup();
    await Promise.all([reorderConversationBranch(vault, { threadId: 'b', direction: 'up' }), vault.update((state) => { state.threads.find((thread) => thread.id === 'b')!.messages.push({ id: 'concurrent', role: 'assistant', content: 'NEW_CONTEXT_KEEP', createdAt: 10, status: 'running', attachments: [] }); }), reorderConversationBranch(vault, { threadId: 'c', direction: 'up' })]);
    expect(ids(vault.snapshot().threads)).toEqual(['root', 'b', 'leaf', 'c', 'a']); expect(vault.snapshot().threads.find((thread) => thread.id === 'b')!.messages.at(-1)?.content).toBe('NEW_CONTEXT_KEEP'); expect(vault.snapshot().composerDrafts[0].text).toBe('UNSENT_KEEP');
  });
  it.each(['send', 'retry'])('retains a newer order when %s start commits after a captured snapshot and through an actual held stream', async (action) => {
    const { vault } = await setup(); await vault.update((state) => { state.threads.find((thread) => thread.id === 'b')!.messages = [{ id: 'question', role: 'user', content: 'QUESTION_KEEP', createdAt: 1, status: 'complete', attachments: [] }, { id: 'answer', role: 'assistant', content: 'ANSWER_KEEP', createdAt: 2, status: 'complete', attachments: [] }]; });
    let releaseCommit!: () => void; let captured!: () => void; let releaseStream!: () => void;
    const heldCommit = new Promise<void>((resolve) => { releaseCommit = resolve; }); const snapshotCaptured = new Promise<void>((resolve) => { captured = resolve; }); const heldStream = new Promise<void>((resolve) => { releaseStream = resolve; });
    const update = vault.update.bind(vault); const spy = vi.spyOn(vault, 'update').mockImplementationOnce(async (change) => { captured(); await heldCommit; return update(change); });
    const gateway = { stream: vi.fn(async (_input, onText) => { onText('STREAM_BEFORE'); await heldStream; onText('STREAM_AFTER'); }) }; const engine = new ConversationEngine(vault, gateway, () => {});
    const thread = vault.snapshot().threads.find((thread) => thread.id === 'b')!;
    const pending = engine.start({ ...request, threadId: 'b', ...(action === 'retry' ? { replay: { action: 'retry' as const, messageId: 'question', revision: createHash('sha256').update(conversationHistory(thread)).digest('hex') } } : {}) });
    try {
      await snapshotCaptured; await reorderConversationBranch(vault, { threadId: 'b', direction: 'up' }); releaseCommit(); await pending;
      expect(vault.snapshot().threads.find((thread) => thread.id === 'b')?.branchOrder).toBe(0);
      await reorderConversationBranch(vault, { threadId: 'b', direction: 'down' }); releaseStream(); await engine.settle('b');
      expect(vault.snapshot().threads.find((thread) => thread.id === 'b')).toMatchObject({ branchOrder: 1, messages: expect.arrayContaining([expect.objectContaining({ content: 'STREAM_BEFORESTREAM_AFTER', status: 'complete' })]) }); expect(gateway.stream).toHaveBeenCalledOnce(); expect(vault.snapshot().composerDrafts[0].text).toBe('UNSENT_KEEP');
    } finally { releaseCommit(); releaseStream(); await pending.catch(() => {}); await engine.settle('b'); spy.mockRestore(); }
  });
  it('rejects boundary, stale and malformed operations before disk changes and keeps private message text out of errors', async () => {
    const { vault, directory } = await setup(); const before = vault.snapshot(); const bytes = await readFile(join(directory, 'workspace.json'));
    for (const input of [{ threadId: 'a', direction: 'up' }, { threadId: 'c', direction: 'down' }, { threadId: 'root', direction: 'up' }, { threadId: 'missing', direction: 'up' }]) await expect(reorderConversationBranch(vault, input)).rejects.toThrow(/edge|no longer exists/);
    expect(() => reorderConversationBranch(vault, { threadId: 'a', direction: 'sideways' })).toThrow(); expect(vault.snapshot()).toEqual(before); expect(await readFile(join(directory, 'workspace.json'))).toEqual(bytes);
    await vault.update((state) => { state.threads.push(sampleThread({ id: 'a', title: 'PRIVATE_MESSAGE_SECRET' })); }); await expect(reorderConversationBranch(vault, { threadId: 'a', direction: 'up' })).rejects.toThrow('duplicate conversation IDs');
  });
  it('retains exact live data after an actual destination write failure and permits the same reorder retry', async () => {
    const { vault, directory } = await setup(); const before = vault.snapshot(); const path = join(directory, 'workspace.json'); const retained = join(directory, 'retained.json'); await rename(path, retained); await mkdir(path);
    try { await expect(reorderConversationBranch(vault, { threadId: 'b', direction: 'up' })).rejects.toThrow(); expect(vault.snapshot()).toEqual(before); }
    finally { await rm(path, { recursive: true }); await rename(retained, path); }
    expect(await reorderConversationBranch(vault, { threadId: 'b', direction: 'up' })).toMatchObject({ activeThreadId: before.activeThreadId, composerDrafts: before.composerDrafts }); expect(ids(vault.snapshot().threads)).toEqual(['root', 'b', 'leaf', 'a', 'c']);
  });
  it('keeps temporary family order volatile in both history files, backups and actual restart', async () => {
    const { vault, directory } = await setup([sampleThread({ id: 'ordinary' })]); const before = await Promise.all(['workspace.json', 'workspace.backup.json'].map((name) => readFile(join(directory, name))));
    await vault.update((state) => { state.threads.push(sampleThread({ id: 'temporary', temporary: true }), child('ta', 2, 'temporary', { temporary: true }), child('tb', 3, 'temporary', { temporary: true })); });
    await reorderConversationBranch(vault, { threadId: 'tb', direction: 'up' }); expect(ids(vault.snapshot().threads, 'temporary')).toEqual(['temporary', 'tb', 'ta']); expect(vault.backup().threads.map((thread) => thread.id)).toEqual(['ordinary']);
    expect(await Promise.all(['workspace.json', 'workspace.backup.json'].map((name) => readFile(join(directory, name))))).toEqual(before); const reopened = new WorkspaceVault(directory, codec); await reopened.initialize(); expect(reopened.snapshot().threads.map((thread) => thread.id)).toEqual(['ordinary']);
  });
  it('retains every peer at the actual 10,000-thread limit with valid ordinals across the last position', async () => {
    const { vault } = await setup(Array.from({ length: 10_000 }, (_, index) => child(String(index), index, 'deleted'))); const next = await reorderConversationBranch(vault, { threadId: '9999', direction: 'up' });
    expect(ids(next.threads, '0').slice(-3)).toEqual(['9997', '9999', '9998']); expect(next.threads.find((thread) => thread.id === '9998')?.branchOrder).toBe(9999); expect(next.threads).toHaveLength(10_000);
  });
  it('appends newly archived and regenerated edit paths without inheriting a parent sibling ordinal', async () => {
    const original = sampleThread({ id: 'root', branchOrder: 8, providerId: request.providerId, messages: [{ id: 'question', role: 'user', content: 'ORIGINAL_CONTEXT_KEEP', createdAt: 1, status: 'complete', attachments: [] }, { id: 'answer', role: 'assistant', content: 'ORIGINAL_REPLY_KEEP', createdAt: 2, status: 'complete', attachments: [] }] });
    const { vault } = await setup([original]); await vault.update((state) => { const archive = archiveConversation(state, state.threads[0], 'question', 'reply', 5); expect(archive).not.toHaveProperty('branchOrder'); });
    const gateway = { stream: vi.fn(async (_input, onText) => { onText('EDITED_REPLY'); }) }; const engine = new ConversationEngine(vault, gateway, () => {});
    const result = await engine.start({ ...request, threadId: 'root', text: 'EDITED_CONTEXT', replay: { action: 'edit', messageId: 'question', revision: createHash('sha256').update(conversationHistory(original)).digest('hex') } }); await engine.settle(result.threadId);
    expect(vault.snapshot().threads.find((thread) => thread.id === result.threadId)).not.toHaveProperty('branchOrder'); expect(vault.snapshot().threads[0]).toEqual(original); expect(gateway.stream).toHaveBeenCalledOnce();
  });
});
