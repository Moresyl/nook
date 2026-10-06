import { createHash, randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { readWorkspaceFile as readFile } from './read-workspace-file';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { comparisonReply, comparisonSchema, comparisonThreads } from '../contracts/model-comparisons';
import { conversationHistory } from '../contracts/conversations';
import { threadSchema } from '../contracts/workspace';
import { ConversationEngine } from '../desktop/services/conversation-engine';
import type { ModelGateway, ModelInput } from '../desktop/services/model-gateway';
import { WorkspaceVault } from '../desktop/services/vault';
import { archiveConversation } from '../desktop/services/conversation-archive';
import { WorkspaceBackupFiles } from '../desktop/services/backup-files';
import { persistentWorkspace, parsePersistentWorkspace } from '../contracts/temporary-conversations';
import { codec, request, sampleThread, testVault } from './fixtures';

const directories: string[] = []; const engines: ConversationEngine[] = [];
afterEach(async () => { await Promise.all(engines.splice(0).map((engine) => engine.shutdown())); await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
const models = [{ providerId: 'local', model: 'one' }, { providerId: 'local', model: 'two' }];
const input = { text: 'Same question 中文 <img> {{literal}}', attachments: [], models };
const revision = (thread: ReturnType<typeof sampleThread>) => createHash('sha256').update(conversationHistory(thread)).digest('hex');
async function setup(gateway: ModelGateway = { stream: async (_input, text) => { text('reply'); } }, interval = 750) {
  const { vault, directory } = await testVault(); directories.push(directory);
  await vault.update((state) => { state.providers[0].models = ['one', 'two', 'three', 'four']; });
  const emit = vi.fn(); const engine = new ConversationEngine(vault, gateway, emit, undefined, interval); engines.push(engine);
  return { vault, directory, engine, emit };
}
describe('atomic comparison starts', () => {
  it('commits all four owned initial replies once, keeps the exact previous file and announces one complete state before held streams finish', async () => {
    const observed: ModelInput[] = [];
    const { engine, vault, directory, emit } = await setup({ stream: async (model, text) => {
      observed.push(model); text(`${model.model}: PARTIAL 中文😀`);
      await new Promise<void>((_resolve, reject) => model.signal.addEventListener('abort', () => reject(new Error('Stopped')), { once: true }));
    } }, 60_000);
    const attachment = { id: 'shared-evidence', name: '资料.txt', content: 'EXACT_SHARED_ATTACHMENT 中文😀' };
    const source = sampleThread({ messages: [{ id: 'prior-user', role: 'user', content: 'EXACT_PRIOR_QUESTION', attachments: [attachment], status: 'complete', createdAt: 1 }, { id: 'prior-reply', role: 'assistant', content: 'EXACT_PRIOR_REPLY', attachments: [], status: 'complete', createdAt: 2 }] });
    await vault.update((state) => { state.threads = [source]; state.activeThreadId = source.id; state.composerDrafts = [{ threadId: source.id, text: 'DRAFT_KEEP', attachments: [attachment], model: 'one', mode: 'chat', mcpServerIds: [], skillIds: [], pluginIds: [], updatedAt: 1 }]; });
    const previous = await readFile(join(directory, 'workspace.json')); const before = vault.snapshot(); const update = vi.spyOn(vault, 'commit');
    const result = await engine.compare({ ...input, threadId: source.id, revision: revision(source), attachments: [attachment], assistantId: 'general', models: [...models, { providerId: 'local', model: 'three' }, { providerId: 'local', model: 'four' }] });
    expect(observed).toHaveLength(4); expect(result.failedThreadIds).toEqual([]); expect(update).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls.filter(([event]) => event.state)).toHaveLength(1); expect(await readFile(join(directory, 'workspace.backup.json.gz'))).toEqual(previous);
    const committed = JSON.parse(await readFile(join(directory, 'workspace.json'), 'utf8')); const parsed = comparisonThreads(committed.threads, result.groupId);
    expect(parsed.map((thread) => thread.messages.at(-1)?.status)).toEqual(['running', 'running', 'running', 'running']);
    expect(parsed.every((thread) => thread.messages.length === 4 && thread.messages.at(-2)?.content === input.text)).toBe(true);
    expect(observed.every((model) => model.messages.length === 3 && model.messages.at(-1)?.attachments[0].content === attachment.content && model.instructions.includes('Be clear'))).toBe(true);
    const current = vault.snapshot(); expect(current.threads.find((thread) => thread.id === source.id)).toEqual(source); expect(current.composerDrafts).toEqual(before.composerDrafts); expect(current.activeThreadId).toBe(source.id);
  });
});
describe('comparison start shutdown', () => {
  it('releases every reserved response and preserves both exact files when shutdown wins the queued atomic group commit', async () => {
    const stream = vi.fn(); const { engine, vault, directory } = await setup({ stream }); const update = vault.commit.bind(vault);
    const before = await readFile(join(directory, 'workspace.json')); const backup = await readFile(join(directory, 'workspace.backup.json.gz'));
    let release!: () => void; let queued!: () => void; const held = new Promise<void>((resolve) => { release = resolve; }); const started = new Promise<void>((resolve) => { queued = resolve; });
    vi.spyOn(vault, 'commit').mockImplementationOnce(async (change) => { queued(); await held; return update(change); });
    const comparing = engine.compare({ ...input, models: [...models, { providerId: 'local', model: 'three' }, { providerId: 'local', model: 'four' }] }); await started;
    const closing = engine.shutdown(); release(); await expect(comparing).rejects.toThrow('shutting down'); await closing;
    expect(stream).not.toHaveBeenCalled(); expect(engine.active()).toBe(false); expect(vault.snapshot().threads).toEqual([]);
    expect(await readFile(join(directory, 'workspace.json'))).toEqual(before); expect(await readFile(join(directory, 'workspace.backup.json.gz'))).toEqual(backup);
  });
});
describe('model comparison contracts', () => {
  it('accepts two to four distinct provider/model pairs, including punctuation without composite-key collisions', () => {
    expect(comparisonSchema.parse(input).models).toEqual(models);
    expect(comparisonSchema.parse({ ...input, models: [{ providerId: 'a:b', model: 'c' }, { providerId: 'a', model: 'b:c' }] }).models).toHaveLength(2);
    expect(comparisonSchema.parse({ ...input, models: [...models, { providerId: 'local', model: 'three' }, { providerId: 'other', model: 'one' }] }).models).toHaveLength(4);
    for (const selected of [[], [models[0]], [models[0], models[0]], [...models, ...models, models[0]]]) expect(() => comparisonSchema.parse({ ...input, models: selected })).toThrow();
  });
  it('requires a revision exactly with an existing context and rejects hidden replay/tool/storage options', () => {
    expect(comparisonSchema.parse({ ...input, threadId: 'source', revision: 'a'.repeat(64) }).threadId).toBe('source');
    for (const extra of [{ threadId: 'source' }, { revision: 'a'.repeat(64) }, { mode: 'agent' }, { temporary: true }, { replay: {} }, { threadId: '\0', revision: 'a'.repeat(64) }]) expect(() => comparisonSchema.parse({ ...input, ...extra })).toThrow();
  });
  it('sorts surviving members by their fixed position and rejects ambiguous identifiers or positions', () => {
    const groupId = randomUUID(); const one = sampleThread({ id: 'one', comparison: { groupId, index: 0, contextLength: 0 } }); const two = sampleThread({ id: 'two', comparison: { groupId, index: 1, contextLength: 0 } });
    expect(comparisonThreads([two, sampleThread(), one], groupId)).toEqual([one, two]); expect(comparisonThreads([two], groupId)).toEqual([two]); expect(comparisonThreads([one], randomUUID())).toEqual([]);
    expect(() => comparisonThreads([one, one], groupId)).toThrow('ambiguous'); expect(() => comparisonThreads([one, { ...two, comparison: one.comparison }], groupId)).toThrow('ambiguous');
    expect(() => comparisonThreads([one, { ...two, id: one.id }], groupId)).toThrow('ambiguous');
    expect(() => comparisonThreads(Array.from({ length: 5 }, (_, index) => ({ ...one, id: String(index), comparison: { groupId, index, contextLength: 0 } })), groupId)).toThrow('ambiguous');
    expect(threadSchema.parse(sampleThread()).comparison).toBeUndefined();
    for (const comparison of [{ groupId: 'invalid', index: 0, contextLength: 0 }, { groupId, index: 4, contextLength: 0 }, { groupId, index: 0, contextLength: 4999 }, { groupId, index: 0, contextLength: 0, hidden: true }]) expect(() => threadSchema.parse({ ...one, comparison })).toThrow();
  });
});
describe('independent parallel model comparisons', () => {
  it('retains an uncheckpointed partial reply in a later parallel initial-state notification', async () => {
    const callbacks = new Map<string, (text: string) => void>();
    const { engine, vault, emit } = await setup({ stream: async (model, text) => { callbacks.set(model.model, text); await new Promise<void>((_resolve, reject) => model.signal.addEventListener('abort', () => reject(new Error('Stopped')), { once: true })); } }, 60_000);
    const update = vault.commit.bind(vault); let calls = 0; let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(vault, 'commit').mockImplementation(async (change) => { const own = ++calls; const saved = await update(change); if (own === 2) await held; return saved; });
    const comparing = (async () => { const first = await engine.start({ ...request, model: 'one' }); const second = await engine.start({ ...request, model: 'two' }); return { threadIds: [first.threadId, second.threadId] }; })();
    try {
      await vi.waitFor(() => { expect(callbacks.has('one')).toBe(true); });
      callbacks.get('one')!('one: PARTIAL');
      expect(vault.snapshot().threads[0].messages.at(-1)?.content).toBe('');
      release(); const result = await comparing;
      const later = emit.mock.calls.map(([event]) => event).find((event) => event.state && event.threadId === result.threadIds[1]);
      expect(later?.state?.threads.find((thread: ReturnType<typeof sampleThread>) => thread.id === result.threadIds[0])?.messages.at(-1)).toMatchObject({ content: 'one: PARTIAL', status: 'running' });
      expect(vault.snapshot().threads[0].messages.at(-1)?.content).toBe('');
      later!.state!.threads[0].messages.at(-1)!.content = 'Modified emitted copy';
      await engine.stop(result.threadIds[0]);
      expect(vault.snapshot().threads[0].messages.at(-1)?.content).toBe('one: PARTIAL');
    } finally { release(); await comparing; await engine.shutdown(); }
  });
  it('retains new stream text when an earlier empty checkpoint returns after the delta', async () => {
    let text!: (value: string) => void;
    const { engine, vault, emit } = await setup({ stream: async (model, callback) => { text = callback; await new Promise<void>((_resolve, reject) => model.signal.addEventListener('abort', () => reject(new Error('Stopped')), { once: true })); } }, 10);
    const update = vault.checkpointMessages.bind(vault); let calls = 0; let release!: () => void; let checkpointStarted!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; }); const started = new Promise<void>((resolve) => { checkpointStarted = resolve; });
    vi.spyOn(vault, 'checkpointMessages').mockImplementation(async (entries) => { const own = ++calls; const saved = await update(entries); if (own === 1) { checkpointStarted(); await held; } return saved; });
    await engine.start({ ...request, model: 'one' });
    try {
      await started; text('one: PARTIAL');
      expect(vault.snapshot().threads[0].messages.at(-1)?.content).toBe('');
      release();
      await vi.waitFor(() => { expect(emit.mock.calls.some(([event]) => event.message)).toBe(true); });
      const checkpoint = emit.mock.calls.find(([event]) => event.message)?.[0];
      expect(checkpoint?.message).toMatchObject({ content: 'one: PARTIAL', status: 'running' });
    } finally { release(); await engine.shutdown(); }
  });
  it('samples a queued checkpoint when its transaction runs without announcing unsaved completion', async () => {
    let text!: (value: string) => void; let finish!: () => void;
    const stream = new Promise<void>((resolve) => { finish = resolve; });
    const { engine, vault, emit } = await setup({ stream: async (_model, callback) => { text = callback; await stream; } }, 10);
    const update = vault.checkpointMessages.bind(vault); let calls = 0; let release!: () => void; let checkpointStarted!: () => void; let queuedContent: string | undefined;
    const held = new Promise<void>((resolve) => { release = resolve; }); const started = new Promise<void>((resolve) => { checkpointStarted = resolve; });
    vi.spyOn(vault, 'checkpointMessages').mockImplementation(async (entries) => { const own = ++calls; if (own === 1) { checkpointStarted(); await held; } const saved = await update(entries); if (own === 1) queuedContent = saved.threads[0].messages.at(-1)?.content; return saved; });
    const { threadId } = await engine.start({ ...request, model: 'one' });
    try {
      await started; text('one: PARTIAL'); release();
      await vi.waitFor(() => { expect(queuedContent).toBeDefined(); });
      expect(queuedContent).toBe('one: PARTIAL');
      expect(vault.snapshot().threads[0].messages.at(-1)?.status).toBe('running');
      finish(); await engine.settle(threadId);
      expect(emit.mock.calls.at(-1)?.[0].state?.threads[0].messages.at(-1)).toMatchObject({ content: 'one: PARTIAL', status: 'complete' });
    } finally { release(); finish(); await engine.shutdown(); }
  });
  it('keeps terminal status running until its final transaction commits and does not revive deleted messages', async () => {
    let finish!: () => void; const stream = new Promise<void>((resolve) => { finish = resolve; });
    const { engine, vault, emit } = await setup({ stream: async (model, text) => { text(`${model.model}: PARTIAL`); if (model.model === 'one') await stream; else await new Promise<void>((_resolve, reject) => model.signal.addEventListener('abort', () => reject(new Error('Stopped')), { once: true })); } }, 60_000);
    const update = vault.commit.bind(vault); const checkpoint = vault.checkpointMessages.bind(vault); let release!: () => void; let finalStarted!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; }); const started = new Promise<void>((resolve) => { finalStarted = resolve; });
    const first = await engine.start({ ...request, model: 'one' });
    vi.spyOn(vault, 'checkpointMessages').mockImplementationOnce(async (entries) => { finalStarted(); await held; return checkpoint(entries); });
    try {
      finish(); await started;
      await engine.start({ ...request, model: 'two' });
      const pending = emit.mock.calls.filter(([event]) => event.state).at(-1)?.[0].state;
      expect(pending?.threads.find((thread: ReturnType<typeof sampleThread>) => thread.id === first.threadId)?.messages.at(-1)).toMatchObject({ content: 'one: PARTIAL', status: 'running' });
      expect(vault.snapshot().threads[0].messages.at(-1)?.content).toBe('');
      release(); await engine.settle(first.threadId);
      const completed = emit.mock.calls.filter(([event]) => event.state).at(-1)?.[0].state;
      expect(completed?.threads[0].messages.at(-1)?.status).toBe('complete'); expect(completed?.threads[1].messages.at(-1)?.content).toBe('two: PARTIAL');
      await update((state) => { state.threads[1].messages = []; });
      await engine.start({ ...request, model: 'three' });
      const removed = emit.mock.calls.filter(([event]) => event.state).at(-1)?.[0].state;
      expect(removed?.threads[1].messages).toEqual([]);
    } finally { release(); finish(); await engine.shutdown(); }
  });
  it('does not regress a durable partial reply when a later initial-save callback releases an older whole-state snapshot', async () => {
    const { engine, vault, emit } = await setup({ stream: async (model, text) => { text(`${model.model}: PARTIAL`); await new Promise<void>((_resolve, reject) => model.signal.addEventListener('abort', () => reject(new Error('Stopped')), { once: true })); } }, 10);
    const update = vault.commit.bind(vault); let calls = 0; let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(vault, 'commit').mockImplementation(async (change) => { const own = ++calls; const saved = await update(change); if (own === 2) await held; return saved; });
    const comparing = (async () => { const first = await engine.start({ ...request, model: 'one' }); const second = await engine.start({ ...request, model: 'two' }); return { threadIds: [first.threadId, second.threadId] }; })();
    try {
      await vi.waitFor(() => { expect(vault.snapshot().threads[0]?.messages.at(-1)?.content).toContain('one: PARTIAL'); expect(emit.mock.calls.some(([event]) => event.message?.content.includes('one: PARTIAL'))).toBe(true); });
      release(); const result = await comparing;
      const laterInitialNotification = emit.mock.calls.map(([event]) => event).find((event) => event.state && event.threadId === result.threadIds[1]);
      expect(laterInitialNotification?.state?.threads.find((thread: ReturnType<typeof sampleThread>) => thread.id === result.threadIds[0])?.messages.at(-1)?.content).toContain('one: PARTIAL');
      await Promise.all(result.threadIds.map((id) => engine.stop(id)));
    } finally { release(); await comparing.catch(() => {}); await engine.shutdown(); }
  });
  it('retains the recorded comparison origin after an actual continuation changes models and the vault restarts', async () => {
    const { engine, vault, directory } = await setup(); const result = await engine.compare(input); await Promise.all(result.threadIds.map((id) => engine.settle(id)));
    const origin = comparisonReply(vault.snapshot().threads.find((thread) => thread.id === result.threadIds[0])!);
    expect(origin).toMatchObject({ model: 'one', providerName: 'Local', message: { role: 'assistant', status: 'complete' } });
    await engine.start({ ...request, threadId: result.threadIds[0], model: 'two' }); await engine.settle(result.threadIds[0]);
    await vault.update((state) => { state.providers[0].name = 'Renamed connection'; });
    const continued = vault.snapshot().threads.find((thread) => thread.id === result.threadIds[0])!; expect(continued.model).toBe('two'); expect(continued.messages.at(-1)?.invocations?.[0].model).toBe('two'); expect(comparisonReply(continued)).toEqual(origin);
    const restarted = new WorkspaceVault(directory, codec); await restarted.initialize(); expect(comparisonReply(restarted.snapshot().threads.find((thread) => thread.id === continued.id)!)).toEqual(origin);
  });
  it('uses the original reply position and final recorded invocation without borrowing a later reply or mutating history', () => {
    const invocation = { round: 0, providerId: 'original', providerName: 'Original connection', providerKind: 'openai' as const, model: 'initial-model', destination: 'https://example.invalid/v1', startedAt: 1, status: 'complete' as const };
    const message = { id: 'message', role: 'assistant' as const, content: 'Original reply', attachments: [], status: 'complete' as const, createdAt: 1, invocations: [invocation, { ...invocation, round: 1, model: 'recorded-model' }] };
    const thread = sampleThread({ model: 'later-model', providerId: 'later', comparison: { groupId: randomUUID(), index: 0, contextLength: 2 }, messages: [{ ...message, id: 'base-user', role: 'user', invocations: undefined }, { ...message, id: 'base-reply' }, { ...message, id: 'question', role: 'user', invocations: undefined }, message, { ...message, id: 'continuation', role: 'user', invocations: undefined }, { ...message, id: 'later-reply', invocations: [{ ...invocation, providerName: 'Later connection', model: 'later-model' }] }] });
    const before = structuredClone(thread); expect(comparisonReply(thread)).toEqual({ message, providerName: 'Original connection', model: 'recorded-model' }); expect(thread).toEqual(before);
  });
  it('keeps missing or invalid original replies distinct from an unrecorded request and never guesses their origin', () => {
    const message = { id: 'message', role: 'assistant' as const, content: '', attachments: [], status: 'error' as const, createdAt: 1 };
    const comparison = { groupId: randomUUID(), index: 0, contextLength: 0 };
    expect(comparisonReply(sampleThread({ messages: [message, message] }))).toEqual({});
    expect(comparisonReply(sampleThread({ comparison }))).toEqual({});
    expect(comparisonReply(sampleThread({ comparison, messages: [message, { ...message, role: 'user' }] }))).toEqual({});
    for (const original of [message, { ...message, invocations: [] }]) expect(comparisonReply(sampleThread({ comparison, model: 'unrelated', messages: [message, original] }))).toEqual({ message: original, providerName: undefined, model: undefined });
  });
  it('announces each durable running checkpoint so an initial parallel state snapshot cannot permanently hide partial text', async () => {
    const { engine, emit } = await setup({ stream: async (model, text) => { text(`${model.model}: PARTIAL`); await new Promise<void>((_resolve, reject) => model.signal.addEventListener('abort', () => reject(new Error('Stopped')), { once: true })); } }, 10);
    const result = await engine.compare(input);
    await vi.waitFor(() => { const checkpoints = emit.mock.calls.map(([event]) => event).filter((event) => event.message?.status === 'running'); expect(new Set(checkpoints.map((event) => event.threadId)).size).toBe(2); expect(checkpoints.every((event) => event.message.content.includes('PARTIAL'))).toBe(true); });
    expect(result.threadIds.every((id) => engine.active(id))).toBe(true);
  });
  it('starts all streams before any completes, sends identical full context and attachments, and retains original drafts and active owner', async () => {
    const observed: ModelInput[] = []; let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; });
    const { engine, vault } = await setup({ stream: async (model, text) => { observed.push(model); text(`${model.model}: partial`); await held; text(': finished'); } });
    const attachment = { id: 'attachment', name: '中文.txt', content: 'same evidence' };
    const source = sampleThread({ branchOrder: 2, messages: [{ id: 'u', role: 'user', content: 'exact previous', attachments: [attachment], createdAt: 1, status: 'complete' }, { id: 'a', role: 'assistant', content: 'previous reply', attachments: [], createdAt: 2, status: 'complete' }] });
    await vault.update((state) => { state.threads.push(source); state.activeThreadId = source.id; state.composerDrafts.push({ threadId: source.id, text: 'SOURCE_DRAFT_KEEP', attachments: [attachment], model: 'one', mode: 'agent', mcpServerIds: [], skillIds: [], pluginIds: [], updatedAt: 1 }); });
    const before = vault.snapshot(); const result = await engine.compare({ ...input, threadId: source.id, revision: revision(source), attachments: [attachment], assistantId: 'general' });
    expect(observed).toHaveLength(2); expect(result.failedThreadIds).toEqual([]); expect(result.threadIds.every((id) => engine.active(id))).toBe(true);
    expect(observed[0].messages.slice(0, -1)).toEqual(observed[1].messages.slice(0, -1));
    expect(observed.every((model) => model.messages.at(-1)?.content === input.text && model.messages.at(-1)?.attachments[0].content === 'same evidence' && model.instructions.includes('Be clear') && !model.tools?.length)).toBe(true);
    expect(vault.snapshot().threads.find((thread) => thread.id === source.id)).toEqual(source); expect(vault.snapshot().composerDrafts).toEqual(before.composerDrafts); expect(vault.snapshot().activeThreadId).toBe(source.id);
    expect(comparisonThreads(vault.snapshot().threads, result.groupId).every((thread) => !thread.branchOrder && thread.forkedFrom?.threadId === source.id && thread.mode === 'chat')).toBe(true);
    release(); await Promise.all(result.threadIds.map((id) => engine.settle(id))); expect(comparisonThreads(vault.snapshot().threads, result.groupId).map((thread) => thread.messages.at(-1)?.content)).toEqual(['one: partial: finished', 'two: partial: finished']);
  });
  it('retains independent provider failure and partial stop while other requests finish and can be continued', async () => {
    const { engine, vault } = await setup({ stream: async (model, text) => { text(model.model); if (model.model === 'one') throw new Error('Fixture provider failure'); if (model.model === 'two') await new Promise<void>((_resolve, reject) => model.signal.addEventListener('abort', () => reject(new Error('Stopped')), { once: true })); } });
    const result = await engine.compare({ ...input, models: [...models, { providerId: 'local', model: 'three' }] });
    await engine.settle(result.threadIds[0]); expect(engine.active(result.threadIds[1])).toBe(true); await engine.stop(result.threadIds[1]); await engine.settle(result.threadIds[2]);
    expect(comparisonThreads(vault.snapshot().threads, result.groupId).map((thread) => thread.messages.at(-1)?.status)).toEqual(['error', 'stopped', 'complete']);
    await engine.start({ ...request, threadId: result.threadIds[2], model: 'three', text: 'Continue selected' }); await engine.settle(result.threadIds[2]);
    expect(vault.snapshot().threads.find((thread) => thread.id === result.threadIds[2])?.messages).toHaveLength(4); expect(comparisonThreads(vault.snapshot().threads, result.groupId)).toHaveLength(3);
  });
  it('validates every provider, model, credential, assistant and project before saving or making any model request', async () => {
    const stream = vi.fn(); const { engine, vault, directory } = await setup({ stream }); const before = await readFile(join(directory, 'workspace.json'));
    for (const extra of [{ models: [models[0], { providerId: 'missing', model: 'two' }] }, { models: [models[0], { providerId: 'local', model: 'missing' }] }, { assistantId: 'missing' }, { projectId: 'missing' }, { threadId: 'missing', revision: 'a'.repeat(64) }]) await expect(engine.compare({ ...input, ...extra })).rejects.toThrow();
    expect(stream).not.toHaveBeenCalled(); expect(await readFile(join(directory, 'workspace.json'))).toEqual(before);
    await vault.update((state) => { state.providers.push({ ...state.providers[0], id: 'remote', kind: 'openai' }); });
    await expect(engine.compare({ ...input, models: [models[0], { providerId: 'remote', model: 'two' }] })).rejects.toThrow('every selected'); expect(stream).not.toHaveBeenCalled(); expect(vault.snapshot().threads).toEqual([]);
  });
  it('rejects stale or running context without modifying the source or consuming its draft', async () => {
    const { engine, vault } = await setup(); const source = sampleThread({ messages: [{ id: 'a', role: 'assistant', content: 'running', attachments: [], status: 'running', createdAt: 1 }] });
    await vault.update((state) => { state.threads.push(source); }); await expect(engine.compare({ ...input, threadId: source.id, revision: 'a'.repeat(64) })).rejects.toThrow('changed');
    await expect(engine.compare({ ...input, threadId: source.id, revision: revision(source) })).rejects.toThrow('Stop'); expect(vault.snapshot().threads).toEqual([source]);
  });
  it('revalidates live context inside the FIFO write after a captured history change', async () => {
    const stream = vi.fn(); const { engine, vault } = await setup({ stream }); const source = sampleThread(); await vault.update((state) => { state.threads.push(source); });
    const update = vault.commit.bind(vault); vi.spyOn(vault, 'commit').mockImplementationOnce(async (change) => { await update((state) => { state.threads[0].messages.push({ id: 'later', role: 'user', content: 'Changed', attachments: [], status: 'complete', createdAt: 1 }); }); return update(change); });
    await expect(engine.compare({ ...input, threadId: source.id, revision: revision(source) })).rejects.toThrow('changed'); expect(stream).not.toHaveBeenCalled(); expect(vault.snapshot().threads).toHaveLength(1);
  });
  it('keeps both workspace files and every reservation unchanged when the atomic group save fails', async () => {
    const stream = vi.fn(); const { engine, vault, directory } = await setup({ stream }); const before = await readFile(join(directory, 'workspace.json'));
    vi.spyOn(vault, 'commit').mockRejectedValueOnce(new Error('Fixture EIO'));
    await expect(engine.compare(input)).rejects.toThrow('EIO'); expect(stream).not.toHaveBeenCalled(); expect(engine.active()).toBe(false); expect(vault.snapshot().threads).toEqual([]); expect(await readFile(join(directory, 'workspace.json'))).toEqual(before);
  });
  it('keeps a failed atomic start outside both files, preserves an unrelated running response and retries the whole intact group', async () => {
    const stream = vi.fn(async (model: ModelInput, text: (value: string) => void) => { text(model.model); if (model.model === 'three') await new Promise<void>((_resolve, reject) => model.signal.addEventListener('abort', () => reject(new Error('Stopped')), { once: true })); });
    const { engine, vault, directory } = await setup({ stream }, 60_000); const existing = await engine.start({ ...request, model: 'three' });
    const before = await readFile(join(directory, 'workspace.json')); const backup = await readFile(join(directory, 'workspace.backup.json.gz')); const captured = vault.snapshot();
    vi.spyOn(vault, 'commit').mockRejectedValueOnce(new Error('PRIVATE_CREDENTIAL_OR_PATH'));
    await expect(engine.compare(input)).rejects.toThrow('PRIVATE_CREDENTIAL_OR_PATH'); expect(stream).toHaveBeenCalledTimes(1); expect(engine.active(existing.threadId)).toBe(true);
    expect(vault.snapshot()).toEqual(captured); expect(await readFile(join(directory, 'workspace.json'))).toEqual(before); expect(await readFile(join(directory, 'workspace.backup.json.gz'))).toEqual(backup);
    const result = await engine.compare(input); await Promise.all(result.threadIds.map((id) => engine.settle(id))); expect(result.failedThreadIds).toEqual([]);
    const current = vault.snapshot(); expect(comparisonThreads(current.threads, result.groupId).map((thread) => thread.messages.at(-1)?.content)).toEqual(['one', 'two']); expect(JSON.stringify(current)).not.toContain('PRIVATE_CREDENTIAL_OR_PATH'); expect(engine.active(existing.threadId)).toBe(true);
    await engine.stop(existing.threadId);
  });
  it('persists the group, original reply position and independent contexts through actual vault restart', async () => {
    const { engine, vault, directory } = await setup(); const result = await engine.compare(input); await Promise.all(result.threadIds.map((id) => engine.settle(id)));
    const before = vault.snapshot(); const restarted = new WorkspaceVault(directory, codec); await restarted.initialize(); expect(comparisonThreads(restarted.snapshot().threads, result.groupId)).toEqual(comparisonThreads(before.threads, result.groupId));
    const archive = await vault.update((state) => { archiveConversation(state, state.threads[0], state.threads[0].messages[1].id, 'reply', Date.now()); });
    expect(archive.threads.at(-1)?.comparison).toBeUndefined(); expect(comparisonThreads(archive.threads, result.groupId)).toHaveLength(2);
    const files = new WorkspaceBackupFiles();
    for (const name of ['comparison-backup.json', 'comparison-backup.json.gz']) { const path = join(directory, name); await files.write(path, persistentWorkspace(archive)); const restored = parsePersistentWorkspace(await files.read(path)); expect(comparisonThreads(restored.threads, result.groupId)).toEqual(comparisonThreads(archive.threads, result.groupId)); }
  });
  it('keeps temporary comparisons and their new drafts out of both history files and normal restart', async () => {
    const { engine, vault, directory } = await setup(); const source = sampleThread({ temporary: true }); await vault.update((state) => { state.threads.push(source); });
    const before = await readFile(join(directory, 'workspace.json')); const beforeBackup = await readFile(join(directory, 'workspace.backup.json.gz')); const result = await engine.compare({ ...input, threadId: source.id, revision: revision(source) }); await Promise.all(result.threadIds.map((id) => engine.settle(id)));
    expect(comparisonThreads(vault.snapshot().threads, result.groupId).every((thread) => thread.temporary)).toBe(true); expect(await readFile(join(directory, 'workspace.json'))).toEqual(before);
    expect(await readFile(join(directory, 'workspace.backup.json.gz'))).toEqual(beforeBackup); expect(persistentWorkspace(vault.snapshot()).threads).toEqual([]);
    const restarted = new WorkspaceVault(directory, codec); await restarted.initialize(); expect(restarted.snapshot().threads).toEqual([]);
  });
  it('rejects group creation after shutdown and at the exact conversation and message limits', async () => {
    const { engine, vault } = await setup(); await vault.update((state) => { state.threads = Array.from({ length: 9999 }, (_, index) => sampleThread({ id: `limit-${index}` })); }); await expect(engine.compare(input)).rejects.toThrow('history'); expect(vault.snapshot().threads).toHaveLength(9999);
    const source = sampleThread({ messages: Array.from({ length: 4999 }, (_, index) => ({ id: `message-${index}`, role: 'user' as const, content: 'x', attachments: [], createdAt: 1, status: 'complete' as const })) }); await vault.update((state) => { state.threads = [source]; }); await expect(engine.compare({ ...input, threadId: source.id, revision: revision(source) })).rejects.toThrow('message limit');
    await engine.shutdown(); await expect(engine.compare(input)).rejects.toThrow('shutting down'); expect(vault.snapshot().threads).toEqual([source]);
  });
  it('treats a held initial group save as active and waits for its rejection before completing shutdown', async () => {
    const stream = vi.fn(); const { engine, vault } = await setup({ stream }); const update = vault.commit.bind(vault); let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(vault, 'commit').mockImplementationOnce(async (change) => { await held; return update(change); });
    const outcome = engine.compare(input).catch((failure) => failure); expect(engine.active()).toBe(true);
    let closed = false; const shutdown = engine.shutdown().then(() => { closed = true; }); await Promise.resolve(); expect(closed).toBe(false);
    release(); expect((await outcome).message).toContain('shutting down'); await shutdown; expect(closed).toBe(true); expect(engine.active()).toBe(false); expect(stream).not.toHaveBeenCalled(); expect(vault.snapshot().threads).toEqual([]);
  });
});
