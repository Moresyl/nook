import { rm } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { conversationRevision } from '../contracts/conversations';
import { ConversationEngine } from '../desktop/services/conversation-engine';
import { WorkspaceVault } from '../desktop/services/vault';
import type { ModelGateway, ModelInput } from '../desktop/services/model-gateway';
import { codec, request, testVault } from './fixtures';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function setup() {
  const { vault, directory } = await testVault(); directories.push(directory);
  const stream = vi.fn<ModelGateway['stream']>(async (_input, onText) => { onText('Original reply'); });
  const engine = new ConversationEngine(vault, { stream }, vi.fn());
  const { threadId } = await engine.start({ ...request, assistantId: 'general', text: 'First question' }); await engine.settle(threadId);
  await engine.start({ ...request, threadId, text: 'Second question', attachments: [{ id: 'file', name: 'evidence.txt', content: 'ATTACHMENT_EVIDENCE' }] }); await engine.settle(threadId);
  const thread = vault.snapshot().threads[0]; const replay = { messageId: thread.messages[2].id, revision: await conversationRevision(thread), action: 'edit' as const }; stream.mockClear();
  return { engine, vault, directory, stream, thread, replay };
}

describe('validated conversation replay', () => {
  it('edits into a new branch retaining preceding context, attachments and the complete original conversation', async () => {
    const { engine, vault, stream, thread, replay } = await setup();
    const edited = await engine.start({ ...request, threadId: thread.id, text: 'Edited question', replay }); await engine.settle(edited.threadId);
    expect(edited.threadId).not.toBe(thread.id); expect(vault.snapshot().threads[0]).toEqual(thread);
    const branch = vault.snapshot().threads[1]; expect(branch.forkedFrom).toEqual({ threadId: thread.id, messageId: replay.messageId, kind: 'edit' });
    expect(branch.messages).toHaveLength(4); expect(branch.messages[2]).toMatchObject({ content: 'Edited question', attachments: thread.messages[2].attachments });
    const input = stream.mock.calls[0][0]; expect(input.messages.slice(0, 2)).toEqual(thread.messages.slice(0, 2)); expect(input.messages[2].content).toBe('Edited question');
    expect(input.messages.some((message) => message.content === 'Second question')).toBe(false);
  });
  it('retries atomically in the same conversation using the saved user content and attachments', async () => {
    const { engine, vault, stream, thread, replay } = await setup();
    const result = await engine.start({ ...request, threadId: thread.id, text: 'Ignored replacement', replay: { ...replay, action: 'retry' } }); await engine.settle(result.threadId);
    expect(result.threadId).toBe(thread.id); const updated = vault.snapshot().threads[0]; expect(updated.messages).toHaveLength(4);
    expect(updated.messages.slice(0, 2)).toEqual(thread.messages.slice(0, 2)); expect(updated.messages[2]).toMatchObject({ content: 'Second question', attachments: thread.messages[2].attachments });
    expect(stream.mock.calls[0][0].messages.at(-1)?.content).toBe('Second question'); expect(vault.snapshot().threads).toHaveLength(2);
    const archive = vault.snapshot().threads[1]; expect(archive.archived).toBe(true); expect(archive.messages.slice(0, 3)).toEqual(thread.messages.slice(0, 3));
    expect(archive.messages[3]).toMatchObject(thread.messages[3]); expect(archive.messages[3].replyVersion?.groupId).toBe(updated.messages[3].replyVersion?.groupId);
  });
  it('rejects invalid targets, old retries, stale revisions and provider errors before touching history', async () => {
    const { engine, vault, stream, thread, replay } = await setup();
    for (const changed of [{ messageId: 'missing' }, { messageId: thread.messages[1].id }, { revision: 'a'.repeat(64) }]) await expect(engine.start({ ...request, threadId: thread.id, replay: { ...replay, ...changed } })).rejects.toThrow();
    await expect(engine.start({ ...request, threadId: thread.id, replay: { ...replay, messageId: thread.messages[0].id, action: 'retry' } })).rejects.toThrow('latest user');
    await expect(engine.start({ ...request, threadId: thread.id, providerId: 'missing', replay })).rejects.toThrow('Configure');
    await vault.update((draft) => { draft.providers[0].kind = 'openai'; });
    await expect(engine.start({ ...request, threadId: thread.id, replay: { ...replay, action: 'retry' } })).rejects.toThrow('API key');
    expect(vault.snapshot().threads).toEqual([thread]); expect(stream).not.toHaveBeenCalled(); expect(engine.active()).toBe(false);
  });
  it('rechecks the authoritative revision after a queued write and releases a rejected branch reservation', async () => {
    for (const remove of [false, true]) {
      const { engine, vault, stream, thread, replay } = await setup(); const original = vault.commit.bind(vault); let release!: () => void;
      const hold = new Promise<void>((resolve) => { release = resolve; });
      vi.spyOn(vault, 'commit').mockImplementationOnce(async (change) => { await hold; return original(change); });
      const pending = engine.start({ ...request, threadId: thread.id, replay }); expect(engine.active()).toBe(true);
      await vault.update((draft) => { if (remove) draft.threads = []; else draft.threads[0].messages[3].content = 'Concurrent reply change'; });
      release(); await expect(pending).rejects.toThrow('conversation changed');
      expect(vault.snapshot().threads).toHaveLength(remove ? 0 : 1); expect(engine.active()).toBe(false); expect(stream).not.toHaveBeenCalled();
    }
  });
  it('rolls back a failed initial save and refuses editing an active source conversation', async () => {
    const { engine, vault, stream, thread, replay } = await setup();
    vi.spyOn(vault, 'commit').mockRejectedValueOnce(new Error('Disk full')); await expect(engine.start({ ...request, threadId: thread.id, replay })).rejects.toThrow('Disk full');
    expect(vault.snapshot().threads).toEqual([thread]); expect(engine.active()).toBe(false); expect(stream).not.toHaveBeenCalled();
    stream.mockImplementationOnce(async (input: ModelInput, onText) => { onText('Partial'); await new Promise<void>((_resolve, reject) => { input.signal.addEventListener('abort', () => reject(new Error('Stopped')), { once: true }); }); });
    await engine.start({ ...request, threadId: thread.id });
    await expect(engine.start({ ...request, threadId: thread.id, replay })).rejects.toThrow('already running'); await engine.stop(thread.id);
  });
  it('keeps the original after a provider failure and restores branch ancestry after restart', async () => {
    const { engine, vault, directory, stream, thread, replay } = await setup(); stream.mockRejectedValueOnce(new Error('Provider failure'));
    const result = await engine.start({ ...request, threadId: thread.id, replay }); await engine.settle(result.threadId);
    expect(vault.snapshot().threads[0]).toEqual(thread); expect(vault.snapshot().threads[1].messages[3]).toMatchObject({ status: 'error', error: 'Provider failure' });
    const restarted = new WorkspaceVault(directory, codec); await restarted.initialize();
    expect(restarted.snapshot().threads[0]).toEqual(thread); expect(restarted.snapshot().threads[1].forkedFrom?.threadId).toBe(thread.id);
  });
});
