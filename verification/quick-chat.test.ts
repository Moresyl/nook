import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachmentSchema } from '../contracts/attachments';
import { persistentWorkspace } from '../contracts/temporary-conversations';
import { composerDraftSchema, workspaceSchema, type ComposerDraft, type QuickChatState } from '../contracts/workspace';
import { ConversationEngine } from '../desktop/services/conversation-engine';
import type { ModelGateway } from '../desktop/services/model-gateway';
import { QuickChat } from '../desktop/services/quick-chat';
import { WorkspaceVault } from '../desktop/services/vault';
import { codec, sampleThread, testVault } from './fixtures';
import { readWorkspaceFile as readFile } from './read-workspace-file';

const directories: string[] = [], engines: ConversationEngine[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const engine of engines.splice(0)) await engine.shutdown();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
async function setup(gateway: ModelGateway = { stream: async (_input, onText) => { onText('Quick reply'); } }) {
  const context = await testVault(); directories.push(context.directory);
  await context.vault.update(state => {
    state.preferences.defaultProviderId = 'local'; state.preferences.defaultModel = 'test-model';
    state.threads.push(sampleThread(), sampleThread({ id: 'second', providerId: 'local' }), sampleThread({ id: 'temporary', temporary: true }));
    state.activeThreadId = 'thread'; state.composerDrafts.push(composerDraftSchema.parse({ threadId: 'thread', text: 'Main unsent 中文', updatedAt: 1 }));
  });
  const engine = new ConversationEngine(context.vault, gateway, vi.fn()); engines.push(engine);
  return { ...context, engine, quick: new QuickChat(context.vault, engine) };
}
async function saveText(quick: QuickChat, text: string) {
  const loaded = await quick.load(); return quick.save({ ...loaded.draft, text }, loaded.revision);
}
const pdf = Buffer.from('%PDF-1.7\nquick chat original\n%%EOF');

