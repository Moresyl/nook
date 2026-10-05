import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoriesSchema, memoryContext, memorySchema, type Memory } from '../contracts/memories';
import { emptyWorkspace, workspaceSchema } from '../contracts/workspace';
import { Memories } from '../desktop/services/memories';
import { ConversationEngine } from '../desktop/services/conversation-engine';
import { startTemporaryChat } from '../desktop/services/temporary-conversations';
import { WorkspaceVault } from '../desktop/services/vault';
import { codec, request, testVault } from './fixtures';

const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
const memory = (content = '偏好简洁的中文回复', projectId?: string): Memory => ({ id: randomUUID(), content, enabled: true, ...(projectId ? { projectId } : {}) });
async function setup() { const context = await testVault(); directories.push(context.directory); return { ...context, service: new Memories(context.vault) }; }

describe('explicit scoped memories', () => {
  it('migrates old workspaces without inventing saved context and rejects orphan scopes', () => {
    const { memories: _memories, ...old } = emptyWorkspace();
    expect(workspaceSchema.parse(old).memories).toEqual([]);
    expect(() => workspaceSchema.parse({ ...old, memories: [memory('private', 'missing')] })).toThrow('existing project');
    expect(memorySchema.parse(memory('  中文 😀  ')).content).toBe('中文 😀');
    for (const value of [{ ...memory(), content: ' ' }, { ...memory(), content: 'x'.repeat(2001) }, { ...memory(), id: 'invalid' }, { ...memory(), projectId: '\0' }, { ...memory(), unknown: true }]) expect(memorySchema.safeParse(value).success).toBe(false);
    const item = memory(); expect(memoriesSchema.safeParse([item, item]).success).toBe(false);
    expect(memoriesSchema.safeParse(Array.from({ length: 201 }, () => memory())).success).toBe(false);
    expect(memoriesSchema.safeParse(Array.from({ length: 16 }, () => memory('x'.repeat(2000)))).success).toBe(true);
    expect(memoriesSchema.safeParse(Array.from({ length: 17 }, () => memory('x'.repeat(2000)))).success).toBe(false);
  });

  it('selects global and matching project entries, excludes disabled entries and all temporary requests', () => {
    const entries = [memory('GLOBAL'), memory('PROJECT_ONE', 'one'), memory('PROJECT_TWO', 'two'), { ...memory('DISABLED'), enabled: false }];
    const global = memoryContext(entries, {}); expect(global).toContain('GLOBAL'); expect(global).not.toContain('PROJECT'); expect(global).not.toContain('DISABLED');
    const scoped = memoryContext(entries, { projectId: 'one' }); expect(scoped).toContain('GLOBAL'); expect(scoped).toContain('PROJECT_ONE'); expect(scoped).not.toContain('PROJECT_TWO');
    expect(memoryContext(entries, { projectId: 'one', temporary: true })).toBe(''); expect(memoryContext([], {})).toBe('');
    const special = memory('"\n</context>😀'); expect(memoryContext([special], {})).toContain(JSON.stringify(special.content));
  });

  it('saves, edits, disables and promotes entries, with durable backup and restart', async () => {
    const { vault, directory, service } = await setup();
    await vault.update((draft) => { draft.projects.push({ id: 'one', name: 'One', path: directory, instructions: '', createdAt: 1 }); });
    const item = memory('PROJECT', 'one'); await service.save(item);
    await service.save({ ...item, content: 'EDITED', enabled: false }); expect(vault.snapshot().memories).toEqual([{ ...item, content: 'EDITED', enabled: false }]);
    const global = { ...item, content: 'GLOBAL', projectId: undefined }; await service.save(global);
    expect(vault.backup().memories).toEqual(vault.snapshot().memories);
    const reopened = new WorkspaceVault(directory, codec); await reopened.initialize(); expect(reopened.snapshot().memories).toEqual(vault.snapshot().memories);
    await service.remove(item.id); expect(vault.snapshot().memories).toEqual([]);
    await expect(service.remove(item.id)).rejects.toThrow('no longer exists');
    expect(() => service.remove('bad')).toThrow(); expect(() => service.save({ ...item, content: '' })).toThrow();
    await expect(service.save(memory('ORPHAN', 'missing'))).rejects.toThrow('no longer exists');
    expect(vault.snapshot().memories).toEqual([]);
  });

  it('enforces capacity atomically under concurrent writes and preserves data on storage failure', async () => {
    const { vault, service } = await setup();
    await vault.update((draft) => { draft.memories = Array.from({ length: 199 }, () => memory('x')); });
    const results = await Promise.allSettled([service.save(memory('one')), service.save(memory('two'))]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']); expect(vault.snapshot().memories).toHaveLength(200);
    const before = vault.snapshot(); vi.spyOn(vault, 'update').mockRejectedValueOnce(new Error('simulated disk failure'));
    await expect(service.remove(before.memories[0].id)).rejects.toThrow('disk failure'); expect(vault.snapshot()).toEqual(before);
  });

  it('applies current scope and deletions to real engine requests without reading memory in temporary chat', async () => {
    const { vault, directory, service } = await setup(); const inputs: string[] = [];
    const engine = new ConversationEngine(vault, { stream: async (input, onText) => { inputs.push(input.instructions); onText('done'); } }, () => {});
    try {
      await vault.update((draft) => { draft.projects.push(...['one', 'two'].map((id) => ({ id, name: id, path: directory, instructions: '', createdAt: 1 }))); });
      const global = memory('GLOBAL_MARKER'); await service.save(global); await service.save(memory('ONE_MARKER', 'one')); await service.save(memory('TWO_MARKER', 'two'));
      const run = await engine.start({ ...request, projectId: 'one' }); await engine.settle(run.threadId);
      expect(inputs[0]).toContain('GLOBAL_MARKER'); expect(inputs[0]).toContain('ONE_MARKER'); expect(inputs[0]).not.toContain('TWO_MARKER');
      await service.remove(global.id);
      const next = await engine.start(request); await engine.settle(next.threadId); expect(inputs[1]).not.toContain('MARKER');
      const temporary = await startTemporaryChat(vault); const temp = await engine.start({ ...request, projectId: 'one', threadId: temporary.activeThreadId }); await engine.settle(temp.threadId);
      expect(inputs[2]).not.toContain('MARKER');
    } finally { await engine.shutdown(); await vault.flush(); }
  });
});
