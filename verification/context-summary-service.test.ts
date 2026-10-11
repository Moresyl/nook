import { createHash, randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextSummaries } from '../desktop/services/context-summaries';
import { ConversationEngine } from '../desktop/services/conversation-engine';
import { WorkspaceVault } from '../desktop/services/vault';
import { conversationHistory } from '../contracts/conversations';
import type { Provider } from '../contracts/workspace';
import { modelRequest } from '../desktop/services/model-protocol';
import type { ModelGateway, ModelInput } from '../desktop/services/model-gateway';
import { codec, provider, request, sampleThread, testVault } from './fixtures';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const input = () => ({ threadId: 'thread', requestId: randomUUID(), providerId: 'local', model: 'test-model', keepRecentTurns: 1 });
async function setup(gateway: ModelGateway = { stream: async (_input, text) => { text('原始决策\n尚未完成的工作'); return { kind: 'ollama', items: [], toolCalls: [], usage: { inputTokens: 100, outputTokens: 12 } }; } }, busy = () => false) {
  const { directory, vault } = await testVault(); directories.push(directory);
  await vault.update(state => { state.threads.push(sampleThread({ providerId: provider.id, messages: Array.from({ length: 6 }, (_, index) => ({ id: `m${index}`, role: index % 2 ? 'assistant' as const : 'user' as const, content: `ORIGINAL_${index}`, attachments: index ? [] : [{ id: 'original', name: '笔记.txt', content: 'ATTACHMENT_ORIGINAL' }], status: 'complete' as const, createdAt: index })) })); });
  return { vault, directory, service: new ContextSummaries(vault, gateway, busy), gateway };
}
async function applied() {
  const result = await setup(), preview = await result.service.generate(input());
  await result.service.change({ action: 'apply', threadId: 'thread', previewId: preview.id, content: preview.content });
  return { ...result, preview };
}

