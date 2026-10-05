import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { conversationRevision } from '../contracts/conversations';
import { messageDraftSchema, messageDraftsSchema, messageEditSchema, type MessageDraft } from '../contracts/message-edits';
import { emptyWorkspace, messageSchema, workspaceSchema, type Message } from '../contracts/workspace';
import { MessageEdits } from '../desktop/services/message-edits';
import { WorkspaceVault } from '../desktop/services/vault';
import { ComposerDrafts } from '../desktop/services/composer-drafts';
import { ConversationEngine } from '../desktop/services/conversation-engine';
import { ExtensionSettings } from '../desktop/services/extension-settings';
import { LocalSkills } from '../desktop/services/local-skills';
import { replyVersions } from '../contracts/reply-versions';
import { MessageDraftBuffer } from '../workbench/components/message-drafts';
import type { ModelGateway } from '../desktop/services/model-gateway';
import { codec, request, sampleThread, testVault } from './fixtures';

const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
const user: Message = { id: 'user', role: 'user', content: 'Original question', attachments: [{ id: 'file', name: 'evidence.txt', content: 'EXACT_ATTACHMENT' }], createdAt: 1, status: 'complete' };
const assistant: Message = { id: 'assistant', role: 'assistant', content: 'Original answer', attachments: [], createdAt: 2, status: 'complete', activities: [{ id: 'tool', name: 'read_file', input: '{}', output: 'EXACT_TOOL', status: 'complete', startedAt: 2 }], invocations: [{ round: 0, providerId: 'local', providerName: 'Local', providerKind: 'ollama', model: 'producing-model', destination: 'local', startedAt: 2, status: 'complete', tokens: { inputTokens: 5, outputTokens: 8, totalTokens: 13 } }] };
const savedDraft = (change: Partial<MessageDraft> = {}): MessageDraft => ({ threadId: 'thread', messageId: 'user', content: 'KEEP_EDIT', revision: 'a'.repeat(64), updatedAt: 3, ...change });
async function setup() {
  const context = await testVault(); directories.push(context.directory); const active = vi.fn(() => false); const edits = new MessageEdits(context.vault, active);
  await context.vault.update((state) => { state.threads.push(sampleThread({ messages: [user, assistant, { ...user, id: 'following-user', content: 'Later question' }, { ...assistant, id: 'following-assistant', content: 'Later answer' }] })); });
  const input = async (messageId = 'user', content = '  Edited 中文😀 $& {{literal}}\n') => ({ threadId: 'thread', messageId, content, revision: await conversationRevision(context.vault.snapshot().threads[0]) });
  return { ...context, active, edits, input };
}

