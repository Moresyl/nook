import { createHash } from 'node:crypto';
import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { composerContent, composerRevision, restoreComposer } from '../contracts/composer';
import { mcpServerSchema, skillSchema } from '../contracts/extensions';
import { pluginSchema } from '../contracts/plugins';
import { composerDraftSchema, emptyWorkspace, submitSchema, workspaceSchema, type ComposerDraft } from '../contracts/workspace';
import { ComposerDrafts } from '../desktop/services/composer-drafts';
import { ConversationEngine } from '../desktop/services/conversation-engine';
import { WorkspaceVault } from '../desktop/services/vault';
import { ComposerDraftStore } from '../workbench/components/composer-drafts';
import { codec, provider, request, sampleThread, testVault } from './fixtures';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
const draft = (change: Partial<ComposerDraft> = {}): ComposerDraft => ({ text: '  Keep this draft\n', attachments: [], providerId: provider.id, model: request.model, mode: 'chat', mcpServerIds: [], skillIds: [], pluginIds: [], updatedAt: 1, ...change });
async function setup() { const context = await testVault(); directories.push(context.directory); return { ...context, drafts: new ComposerDrafts(context.vault) }; }

describe('conversation draft persistence and consumption', () => {
  it('atomically persists dirty owners and the selected conversation with one commit and restores both after restart', async () => {
    const { vault, drafts, directory } = await setup(); await vault.update(state => { state.threads = [sampleThread(), sampleThread({ id: 'second' })]; });
    const commit = vi.spyOn(vault, 'commit');
    const pending = [draft(), draft({ threadId: 'thread', attachments: [{ id: 'file', name: 'notes.txt', content: 'EXACT' }] })];
    await drafts.activate('second', pending); expect(commit).toHaveBeenCalledTimes(1);
    pending[0].text = 'Mutated caller';
    const restored = new WorkspaceVault(directory, codec); await restored.initialize();
    expect(restored.snapshot().activeThreadId).toBe('second'); expect(restored.snapshot().composerDrafts[0]).toEqual(draft());
    expect(restored.snapshot().composerDrafts[1].attachments[0].content).toBe('EXACT');
    await drafts.activate(undefined, [draft({ text: '' })]); expect(vault.snapshot().activeThreadId).toBeUndefined(); expect(vault.snapshot().composerDrafts).toHaveLength(1);
  });
  it('rejects invalid batches and owners without persisting any draft or selection', async () => {
    const { vault, drafts } = await setup(); await vault.update(state => { state.threads.push(sampleThread()); });
    const before = vault.snapshot();
    await expect(drafts.activate('missing', [draft()])).rejects.toThrow('no longer exists');
    await expect(drafts.activate('thread', [draft(), draft({ threadId: 'missing' })])).rejects.toThrow('no longer exists');
    await expect(drafts.activate('thread', Array.from({ length: 101 }, () => draft()))).rejects.toThrow();
    await expect(drafts.activate('thread', [{ ...draft(), unexpected: true }])).rejects.toThrow();
    expect(vault.snapshot()).toEqual(before);
  });
  it('keeps temporary draft content out of persistence while saving a regular owner in the same batch', async () => {
    const { vault, drafts, directory } = await setup();
    await vault.update(state => { state.threads = [sampleThread(), sampleThread({ id: 'temporary', temporary: true })]; state.activeThreadId = 'thread'; });
    await drafts.activate('temporary', [draft({ threadId: 'thread' }), draft({ threadId: 'temporary', text: 'PRIVATE' })]);
    expect(vault.snapshot().activeThreadId).toBe('temporary'); expect(vault.snapshot().composerDrafts).toHaveLength(2);
    expect(vault.backup().composerDrafts).toEqual([draft({ threadId: 'thread' })]);
    const restored = new WorkspaceVault(directory, codec); await restored.initialize();
    expect(restored.snapshot().activeThreadId).toBe('thread'); expect(restored.snapshot().composerDrafts).toEqual([draft({ threadId: 'thread' })]);
  });
  it('does not coalesce selections across a combined draft transaction', async () => {
    const { vault, drafts } = await setup(); await vault.update(state => { state.threads = [sampleThread(), sampleThread({ id: 'second' })]; });
    const first = drafts.activate('thread'); const combined = drafts.activate('second', [draft()]); const last = drafts.activate('thread');
    await Promise.all([first, combined, last]);
    expect(vault.snapshot().activeThreadId).toBe('thread'); expect(vault.snapshot().composerDrafts).toEqual([draft()]);
  });
  it('rolls back both selection and drafts after a real filesystem failure and retries the same batch', async () => {
    const { vault, drafts, directory } = await setup(); await vault.update(state => { state.threads.push(sampleThread()); });
    const before = vault.snapshot(); const path = join(directory, 'workspace.json'); const held = join(directory, 'held.json');
    await rename(path, held); await mkdir(path);
    try { await expect(drafts.activate('thread', [draft()])).rejects.toThrow('could not be saved'); expect(vault.snapshot()).toEqual(before); }
    finally { await rm(path, { recursive: true }); await rename(held, path); }
    await drafts.activate('thread', [draft()]);
    const restored = new WorkspaceVault(directory, codec); await restored.initialize();
    expect(restored.snapshot().activeThreadId).toBe('thread'); expect(restored.snapshot().composerDrafts).toEqual([draft()]);
  });
  it('returns an independent selected-thread snapshot without requiring a complete workspace clone', async () => {
    const { vault } = await setup(); await vault.update(state => { state.threads.push(sampleThread()); });
    expect(vault.thread('missing')).toBeUndefined(); const selected = vault.thread('thread')!;
    selected.title = 'Changed outside the vault'; selected.messages.push({ id: 'external', role: 'user', content: 'External', status: 'complete', attachments: [], createdAt: 1 });
    expect(vault.thread('thread')).toEqual(sampleThread()); expect(vault.snapshot().threads[0]).toEqual(sampleThread());
  });
  it('coalesces queued selections into the latest durable owner without letting a later workspace operation overtake them', async () => {
    const { vault, directory, drafts } = await setup(); await vault.update(state => { state.threads = [sampleThread(), sampleThread({ id: 'second' })]; });
    const commit = vi.spyOn(vault, 'commit'); let observed: string | undefined;
    const choices = [drafts.activate('thread'), drafts.activate('second'), drafts.activate('thread'), drafts.activate('second')];
    const following = vault.update(state => { observed = state.activeThreadId; });
    await Promise.all([...choices, following]); expect(observed).toBe('second'); expect(commit).toHaveBeenCalledTimes(1);
    const restored = new WorkspaceVault(directory, codec); await restored.initialize(); expect(restored.snapshot().activeThreadId).toBe('second');
  });
  it('does not acknowledge queued choices until the selected state has been saved, including clearing the owner', async () => {
    const { vault, drafts } = await setup(); await vault.update(state => { state.threads.push(sampleThread()); });
    const original = vault.commit.bind(vault); let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(vault, 'commit').mockImplementationOnce(async (...args) => { await hold; return original(...args); });
    let acknowledgements = 0; const first = drafts.activate('thread').then(() => { acknowledgements++; }); const cleared = drafts.activate().then(() => { acknowledgements++; });
    await Promise.resolve(); expect(acknowledgements).toBe(0); release(); await Promise.all([first, cleared]);
    expect(acknowledgements).toBe(2); expect(vault.snapshot().activeThreadId).toBeUndefined();
  });
  it('rejects every invalid queued owner while retaining the last valid choice', async () => {
    const { vault, drafts } = await setup(); await vault.update(state => { state.threads.push(sampleThread()); });
    const invalid = expect(drafts.activate('missing')).rejects.toThrow('no longer exists');
    const valid = drafts.activate('thread'); const lastInvalid = expect(drafts.activate('also-missing')).rejects.toThrow('no longer exists');
    await Promise.all([invalid, valid, lastInvalid]); expect(vault.snapshot().activeThreadId).toBe('thread');
    await expect(drafts.activate('still-missing')).rejects.toThrow('no longer exists'); expect(vault.snapshot().activeThreadId).toBe('thread');
  });
  it('rejects a failed queued activation and permits a later retry without leaving the batch stuck', async () => {
    const { vault, drafts } = await setup(); await vault.update(state => { state.threads.push(sampleThread()); });
    vi.spyOn(vault, 'commit').mockRejectedValueOnce(new Error('Disk unavailable'));
    await expect(drafts.activate('thread')).rejects.toThrow('Disk unavailable'); expect(vault.snapshot().activeThreadId).toBeUndefined();
    await drafts.activate('thread'); expect(vault.snapshot().activeThreadId).toBe('thread');
  });
  it('reads earlier backups, validates owners and bounds, and gives canonical browser/native revisions', async () => {
    const old = emptyWorkspace(); delete (old as Partial<typeof old>).composerDrafts; expect(workspaceSchema.parse(old).composerDrafts).toEqual([]);
    expect(workspaceSchema.safeParse({ ...old, composerDrafts: [draft(), draft()] }).success).toBe(false);
    expect(composerDraftSchema.safeParse(draft({ text: 'x'.repeat(256_001) })).success).toBe(false);
    expect(composerDraftSchema.safeParse({ ...draft(), unknown: true }).success).toBe(false);
    const revision = await composerRevision(draft()); expect(revision).toBe(createHash('sha256').update(composerContent(draft())).digest('hex'));
    expect(await composerRevision(draft({ updatedAt: 99 }))).toBe(revision);
    expect(await composerRevision(draft({ knowledgeCollectionIds: [] }))).toBe(revision);
    expect(await composerRevision(draft({ knowledgeCollectionIds: ['notes'] }))).not.toBe(revision);
    for (const change of [{ text: 'Different' }, { attachments: [{ id: 'file', name: 'notes.txt', content: 'Evidence' }] }, { model: 'different' }, { threadId: 'thread' }]) expect(await composerRevision(draft(change))).not.toBe(revision);
    expect(submitSchema.safeParse({ ...request, threadId: 'thread', composerRevision: revision, replay: { messageId: 'message', revision, action: 'retry' } }).success).toBe(false);
  });
  it('preserves text, attachments and selection per owner through restart and backup, and clears only an empty draft', async () => {
    const { vault, directory, drafts } = await setup(); await vault.update((state) => { state.threads.push(sampleThread()); });
    const attached = draft({ threadId: 'thread', text: '', attachments: [{ id: 'file', name: 'notes.txt', content: 'FULL_ATTACHMENT_EVIDENCE' }] });
    await drafts.save(draft()); await drafts.save(attached); await drafts.activate('thread');
    expect(vault.backup().composerDrafts).toEqual([draft(), attached]); expect(vault.snapshot().activeThreadId).toBe('thread');
    const restored = new WorkspaceVault(directory, codec); await restored.initialize(); expect(restored.snapshot().composerDrafts).toEqual([draft(), attached]); expect(restored.snapshot().activeThreadId).toBe('thread');
    await drafts.save(draft({ text: '' })); expect(vault.snapshot().composerDrafts).toEqual([attached]);
    await drafts.activate(); expect(vault.snapshot().activeThreadId).toBeUndefined();
    await drafts.save(draft({ text: '' })); expect(vault.snapshot().composerDrafts).toEqual([attached]);
    await expect(drafts.save(draft({ threadId: 'missing' }))).rejects.toThrow('no longer exists'); await expect(drafts.activate('missing')).rejects.toThrow('no longer exists');
    expect(vault.snapshot().composerDrafts).toEqual([attached]);
  });
  it('does not evict drafts at the count/size limits or commit a failed save', async () => {
    const { vault, drafts } = await setup();
    await drafts.save(draft()); vi.spyOn(vault, 'commit').mockRejectedValueOnce(new Error('Disk full')); await expect(drafts.save(draft({ text: 'New' }))).rejects.toThrow('Disk full'); expect(vault.snapshot().composerDrafts).toEqual([draft()]);
    await vault.update((state) => { state.threads = Array.from({ length: 100 }, (_, index) => sampleThread({ id: `thread-${index}` })); state.composerDrafts = state.threads.map((thread) => draft({ threadId: thread.id })); });
    await expect(drafts.save(draft())).rejects.toThrow('100 owners'); expect(vault.snapshot().composerDrafts).toHaveLength(100);
    const attachments = Array.from({ length: 12 }, (_, index) => ({ id: `file-${index}`, name: 'evidence.txt', content: 'x'.repeat(256_000) }));
    await vault.update((state) => { state.composerDrafts = state.threads.slice(0, 10).map((thread) => draft({ threadId: thread.id, attachments })); });
    await expect(drafts.save(draft({ attachments }))).rejects.toThrow('32 MB'); expect(vault.snapshot().composerDrafts).toHaveLength(10);
  });
  it('consumes the matching draft atomically with its turn and restores that conversation after restart', async () => {
    const { vault, drafts, directory } = await setup(); const pending = draft({ text: request.text }); await drafts.save(pending);
    const engine = new ConversationEngine(vault, { stream: async (_input, onText) => { onText('Done'); } }, vi.fn());
    const result = await engine.start({ ...request, composerRevision: await composerRevision(restoreComposer(vault.snapshot(), undefined, pending)) }); await engine.settle(result.threadId);
    expect(vault.snapshot().composerDrafts).toEqual([]); expect(vault.snapshot().activeThreadId).toBe(result.threadId); expect(vault.snapshot().threads[0].messages[0].content).toBe(request.text);
    const restarted = new WorkspaceVault(directory, codec); await restarted.initialize(); expect(restarted.snapshot().activeThreadId).toBe(result.threadId); expect(restarted.snapshot().composerDrafts).toEqual([]);
  });
  it('retains a changed draft, another owner and drafts after validation or initial persistence failures', async () => {
    const { vault, drafts } = await setup(); await vault.update((state) => { state.threads.push(sampleThread()); });
    const pending = draft({ text: request.text }); await drafts.save(pending); await drafts.save(draft({ threadId: 'thread' }));
    const engine = new ConversationEngine(vault, { stream: async () => {} }, vi.fn());
    await expect(engine.start({ ...request, providerId: 'missing', composerRevision: await composerRevision(pending) })).rejects.toThrow('Configure');
    vi.spyOn(vault, 'commit').mockRejectedValueOnce(new Error('Disk full')); await expect(engine.start({ ...request, composerRevision: await composerRevision(pending) })).rejects.toThrow('Disk full');
    expect(vault.snapshot().composerDrafts).toEqual([pending, draft({ threadId: 'thread' })]);
    await drafts.save(draft({ text: 'Typed while submitting' })); await drafts.activate('thread');
    const result = await engine.start({ ...request, composerRevision: await composerRevision(pending) }); await engine.settle(result.threadId);
    expect(vault.snapshot().composerDrafts).toEqual([draft({ text: 'Typed while submitting' }), draft({ threadId: 'thread' })]); expect(vault.snapshot().activeThreadId).toBe('thread');
  });
  it('restores explicit independent selections and safely drops removed providers, projects and extensions', () => {
    const state = emptyWorkspace(); state.providers.push(provider); state.preferences.defaultProviderId = provider.id; state.preferences.defaultModel = request.model;
    state.projects.push({ id: 'project', path: 'C:/project', name: 'Project', instructions: '', createdAt: 1 });
    const thread = sampleThread({ providerId: 'removed', assistantId: 'removed', projectId: 'project', mode: 'agent', mcpServerIds: ['missing'], skillIds: ['00000000-0000-4000-8000-000000000000'], pluginIds: ['00000000-0000-4000-8000-000000000000'] });
    expect(restoreComposer(state, thread)).toMatchObject({ threadId: thread.id, providerId: provider.id, model: request.model, projectId: 'project', mode: 'agent', assistantId: undefined, mcpServerIds: [], skillIds: [], pluginIds: [] });
    expect(restoreComposer(state, thread, draft({ projectId: undefined, assistantId: undefined }))).toMatchObject({ text: draft().text, projectId: undefined, assistantId: undefined, mode: 'chat' });
    state.projects = []; expect(restoreComposer(state, thread).mode).toBe('chat');
  });
  it('restores only enabled tools with current grants and matching project scope, retaining valid model and assistant choices', () => {
    const state = emptyWorkspace(); state.providers.push(provider); state.preferences.defaultProviderId = provider.id; state.preferences.defaultModel = request.model;
    state.projects.push({ id: 'project', path: 'C:/project', name: 'Project', instructions: '', createdAt: 1 });
    state.mcpServers = ['enabled', 'disabled'].map((id) => mcpServerSchema.parse({ id, name: id, transport: 'http', endpoint: 'http://localhost/mcp', enabled: id === 'enabled' }));
    const ids = Array.from({ length: 6 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);
    state.skills = ids.slice(0, 2).map((id, index) => skillSchema.parse({ id, name: id, description: '', importedAt: 1, enabled: index === 0 }));
    state.plugins = ids.map((id, index) => pluginSchema.parse({ id, manifest: { schemaVersion: 1, id: `test.plugin${index}`, name: id, version: '1.0.0', permissions: ['tools'] }, installedAt: 1, hashes: {}, enabled: index !== 2, grants: index === 3 ? [] : ['tools'], projectIds: index === 4 ? ['different'] : index === 5 ? ['project'] : [] }));
    const pending = draft({ threadId: 'thread', assistantId: 'writer', projectId: 'project', mode: 'plan', mcpServerIds: ['enabled', 'disabled', 'missing'], skillIds: ids.slice(0, 3), pluginIds: ids });
    expect(restoreComposer(state, sampleThread(), pending)).toMatchObject({ providerId: provider.id, model: request.model, assistantId: 'writer', projectId: 'project', mode: 'plan', mcpServerIds: ['enabled'], skillIds: [ids[0]], pluginIds: [ids[0], ids[1], ids[5]] });
    expect(restoreComposer(state, undefined, draft({ providerId: 'missing', model: 'old' }))).toMatchObject({ providerId: provider.id, model: request.model });
    expect(restoreComposer(state, sampleThread({ providerId: provider.id, model: 'alternate', assistantId: 'writer', projectId: 'project', mode: 'agent' }))).toMatchObject({ model: 'alternate', assistantId: 'writer', mode: 'agent' });
    expect(restoreComposer(emptyWorkspace())).toMatchObject({ providerId: undefined, model: '', assistantId: 'general', mode: 'chat' });
  });
});

describe('renderer conversation draft coordination', () => {
  it('coalesces queued regular selections while preserving temporary and flush ordering boundaries', async () => {
    const save = vi.fn().mockResolvedValue(undefined); const select = vi.fn().mockResolvedValue(undefined); const store = new ComposerDraftStore(save);
    const first = store.activate('first', select); const second = store.activate('second', select);
    const temporary = store.activate('private', select, true); const regular = store.activate('third', select);
    const barrier = store.flush(); const last = store.activate('last', select);
    await Promise.all([first, second, temporary, regular, barrier, last]);
    expect(select.mock.calls.map(([id]) => id)).toEqual(['second', 'private', 'third', 'last']);
  });
  it('combines dirty owners with selection, retains edits made in flight and orders later flushes', async () => {
    let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
    const save = vi.fn().mockResolvedValue(undefined); const select = vi.fn().mockImplementationOnce(() => hold);
    const store = new ComposerDraftStore(save); store.stage(draft()); store.stage(draft({ threadId: 'thread' }));
    const selection = store.activate('second', select); await Promise.resolve();
    expect(select).toHaveBeenCalledWith('second', [draft(), draft({ threadId: 'thread' })]);
    store.stage(draft({ text: 'Typed during activation' })); const flush = store.flush();
    expect(save).not.toHaveBeenCalled(); release(); await Promise.all([selection, flush]);
    expect(save).toHaveBeenCalledExactlyOnceWith(draft({ text: 'Typed during activation' }));
    expect(store.get('thread')).toEqual(draft({ threadId: 'thread' }));
  });
  it('retains every dirty owner on activation failure and retries without aliasing or redundant saves', async () => {
    const save = vi.fn().mockResolvedValue(undefined); const select = vi.fn().mockRejectedValueOnce(new Error('Disk unavailable')).mockResolvedValue(undefined);
    const store = new ComposerDraftStore(save); store.stage(draft());
    await expect(store.activate('thread', select)).rejects.toThrow('Disk unavailable');
    select.mock.calls[0][1][0].text = 'External mutation'; expect(store.get()).toEqual(draft());
    await store.activate('thread', select); expect(select.mock.calls[1][1]).toEqual([draft()]);
    await store.flush(); expect(save).not.toHaveBeenCalled();
    await store.activate(undefined, select); expect(select.mock.calls[2]).toEqual([undefined, []]);
  });
  it('consumes a submitted owner after navigating away while preserving newer text and other owners', () => {
    const store = new ComposerDraftStore(async () => {}); const submitted = draft({ threadId: 'thread' }); store.stage(submitted); store.stage(draft());
    expect(store.consume({ ...submitted, knowledgeCollectionIds: [], updatedAt: 10 })).toBe(true); expect(store.get('thread')).toBeUndefined(); expect(store.get()?.text).toBe(draft().text);
    expect(store.consume(submitted)).toBe(false); store.stage({ ...submitted, text: 'Newer' }); expect(store.consume(submitted)).toBe(false); expect(store.get('thread')?.text).toBe('Newer');
  });
  it('keeps independent cloned snapshots, flushes both owners after switching and forgets consumed drafts', async () => {
    const save = vi.fn<(value: ComposerDraft) => Promise<void>>(async () => {}); const store = new ComposerDraftStore(save); store.initialize([draft()]);
    const snapshot = store.get()!; snapshot.text = 'Changed outside'; expect(store.get()?.text).toBe(draft().text);
    const staged = draft({ threadId: 'thread' }); store.stage(staged); staged.text = 'Changed outside'; store.stage(draft({ text: 'New draft' })); await store.flush();
    expect(save.mock.calls.map(([item]) => item.text)).toEqual([draft().text, 'New draft']); store.forget('thread'); expect(store.get('thread')).toBeUndefined();
  });
  it('serializes overlapping flushes and writes input received during an in-flight save', async () => {
    let release!: () => void; const hold = new Promise<void>((resolve) => { release = resolve; });
    const save = vi.fn<(value: ComposerDraft) => Promise<void>>().mockImplementationOnce(() => hold).mockResolvedValue(undefined); const store = new ComposerDraftStore(save);
    store.stage(draft()); const first = store.flush(); await Promise.resolve(); store.stage(draft({ text: 'Latest' })); const second = store.flush(); expect(save).toHaveBeenCalledOnce(); release(); await Promise.all([first, second]);
    expect(save.mock.calls.map(([item]) => item.text)).toEqual([draft().text, 'Latest']);
  });
  it('retains failed drafts for retry, saves clearing tombstones, and replaces local state on backup restoration', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('Disk full')).mockResolvedValue(undefined); const store = new ComposerDraftStore(save); store.stage(draft());
    await expect(store.flush()).rejects.toThrow('Disk full'); expect(store.get()?.text).toBe(draft().text); await store.flush();
    store.stage(draft({ text: '' })); await store.flush(); expect(save.mock.calls.at(-1)?.[0].text).toBe('');
    store.stage(draft({ threadId: 'thread' })); store.forget('thread'); store.initialize([draft({ text: 'Restored' })]); await store.flush(); expect(store.get()?.text).toBe('Restored'); expect(save).toHaveBeenCalledTimes(3);
  });
});
