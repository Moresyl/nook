import { describe, expect, it, vi } from 'vitest';
import { invocationSchema, modelDestination, modelInfoSchema, summarizeUsage, tokenUsageSchema, type ModelInvocation } from '../contracts/models';
import { providerSchema } from '../contracts/workspace';
import { UsageCollector } from '../desktop/services/model-usage';
import { provider } from './fixtures';

const invocation = (round: number, tokens?: ModelInvocation['tokens']): ModelInvocation => ({ round, providerId: 'local', providerName: 'Local', providerKind: 'ollama', model: 'test', destination: 'local', startedAt: 1, finishedAt: 2, status: 'complete', tokens });

describe('model usage and capacity contracts', () => {
  it('validates bounded counters, unique configured metadata, output limits and invocation rounds', () => {
    expect(tokenUsageSchema.parse({ inputTokens: 0, outputTokens: 1 })).toEqual({ inputTokens: 0, outputTokens: 1 });
    for (const count of [-1, 1.5, 1_000_000_001, Infinity, '1']) expect(tokenUsageSchema.safeParse({ inputTokens: count }).success).toBe(false);
    const info = { id: 'test-model', source: 'manual', inputTokenLimit: 128_000, outputTokenLimit: 8192, maxOutputTokens: 4096 };
    expect(modelInfoSchema.parse(info).maxOutputTokens).toBe(4096); expect(modelInfoSchema.safeParse({ ...info, maxOutputTokens: 8193 }).success).toBe(false);
    expect(providerSchema.safeParse({ ...provider, modelCatalog: [info] }).success).toBe(true);
    const service = { ...info, source: 'service', destination: modelDestination(provider.kind, provider.endpoint) };
    expect(providerSchema.safeParse({ ...provider, modelCatalog: [service] }).success).toBe(true);
    expect(providerSchema.safeParse({ ...provider, modelCatalog: [{ ...service, destination: 'old connection' }] }).success).toBe(false);
    expect(providerSchema.safeParse({ ...provider, modelCatalog: [{ ...service, destination: undefined }] }).success).toBe(false);
    expect(providerSchema.safeParse({ ...provider, endpoint: 'invalid URL', modelCatalog: [service] }).success).toBe(false);
    expect(modelDestination('ollama', 'HTTP://LOCALHOST:11434/v1/')).toBe(modelDestination('ollama', provider.endpoint));
    expect(modelDestination('ollama', `${provider.endpoint}?tenant=2`)).not.toBe(modelDestination('ollama', provider.endpoint));
    expect(providerSchema.safeParse({ ...provider, modelCatalog: [info, info] }).success).toBe(false); expect(providerSchema.safeParse({ ...provider, modelCatalog: [{ ...info, id: 'missing' }] }).success).toBe(false);
    expect(invocationSchema.safeParse({ ...invocation(0), round: 16 }).success).toBe(false);
  });
  it('summarizes requests while preserving field coverage, unknown totals and interrupted status', () => {
    expect(summarizeUsage([])).toMatchObject({ counts: {}, reported: 0, requests: 0, partial: false });
    expect(summarizeUsage([invocation(0, { inputTokens: 100, outputTokens: 20, totalTokens: 120 }), invocation(1, { inputTokens: 200, outputTokens: 30, totalTokens: 230 })])).toMatchObject({ counts: { inputTokens: 300, outputTokens: 50, totalTokens: 350 }, reported: 2, requests: 2, partial: false });
    const partial = summarizeUsage([invocation(0, { inputTokens: 100, outputTokens: 20, cachedInputTokens: 10 }), invocation(1, { outputTokens: 30 }), invocation(2)]);
    expect(partial).toMatchObject({ counts: { inputTokens: 100, outputTokens: 50, cachedInputTokens: 10 }, coverage: { inputTokens: 1, outputTokens: 2 }, reported: 2, requests: 3, partial: true }); expect(partial.counts.totalTokens).toBeUndefined();
    expect(summarizeUsage([{ ...invocation(0, { inputTokens: 0 }), status: 'interrupted' }]).partial).toBe(true); expect(summarizeUsage([invocation(0, { inputTokens: 0, invalid: true })]).partial).toBe(true);
    expect(summarizeUsage([invocation(0, { inputTokens: 0 })]).partial).toBe(true);
  });
});