describe('local message edits and durable editing drafts', () => {
  it('validates strict targets, revisions, exact text limits and legacy defaults', () => {
    expect(messageDraftSchema.parse(savedDraft({ content: '' })).content).toBe(''); expect(messageEditSchema.safeParse({ ...savedDraft(), updatedAt: undefined }).success).toBe(false);
    const { updatedAt: _time, ...edit } = savedDraft(); expect(messageEditSchema.parse(edit).content).toBe('KEEP_EDIT'); expect(messageEditSchema.safeParse({ ...edit, content: '  ' }).success).toBe(false);
    for (const change of [{ revision: 'bad' }, { threadId: 'a\0b' }, { messageId: '' }, { content: 'x'.repeat(4_000_001) }, { updatedAt: -1 }, { unexpected: true }]) expect(messageDraftSchema.safeParse({ ...savedDraft(), ...change }).success).toBe(false);
    expect(messageDraftsSchema.safeParse([savedDraft(), savedDraft()]).success).toBe(false); expect(messageDraftsSchema.parse([savedDraft(), savedDraft({ messageId: 'assistant' })])).toHaveLength(2);
    const old = emptyWorkspace(); delete (old as Partial<typeof old>).messageDrafts; expect(workspaceSchema.parse(old).messageDrafts).toEqual([]); expect(messageSchema.safeParse({ ...user, editedAt: -1 }).success).toBe(false);
    const state = { ...emptyWorkspace(), threads: [sampleThread({ messages: [user] })], messageDrafts: [savedDraft()] }; expect(workspaceSchema.safeParse(state).success).toBe(true);
    for (const change of [{ threadId: 'missing' }, { messageId: 'missing' }]) expect(workspaceSchema.safeParse({ ...state, messageDrafts: [savedDraft(change)] }).success).toBe(false);
  });
  it('saves independent empty or stale drafts, replaces only their owner and discards only the selected draft', async () => {
    const { edits, vault } = await setup(); await edits.saveDraft(savedDraft()); await edits.saveDraft(savedDraft({ messageId: 'assistant', content: '' })); await edits.saveDraft(savedDraft({ content: 'NEW_DRAFT' }));
    expect(vault.snapshot().messageDrafts.map((draft) => draft.content)).toEqual(['NEW_DRAFT', '']); await edits.removeDraft({ threadId: 'thread', messageId: 'user' }); expect(vault.snapshot().messageDrafts).toEqual([savedDraft({ messageId: 'assistant', content: '' })]);
    await expect(edits.saveDraft(savedDraft({ messageId: 'missing' }))).rejects.toThrow('no longer exists'); await expect(edits.saveDraft(savedDraft({ content: 'x'.repeat(256_001) }))).rejects.toThrow('256 KB');
  });
  it('retains every draft on count, UTF-8 byte quota or failed persistence without evicting owners', async () => {
    const { edits, vault } = await setup(); await vault.update((state) => { state.threads[0].messages = Array.from({ length: 101 }, (_, index) => ({ ...assistant, id: `message-${index}` })); state.messageDrafts = state.threads[0].messages.slice(0, 100).map((message) => savedDraft({ messageId: message.id })); });
    const before = vault.snapshot(); await expect(edits.saveDraft(savedDraft({ messageId: 'message-100' }))).rejects.toThrow('100 messages'); expect(vault.snapshot()).toEqual(before);
    await vault.update((state) => { state.messageDrafts = state.messageDrafts.slice(0, 5).map((draft) => ({ ...draft, content: '中'.repeat(2_000_000) })); }); const bytesBefore = vault.snapshot();
    await expect(edits.saveDraft(savedDraft({ messageId: 'message-5', content: '中'.repeat(2_000_000) }))).rejects.toThrow('32 MB'); expect(vault.snapshot()).toEqual(bytesBefore);
    expect(messageDraftsSchema.safeParse([...bytesBefore.messageDrafts, savedDraft({ messageId: 'message-5', content: '中'.repeat(2_000_000) })]).success).toBe(false);
    vi.spyOn(vault, 'update').mockRejectedValueOnce(new Error('Synthetic EIO')); await expect(edits.removeDraft({ threadId: 'thread', messageId: 'message-0' })).rejects.toThrow('EIO'); expect(vault.snapshot()).toEqual(bytesBefore);
  });
  it('updates only the selected user text in place and atomically retains the entire original path, following replies and composer draft', async () => {
    const { edits, vault, input } = await setup(); const composer = new ComposerDrafts(vault); await composer.save({ threadId: 'thread', text: 'UNSENT_COMPOSER', attachments: [], model: 'test-model', mode: 'chat', mcpServerIds: [], skillIds: [], pluginIds: [], updatedAt: 3 });
    await edits.saveDraft(savedDraft()); await edits.saveDraft(savedDraft({ messageId: 'assistant' })); const before = vault.snapshot().threads[0]; const next = await edits.edit(await input());
    expect(next.threads[0].id).toBe('thread'); expect(next.threads[0].messages[0]).toMatchObject({ content: '  Edited 中文😀 $& {{literal}}\n', attachments: user.attachments, createdAt: user.createdAt }); expect(next.threads[0].messages[0].id).not.toBe('user'); expect(next.threads[0].messages[0].editedAt).toBeGreaterThan(0);
    expect(next.threads[0].messages.slice(1)).toEqual(before.messages.slice(1)); const archive = next.threads[1]; expect(archive.messages).toEqual(before.messages); expect(archive).toMatchObject({ archived: true, pinned: false, forkedFrom: { threadId: 'thread', messageId: 'user', kind: 'message' } });
    expect(next.composerDrafts.map((draft) => draft.text)).toEqual(['UNSENT_COMPOSER', 'UNSENT_COMPOSER']); expect(next.messageDrafts.map((draft) => draft.messageId)).toEqual(['assistant']);
  });
  it('keeps actual model, tool and usage evidence on manually edited assistant versions and preserves separate old/new continuations', async () => {
    const { edits, vault, input } = await setup(); const next = await edits.edit(await input('assistant', 'Manual answer')); const edited = next.threads[0].messages[1]; const original = next.threads[1].messages[1];
    expect(edited.invocations).toEqual(assistant.invocations); expect(edited.activities).toEqual(assistant.activities); expect(original.content).toBe('Original answer'); expect(edited.replyVersion?.number).toBe(2); expect(original.replyVersion?.number).toBe(1); expect(replyVersions(next.threads, 'thread').get(edited.replyVersion!.groupId)).toHaveLength(2);
    const stream = vi.fn<ModelGateway['stream']>(async (_input, onText) => { onText('Continuation'); }); const engine = new ConversationEngine(vault, { stream }, vi.fn()); const newer = structuredClone(vault.snapshot().threads[0]);
    await engine.start({ ...request, threadId: next.threads[1].id, text: 'Old continuation' }); await engine.settle(next.threads[1].id); expect(stream.mock.calls[0][0].messages.map((message) => message.content)).toContain('Original answer'); expect(vault.snapshot().threads[0]).toEqual(newer);
    await engine.start({ ...request, threadId: 'thread', text: 'New continuation' }); await engine.settle('thread'); expect(stream.mock.calls[1][0].messages.map((message) => message.content)).toContain('Manual answer'); expect(stream.mock.calls[1][0].messages.map((message) => message.content)).not.toContain('Original answer');
    const latest = vault.snapshot().threads[0].messages[1]; const again = await edits.edit(await input(latest.id, 'Second manual answer')); expect(again.threads[0].messages[1].replyVersion?.number).toBe(3);
  });
  it('retains failure or stop provenance, accepts complete large assistant text and avoids a new archive for an unchanged save', async () => {
    const { edits, vault, input } = await setup(); const unchanged = await edits.edit(await input('user', user.content)); expect(unchanged.threads).toHaveLength(1); expect(unchanged.threads[0].messages[0].editedAt).toBeUndefined();
    await vault.update((state) => { state.threads[0].messages[1].status = 'error'; state.threads[0].messages[1].error = 'Original provider failure'; }); const next = await edits.edit(await input('assistant', 'x'.repeat(256_001))); expect(next.threads[0].messages[1]).toMatchObject({ status: 'error', error: 'Original provider failure' });
    await expect(edits.edit(await input(next.threads[0].messages[0].id, 'x'.repeat(256_001)))).rejects.toThrow('256 KB');
  });
  it('rejects stale or missing targets and active/reserved/running histories without changing saved edits', async () => {
    const { edits, vault, active, input } = await setup(); const edit = await input(); await edits.saveDraft(savedDraft({ revision: edit.revision })); const before = vault.snapshot();
    await expect(edits.edit({ ...edit, revision: 'f'.repeat(64) })).rejects.toThrow('changed'); await expect(edits.edit({ ...edit, threadId: 'missing' })).rejects.toThrow('no longer exists'); await expect(edits.edit({ ...edit, messageId: 'missing' })).rejects.toThrow('no longer exists'); active.mockReturnValue(true); await expect(edits.edit(edit)).rejects.toThrow('Stop'); expect(vault.snapshot()).toEqual(before);
    active.mockReturnValue(false); await vault.update((state) => { state.threads[0].messages[1].status = 'running'; }); await expect(edits.edit(await input())).rejects.toThrow('Stop');
  });
  it('rolls back archive, replacement and draft consumption after persistence failure and rechecks queued activity', async () => {
    const { edits, vault, directory, input, active } = await setup(); const edit = await input(); await edits.saveDraft(savedDraft({ revision: edit.revision })); const before = vault.snapshot(); const bytes = await readFile(join(directory, 'workspace.json'));
    vi.spyOn(vault, 'update').mockRejectedValueOnce(new Error('Synthetic EIO')); await expect(edits.edit(edit)).rejects.toThrow('EIO'); expect(vault.snapshot()).toEqual(before); expect(await readFile(join(directory, 'workspace.json'))).toEqual(bytes);
    const update = vault.update.bind(vault); let release!: () => void; const hold = new Promise<void>((resolve) => { release = resolve; }); vi.mocked(vault.update).mockImplementationOnce(async (change) => { await hold; return update(change); }); const pending = edits.edit(edit); active.mockReturnValue(true); release(); await expect(pending).rejects.toThrow('Stop'); expect(vault.snapshot()).toEqual(before);
  });
  it('prevents queued normal sends from overwriting changed or deleted conversation history and releases their reservation', async () => {
    const { vault } = await setup(); const stream = vi.fn(); const engine = new ConversationEngine(vault, { stream }, vi.fn()); const update = vault.commit.bind(vault);
    for (const deleted of [false, true]) {
      let release!: () => void; const hold = new Promise<void>((resolve) => { release = resolve; }); vi.spyOn(vault, 'commit').mockImplementationOnce(async (change) => { await hold; return update(change); });
      const pending = engine.start({ ...request, threadId: 'thread' }); await vi.waitFor(() => expect(engine.active()).toBe(true)); await vault.update((state) => { if (deleted) state.threads = []; else state.threads[0].messages[0].content = 'Concurrent saved edit'; }); release(); await expect(pending).rejects.toThrow('changed'); expect(engine.active()).toBe(false); expect(stream).not.toHaveBeenCalled(); vi.restoreAllMocks();
    }
  });
  it('moves replaced reply drafts into their complete archive and rebases only a current editing revision', async () => {
    const { vault, edits, input } = await setup(); const fresh = await input('following-assistant'); await edits.saveDraft(savedDraft({ messageId: 'following-assistant', revision: fresh.revision })); await edits.saveDraft(savedDraft({ messageId: 'assistant' }));
    const engine = new ConversationEngine(vault, { stream: vi.fn(async (_input, onText) => { onText('Regenerated answer'); }) }, vi.fn());
    await engine.start({ ...request, threadId: 'thread', replay: { messageId: 'following-user', revision: fresh.revision, action: 'retry' } }); await engine.settle('thread'); let state = vault.snapshot(); let draft = state.messageDrafts.find((item) => item.messageId === 'following-assistant')!; const archive = state.threads.find((thread) => thread.id === draft.threadId)!;
    expect(archive).toMatchObject({ archived: true, forkedFrom: { threadId: 'thread', kind: 'reply' } }); expect(archive.messages.at(-1)?.id).toBe('following-assistant'); expect(draft.content).toBe('KEEP_EDIT'); expect(draft.revision).toBe(await conversationRevision(archive)); expect(state.messageDrafts.find((item) => item.messageId === 'assistant')?.threadId).toBe('thread');
    const reply = state.threads[0].messages.at(-1)!; await edits.saveDraft(savedDraft({ messageId: reply.id, revision: 'f'.repeat(64) })); await engine.start({ ...request, threadId: 'thread', replay: { messageId: state.threads[0].messages.at(-2)!.id, revision: await conversationRevision(state.threads[0]), action: 'retry' } }); await engine.settle('thread'); state = vault.snapshot(); draft = state.messageDrafts.find((item) => item.messageId === reply.id)!;
    expect(draft.threadId).not.toBe('thread'); expect(draft.revision).toBe('f'.repeat(64)); expect(state.messageDrafts.every((item) => state.threads.find((thread) => thread.id === item.threadId)?.messages.some((message) => message.id === item.messageId))).toBe(true);
  });
  it('preserves the original user identity, timestamps, attachments and manual edit provenance when regenerating', async () => {
    const { vault, edits, input } = await setup(); await edits.edit(await input('following-user', 'Manually saved question')); const before = vault.snapshot().threads[0]; const question = before.messages.at(-2)!; expect(question.editedAt).toBeGreaterThan(0);
    const engine = new ConversationEngine(vault, { stream: vi.fn() }, vi.fn()); await engine.start({ ...request, threadId: 'thread', replay: { messageId: question.id, revision: await conversationRevision(before), action: 'retry' } }); await engine.settle('thread'); expect(vault.snapshot().threads[0].messages.at(-2)).toEqual(question);
  });
  it('consumes only the successful resend editor draft while preserving original messages and unrelated drafts', async () => {
    const { vault, edits, input } = await setup(); const edit = await input(); await edits.saveDraft(savedDraft({ revision: edit.revision })); await edits.saveDraft(savedDraft({ messageId: 'assistant' })); const original = vault.snapshot().threads[0]; const engine = new ConversationEngine(vault, { stream: vi.fn() }, vi.fn());
    const result = await engine.start({ ...request, threadId: 'thread', text: 'Resent edit', replay: { messageId: 'user', revision: edit.revision, action: 'edit' } }); await engine.settle(result.threadId); expect(vault.snapshot().threads[0]).toEqual(original); expect(vault.snapshot().messageDrafts.map((draft) => draft.messageId)).toEqual(['assistant']);
  });
  it('restores exact edits, archived provenance and unsent message drafts after disk restart and complete backup recovery', async () => {
    const { vault, edits, input, directory } = await setup(); await edits.edit(await input('assistant')); await edits.saveDraft(savedDraft()); const expected = vault.snapshot(); const reopened = new WorkspaceVault(directory, codec); await reopened.initialize(); expect(reopened.snapshot()).toEqual(expected);
    const extensions = new ExtensionSettings(vault, new LocalSkills(join(directory, 'skills'))); const backup = await extensions.backup(); await vault.update((state) => { state.threads = []; state.messageDrafts = []; }); const restored = await extensions.restore(backup); expect(restored.threads).toEqual(expected.threads); expect(restored.messageDrafts).toEqual(expected.messageDrafts);
  });
  it('serializes competing saved edits and keeps the rejected editing draft instead of silently replacing newer text', async () => {
    const { edits, vault, input } = await setup(); const edit = await input(); const results = await Promise.allSettled([edits.edit(edit), edits.edit({ ...edit, content: 'Competing edit' })]); expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']); expect(vault.snapshot().threads).toHaveLength(2); expect(vault.snapshot().threads[0].messages[0].content).toBe(edit.content);
  });
});

