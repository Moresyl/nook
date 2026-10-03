import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { composerRevision } from '../contracts/composer';
import { conversationHistory } from '../contracts/conversations';
import { parsePersistentWorkspace, persistentWorkspace } from '../contracts/temporary-conversations';
import { composerDraftSchema, emptyWorkspace, threadSchema } from '../contracts/workspace';
import { ComposerDrafts } from '../desktop/services/composer-drafts';
import { ConversationEngine } from '../desktop/services/conversation-engine';
import { ExtensionSettings } from '../desktop/services/extension-settings';
import { LocalSkills } from '../desktop/services/local-skills';
import { MessageEdits } from '../desktop/services/message-edits';
import { startTemporaryChat } from '../desktop/services/temporary-conversations';
import { WorkspaceBackupFiles } from '../desktop/services/backup-files';
import { WorkspaceVault } from '../desktop/services/vault';
import { codec, request, sampleThread, testVault } from './fixtures';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function setup() { const context = await testVault(); directories.push(context.directory); return { ...context, drafts: new ComposerDrafts(context.vault) }; }
const draft = (threadId?: string) => composerDraftSchema.parse({ threadId, text: 'TEMPORARY_DRAFT_SECRET', attachments: [{ id: 'attachment', name: '临时资料.txt', content: 'TEMPORARY_ATTACHMENT_SECRET' }], updatedAt: 1 });
const revision = (thread: ReturnType<typeof sampleThread>) => createHash('sha256').update(conversationHistory(thread)).digest('hex');
async function files(directory: string) { return Promise.all(['workspace.json', 'workspace.backup.json'].map((name) => readFile(join(directory, name), 'utf8'))); }

