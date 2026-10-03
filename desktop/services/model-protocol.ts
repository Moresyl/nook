import { toolCallSchema, type ToolCall, type ToolDefinition, type ToolResult } from '../../contracts/tools';
import type { Message, Provider } from '../../contracts/workspace';
import { geminiRequest, GeminiReply } from './gemini-protocol';
import type { TokenUsage } from '../../contracts/models';
import { UsageCollector } from './model-usage';
import { modelMessage, validateModelAttachments } from './model-attachments';

type JsonObject = Record<string, unknown>;
export type ModelReply = { kind: Provider['kind']; protocol?: 'responses' | 'openai'; items: JsonObject[]; toolCalls: ToolCall[]; usage?: TokenUsage };
export type ModelExchange = { reply: ModelReply; results: ToolResult[] };
export type ModelInput = {
  provider: Provider; key: string; model: string; instructions: string; messages: Message[];
  signal: AbortSignal; tools?: ToolDefinition[]; exchanges?: ModelExchange[];
};

function object(value: unknown): JsonObject { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}; }
function objects(value: unknown): JsonObject[] { return Array.isArray(value) ? value.map(object) : []; }
function string(value: unknown): string { return typeof value === 'string' ? value : ''; }
function invalid(): Error { return new Error('The provider sent an invalid response. Retry or check API compatibility.'); }

export function providerProtocol(provider: Provider): 'responses' | 'openai' | 'anthropic' | 'gemini' {
  if (provider.kind === 'azure') return !provider.azureApi || provider.azureApi === 'responses' ? 'responses' : 'openai';
  return provider.kind === 'ollama' ? 'openai' : provider.kind;
}

export function modelRequest(input: ModelInput): { route: string; body: JsonObject } {
  const { provider, model, instructions, tools = [], exchanges = [] } = input;
  const protocol = providerProtocol(provider);
  validateModelAttachments(provider, model, input.messages);
  const history = input.messages.filter((message) => message.content || message.attachments.length || message.activities?.length).map((message) => modelMessage(message, protocol));
  const modelInfo = provider.modelCatalog?.find((item) => item.id === model);
  const maxOutput = modelInfo?.maxOutputTokens;
  if (protocol === 'gemini') return geminiRequest(input, history);
  for (const exchange of exchanges) {
    if (exchange.reply.kind !== provider.kind) throw invalid();
    if (exchange.reply.protocol && exchange.reply.protocol !== protocol) throw invalid();
    history.push(...exchange.reply.items);
    if (protocol === 'responses') history.push(...exchange.results.map((result) => ({ type: 'function_call_output', call_id: result.callId, output: result.output })));
    else if (protocol === 'anthropic') history.push({ role: 'user', content: exchange.results.map((result) => ({ type: 'tool_result', tool_use_id: result.callId, content: result.output, is_error: result.error })) });
    else history.push(...exchange.results.map((result) => ({ role: 'tool', tool_call_id: result.callId, content: result.output })));
  }
  if (protocol === 'responses') return {
    route: 'responses', body: { model, instructions, input: history, stream: true, store: false, include: ['reasoning.encrypted_content'],
      ...(maxOutput ? { max_output_tokens: maxOutput } : {}),
      ...(tools.length ? { tools: tools.map((tool) => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters, strict: tool.strict ?? true })) } : {}),
    },
  };
  if (protocol === 'anthropic') return {
    route: 'messages', body: { model, system: instructions, messages: history, max_tokens: Math.min(maxOutput ?? 8192, modelInfo?.outputTokenLimit ?? 1_000_000_000), stream: true,
      ...(tools.length ? { tools: tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })) } : {}),
    },
  };
  if (provider.kind === 'azure' && provider.azureApi === 'deployment-chat' && (['.', '..'].includes(model) || !/^\d{4}-\d{2}-\d{2}(?:-preview)?$/.test(provider.apiVersion ?? ''))) throw new Error('Enter a valid Azure deployment name and dated API version.');
  return {
    route: provider.kind === 'azure' && provider.azureApi === 'deployment-chat' ? `deployments/${encodeURIComponent(model)}/chat/completions?api-version=${encodeURIComponent(provider.apiVersion!)}` : 'chat/completions',
    body: { model, messages: [...(instructions ? [{ role: 'system', content: instructions }] : []), ...history], stream: true,
      ...(provider.streamUsage === false ? {} : { stream_options: { include_usage: true } }), ...(maxOutput ? { [modelInfo?.outputParameter ?? (provider.kind === 'ollama' || (provider.kind === 'azure' && provider.azureApi === 'deployment-chat') ? 'max_tokens' : 'max_completion_tokens')]: maxOutput } : {}),
      ...(tools.length ? { tools: tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters, strict: tool.strict ?? true } })) } : {}),
    },
  };
}

