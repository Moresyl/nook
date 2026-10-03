import type { TokenUsage } from '../../contracts/models';

type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}; }

/** Usage events are cumulative snapshots within a request, never increments. */
export class UsageCollector {
  private raw: JsonObject = {};
  private invalid = false;
  constructor(private readonly protocol: 'responses' | 'openai' | 'anthropic' | 'gemini', private readonly notify?: (usage: TokenUsage) => void) {}

  accept(event: JsonObject, complete = false): void {
    const usage = this.protocol === 'gemini' ? event.usageMetadata
      : this.protocol === 'responses' ? (complete ? event.usage : object(event.response).usage)
      : this.protocol === 'anthropic' && event.type === 'message_start' ? object(event.message).usage : event.usage;
    if (usage === undefined || usage === null) return;
    if (typeof usage !== 'object' || Array.isArray(usage)) { this.invalid = true; this.publish(); return; }
    const value = object(usage);
    const flat: JsonObject = { ...value, ...object(value.input_tokens_details), ...object(value.output_tokens_details), ...object(value.prompt_tokens_details), ...object(value.completion_tokens_details) };
    const fields = ['input_tokens', 'output_tokens', 'total_tokens', 'cached_tokens', 'cache_write_tokens', 'reasoning_tokens', 'prompt_tokens', 'completion_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'promptTokenCount', 'candidatesTokenCount', 'totalTokenCount', 'cachedContentTokenCount', 'thoughtsTokenCount', 'toolUsePromptTokenCount'];
    for (const field of fields) {
      if (flat[field] === undefined || flat[field] === null) continue;
      const count = flat[field];
      if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || count > 1_000_000_000) { this.invalid = true; continue; }
      this.raw[field] = count;
    }
    this.publish();
  }

  private publish(): void { const usage = this.snapshot(); if (usage) this.notify?.(usage); }

  snapshot(): TokenUsage | undefined {
    const number = (key: string): number | undefined => typeof this.raw[key] === 'number' ? this.raw[key] as number : undefined;
    const result: TokenUsage = {};
    if (this.protocol === 'gemini') {
      result.inputTokens = number('promptTokenCount'); result.cachedInputTokens = number('cachedContentTokenCount');
      const candidates = number('candidatesTokenCount'); const reasoning = number('thoughtsTokenCount');
      result.outputTokens = candidates === undefined ? undefined : candidates + (reasoning ?? 0);
      result.reasoningTokens = reasoning; result.totalTokens = number('totalTokenCount'); result.toolInputTokens = number('toolUsePromptTokenCount');
    } else if (this.protocol === 'anthropic') {
      const uncached = number('input_tokens'); const read = number('cache_read_input_tokens'); const write = number('cache_creation_input_tokens');
      result.inputTokens = uncached === undefined ? undefined : uncached + (read ?? 0) + (write ?? 0);
      result.outputTokens = number('output_tokens'); result.cachedInputTokens = read; result.cacheWriteTokens = write;
    } else {
      result.inputTokens = number(this.protocol === 'responses' ? 'input_tokens' : 'prompt_tokens');
      result.outputTokens = number(this.protocol === 'responses' ? 'output_tokens' : 'completion_tokens');
      result.totalTokens = number('total_tokens'); result.cachedInputTokens = number('cached_tokens'); result.cacheWriteTokens = number('cache_write_tokens'); result.reasoningTokens = number('reasoning_tokens');
    }
    if (result.totalTokens === undefined && result.inputTokens !== undefined && result.outputTokens !== undefined) result.totalTokens = result.inputTokens + result.outputTokens;
    for (const key of Object.keys(result) as (keyof TokenUsage)[]) {
      const value = result[key];
      if (value === undefined) delete result[key];
      else if (typeof value === 'number' && value > 1_000_000_000) { delete result[key]; result.invalid = true; }
    }
    if (result.inputTokens !== undefined) {
      for (const field of ['cachedInputTokens', 'cacheWriteTokens'] as const) if (result[field] !== undefined && result[field]! > result.inputTokens) { delete result[field]; result.invalid = true; }
    }
    if (result.outputTokens !== undefined && result.reasoningTokens !== undefined && result.reasoningTokens > result.outputTokens) { delete result.reasoningTokens; result.invalid = true; }
    if (this.invalid) result.invalid = true;
    return Object.keys(result).length ? result : undefined;
  }
}