describe('temporary conversation persistence boundaries', () => {
  it('keeps earlier snapshots compatible and validates the immutable storage marker', () => {
    expect(parsePersistentWorkspace(emptyWorkspace())).toEqual(emptyWorkspace());
    expect(parsePersistentWorkspace({ ...emptyWorkspace(), threads: [sampleThread()] }).threads[0]).not.toHaveProperty('temporary');
    expect(threadSchema.safeParse(sampleThread({ temporary: true })).success).toBe(true);
    expect(threadSchema.safeParse({ ...sampleThread(), temporary: false }).success).toBe(false);
    expect(() => parsePersistentWorkspace({ ...emptyWorkspace(), threads: [sampleThread({ temporary: true })] })).toThrow('cannot be restored');
    expect(() => parsePersistentWorkspace({ schemaVersion: 2 })).toThrow();
  });

  it('projects only temporary thread owners, preserves metadata, and does not mutate the live workspace', () => {
    const state = emptyWorkspace(); const regular = sampleThread(); const temporary = sampleThread({ id: 'temporary', temporary: true });
    state.threads = [regular, temporary]; state.composerDrafts = [draft(), draft(regular.id), draft(temporary.id)]; state.activeThreadId = temporary.id;
    const before = structuredClone(state); const persistent = persistentWorkspace(state, regular.id);
    expect(persistent.threads).toEqual([regular]); expect(persistent.composerDrafts).toEqual([draft(), draft(regular.id)]); expect(persistent.activeThreadId).toBe(regular.id);
    expect(persistent.preferences).toEqual(state.preferences); expect(state).toEqual(before);
    expect(persistentWorkspace(state, 'removed').activeThreadId).toBeUndefined(); state.activeThreadId = regular.id;
    expect(persistentWorkspace(state, 'removed').activeThreadId).toBe(regular.id); delete state.activeThreadId; expect(persistentWorkspace(state).activeThreadId).toBeUndefined();
    expect(persistentWorkspace(emptyWorkspace())).toEqual(emptyWorkspace());
  });

  it('creates separate temporary chats without a model request or any change to either existing disk file', async () => {
    const { vault, directory } = await setup(); await vault.update((state) => { state.threads.push(sampleThread()); state.activeThreadId = 'thread'; state.preferences.defaultProviderId = request.providerId; state.preferences.defaultModel = request.model; });
    const before = await files(directory); const one = await startTemporaryChat(vault); const two = await startTemporaryChat(vault);
    expect(one.activeThreadId).not.toBe(two.activeThreadId); expect(two.threads.filter((thread) => thread.temporary)).toHaveLength(2);
    expect(two.threads.at(-1)).toMatchObject({ temporary: true, model: request.model, providerId: request.providerId, messages: [] }); expect(await files(directory)).toEqual(before);
    one.threads.length = 0; expect(vault.snapshot().threads).toHaveLength(3); expect(vault.backup().activeThreadId).toBe('thread');
  });

  it('preserves independent new-chat and regular drafts while temporary drafts remain entirely volatile', async () => {
    const { vault, directory, drafts } = await setup(); await vault.update((state) => { state.threads.push(sampleThread()); state.activeThreadId = 'thread'; });
    await drafts.save({ ...draft(), text: 'REGULAR_NEW_DRAFT', attachments: [] }); await drafts.save({ ...draft('thread'), text: 'REGULAR_THREAD_DRAFT', attachments: [] });
    const before = await files(directory); const state = await startTemporaryChat(vault); const id = state.activeThreadId!; await drafts.save(draft(id)); await drafts.activate(id);
    expect(vault.snapshot().composerDrafts).toHaveLength(3); expect(await files(directory)).toEqual(before);
    expect(JSON.stringify(vault.backup())).not.toContain('TEMPORARY_');
    const restarted = new WorkspaceVault(directory, codec); await restarted.initialize(); expect(restarted.snapshot().threads).toHaveLength(1); expect(restarted.snapshot().activeThreadId).toBe('thread');
    expect(restarted.snapshot().composerDrafts.map((item) => item.text)).toEqual(['REGULAR_NEW_DRAFT', 'REGULAR_THREAD_DRAFT']);
  });

  it('continues temporary changes when a disk destination is blocked and rejects persistent changes without losing live content', async () => {
    const { vault, directory, drafts } = await setup(); const original = join(directory, 'workspace.json'); const held = join(directory, 'workspace-held.json'); await rename(original, held); await mkdir(original);
    const state = await startTemporaryChat(vault); const id = state.activeThreadId!; await drafts.save(draft(id));
    await expect(vault.update((next) => { next.preferences.theme = 'dark'; })).rejects.toThrow(); expect(vault.snapshot().preferences.theme).toBe('system'); expect(vault.snapshot().composerDrafts).toEqual([draft(id)]);
    await drafts.save({ ...draft(id), text: 'LATEST_TEMPORARY_SECRET' }); await rm(original, { recursive: true }); await rename(held, original);
    await vault.update((next) => { next.preferences.theme = 'dark'; }); expect(vault.snapshot().preferences.theme).toBe('dark');
    for (const file of await files(directory)) { expect(file).not.toContain(id); expect(file).not.toContain('TEMPORARY_'); }
  });

  it('serializes concurrent regular and temporary changes and retains the last valid regular selection', async () => {
    const { vault, directory, drafts } = await setup(); await vault.update((state) => { state.threads = [sampleThread(), sampleThread({ id: 'other' })]; state.activeThreadId = 'thread'; });
    const temporary = await startTemporaryChat(vault); const id = temporary.activeThreadId!;
    await Promise.all([drafts.save(draft(id)), vault.update((state) => { state.notes.push({ id: 'regular-note', title: 'Regular', content: 'SAVED_NOTE', createdAt: 1 }); }), drafts.activate('other'), drafts.activate(id)]);
    expect(vault.snapshot().activeThreadId).toBe(id); expect(vault.backup().activeThreadId).toBe('other');
    const restarted = new WorkspaceVault(directory, codec); await restarted.initialize(); expect(restarted.snapshot().activeThreadId).toBe('other'); expect(restarted.snapshot().notes[0].content).toBe('SAVED_NOTE'); expect(restarted.snapshot().composerDrafts).toEqual([]);
    await vault.update((state) => { state.threads = state.threads.filter((thread) => thread.id !== 'other'); }); expect(vault.backup().activeThreadId).toBeUndefined();
  });

  it.each(['json', 'json.gz'])('exports a complete %s backup without temporary data even during a live response', async (extension) => {
    const { vault, directory, drafts } = await setup(); const state = await startTemporaryChat(vault); const id = state.activeThreadId!; await drafts.save(draft(id));
    const engine = new ConversationEngine(vault, { stream: async (input, onText) => { onText('TEMPORARY_PARTIAL_SECRET'); await new Promise<void>((_resolve, reject) => input.signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true })); } }, () => {});
    await engine.start({ ...request, threadId: id, text: 'TEMPORARY_PROMPT_SECRET' });
    const settings = new ExtensionSettings(vault, new LocalSkills(join(directory, 'skills'))); const backup = await settings.backup(); const service = new WorkspaceBackupFiles(); const path = join(directory, `backup.${extension}`);
    try { await service.write(path, backup); const restored = parsePersistentWorkspace(await service.read(path)); expect(restored.threads).toEqual([]); expect(restored.composerDrafts).toEqual([]); expect(JSON.stringify(restored)).not.toContain('TEMPORARY_'); }
    finally { await engine.stop(id); await service.shutdown(); }
    expect(vault.snapshot().threads[0].messages.at(-1)).toMatchObject({ status: 'stopped', content: 'TEMPORARY_PARTIAL_SECRET' });
  });

  it('streams temporary messages and consumes exactly their own draft while preserving ordinary new-chat text', async () => {
    const { vault, directory, drafts } = await setup(); await drafts.save({ ...draft(), text: 'REGULAR_NEW_DRAFT', attachments: [] }); const state = await startTemporaryChat(vault); const id = state.activeThreadId!; const pending = draft(id); await drafts.save(pending);
    const gateway = { stream: vi.fn(async (_input, onText) => { onText('TEMPORARY_REPLY_SECRET'); }) }; const engine = new ConversationEngine(vault, gateway, () => {});
    await engine.start({ ...request, threadId: id, text: 'TEMPORARY_PROMPT_SECRET', attachments: pending.attachments, composerRevision: await composerRevision(pending) }); await engine.settle(id);
    expect(gateway.stream).toHaveBeenCalledOnce(); const thread = vault.snapshot().threads[0]; expect(thread.title).toBe('TEMPORARY_PROMPT_SECRET'); expect(thread.messages.at(-1)).toMatchObject({ status: 'complete', content: 'TEMPORARY_REPLY_SECRET' });
    expect(vault.snapshot().composerDrafts.map((item) => item.text)).toEqual(['REGULAR_NEW_DRAFT']); for (const file of await files(directory)) expect(file).not.toContain('TEMPORARY_');
    await engine.start({ ...request, threadId: id }); await engine.settle(id); expect(vault.snapshot().threads[0].messages).toHaveLength(4);
  });

  it('keeps retry archives, edited branches and editing drafts temporary without removing the original context', async () => {
    const { vault, directory } = await setup(); const state = await startTemporaryChat(vault); const id = state.activeThreadId!;
    const engine = new ConversationEngine(vault, { stream: async (_input, onText) => { onText('TEMPORARY_REPLY_SECRET'); } }, () => {});
    await engine.start({ ...request, threadId: id, text: 'TEMPORARY_PROMPT_SECRET' }); await engine.settle(id);
    let thread = vault.snapshot().threads[0]; const message = thread.messages[0]; const edits = new MessageEdits(vault, (threadId) => engine.active(threadId));
    await edits.saveDraft({ threadId: id, messageId: message.id, content: 'TEMPORARY_EDITING_SECRET', revision: revision(thread), updatedAt: 1 });
    await engine.start({ ...request, threadId: id, replay: { messageId: message.id, revision: revision(thread), action: 'retry' } }); await engine.settle(id);
    expect(vault.snapshot().threads).toHaveLength(2); expect(vault.snapshot().threads.every((item) => item.temporary)).toBe(true);
    thread = vault.snapshot().threads.find((item) => item.id === id)!; const result = await engine.start({ ...request, threadId: id, text: 'TEMPORARY_EDITED_PROMPT', replay: { messageId: message.id, revision: revision(thread), action: 'edit' } }); await engine.settle(result.threadId);
    expect(vault.snapshot().threads).toHaveLength(3); expect(vault.snapshot().threads.every((item) => item.temporary)).toBe(true); expect(vault.backup().threads).toEqual([]); expect(vault.backup().messageDrafts).toEqual([]);
    for (const file of await files(directory)) { expect(file).not.toContain(id); expect(file).not.toContain('TEMPORARY_'); }
  });

  it('rejects temporary-marked files and restores before modifying live data or imported extension assets', async () => {
    const { vault, directory } = await setup(); const backup = vault.backup(); backup.threads.push(sampleThread({ temporary: true }));
    const before = await files(directory); const settings = new ExtensionSettings(vault, new LocalSkills(join(directory, 'skills')));
    await expect(settings.restore(backup)).rejects.toThrow('cannot be restored'); expect(await files(directory)).toEqual(before); expect(vault.snapshot().threads).toEqual([]);
    await writeFile(join(directory, 'workspace.json'), JSON.stringify(backup)); await expect(new WorkspaceVault(directory, codec).initialize()).rejects.toThrow('Workspace data could not be read'); expect(JSON.parse(await readFile(join(directory, 'workspace.json'), 'utf8'))).toEqual(backup);
  });

  it('rejects creating a conversation at the quota without changing the active conversation', async () => {
    const { vault } = await setup(); await vault.update((state) => { state.threads = Array.from({ length: 10_000 }, (_, index) => sampleThread({ id: `thread-${index}` })); state.activeThreadId = 'thread-0'; });
    await expect(startTemporaryChat(vault)).rejects.toThrow('10,000 conversations'); expect(vault.snapshot().threads).toHaveLength(10_000); expect(vault.snapshot().activeThreadId).toBe('thread-0');
  });
});