/** Collect an entire model turn before exposing executable tool calls. */
export class ReplyCollector {
  private text = '';
  private items = new Map<number, JsonObject>();
  private calls = new Map<number, JsonObject>();
  private arguments = new Map<number, string>();
  private completed = false;
  private stopReason = '';
  private readonly protocol: ReturnType<typeof providerProtocol>;
  private readonly gemini: GeminiReply;
  private readonly usage: UsageCollector;

  constructor(private readonly kind: Provider['kind'], private readonly onText: (text: string) => void, protocol?: ReturnType<typeof providerProtocol>, onUsage?: (usage: TokenUsage) => void) {
    this.protocol = protocol ?? (kind === 'azure' ? 'responses' : kind === 'ollama' ? 'openai' : kind);
    this.gemini = new GeminiReply((text) => this.appendText(text));
    this.usage = new UsageCollector(this.protocol, onUsage);
  }

  private appendText(value: unknown): void {
    if (typeof value !== 'string' || !value) return;
    if (this.text.length + value.length > 4_000_000) throw new Error('The response exceeded the message size limit. Ask for a shorter answer.');
    this.text += value;
    this.onText(value);
  }

  accept(raw: unknown): void {
    const event = object(raw);
    this.usage.accept(event);
    if (event.error || ['error', 'response.failed', 'response.incomplete'].includes(string(event.type))) throw new Error('The provider interrupted the response. Retry the request.');
    if (this.protocol === 'gemini') this.gemini.accept(event);
    else if (this.protocol === 'responses') this.responses(event);
    else if (this.protocol === 'anthropic') this.anthropic(event);
    else this.chat(event);
    if (this.items.size > 128 || this.calls.size > 32) throw invalid();
  }

  done(): void { this.completed = true; }

  private chat(event: JsonObject): void {
    const choice = objects(event.choices)[0] ?? {};
    const delta = object(choice.delta);
    this.appendText(delta.content);
    if (choice.finish_reason) { this.stopReason = string(choice.finish_reason); this.completed = true; }
    for (const fragment of objects(delta.tool_calls)) {
      const index = fragment.index;
      if (!Number.isInteger(index) || Number(index) < 0 || Number(index) > 31) throw invalid();
      const current = this.calls.get(Number(index)) ?? { id: '', name: '', arguments: '' };
      const fn = object(fragment.function);
      if (fragment.id) current.id = string(fragment.id);
      if (fn.name) current.name = string(fn.name);
      current.arguments = string(current.arguments) + string(fn.arguments);
      if (string(current.arguments).length > 64_000) throw invalid();
      this.calls.set(Number(index), current);
    }
  }

  private responses(event: JsonObject): void {
    const type = string(event.type);
    if (type === 'response.output_text.delta') this.appendText(event.delta);
    if (type === 'response.output_item.added' || type === 'response.output_item.done') {
      if (!Number.isInteger(event.output_index) || Number(event.output_index) < 0 || Number(event.output_index) > 127) throw invalid();
      this.items.set(Number(event.output_index), object(event.item));
    }
    if (type === 'response.completed') {
      const response = object(event.response);
      if (response.status && response.status !== 'completed') throw new Error('The provider stopped before completing the response. Retry the request.');
      if (Array.isArray(response.output)) this.items = new Map(objects(response.output).map((item, index) => [index, item]));
      this.completed = true;
    }
  }

  private anthropic(event: JsonObject): void {
    const index = Number(event.index ?? 0);
    if (!Number.isInteger(index) || index < 0 || index > 127) throw invalid();
    if (event.type === 'content_block_start') {
      const block = object(event.content_block);
      this.items.set(index, { ...block });
      if (block.type === 'text') this.appendText(block.text);
    }
    if (event.type === 'content_block_delta') {
      const delta = object(event.delta);
      const block = this.items.get(index) ?? { type: 'text', text: '' };
      if (delta.type === 'text_delta') { block.text = string(block.text) + string(delta.text); this.appendText(delta.text); }
      if (delta.type === 'thinking_delta') block.thinking = string(block.thinking) + string(delta.thinking);
      if (delta.type === 'signature_delta') block.signature = string(block.signature) + string(delta.signature);
      if (delta.type === 'input_json_delta') {
        const value = (this.arguments.get(index) ?? '') + string(delta.partial_json);
        if (value.length > 64_000) throw invalid();
        this.arguments.set(index, value);
      }
      this.items.set(index, block);
    }
    if (event.type === 'message_delta') this.stopReason = string(object(event.delta).stop_reason);
    if (event.type === 'message_stop') this.completed = true;
  }