describe('context summary service', () => {
  it('generates a real read-only preview, accepts edits, preserves exact originals and restores after reopening the vault', async () => {
    let captured!: ModelInput;
    const { service, vault, directory } = await setup({ stream: async (value, text, usage) => { captured = value; text('  PREVIEW\n'); text('exact text  '); usage?.({ inputTokens: 20 }); } });
    const original = structuredClone(vault.thread('thread')!.messages), preview = await service.generate(input());
    expect(captured.messages).toEqual(original.slice(0, 4)); expect(captured.tools).toBeUndefined(); expect(captured.exchanges).toBeUndefined(); expect(captured.instructions).toContain('untrusted historical data');
    expect(preview.content).toBe('  PREVIEW\nexact text  '); expect(preview.invocations?.[0]).toMatchObject({ status: 'complete', tokens: { inputTokens: 20 } });
    expect(vault.thread('thread')!.contextSummaries).toBeUndefined();
    await service.change({ action: 'apply', threadId: 'thread', previewId: preview.id, content: '  USER_EDIT\n ' });
    expect(vault.thread('thread')!.messages).toEqual(original); expect(service.messages(vault.thread('thread')!)[1].content).toBe('  USER_EDIT\n ');
    await vault.flush(); const reopened = new WorkspaceVault(directory, codec); await reopened.initialize();
    expect(reopened.thread('thread')).toEqual(vault.thread('thread'));
    await service.change({ action: 'select', threadId: 'thread' }); expect(service.messages(vault.thread('thread')!)).toEqual(original);
    await service.change({ action: 'select', threadId: 'thread', summaryId: preview.id }); expect(service.messages(vault.thread('thread')!)).toHaveLength(4);
  });
  it('retains a preview after invalid input or failed durable apply and rejects cross-conversation or forged preview metadata', async () => {
    const { service, vault } = await setup(), preview = await service.generate(input());
    await vault.update(state => { state.threads.push(sampleThread({ id: 'other', messages: structuredClone(state.threads[0].messages) })); });
    await expect(service.change({ action: 'apply', threadId: 'other', previewId: preview.id, content: 'wrong' })).rejects.toThrow('unavailable');
    await expect(service.change({ action: 'apply', threadId: 'thread', previewId: preview.id, content: ' ', invocations: [] })).rejects.toThrow();
    const update = vi.spyOn(vault, 'update').mockRejectedValueOnce(new Error('disk full'));
    await expect(service.change({ action: 'apply', threadId: 'thread', previewId: preview.id, content: 'edit' })).rejects.toThrow('disk full'); update.mockRestore();
    await service.change({ action: 'apply', threadId: 'thread', previewId: preview.id, content: 'edit' });
    await expect(service.change({ action: 'apply', threadId: 'thread', previewId: preview.id, content: 'again' })).rejects.toThrow('unavailable');
  });
  it('guards changed original history, provider and selection without overwriting them', async () => {
    for (const kind of ['history', 'provider', 'selection']) {
      const { service, vault } = await setup(), preview = await service.generate(input());
      await vault.update(state => { if (kind === 'history') state.threads[0].messages[0].content = 'CHANGED'; else if (kind === 'provider') state.providers[0].endpoint = 'http://localhost:11435/v1'; else state.threads[0].activeContextSummaryId = randomUUID(); });
      const before = vault.snapshot();
      await expect(service.change({ action: 'apply', threadId: 'thread', previewId: preview.id, content: 'edit' })).rejects.toThrow('changed'); expect(vault.snapshot()).toEqual(before);
    }
  });
  it('edits only an unchanged saved summary and retains source provenance, usage and originals', async () => {
    const { service, vault, preview } = await applied(), summary = vault.thread('thread')!.contextSummaries![0], revision = digest(JSON.stringify(summary));
    await expect(service.change({ action: 'edit', threadId: 'thread', summaryId: preview.id, revision: '0'.repeat(64), content: 'wrong' })).rejects.toThrow('changed');
    await service.change({ action: 'edit', threadId: 'thread', summaryId: preview.id, revision, content: 'SAVED_EDIT' });
    expect(vault.thread('thread')!.contextSummaries![0]).toEqual({ ...summary, content: 'SAVED_EDIT' });
    await expect(service.change({ action: 'edit', threadId: 'thread', summaryId: preview.id, revision, content: 'overwrite' })).rejects.toThrow('changed');
  });
  it('requires restoring or switching context before deleting an active record, and can delete expired unused summaries', async () => {
    const { service, vault, preview } = await applied();
    await expect(service.change({ action: 'delete', threadId: 'thread', summaryId: preview.id })).rejects.toThrow('Restore');
    await vault.update(state => { state.threads[0].messages[0].content = 'edit original'; });
    await expect(service.change({ action: 'select', threadId: 'thread', summaryId: preview.id })).rejects.toThrow('changed');
    expect(service.messages(vault.thread('thread')!)).toEqual(vault.thread('thread')!.messages);
    await service.change({ action: 'select', threadId: 'thread' }); await service.change({ action: 'delete', threadId: 'thread', summaryId: preview.id });
    expect(vault.thread('thread')!.contextSummaries).toEqual([]);
    await expect(service.change({ action: 'select', threadId: 'thread', summaryId: preview.id })).rejects.toThrow('no longer');
  });
  it('rejects missing owners, non-idle conversations, unavailable models, credentials and empty sources', async () => {
    const { service, vault } = await setup();
    await expect(service.generate({ ...input(), threadId: 'missing' })).rejects.toThrow('no longer');
    await expect(service.change({ action: 'select', threadId: 'missing' })).rejects.toThrow('no longer');
    await expect(service.generate({ ...input(), keepRecentTurns: 3 })).rejects.toThrow('no older');
    await expect(service.generate({ ...input(), model: 'missing' })).rejects.toThrow('configured');
    await expect(service.generate({ ...input(), providerId: 'missing' })).rejects.toThrow('configured');
    const busy = new ContextSummaries(vault, { stream: vi.fn() }, () => true); await expect(busy.generate(input())).rejects.toThrow('Stop');
    await vault.update(state => { state.providers[0].kind = 'openai'; }); await expect(service.generate(input())).rejects.toThrow('API key');
    await vault.update(state => { state.providers[0].kind = 'ollama'; state.threads[0].messages[5].status = 'running'; }); await expect(service.generate(input())).rejects.toThrow('Stop');
  });
  it('does not persist oversized sources, oversized or empty output, provider failures or tool requests', async () => {
    const { service, vault } = await setup();
    await vault.update(state => { state.threads[0].messages[0].content = 'x'.repeat(4_000_000); }); await expect(service.generate(input())).rejects.toThrow('4 MB');
    for (const gateway of [{ stream: async (_input: ModelInput, text: (value: string) => void) => { text('x'.repeat(256_001)); } }, { stream: async () => {} }, { stream: async () => { throw new Error('offline'); } }, { stream: async () => ({ kind: 'ollama' as const, items: [], toolCalls: [{ id: 'call', name: 'write_file', arguments: '{}' }] }) }]) {
      const fixture = await setup(gateway); await expect(fixture.service.generate(input())).rejects.toThrow(); expect(fixture.service.active()).toBe(false); expect(fixture.vault.thread('thread')!.contextSummaries).toBeUndefined();
    }
  });
  it('cancels only the selected request or provider and awaits shutdown without saving partial text', async () => {
    const { service, vault } = await setup({ stream: async (value, text) => { text('PARTIAL'); await new Promise<void>((_, reject) => value.signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true })); } });
    await vault.update(state => { state.providers.push({ ...state.providers[0], id: 'other' }); state.threads.push(sampleThread({ ...state.threads[0], id: 'two' }), sampleThread({ ...state.threads[0], id: 'three' })); });
    const one = input(), two = { ...input(), threadId: 'two', providerId: 'other' };
    const first = service.generate(one), second = service.generate(two); const results = Promise.allSettled([first, second]);
    expect(service.active()).toBe(true); expect(service.active('thread')).toBe(true); await expect(service.generate(input())).rejects.toThrow('Stop');
    await expect(service.generate({ ...input(), threadId: 'three', requestId: one.requestId })).rejects.toThrow('identifier is already');
    await expect(service.generate({ ...two, requestId: one.requestId, threadId: 'missing' })).rejects.toThrow('no longer');
    await service.stop(randomUUID()); await service.stopProvider('local'); expect(service.active('thread')).toBe(false); expect(service.active('two')).toBe(true);
    await service.shutdown(); expect(service.active()).toBe(false); expect((await results).every(item => item.status === 'rejected')).toBe(true); expect(vault.thread('thread')!.contextSummaries).toBeUndefined();
  });
  it('rejects stale changes during generation but allows appending to an unchanged summarized prefix', async () => {
    for (const kind of ['history', 'provider', 'selection', 'append', 'delete']) {
      let finish!: () => void; const gate = new Promise<void>(resolve => { finish = resolve; });
      const { service, vault } = await setup({ stream: async (_value, text) => { await gate; text('SUMMARY'); } });
      const pending = service.generate(input()); const checked = pending.then(value => value, error => error as Error);
      await vault.update(state => { if (kind === 'history') state.threads[0].messages[0].content = 'changed'; else if (kind === 'provider') state.providers[0].name = 'Changed'; else if (kind === 'selection') state.threads[0].activeContextSummaryId = randomUUID(); else if (kind === 'delete') state.threads = []; else state.threads[0].messages.push({ id: 'new', role: 'user', content: 'AFTER_PREFIX', status: 'complete', createdAt: 7, attachments: [] }); });
      finish(); const result = await checked;
      if (kind === 'append') { if (result instanceof Error) throw result; await service.change({ action: 'apply', threadId: 'thread', previewId: result.id, content: result.content }); expect(service.messages(vault.thread('thread')!).at(-1)?.content).toBe('AFTER_PREFIX'); }
      else expect(result).toBeInstanceOf(Error);
    }
  });
  it('bounds preview memory and saved versions while preserving previews after a saved-version limit error', async () => {
    const { service, vault } = await setup(); const first = await service.generate(input()); let last = first;
    for (let index = 0; index < 20; index++) last = await service.generate(input());
    await expect(service.change({ action: 'apply', threadId: 'thread', previewId: first.id, content: first.content })).rejects.toThrow('unavailable');
    await vault.update(state => { const { threadId: _owner, ...summary } = last; state.threads[0].contextSummaries = Array.from({ length: 20 }, () => ({ ...summary, id: randomUUID() })); });
    // Generate against the new selection so the relevant gate is the saved-version bound.
    const full = await service.generate(input());
    await expect(service.change({ action: 'apply', threadId: 'thread', previewId: full.id, content: full.content })).rejects.toThrow('20 summaries');
  });
});

