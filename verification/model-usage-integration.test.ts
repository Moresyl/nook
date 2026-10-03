import { rm } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { modelDestination, summarizeUsage, type ModelInfo, type ModelInvocation } from '../contracts/models';
import type { Message } from '../contracts/workspace';
import { ConversationEngine } from '../desktop/services/conversation-engine';
import { HttpModelGateway, type ModelGateway, type ModelInput } from '../desktop/services/model-gateway';
import { modelRequest } from '../desktop/services/model-protocol';
import { WorkspaceVault } from '../desktop/services/vault';
import { interruptRuns } from '../desktop/services/interrupted-runs';
import { ExtensionSettings } from '../desktop/services/extension-settings';
import { LocalSkills } from '../desktop/services/local-skills';
import { configuredModels, configuredProvider, discoveredModels, setModelInfo } from '../workbench/pages/model-settings';
import { modelContext } from '../workbench/components/model-context';
import { codec, provider, request, testVault } from './fixtures';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
const input = (kind: ModelInput['provider']['kind']): ModelInput => ({ provider: { ...provider, kind }, model: 'test-model', key: '', instructions: '', messages: [{ id: 'user', role: 'user', content: 'Question', attachments: [], status: 'complete', createdAt: 1 }], signal: new AbortController().signal });
const stream = (events: unknown[]) => new Response(events.map((event) => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
async function setup(gateway: ModelGateway) {
  const { vault, directory } = await testVault(); directories.push(directory);
  const emit = vi.fn(); const engine = new ConversationEngine(vault, gateway, emit, { execute: vi.fn().mockResolvedValue({ callId: 'call', output: 'File evidence', error: false }) });
  return { vault, directory, emit, engine };
}

describe('usage transport and model settings', () => {
  it.each(['openai', 'responses', 'anthropic', 'gemini'] as const)('collects %s streaming and JSON usage without duplicating cumulative counts', async (kind) => {
    const json = kind === 'openai' ? { choices: [{ message: { content: 'Answer' } }], usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 } }
      : kind === 'responses' ? { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Answer' }] }], usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130 } }
      : kind === 'anthropic' ? { content: [{ type: 'text', text: 'Answer' }], usage: { input_tokens: 50, cache_read_input_tokens: 30, cache_creation_input_tokens: 20, output_tokens: 30 } }
      : { candidates: [{ index: 0, content: { role: 'model', parts: [{ text: 'Answer' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, thoughtsTokenCount: 20, totalTokenCount: 130 } };
    const events = kind === 'openai' ? [{ choices: [{ delta: { content: 'Answer' }, finish_reason: 'stop' }], usage: null }, { choices: [], usage: json.usage }, '[DONE]']
      : kind === 'responses' ? [{ type: 'response.completed', response: json }]
      : kind === 'anthropic' ? [{ type: 'message_start', message: { usage: { ...json.usage, output_tokens: 0 } } }, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Answer' } }, { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: json.usage }, { type: 'message_stop' }]
      : [json, { usageMetadata: json.usageMetadata }];
    const fetcher = vi.fn().mockResolvedValueOnce(stream(events)).mockResolvedValueOnce(Response.json(json)); const gateway = new HttpModelGateway(fetcher);
    for (let index = 0; index < 2; index++) { const text = vi.fn(); const usage = vi.fn(); const reply = await gateway.stream(input(kind), text, usage); expect(text).toHaveBeenCalledWith('Answer'); expect(reply.usage).toMatchObject({ inputTokens: 100, outputTokens: 30, totalTokens: 130 }); expect(usage).toHaveBeenLastCalledWith(reply.usage); }
    if (kind === 'openai') expect(JSON.parse(fetcher.mock.calls[0][1].body).stream_options).toEqual({ include_usage: true });
  });
  it('retains usage from a failed or incomplete Responses event before reporting the failure', async () => {
    const notify = vi.fn(); const gateway = new HttpModelGateway(vi.fn().mockResolvedValue(stream([{ type: 'response.incomplete', response: { usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } } }])));
    await expect(gateway.stream(input('responses'), () => {}, notify)).rejects.toThrow('interrupted'); expect(notify).toHaveBeenCalledWith({ inputTokens: 100, outputTokens: 50, totalTokens: 150 });
  });
  it('sends protocol-specific output budgets and allows incompatible Chat servers to omit usage options', () => {
    for (const kind of ['responses', 'openai', 'ollama', 'gemini', 'anthropic', 'azure'] as const) {
      const current = input(kind); current.provider.modelCatalog = [{ id: current.model, source: 'manual', maxOutputTokens: 5000, outputTokenLimit: 6000 }];
      const body = modelRequest(current).body;
      if (kind === 'gemini') expect(body.generationConfig).toMatchObject({ maxOutputTokens: 5000 });
      else expect(body[kind === 'responses' || kind === 'azure' ? 'max_output_tokens' : kind === 'anthropic' || kind === 'ollama' ? 'max_tokens' : 'max_completion_tokens']).toBe(5000);
    }
    const classic = input('azure'); classic.provider.azureApi = 'deployment-chat'; classic.provider.apiVersion = '2024-10-21'; classic.provider.modelCatalog = [{ id: classic.model, source: 'manual', maxOutputTokens: 50 }];
    expect(modelRequest(classic).body.max_tokens).toBe(50); classic.provider.modelCatalog[0].outputParameter = 'max_completion_tokens'; expect(modelRequest(classic).body.max_completion_tokens).toBe(50);
    const compatible = input('openai'); compatible.provider.streamUsage = false; compatible.provider.modelCatalog = [{ id: compatible.model, source: 'manual', maxOutputTokens: 50, outputParameter: 'max_tokens' }];
    expect(modelRequest(compatible).body).toMatchObject({ max_tokens: 50 }); expect(modelRequest(compatible).body.stream_options).toBeUndefined();
    const anthropic = input('anthropic'); expect(modelRequest(anthropic).body.max_tokens).toBe(8192); anthropic.provider.modelCatalog = [{ id: anthropic.model, source: 'manual', outputTokenLimit: 4096 }]; expect(modelRequest(anthropic).body.max_tokens).toBe(4096);
    anthropic.provider.modelCatalog[0].maxOutputTokens = 20_000; anthropic.provider.modelCatalog[0].outputTokenLimit = 32_000; expect(modelRequest(anthropic).body.max_tokens).toBe(20_000);
  });
  it('reads only explicit Gemini limits and reasoning flags, preserves paginated details and leaves other capacities unknown', async () => {
    const gemini = input('gemini').provider; const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ models: [{ name: 'models/a', supportedGenerationMethods: ['generateContent'], inputTokenLimit: 1000, outputTokenLimit: 100, thinking: true }, { name: 'models/b', supportedGenerationMethods: ['generateContent'], inputTokenLimit: -1, outputTokenLimit: 1.5, thinking: 'true' }], nextPageToken: 'next' })).mockResolvedValueOnce(Response.json({ models: [{ name: 'models/a', supportedGenerationMethods: ['generateContent'] }] }));
    const catalog = await new HttpModelGateway(fetcher).discoverCatalog(gemini, '');
    expect(catalog[0]).toEqual({ id: 'a', source: 'service', destination: modelDestination('gemini', gemini.endpoint), inputTokenLimit: 1000, outputTokenLimit: 100, supportsReasoning: true });
    expect(catalog[1]).toEqual({ id: 'b', source: 'service', destination: modelDestination('gemini', gemini.endpoint) }); expect(catalog[0].supportsTools).toBeUndefined();
    expect(await new HttpModelGateway(vi.fn().mockResolvedValue(Response.json({ data: [{ id: 'model-128k', contextWindow: 128_000 }] }))).discoverCatalog(provider, '')).toEqual([{ id: 'model-128k', source: 'service', destination: modelDestination(provider.kind, provider.endpoint) }]);
  });
  it('preserves explicit manual settings on discovery, filters removed models and keeps service provenance for request options', () => {
    expect(configuredModels(' a, b\n a\n\n')).toEqual(['a', 'b']);
    const catalog: ModelInfo[] = [{ id: 'a', source: 'service', destination: 'connection', inputTokenLimit: 1000 }];
    let current = discoveredModels(provider, catalog); expect(current.models).toEqual(['a']);
    current = setModelInfo(current, 'a', 'maxOutputTokens', 100); expect(current.modelCatalog?.[0].source).toBe('service');
    current = setModelInfo(current, 'a', 'outputParameter', 'max_tokens'); expect(current.modelCatalog?.[0].source).toBe('service');
    expect(discoveredModels(current, catalog).modelCatalog?.[0]).toMatchObject({ inputTokenLimit: 1000, maxOutputTokens: 100, outputParameter: 'max_tokens' });
    current = setModelInfo(current, 'a', 'supportsTools', false); expect(current.modelCatalog?.[0]).toMatchObject({ source: 'manual', supportsTools: false }); expect(current.modelCatalog?.[0].destination).toBeUndefined();
    expect(discoveredModels(current, [{ ...catalog[0], inputTokenLimit: 2000 }]).modelCatalog?.[0].inputTokenLimit).toBe(1000);
    expect(configuredProvider(current, 'new').modelCatalog).toEqual([]); expect(setModelInfo(provider, 'test-model', 'contextWindow', undefined).modelCatalog).toEqual([{ id: 'test-model', source: 'manual', contextWindow: undefined, destination: undefined }]);
  });
  it('uses only the latest invocation for the selected model and destination instead of accumulated conversation usage', () => {
    const invocation: ModelInvocation = { round: 0, providerId: provider.id, providerName: provider.name, providerKind: provider.kind, model: 'test-model', destination: modelDestination(provider.kind, provider.endpoint), startedAt: 1, status: 'complete', tokens: { inputTokens: 100 } };
    const message = (invocations?: ModelInvocation[]): Message => ({ id: 'answer', role: 'assistant', content: 'Text', status: 'complete', attachments: [], createdAt: 1, invocations });
    expect(modelContext(provider, 'test-model', [message(), message([invocation]), message([{ ...invocation, tokens: { inputTokens: 200 } }])]).latest?.tokens?.inputTokens).toBe(200);
    expect(modelContext(provider, 'test-model', [message([invocation]), message([{ ...invocation, tokens: undefined }])]).latest?.tokens).toBeUndefined();
    expect(modelContext(provider, 'test-model', [message([{ ...invocation, destination: 'old' }, { ...invocation, providerId: 'other' }, { ...invocation, model: 'other' }])]).latest).toBeUndefined();
  });
});

describe('durable invocation records', () => {
  it('records each tool round once, keeps cumulative updates separate and retains snapshots through restart and backup', async () => {
    let round = 0; const gateway: ModelGateway = { stream: async (_input, onText, onUsage) => {
      onUsage?.({ inputTokens: 100 + round * 100, outputTokens: 10 }); onUsage?.({ inputTokens: 100 + round * 100, outputTokens: 20, totalTokens: 120 + round * 100 });
      return round++ === 0 ? { kind: 'ollama', items: [], toolCalls: [{ id: 'call', name: 'list_files', arguments: '{}' }] } : (onText('Answer'), { kind: 'ollama', items: [], toolCalls: [], usage: { inputTokens: 200, outputTokens: 30, totalTokens: 230 } });
    } };
    const { vault, engine, directory, emit } = await setup(gateway);
    await vault.update((draft) => { draft.projects.push({ id: 'project', name: 'Project', path: directory, instructions: '', createdAt: 1 }); draft.providers[0].modelCatalog = [{ id: 'test-model', source: 'manual', inputTokenLimit: 1000 }]; });
    const { threadId } = await engine.start({ ...request, projectId: 'project', mode: 'plan' }); await engine.settle(threadId);
    expect(vault.snapshot().threads[0].messages[1]).toMatchObject({ status: 'complete', content: 'Answer' });
    const records = vault.snapshot().threads[0].messages[1].invocations!; expect(records).toHaveLength(2); expect(records.map((item) => item.round)).toEqual([0, 1]);
    expect(records.every((item) => item.status === 'complete' && item.finishedAt && item.modelInfo?.inputTokenLimit === 1000)).toBe(true);
    expect(summarizeUsage(records).counts).toEqual({ inputTokens: 300, outputTokens: 50, totalTokens: 350 }); expect(emit.mock.calls.some(([event]) => event.invocation?.tokens?.outputTokens === 30)).toBe(true);
    await vault.update((draft) => { draft.providers[0].name = 'Renamed'; draft.providers[0].modelCatalog![0].inputTokenLimit = 2000; });
    expect(vault.backup().threads[0].messages[1].invocations).toEqual(records); const restarted = new WorkspaceVault(directory, codec); await restarted.initialize(); expect(restarted.snapshot().threads[0].messages[1].invocations).toEqual(records);
  });
  it.each(['error', 'interrupted'] as const)('persists partial usage when a request is %s', async (status) => {
    const gateway: ModelGateway = { stream: async (input, onText, onUsage) => { onText('Partial'); onUsage?.({ inputTokens: 100, outputTokens: 5 });
      if (status === 'error') throw new Error('Request failed'); await new Promise<void>((_resolve, reject) => input.signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true }));
    } };
    const { vault, engine } = await setup(gateway); const { threadId } = await engine.start(request); if (status === 'interrupted') await engine.stop(threadId); else await engine.settle(threadId);
    const message = vault.snapshot().threads[0].messages[1]; expect(message.invocations?.[0]).toMatchObject({ status, tokens: { inputTokens: 100, outputTokens: 5 } }); expect(summarizeUsage(message.invocations!).partial).toBe(true);
  });
  it('rejects configured unsupported tools before sending or changing the draft and preserves missing usage as unknown', async () => {
    const stream = vi.fn(); const { vault, engine, directory } = await setup({ stream });
    await vault.update((draft) => { draft.projects.push({ id: 'project', name: 'Project', path: directory, instructions: '', createdAt: 1 }); draft.providers[0].modelCatalog = [{ id: 'test-model', source: 'manual', supportsTools: false }]; });
    await expect(engine.start({ ...request, projectId: 'project', mode: 'plan' })).rejects.toThrow('without tool support'); expect(stream).not.toHaveBeenCalled(); expect(vault.snapshot().threads).toEqual([]);
    const { threadId } = await engine.start(request); await engine.settle(threadId); expect(vault.snapshot().threads[0].messages[1].invocations?.[0]).toMatchObject({ status: 'complete' }); expect(vault.snapshot().threads[0].messages[1].invocations?.[0].tokens).toBeUndefined();
  });
  it('marks checkpointed running invocations interrupted after restart without discarding consumed tokens', async () => {
    const { vault, directory } = await testVault(); directories.push(directory);
    await vault.update((draft) => { draft.threads.push({ id: 'thread', title: 'Interrupted', model: 'test-model', pinned: false, archived: false, createdAt: 1, updatedAt: 1, messages: [{ id: 'a', role: 'assistant', content: 'Partial', createdAt: 1, status: 'running', attachments: [], invocations: [{ round: 0, providerId: provider.id, providerName: provider.name, providerKind: provider.kind, model: 'test-model', destination: 'original', startedAt: 1, status: 'running', tokens: { inputTokens: 100 } }] }] }); });
    const restarted = new WorkspaceVault(directory, codec); await restarted.initialize(); const message = restarted.snapshot().threads[0].messages[0]; expect(message.status).toBe('stopped'); expect(message.invocations?.[0]).toMatchObject({ status: 'interrupted', tokens: { inputTokens: 100 } }); expect(message.invocations?.[0].finishedAt).toBeDefined();
    const backup = vault.backup(); const restored = await new ExtensionSettings(restarted, new LocalSkills(directory)).restore(backup); expect(restored.threads[0].messages[0].invocations?.[0]).toMatchObject({ status: 'interrupted', tokens: { inputTokens: 100 } }); expect(backup.threads[0].messages[0].invocations?.[0].status).toBe('running');
    const finished = restored.threads[0].messages[0].invocations?.[0].finishedAt; expect(interruptRuns(restored.threads, 999)).toBe(false); expect(restored.threads[0].messages[0].invocations?.[0].finishedAt).toBe(finished);
    restored.threads[0].messages[0].activities = [{ id: 'a', name: 'read_file', input: '{}', output: 'Partial', startedAt: 1, status: 'waiting' }, { id: 'b', name: 'read_file', input: '{}', output: 'Done', startedAt: 1, finishedAt: 2, status: 'complete' }, { id: 'c', name: 'read_file', input: '{}', output: 'Partial', startedAt: 1, status: 'running' }];
    expect(interruptRuns(restored.threads, 999)).toBe(true); expect(restored.threads[0].messages[0].activities.map((item) => [item.status, item.finishedAt])).toEqual([['stopped', 999], ['complete', 2], ['stopped', 999]]);
  });
});