  complete(raw: unknown): ModelReply {
    const result = object(raw);
    this.usage.accept(result, true);
    if (result.error) throw new Error('The provider interrupted the response. Retry the request.');
    this.completed = true;
    if (this.protocol === 'gemini') this.gemini.accept(result);
    else if (this.protocol === 'responses') {
      if (result.status && result.status !== 'completed') throw new Error('The provider stopped before completing the response. Retry the request.');
      this.items = new Map(objects(result.output).map((item, index) => [index, item]));
    } else if (this.protocol === 'anthropic') {
      this.items = new Map(objects(result.content).map((item, index) => [index, item]));
      this.stopReason = string(result.stop_reason);
    } else {
      const choice = objects(result.choices)[0] ?? {};
      const message = object(choice.message);
      this.appendText(message.content);
      this.stopReason = string(choice.finish_reason);
      objects(message.tool_calls).forEach((call, index) => { const fn = object(call.function); this.calls.set(index, { id: call.id, name: fn.name, arguments: fn.arguments }); });
    }
    return this.finish();
  }

  finish(): ModelReply {
    if (this.protocol === 'gemini') {
      const reply = this.gemini.finish();
      const parsed = toolCallSchema.array().max(32).safeParse(reply.toolCalls);
      if (!parsed.success || new Set(parsed.data.map((call) => call.id)).size !== parsed.data.length) throw invalid();
      if (!this.text && !parsed.data.length) throw new Error('The provider returned no text. Check that the selected model supports chat.');
      return { kind: this.kind, items: reply.items, toolCalls: parsed.data, ...(this.usage.snapshot() ? { usage: this.usage.snapshot() } : {}) };
    }
    if (['length', 'max_tokens', 'content_filter'].includes(this.stopReason)) throw new Error('The provider stopped before completing the response. Retry with a shorter request.');
    const items = [...this.items.entries()].sort(([a], [b]) => a - b).map(([, item]) => item);
    let calls: unknown[];
    if (this.protocol === 'responses') {
      if (!this.completed) throw new Error('The response stream ended before completion. Retry the request.');
      calls = items.filter((item) => item.type === 'function_call').map((item) => ({ id: item.call_id, name: item.name, arguments: item.arguments }));
      if (!this.text) this.appendText(items.filter((item) => item.type === 'message').flatMap((item) => objects(item.content)).filter((part) => part.type === 'output_text').map((part) => string(part.text)).join(''));
    } else if (this.protocol === 'anthropic') {
      for (const [index, json] of this.arguments) {
        try { this.items.get(index)!.input = JSON.parse(json); } catch { throw invalid(); }
      }
      calls = items.filter((item) => item.type === 'tool_use').map((item) => ({ id: item.id, name: item.name, arguments: JSON.stringify(item.input) }));
      if (!this.text) this.appendText(items.filter((item) => item.type === 'text').map((item) => string(item.text)).join(''));
    } else calls = [...this.calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
    if (calls.length && !this.completed) throw new Error('The tool-call stream ended before completion. Retry the request.');
    const parsed = toolCallSchema.array().max(32).safeParse(calls);
    if (!parsed.success || new Set(parsed.data.map((call) => call.id)).size !== parsed.data.length) throw invalid();
    if (!this.text && !parsed.data.length) throw new Error('The provider returned no text. Check that the selected model supports chat.');
    const usage = this.usage.snapshot();
    if (this.protocol === 'anthropic') return { kind: this.kind, items: [{ role: 'assistant', content: items }], toolCalls: parsed.data, ...(usage ? { usage } : {}) };
    if (this.protocol === 'responses') return { kind: this.kind, ...(this.kind === 'azure' ? { protocol: 'responses' as const } : {}), items, toolCalls: parsed.data, ...(usage ? { usage } : {}) };
    return { kind: this.kind, items: [{ role: 'assistant', content: this.text || null,
      ...(parsed.data.length ? { tool_calls: parsed.data.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) } : {}),
    }], ...(this.kind === 'azure' ? { protocol: 'openai' as const } : {}), toolCalls: parsed.data, ...(usage ? { usage } : {}) };
  }
}