describe('independent quick chat', () => {
  it('opens concurrently with one durable owner and never reads or overwrites main drafts', async () => {
    const { quick, vault, directory } = await setup(); const before = vault.snapshot();
    const snapshot = vi.spyOn(vault, 'snapshot');
    const [one, two] = await Promise.all([quick.load(), quick.load()]);
    expect(one.revision).toBe(two.revision); expect(one.draft).toMatchObject({ text: '', providerId: 'local', model: 'test-model' });
    expect(one.draft.threadId).toBeUndefined(); expect(snapshot).not.toHaveBeenCalled(); snapshot.mockRestore();
    expect(vault.snapshot()).toEqual({ ...before, quickChat: { revision: one.revision, composerDrafts: [one.draft] } });
    one.context.providers[0].models.push('Injected'); one.draft.text = 'Injected';
    expect((await quick.load()).context.providers[0].models).toEqual(['test-model']);
    const restarted = new WorkspaceVault(directory, codec); await restarted.initialize();
    expect(restarted.quickChat()).toEqual(vault.quickChat()); expect(restarted.snapshot().composerDrafts).toEqual(before.composerDrafts);
  });

  it('preserves per-conversation and new-chat drafts through switching and restart', async () => {
    const { quick, vault, directory } = await setup(); const main = vault.snapshot();
    let revision = await saveText(quick, 'New quick draft');
    revision = await quick.activate('second', revision); expect((await quick.load()).draft.text).toBe('');
    revision = await saveText(quick, 'Second quick draft');
    revision = await quick.activate(undefined, revision); expect((await quick.load()).draft.text).toBe('New quick draft');
    await quick.activate('second', revision); expect((await quick.load()).draft.text).toBe('Second quick draft');
    expect(vault.snapshot().composerDrafts).toEqual(main.composerDrafts); expect(vault.snapshot().activeThreadId).toBe('thread');
    const restarted = new WorkspaceVault(directory, codec); await restarted.initialize();
    expect((await new QuickChat(restarted, { start: vi.fn(), stop: vi.fn() }).load()).draft.text).toBe('Second quick draft');
  });

  it('rejects stale, malformed and foreign-owner changes without consuming the current draft', async () => {
    const { quick, vault } = await setup(); const loaded = await quick.load();
    const revision = await quick.save({ ...loaded.draft, text: 'Latest' }, loaded.revision), before = vault.snapshot();
    await expect(quick.save({ ...loaded.draft, text: 'Stale' }, loaded.revision)).rejects.toThrow('input is retained');
    await expect(quick.send(loaded.revision)).rejects.toThrow('input is retained');
    await expect(quick.activate('second', loaded.revision)).rejects.toThrow('changed');
    await expect(quick.save({ ...loaded.draft, threadId: 'second' }, revision)).rejects.toThrow('does not belong');
    await expect(quick.save({ ...loaded.draft, surprise: true }, revision)).rejects.toThrow();
    await expect(quick.send('invalid')).rejects.toThrow();
    await expect(quick.activate('missing', revision)).rejects.toThrow('saved conversation');
    await expect(quick.activate('temporary', revision)).rejects.toThrow('saved conversation');
    await expect(quick.activate('x'.repeat(129), revision)).rejects.toThrow();
    expect(vault.snapshot()).toEqual(before);
  });

  it('serializes competing saves and retains the winner instead of silently overwriting input', async () => {
    const { quick } = await setup(); const loaded = await quick.load();
    const results = await Promise.allSettled([
      quick.save({ ...loaded.draft, text: 'First' }, loaded.revision),
      quick.save({ ...loaded.draft, text: 'Second' }, loaded.revision),
    ]);
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected']); expect((await quick.load()).draft.text).toBe('First');
  });

  it('recovers a deleted owner as a new draft while preserving its input and other quick drafts', async () => {
    const { quick, vault } = await setup(); const opened = await quick.load();
    await vault.commitQuickChat(state => { state.quickChat = { revision: opened.revision, activeThreadId: 'gone', composerDrafts: [
      composerDraftSchema.parse({ threadId: 'gone', text: 'Recovered input', providerId: 'local', model: 'test-model', updatedAt: 1 }),
      composerDraftSchema.parse({ threadId: 'second', text: 'Other input', updatedAt: 1 }),
    ] }; });
    const recovered = await quick.load(); expect(recovered.draft.threadId).toBeUndefined(); expect(recovered.thread).toBeUndefined();
    await quick.save(recovered.draft, recovered.revision);
    expect(vault.quickChat()?.composerDrafts.map(draft => [draft.threadId, draft.text])).toEqual([['second', 'Other input'], [undefined, 'Recovered input']]);
  });

  it('requires an open draft and a configured model before sending', async () => {
    const { quick, vault, engine } = await setup();
    await expect(quick.stop()).rejects.toThrow('Open quick chat'); await expect(quick.send(randomUUID())).rejects.toThrow('Open quick chat');
    await vault.update(state => { delete state.preferences.defaultProviderId; state.preferences.defaultModel = ''; });
    const loaded = await quick.load(); await expect(quick.send(loaded.revision)).rejects.toThrow('configured model');
    expect(engine.active()).toBe(false);
  });

  it('consumes only its acknowledged draft with the durable message, then continues its conversation', async () => {
    const stream = vi.fn<ModelGateway['stream']>(async (input, onText) => {
      expect(input.messages.at(-1)?.content).toBe('Quick 中文'); onText('Answer');
    });
    const { quick, vault, engine, directory } = await setup({ stream }); const main = vault.snapshot();
    const revision = await saveText(quick, 'Quick 中文'), { threadId } = await quick.send(revision);
    await engine.settle(threadId); expect(quick.owns(threadId)).toBe(true); expect(quick.owns('thread')).toBe(false);
    const loaded = await quick.load(); expect(loaded.draft).toMatchObject({ threadId, text: '', attachments: [] });
    expect(loaded.revision).not.toBe(revision); expect(loaded.thread?.messages[1]).toMatchObject({ content: 'Answer', status: 'complete' });
    expect(vault.snapshot().activeThreadId).toBe(main.activeThreadId); expect(vault.snapshot().composerDrafts).toEqual(main.composerDrafts);
    const again = await saveText(quick, 'Quick 中文'); expect((await quick.send(again)).threadId).toBe(threadId); await engine.settle(threadId);
    expect(stream).toHaveBeenCalledTimes(2); expect(stream.mock.calls[1][0].messages).toHaveLength(3);
    const restarted = new WorkspaceVault(directory, codec); await restarted.initialize(); expect(restarted.quickChat()?.activeThreadId).toBe(threadId);
    expect(restarted.thread(threadId)?.messages).toHaveLength(4);
  });

  it('rejects a draft changed during send before creating a conversation or calling the provider, and releases its reservation', async () => {
    const stream = vi.fn<ModelGateway['stream']>(async () => {}); const { quick, vault, engine } = await setup({ stream });
    const revision = await saveText(quick, 'Old input'); const original = vault.commit.bind(vault);
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(vault, 'commit').mockImplementationOnce(async (change, options) => { await held; return original(change, options); });
    const sending = quick.send(revision); const rejected = expect(sending).rejects.toThrow('draft is retained');
    await vi.waitFor(() => expect(engine.active()).toBe(true)); await saveText(quick, 'New input'); release(); await rejected;
    expect(stream).not.toHaveBeenCalled(); expect(engine.active()).toBe(false); expect(vault.snapshot().threads).toHaveLength(3);
    expect((await quick.load()).draft.text).toBe('New input');
    const current = await quick.load(), result = await quick.send(current.revision); await engine.settle(result.threadId); expect(stream).toHaveBeenCalledTimes(1);
  });

  it('retains input on initial save failure and stops only the quick-chat owner with its partial reply', async () => {
    const stream: ModelGateway['stream'] = async (input, onText) => {
      onText('Partial'); await new Promise<void>((_resolve, reject) => input.signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true }));
    };
    const { quick, vault, engine } = await setup({ stream }); const revision = await saveText(quick, 'Retained');
    vi.spyOn(vault, 'commit').mockRejectedValueOnce(new Error('Disk full'));
    await expect(quick.send(revision)).rejects.toThrow('Disk full'); expect(engine.active()).toBe(false); expect((await quick.load()).draft.text).toBe('Retained');
    const main = await engine.start({ providerId: 'local', model: 'test-model', text: 'Main run', attachments: [], threadId: 'thread' });
    await quick.stop(); expect(engine.active(main.threadId)).toBe(true);
    const run = await quick.send(revision); await quick.stop(); expect(engine.active(run.threadId)).toBe(false); expect(engine.active(main.threadId)).toBe(true);
    expect(vault.thread(run.threadId)?.messages[1]).toMatchObject({ content: 'Partial', status: 'stopped' }); await engine.stop(main.threadId);
  });

  it('owns original PDF bytes through draft persistence, backup, send and restart while sending extracted text only', async () => {
    const stream = vi.fn<ModelGateway['stream']>(async (input, onText) => {
      expect(input.messages.at(-1)?.attachments[0].content).toBe('Extracted quick PDF text');
      expect(JSON.stringify(input)).not.toContain(pdf.toString('base64')); onText('Read PDF');
    });
    const { quick, vault, directory, engine } = await setup({ stream }); const loaded = await quick.load(), [original] = vault.stageDocumentOriginals([pdf]);
    const attachment = attachmentSchema.parse({ id: 'pdf', name: 'quick.pdf', content: 'Extracted quick PDF text', source: { format: 'pdf', bytes: pdf.length }, original });
    const revision = await quick.save({ ...loaded.draft, text: 'Read this PDF', attachments: [attachment] }, loaded.revision);
    expect(await vault.readDocumentOriginal(original)).toEqual(pdf); expect(await readFile(join(directory, 'document-originals', original.sha256))).toEqual(pdf);
    const backup = await vault.backupWithOriginals(); expect(backup.documentOriginals).toEqual([{ reference: original, data: pdf.toString('base64') }]);
    const restored = new WorkspaceVault(directory, codec); await restored.initialize(); expect(await restored.readDocumentOriginal(original)).toEqual(pdf);
    const result = await quick.send(revision); await engine.settle(result.threadId);
    expect((await quick.load()).draft.attachments).toEqual([]); expect(vault.thread(result.threadId)?.messages[0].attachments[0].original).toEqual(original);
    expect(await vault.readDocumentOriginal(original)).toEqual(pdf); expect((await vault.backupWithOriginals()).documentOriginals).toHaveLength(1);
  });
});