describe('provider usage snapshots', () => {
  it.each(['responses', 'openai'] as const)('preserves cumulative %s snapshots and cache/reasoning breakdowns without double counting', (protocol) => {
    const notify = vi.fn(); const collector = new UsageCollector(protocol, notify);
    const usage = protocol === 'responses' ? { input_tokens: 100, output_tokens: 40, total_tokens: 140, input_tokens_details: { cached_tokens: 80, cache_write_tokens: 10 }, output_tokens_details: { reasoning_tokens: 30 } }
      : { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140, prompt_tokens_details: { cached_tokens: 80, cache_write_tokens: 10 }, completion_tokens_details: { reasoning_tokens: 30 } };
    collector.accept(protocol === 'responses' ? { response: { usage } } : { usage }); collector.accept(protocol === 'responses' ? { response: { usage } } : { usage });
    expect(collector.snapshot()).toEqual({ inputTokens: 100, outputTokens: 40, totalTokens: 140, cachedInputTokens: 80, cacheWriteTokens: 10, reasoningTokens: 30 }); expect(notify).toHaveBeenCalledTimes(2);
    collector.accept({ usage: protocol === 'responses' ? { output_tokens: 50 } : { completion_tokens: 50 } }, true); expect(collector.snapshot()?.outputTokens).toBe(50);
  });
  it('folds Anthropic cache read/write into input and replaces partial cumulative message-delta fields', () => {
    const collector = new UsageCollector('anthropic'); collector.accept({ type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 1, cache_creation_input_tokens: 20, cache_read_input_tokens: 30 } } });
    expect(collector.snapshot()).toEqual({ inputTokens: 60, outputTokens: 1, totalTokens: 61, cachedInputTokens: 30, cacheWriteTokens: 20 });
    collector.accept({ type: 'message_delta', usage: { output_tokens: 40 } }); collector.accept({ type: 'message_delta', usage: { input_tokens: 15, output_tokens: 45 } });
    expect(collector.snapshot()).toEqual({ inputTokens: 65, outputTokens: 45, totalTokens: 110, cachedInputTokens: 30, cacheWriteTokens: 20 });
    const simple = new UsageCollector('anthropic'); simple.accept({ usage: { input_tokens: 25, output_tokens: 15 } }, true); expect(simple.snapshot()).toEqual({ inputTokens: 25, outputTokens: 15, totalTokens: 40 });
  });
  it('adds Gemini thoughts once to generated output, preserves its reported total and keeps tool prompt detail separate', () => {
    const collector = new UsageCollector('gemini'); collector.accept({ usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 80, candidatesTokenCount: 10, thoughtsTokenCount: 20, totalTokenCount: 130, toolUsePromptTokenCount: 5 } });
    expect(collector.snapshot()).toEqual({ inputTokens: 100, outputTokens: 30, totalTokens: 130, cachedInputTokens: 80, reasoningTokens: 20, toolInputTokens: 5 });
    collector.accept({ usageMetadata: { candidatesTokenCount: 15, thoughtsTokenCount: 25, totalTokenCount: 140 } }); expect(collector.snapshot()?.outputTokens).toBe(40);
    const partial = new UsageCollector('gemini'); partial.accept({ usageMetadata: { thoughtsTokenCount: 20 } }); expect(partial.snapshot()).toEqual({ reasoningTokens: 20 });
  });
  it('keeps omitted, null and empty usage unknown and derives a total only when both sides are reported', () => {
    const collector = new UsageCollector('openai'); collector.accept({}); collector.accept({ usage: null }); collector.accept({ usage: {} }); expect(collector.snapshot()).toBeUndefined();
    collector.accept({ usage: { prompt_tokens: 100 } }); expect(collector.snapshot()).toEqual({ inputTokens: 100 }); collector.accept({ usage: { completion_tokens: 0 } }); expect(collector.snapshot()).toEqual({ inputTokens: 100, outputTokens: 0, totalTokens: 100 });
    collector.accept({ usage: { total_tokens: 105 } }); expect(collector.snapshot()?.totalTokens).toBe(105);
  });
  it('drops unsafe counters and inconsistent subsets without interrupting an otherwise usable reply', () => {
    for (const usage of [[], 'private provider payload']) { const collector = new UsageCollector('openai'); collector.accept({ usage }); expect(collector.snapshot()).toEqual({ invalid: true }); }
    const collector = new UsageCollector('openai'); collector.accept({ usage: { prompt_tokens: -1, completion_tokens: 'secret', total_tokens: Infinity } }); expect(collector.snapshot()).toEqual({ invalid: true });
    collector.accept({ usage: { prompt_tokens: 10, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 11, cache_write_tokens: 12 }, completion_tokens_details: { reasoning_tokens: 21 } } }); expect(collector.snapshot()).toEqual({ inputTokens: 10, outputTokens: 20, totalTokens: 30, invalid: true });
    const large = new UsageCollector('anthropic'); large.accept({ usage: { input_tokens: 1_000_000_000, output_tokens: 1, cache_creation_input_tokens: 1 } }); expect(large.snapshot()?.inputTokens).toBeUndefined(); expect(large.snapshot()?.invalid).toBe(true);
    const output = new UsageCollector('gemini'); output.accept({ usageMetadata: { candidatesTokenCount: 1_000_000_000, thoughtsTokenCount: 1 } }); expect(output.snapshot()?.outputTokens).toBeUndefined();
  });
});
