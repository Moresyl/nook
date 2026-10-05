import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextReplyVersion, replyVersions } from '../contracts/reply-versions';
import { conversationRevision } from '../contracts/conversations';
import { messageSchema, type Message } from '../contracts/workspace';
import { ConversationEngine } from '../desktop/services/conversation-engine';
import { ComposerDrafts } from '../desktop/services/composer-drafts';
import { WorkspaceVault } from '../desktop/services/vault';
import { ExtensionSettings } from '../desktop/services/extension-settings';
import { LocalSkills } from '../desktop/services/local-skills';
import type { ModelGateway, ModelInput } from '../desktop/services/model-gateway';
import { codec, request, sampleThread, testVault } from './fixtures';

const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
const reply = (id: string, groupId = randomUUID(), number = 1): Message => ({ id, role: 'assistant', content: `Reply ${id}`, attachments: [], createdAt: 1, status: 'complete', replyVersion: { groupId, number } });
async function setup() {
  const { vault, directory } = await testVault(); directories.push(directory);
  const stream = vi.fn<ModelGateway['stream']>(async (_input, onText) => { onText(`Reply ${stream.mock.calls.length}`); });
  const engine = new ConversationEngine(vault, { stream }, vi.fn());
  const { threadId } = await engine.start({ ...request, text: 'Original question', attachments: [{ id: 'file', name: 'evidence.txt', content: 'EXACT_ATTACHMENT' }] }); await engine.settle(threadId);
  async function retry(thread = vault.snapshot().threads.find((item) => item.id === threadId)!) {
    const user = thread.messages.findLast((message) => message.role === 'user')!;
    return engine.start({ ...request, threadId: thread.id, text: 'Ignored', replay: { action: 'retry', messageId: user.id, revision: await conversationRevision(thread) } });
  }
  return { vault, directory, stream, engine, threadId, retry };
}