describe('bounded quick-chat persistence', () => {
  it('retains canonical bytes, previous complete backup and isolated callbacks without cloning unrelated histories', async () => {
    const { vault, directory } = await setup(); const before = vault.snapshot(); let held!: { quickChat?: QuickChatState };
    const quickChat = { revision: randomUUID(), composerDrafts: [composerDraftSchema.parse({ text: 'Scoped', updatedAt: 1 })] };
    const expected = workspaceSchema.parse({ ...before, quickChat });
    const clones = vi.spyOn(globalThis, 'structuredClone'), snapshot = vi.spyOn(vault, 'snapshot');
    await vault.commitQuickChat(state => { held = state; state.quickChat = quickChat; (state as unknown as { threads: unknown[] }).threads = []; });
    expect(snapshot).not.toHaveBeenCalled(); expect(clones.mock.calls.some(([value]) => value && typeof value === 'object' && ('schemaVersion' in value || 'messages' in value))).toBe(false);
    clones.mockRestore(); snapshot.mockRestore(); held.quickChat!.composerDrafts[0].text = 'Mutated';
    expect(vault.snapshot()).toEqual(expected); expect(await readFile(join(directory, 'workspace.json'))).toEqual(Buffer.from(JSON.stringify(persistentWorkspace(expected), null, 2)));
    expect(await readFile(join(directory, 'workspace.backup.json.gz'))).toEqual(Buffer.from(JSON.stringify(persistentWorkspace(before), null, 2)));
    const context = vault.composerContext(); context.preferences.defaultModel = 'Changed'; expect(vault.preferences().defaultModel).toBe('test-model');
    expect(vault.hasPersistentThread('thread')).toBe(true); expect(vault.hasPersistentThread('temporary')).toBe(false); expect(vault.hasPersistentThread('missing')).toBe(false);
  });

  it('rejects invalid mutations and actual disk failure atomically, then permits retry and removal', async () => {
    const { quick, vault, directory } = await setup(); const loaded = await quick.load(), before = vault.snapshot();
    const draft: ComposerDraft = { ...loaded.draft, text: 'Retry input' };
    await expect(vault.commitQuickChat(state => { state.quickChat!.composerDrafts = [draft, draft]; })).rejects.toThrow('unique owners');
    await expect(vault.commitQuickChat(() => { throw new Error('Callback failed'); })).rejects.toThrow('Callback failed');
    const primary = await readFile(join(directory, 'workspace.json')), backup = join(directory, 'workspace.backup.json.gz'), retained = join(directory, 'held-backup.json');
    await rename(backup, retained); await mkdir(backup);
    try {
      await expect(quick.save(draft, loaded.revision)).rejects.toThrow('could not be saved'); expect(vault.snapshot()).toEqual(before);
      expect(await readFile(join(directory, 'workspace.json'))).toEqual(primary);
    } finally { await rm(backup, { recursive: true }); await rename(retained, backup); }
    await quick.save(draft, loaded.revision); expect((await quick.load()).draft.text).toBe('Retry input');
    await vault.commitQuickChat(state => { delete state.quickChat; });
    const restarted = new WorkspaceVault(directory, codec); await restarted.initialize(); expect(restarted.quickChat()).toBeUndefined();
  });
});