describe('effective model context', () => {
  const variants: Partial<Provider>[] = [...(['responses', 'openai', 'anthropic', 'ollama', 'gemini'] as const).map(kind => ({ kind })), ...(['responses', 'chat', 'deployment-chat'] as const).map(azureApi => ({ kind: 'azure' as const, azureApi, apiVersion: '2024-10-21' }))];
  it.each(variants)('sends a summary with recent turns through %j and retains raw disk history', async variant => {
    const { vault, service } = await applied(); const saved = structuredClone(vault.thread('thread')!);
    let actual!: ModelInput; const engine = new ConversationEngine(vault, { stream: async (value, text) => { actual = value; text('NEW_REPLY'); } }, () => {});
    await vault.update(state => { Object.assign(state.providers[0], variant); if (variant.kind === 'ollama') state.providers[0].hasKey = false; });
    // Non-local providers require the existing credential store, even in mocked tests.
    await vault.setKey('local', 'fixture-key');
    await engine.start({ ...request, threadId: 'thread', text: `NEW_${variant.kind}_${variant.azureApi ?? ''}` }); await engine.settle('thread');
    expect(actual.messages[1].content).toBe(saved.contextSummaries![0].content); expect(actual.messages.map(message => message.id)).not.toContain('m0');
    const body = JSON.stringify(modelRequest(actual).body); expect(body).toContain('原始决策'); expect(body).not.toContain('ATTACHMENT_ORIGINAL');
    expect(vault.thread('thread')!.messages.slice(0, 6)).toEqual(saved.messages); await engine.shutdown();
    expect(service.messages(vault.thread('thread')!)[1].content).toBe(saved.contextSummaries![0].content);
  });
  it('restores full model context after original edits and uses only valid summaries in retry and earlier edit branches', async () => {
    const { vault } = await applied(); const calls: ModelInput[] = []; const engine = new ConversationEngine(vault, { stream: async (value, text) => { calls.push(value); text('REPLY'); } }, () => {});
    let thread = vault.thread('thread')!;
    await engine.start({ ...request, threadId: 'thread', replay: { action: 'retry', messageId: 'm4', revision: digest(conversationHistory(thread)) } }); await engine.settle('thread');
    expect(calls[0].messages[1].content).toBe(thread.contextSummaries![0].content);
    thread = vault.thread('thread')!;
    const edited = await engine.start({ ...request, threadId: 'thread', text: 'EDIT_EARLY', replay: { action: 'edit', messageId: 'm0', revision: digest(conversationHistory(thread)) } }); await engine.settle(edited.threadId);
    expect(calls[1].messages).toHaveLength(1); expect(calls[1].messages[0].content).toBe('EDIT_EARLY');
    await vault.update(state => { state.threads.find(item => item.id === 'thread')!.messages[0].content = 'SOURCE_CHANGED'; });
    await engine.start({ ...request, threadId: 'thread' }); await engine.settle('thread'); expect(calls[2].messages[0].content).toBe('SOURCE_CHANGED'); await engine.shutdown();
  });
  it('uses the same effective source in comparison branches while retaining originals and independent summary records', async () => {
    const { vault } = await applied(); const calls: ModelInput[] = []; const engine = new ConversationEngine(vault, { stream: async (value, text) => { calls.push(value); text('COMPARE'); } }, () => {});
    await vault.update(state => { state.providers[0].models.push('second'); });
    const source = vault.thread('thread')!, result = await engine.compare({ threadId: source.id, revision: digest(conversationHistory(source)), text: 'COMPARE_NEW', attachments: [], models: [{ providerId: 'local', model: 'test-model' }, { providerId: 'local', model: 'second' }] });
    await Promise.all(result.threadIds.map(id => engine.settle(id))); expect(calls).toHaveLength(2);
    for (const [index, id] of result.threadIds.entries()) { expect(calls[index].messages[1].content).toBe(source.contextSummaries![0].content); expect(vault.thread(id)!.messages.slice(0, 6)).toEqual(source.messages); expect(vault.thread(id)!.contextSummaries).toEqual(source.contextSummaries); }
    expect(vault.thread(source.id)).toEqual(source); await engine.shutdown();
  });
  it('reserves summary generation against send/compare and routes thread/provider/shutdown cancellation through the engine', async () => {
    for (const stop of ['thread', 'provider', 'shutdown']) {
      const { vault } = await setup(); const engine = new ConversationEngine(vault, { stream: async value => { await new Promise<void>((_, reject) => value.signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true })); } }, () => {});
      const pending = engine.contextSummaries.generate(input()), checked = pending.catch(error => error);
      expect(engine.active('thread')).toBe(true); await expect(engine.start({ ...request, threadId: 'thread' })).rejects.toThrow('summary');
      if (stop === 'thread') await engine.stop('thread'); else if (stop === 'provider') await engine.stopProvider('local'); else await engine.shutdown();
      expect(await checked).toBeInstanceOf(Error); expect(engine.active()).toBe(false); await engine.shutdown();
    }
  });
});