describe('durable regenerated reply versions', () => {
  it('validates version metadata and retains schema-version-one messages without it', () => {
    const valid = reply('reply'); expect(messageSchema.parse(valid).replyVersion).toEqual(valid.replyVersion);
    const { replyVersion: _version, ...legacy } = valid; expect(messageSchema.parse(legacy).replyVersion).toBeUndefined();
    for (const metadata of [{ groupId: 'bad', number: 1 }, { groupId: randomUUID(), number: 0 }, { groupId: randomUUID(), number: 10001 }, { groupId: randomUUID(), number: 1, extra: true }]) expect(messageSchema.safeParse({ ...valid, replyVersion: metadata }).success).toBe(false);
    expect(messageSchema.safeParse({ ...valid, role: 'user' }).success).toBe(false);
  });
  it('allocates numbers across all stored paths without reusing a newer version when retrying an older branch', () => {
    const groupId = randomUUID(); expect(nextReplyVersion([], groupId)).toBe(2);
    expect(nextReplyVersion([sampleThread({ messages: [reply('a', groupId, 7), reply('other'), { ...reply('legacy'), replyVersion: undefined }] })], groupId)).toBe(8);
    expect(() => nextReplyVersion([sampleThread({ messages: [reply('limit', groupId, 10000)] })], groupId)).toThrow('10,000');
  });
  it('deduplicates copied prefixes, prefers the current path and then the newest continuation, and preserves producing model metadata', () => {
    const groupId = randomUUID(); const first = reply('a', groupId); const second = reply('b', groupId, 2);
    second.invocations = [{ round: 0, providerId: 'local', providerName: 'Local', providerKind: 'ollama', model: 'actual-model', destination: 'local', startedAt: 1, status: 'complete' }];
    const paths = [sampleThread({ id: 'older', updatedAt: 1, model: 'old-model', messages: [first] }), sampleThread({ id: 'newer', updatedAt: 3, messages: [first, second, { ...reply('legacy'), replyVersion: undefined }, { ...first, role: 'user' }] }), sampleThread({ id: 'same-age', updatedAt: 3, messages: [first] })];
    expect(replyVersions(paths, 'older').get(groupId)?.map((item) => [item.threadId, item.message.id, item.model])).toEqual([['older', 'a', 'old-model'], ['newer', 'b', 'actual-model']]);
    expect(replyVersions(paths, 'none').get(groupId)?.[0].threadId).toBe('newer'); expect(replyVersions([], 'none').size).toBe(0);
    expect(replyVersions([sampleThread({ messages: [reply('z', groupId), reply('a', groupId)] })], 'thread').get(groupId)?.map((item) => item.message.id)).toEqual(['a', 'z']);
  });
  it('archives exact prior content, attachments, tool and usage evidence in the same durable transaction as a retry', async () => {
    const { vault, engine, retry, threadId, stream } = await setup();
    await vault.update((draft) => { draft.threads[0].messages[1].activities = [{ id: 'tool', name: 'read_file', input: '{}', output: 'EXACT_TOOL_EVIDENCE', status: 'complete', startedAt: 1 }]; });
    const before = vault.snapshot().threads[0]; await retry(); await engine.settle(threadId); const state = vault.snapshot(); const archive = state.threads.find((item) => item.id !== threadId)!;
    expect(archive).toMatchObject({ archived: true, pinned: false, forkedFrom: { threadId, messageId: before.messages[1].id, kind: 'reply' } }); expect(archive.messages[0]).toEqual(before.messages[0]); expect(archive.messages[1]).toMatchObject(before.messages[1]);
    expect(archive.messages[1].replyVersion?.number).toBe(1); expect(state.threads[0].messages[1].replyVersion?.number).toBe(2); expect(state.threads[0].messages[0].attachments).toEqual(before.messages[0].attachments);
    expect(stream.mock.calls.at(-1)?.[0].messages).toHaveLength(1); expect(stream.mock.calls.at(-1)?.[0].messages[0].content).toBe('Original question');
    expect(replyVersions(state.threads, threadId).values().next().value).toHaveLength(2);
  });
  it('gives each version an independent saved draft and retains all versions after restart and complete backup restore', async () => {
    const { vault, engine, retry, threadId, directory } = await setup(); const drafts = new ComposerDrafts(vault);
    await drafts.save({ threadId, text: 'KEEP_DRAFT', attachments: [{ id: 'draft-file', name: 'draft.txt', content: 'KEEP_ATTACHMENT' }], providerId: 'local', model: 'test-model', mode: 'chat', mcpServerIds: [], skillIds: [], pluginIds: [], updatedAt: 2 });
    await retry(); await engine.settle(threadId); const archive = vault.snapshot().threads[1]; const copied = vault.snapshot().composerDrafts.find((item) => item.threadId === archive.id)!; expect(copied.text).toBe('KEEP_DRAFT'); expect(copied.attachments[0].content).toBe('KEEP_ATTACHMENT');
    await drafts.save({ ...copied, text: 'OLDER_VERSION_DRAFT' }); expect(vault.snapshot().composerDrafts.find((item) => item.threadId === threadId)?.text).toBe('KEEP_DRAFT');
    const reopened = new WorkspaceVault(directory, codec); await reopened.initialize(); expect(reopened.snapshot().threads).toEqual(vault.snapshot().threads); expect(reopened.snapshot().composerDrafts).toEqual(vault.snapshot().composerDrafts);
    const extensions = new ExtensionSettings(vault, new LocalSkills(join(directory, 'skills'))); const backup = await extensions.backup(); await vault.update((state) => { state.threads = []; state.composerDrafts = []; }); const restored = await extensions.restore(backup); expect(restored.threads).toEqual(backup.threads); expect(restored.composerDrafts).toEqual(backup.composerDrafts);
  });
  it('continues from the selected old version using only its own reply and keeps newer paths intact', async () => {
    const { vault, engine, retry, threadId, stream } = await setup(); await retry(); await engine.settle(threadId); const archive = vault.snapshot().threads[1]; const latest = vault.snapshot().threads[0];
    await engine.start({ ...request, threadId: archive.id, text: 'Continue older reply' }); await engine.settle(archive.id); const input = stream.mock.calls.at(-1)![0];
    expect(input.messages.map((message) => message.content)).toEqual(['Original question', 'Reply 1', 'Continue older reply']); expect(vault.snapshot().threads[0]).toEqual(latest); expect(vault.snapshot().threads[1].messages).toHaveLength(4);
    await retry(latest); await engine.settle(threadId); expect(vault.snapshot().threads[0].messages[1].replyVersion?.number).toBe(3); expect(vault.snapshot().threads.find((item) => item.id === archive.id)?.messages).toHaveLength(4);
  });
  it('retains original versions after a provider failure or stopped generation', async () => {
    const { vault, engine, retry, threadId, stream } = await setup(); stream.mockRejectedValueOnce(new Error('Provider failure')); await retry(); await engine.settle(threadId); expect(vault.snapshot().threads[0].messages[1].status).toBe('error'); expect(vault.snapshot().threads[1].messages[1].content).toBe('Reply 1');
    stream.mockImplementationOnce(async (input: ModelInput, onText) => { onText('PARTIAL_VERSION'); await new Promise<void>((_resolve, reject) => { input.signal.addEventListener('abort', () => reject(new Error('Stopped')), { once: true }); }); });
    await retry(); await engine.stop(threadId); const state = vault.snapshot(); expect(state.threads).toHaveLength(3); expect(state.threads[0].messages[1]).toMatchObject({ content: 'PARTIAL_VERSION', status: 'stopped' }); expect(state.threads[2].messages[1].status).toBe('error');
  });
  it('rolls back both the archive and replacement on initial persistence failure and rechecks a queued revision', async () => {
    const { vault, engine, retry, stream } = await setup(); const before = vault.snapshot(); const bytes = await readFile(join(directories.at(-1)!, 'workspace.json'));
    vi.spyOn(vault, 'commit').mockRejectedValueOnce(new Error('Synthetic EIO')); await expect(retry()).rejects.toThrow('EIO'); expect(vault.snapshot()).toEqual(before); expect(await readFile(join(directories.at(-1)!, 'workspace.json'))).toEqual(bytes); expect(engine.active()).toBe(false); expect(stream).toHaveBeenCalledTimes(1);
    const update = vault.commit.bind(vault); let release!: () => void; const hold = new Promise<void>((resolve) => { release = resolve; }); vi.mocked(vault.commit).mockImplementationOnce(async (change) => { await hold; return update(change); }); const pending = retry(); await vi.waitFor(() => expect(engine.active()).toBe(true)); await vault.update((draft) => { draft.threads[0].messages[1].content = 'Concurrent change'; }); release(); await expect(pending).rejects.toThrow('changed'); expect(vault.snapshot().threads).toHaveLength(1);
  });
  it('retries a user-only branch without inventing an archive or changing a preceding reply', async () => {
    const { vault, engine, retry, threadId } = await setup(); await vault.update((draft) => { draft.threads[0].messages.push({ id: 'unanswered', role: 'user', content: 'Unanswered', attachments: [], createdAt: 2, status: 'complete' }); }); await retry(); await engine.settle(threadId); expect(vault.snapshot().threads).toHaveLength(1); expect(vault.snapshot().threads[0].messages[1].content).toBe('Reply 1'); expect(vault.snapshot().threads[0].messages.at(-1)?.replyVersion).toBeUndefined();
  });
  it('serializes version numbers when two independent paths regenerate the same reply family concurrently', async () => {
    const { vault, engine, retry, threadId } = await setup(); await retry(); await engine.settle(threadId); const [newer, older] = vault.snapshot().threads;
    const results = await Promise.all([retry(newer), retry(older)]); await Promise.all(results.map((result) => engine.settle(result.threadId)));
    const state = vault.snapshot(); expect(state.threads.filter((thread) => results.some((result) => result.threadId === thread.id)).map((thread) => thread.messages[1].replyVersion?.number).sort()).toEqual([3, 4]); expect([...replyVersions(state.threads, threadId).values()][0]).toHaveLength(4);
  });
  it('rejects copied draft bytes over the existing 32 MB limit without saving an archive', async () => {
    const { vault, engine, retry } = await setup(); const attachments = Array.from({ length: 12 }, (_, index) => ({ id: `file-${index}`, name: 'evidence.txt', content: 'x'.repeat(256000) }));
    await vault.update((draft) => { draft.threads.push(...Array.from({ length: 9 }, (_, index) => sampleThread({ id: `extra-${index}` }))); draft.composerDrafts = draft.threads.map((thread) => ({ threadId: thread.id, text: 'KEEP', attachments, model: 'test-model', mode: 'chat', mcpServerIds: [], skillIds: [], pluginIds: [], updatedAt: 1 })); });
    const before = vault.snapshot(); await expect(retry()).rejects.toThrow('32 MB'); expect(vault.snapshot()).toEqual(before); expect(engine.active()).toBe(false);
  });
  it('rejects archive and copied-draft owner limits without discarding any history or reservations', async () => {
    const { vault, engine, retry } = await setup(); await vault.update((draft) => { draft.threads.push(...Array.from({ length: 9999 }, (_, index) => sampleThread({ id: `extra-${index}` }))); }); const before = vault.snapshot(); await expect(retry()).rejects.toThrow('10,000 conversations'); expect(vault.snapshot()).toEqual(before); expect(engine.active()).toBe(false);
    await vault.update((draft) => { draft.threads = draft.threads.slice(0, 100); draft.composerDrafts = draft.threads.map((thread) => ({ threadId: thread.id, text: 'KEEP', attachments: [], model: 'test-model', mode: 'chat', mcpServerIds: [], skillIds: [], pluginIds: [], updatedAt: 1 })); }); const bounded = vault.snapshot(); await expect(retry()).rejects.toThrow('100 owners'); expect(vault.snapshot()).toEqual(bounded);
  });
});