describe('editing draft buffer', () => {
  it('serializes actual saves, retains newer input during an in-flight write and clones snapshots', async () => {
    let release!: () => void; const hold = new Promise<void>((resolve) => { release = resolve; }); const save = vi.fn().mockImplementationOnce(() => hold).mockResolvedValue(undefined); const buffer = new MessageDraftBuffer(savedDraft(), save, vi.fn()); const copy = buffer.get(); copy.content = 'Mutated'; expect(buffer.get().content).toBe('KEEP_EDIT');
    buffer.stage('First'); const first = buffer.flush(); await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1)); buffer.stage('Latest'); const second = buffer.flush(); release(); await Promise.all([first, second]); expect(save.mock.calls.map(([draft]) => draft.content)).toEqual(['First', 'Latest']); await buffer.flush(); expect(save).toHaveBeenCalledTimes(2);
  });
  it('retains failed writes/discards, retries latest input, consumes success and discards only after prior writes settle', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('EIO')).mockResolvedValue(undefined); const remove = vi.fn().mockRejectedValueOnce(new Error('EIO')).mockResolvedValue(undefined); const buffer = new MessageDraftBuffer(savedDraft(), save, remove); buffer.stage('Latest'); await expect(buffer.flush()).rejects.toThrow('EIO'); expect(buffer.get().content).toBe('Latest'); await buffer.flush(); buffer.stage('Consumed'); buffer.consume(); await buffer.flush(); expect(save).toHaveBeenCalledTimes(2);
    buffer.stage('Discard me'); await expect(buffer.discard()).rejects.toThrow('EIO'); await buffer.flush(); expect(save.mock.calls.at(-1)?.[0].content).toBe('Discard me'); buffer.stage('Discard again'); await buffer.discard(); await buffer.flush(); expect(save).toHaveBeenCalledTimes(3); expect(remove).toHaveBeenCalledTimes(2);
  });
});
