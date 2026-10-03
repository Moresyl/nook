import { randomUUID } from 'node:crypto';
import type { ModelInput } from './model-protocol';

type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}; }
function invalid(): Error { return new Error('The Gemini provider sent an invalid response. Retry or check API compatibility.'); }

export function geminiRequest(input: ModelInput, history: JsonObject[]): { route: string; body: JsonObject } {
  const contents: JsonObject[] = history.map((message) => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: Array.isArray(message.content) ? message.content : [{ text: message.content }] }));
  for (const { reply, results } of input.exchanges ?? []) {
    if (reply.kind !== 'gemini') throw invalid();
    const calls = reply.items.flatMap((item) => (Array.isArray(item.parts) ? item.parts : []).map(object)).filter((part) => part.functionCall);
    if (calls.length !== reply.toolCalls.length || results.length !== calls.length || new Set(results.map((result) => result.callId)).size !== results.length) throw invalid();
    contents.push(...reply.items);
    const parts = reply.toolCalls.map((call, index) => {
      const result = results.find((item) => item.callId === call.id);
      if (!result) throw invalid();
      const original = object(calls[index].functionCall);
      return { functionResponse: { name: call.name, ...(original.id ? { id: original.id } : {}), response: { [result.error ? 'error' : 'output']: result.output } } };
    });
    contents.push({ role: 'user', parts });
  }
  const model = input.model.replace(/^models\//, '');
  const maxOutput = input.provider.modelCatalog?.find((item) => item.id === input.model)?.maxOutputTokens;
  if (!/^[a-zA-Z0-9_.-]{1,128}$/.test(model)) throw new Error('Enter a Gemini model name from the model list.');
  return { route: `models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, body: {
    contents, ...(input.instructions ? { systemInstruction: { parts: [{ text: input.instructions }] } } : {}),
    generationConfig: { candidateCount: 1, ...(maxOutput ? { maxOutputTokens: maxOutput } : {}) },
    ...(input.tools?.length ? { tools: [{ functionDeclarations: input.tools.map((tool) => ({ name: tool.name, description: tool.description, parametersJsonSchema: tool.parameters })) }] } : {}),
  } };
}

/** Preserve signed parts verbatim; combine only adjacent plain text deltas. */
export class GeminiReply {
  private parts: JsonObject[] = [];
  private size = 0;
  private stopReason = '';

  constructor(private readonly onText: (text: unknown) => void) {}

  accept(raw: JsonObject): void {
    if (object(raw.promptFeedback).blockReason && object(raw.promptFeedback).blockReason !== 'BLOCK_REASON_UNSPECIFIED') {
      throw new Error('Gemini blocked the request. Review the prompt or choose another model.');
    }
    const candidates = raw.candidates;
    if (candidates === undefined) return;
    if (!Array.isArray(candidates) || candidates.length > 1) throw invalid();
    for (const value of candidates) {
      const candidate = object(value);
      if (candidate.index !== undefined && candidate.index !== 0) throw invalid();
      if (candidate.finishReason) this.stopReason = String(candidate.finishReason);
      const content = object(candidate.content);
      if (content.role !== undefined && content.role !== 'model') throw invalid();
      if (content.parts !== undefined && !Array.isArray(content.parts)) throw invalid();
      for (const value of content.parts as unknown[] ?? []) {
        const part = object(value);
        if (!Object.keys(part).length) throw invalid();
        this.size += JSON.stringify(part).length;
        if (this.size > 4_000_000) throw new Error('The Gemini response exceeded the message size limit. Ask for a shorter answer.');
        if (part.text !== undefined && typeof part.text !== 'string') throw invalid();
        if (part.text && !part.thought) this.onText(part.text);
        const plain = Object.keys(part).every((key) => key === 'text' || key === 'thought') && typeof part.text === 'string';
        const previous = this.parts.at(-1);
        const previousPlain = previous && Object.keys(previous).every((key) => key === 'text' || key === 'thought') && typeof previous.text === 'string';
        if (plain && previousPlain && part.thought === previous.thought) previous.text = String(previous.text) + part.text;
        else this.parts.push(structuredClone(part));
        if (this.parts.length > 128) throw invalid();
      }
    }
  }

  finish(): { items: JsonObject[]; toolCalls: unknown[] } {
    if (this.stopReason !== 'STOP') throw new Error(this.stopReason
      ? 'Gemini stopped before completing the response. Review the prompt or retry with a shorter request.'
      : 'The Gemini stream ended before completion. Retry the request.');
    const toolCalls = this.parts.filter((part) => part.functionCall).map((part) => {
      const call = object(part.functionCall);
      if (call.args !== undefined && (call.args === null || typeof call.args !== 'object' || Array.isArray(call.args))) throw invalid();
      return { id: call.id === undefined ? randomUUID() : call.id, name: call.name, arguments: JSON.stringify(call.args ?? {}) };
    });
    return { items: [{ role: 'model', parts: this.parts }], toolCalls };
  }
}
