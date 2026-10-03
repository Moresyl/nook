import { describe, expect, it, vi } from 'vitest';
import { HttpModelGateway, type ModelInput } from '../desktop/services/model-gateway';
import { modelRequest, ReplyCollector } from '../desktop/services/model-protocol';
import { projectToolDefinitions } from '../desktop/services/project-tools';
import { provider } from './fixtures';

const call = { id: 'call-1', name: 'read_file', arguments: '{"path":"README.md","start_line":1,"max_lines":20}' };
function input(kind: ModelInput['provider']['kind']): ModelInput {
  return { provider: { ...provider, kind }, key: 'test-key', model: 'model', instructions: 'Project rules', tools: projectToolDefinitions,
    messages: [{ id: 'user', role: 'user', content: 'Inspect the project', attachments: [], status: 'complete', createdAt: 1 }], signal: new AbortController().signal };
}
function stream(events: unknown[]) { return new Response(events.map((event) => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } }); }

describe('model tool protocols', () => {
  it('preserves external optional JSON schemas without forcing strict mode in native provider formats', () => {
    const parameters = { type: 'object', properties: { optional: { type: 'string' } } };
    const tools = [{ name: 'mcp_optional', description: 'Optional input', parameters, strict: false }];
    expect(modelRequest({ ...input('responses'), tools }).body.tools).toEqual([{ type: 'function', name: 'mcp_optional', description: 'Optional input', parameters, strict: false }]);
    expect(modelRequest({ ...input('openai'), tools }).body.tools).toEqual([{ type: 'function', function: tools[0] }]);
    expect(modelRequest({ ...input('anthropic'), tools }).body.tools).toEqual([{ name: 'mcp_optional', description: 'Optional input', input_schema: parameters }]);
  });
  it('assembles split Chat Completions arguments and sends correlated results on the next turn', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(stream([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: call.id, function: { name: call.name, arguments: '{"path":"' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'README.md","start_line":1,"max_lines":20}' } }] }, finish_reason: 'tool_calls' }] }, '[DONE]',
    ])).mockResolvedValueOnce(stream([{ choices: [{ delta: { content: 'Based on the file' } }] }, '[DONE]']));
    const gateway = new HttpModelGateway(fetcher);
    const reply = await gateway.stream(input('openai'), () => {});
    expect(reply.toolCalls).toEqual([call]);
    expect(JSON.parse(fetcher.mock.calls[0][1].body).tools[0]).toMatchObject({ type: 'function', function: { name: 'list_files', strict: true } });
    const text = vi.fn();
    await gateway.stream({ ...input('openai'), exchanges: [{ reply, results: [{ callId: call.id, output: '1: Project overview', error: false }] }] }, text);
    const messages = JSON.parse(fetcher.mock.calls[1][1].body).messages;
    expect(messages.at(-2).tool_calls[0].id).toBe(call.id);
    expect(messages.at(-1)).toEqual({ role: 'tool', tool_call_id: call.id, content: '1: Project overview' });
    expect(text).toHaveBeenCalledWith('Based on the file');
  });

  it('uses stateless Responses and preserves reasoning, assistant phase and tool IDs for continuation', async () => {
    const output = [
      { id: 'reasoning-1', type: 'reasoning', summary: [], encrypted_content: 'opaque' },
      { id: 'message-1', type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'Inspecting' }] },
      { id: 'function-1', type: 'function_call', call_id: call.id, name: call.name, arguments: call.arguments },
    ];
    const fetcher = vi.fn().mockResolvedValueOnce(stream([
      { type: 'response.output_item.added', output_index: 2, item: { ...output[2], arguments: '' } },
      { type: 'response.function_call_arguments.delta', output_index: 2, delta: call.arguments },
      { type: 'response.output_text.delta', delta: 'Inspecting' },
      { type: 'response.output_item.done', output_index: 2, item: output[2] },
      { type: 'response.completed', response: { status: 'completed', output } },
    ])).mockResolvedValueOnce(Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Final analysis' }] }] }));
    const gateway = new HttpModelGateway(fetcher);
    const text = vi.fn();
    const reply = await gateway.stream(input('responses'), text);
    expect(fetcher.mock.calls[0][0]).toMatch(/\/responses$/);
    const first = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(first).toMatchObject({ store: false, instructions: 'Project rules' });
    expect(first.tools[0]).toMatchObject({ type: 'function', name: 'list_files', strict: true });
    expect(reply.items).toEqual(output);
    expect(reply.toolCalls).toEqual([call]);
    expect(text.mock.calls).toEqual([['Inspecting']]);
    await gateway.stream({ ...input('responses'), exchanges: [{ reply, results: [{ callId: call.id, output: 'File contents', error: false }] }] }, text);
    expect(JSON.parse(fetcher.mock.calls[1][1].body).input.slice(1)).toEqual([...output, { type: 'function_call_output', call_id: call.id, output: 'File contents' }]);
    expect(text).toHaveBeenLastCalledWith('Final analysis');
  });

  it('handles native Anthropic tool input fragments and retains signed thinking in the next request', async () => {
    const fetcher = vi.fn().mockResolvedValue(stream([
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'internal evidence' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'signed' } },
      { type: 'content_block_start', index: 1, content_block: { type: 'text', text: 'Checking' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: ' files' } },
      { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: call.id, name: call.name, input: {} } },
      { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: call.arguments.slice(0, 12) } },
      { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: call.arguments.slice(12) } },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' } }, { type: 'message_stop' },
    ]));
    const text = vi.fn();
    const reply = await new HttpModelGateway(fetcher).stream(input('anthropic'), text);
    expect(reply.toolCalls).toEqual([call]);
    expect(text.mock.calls).toEqual([['Checking'], [' files']]);
    const request = modelRequest({ ...input('anthropic'), exchanges: [{ reply, results: [{ callId: call.id, output: 'Access denied', error: true }] }] });
    const messages = request.body.messages as { role: string; content: unknown }[];
    expect((messages.at(-2)?.content as unknown[])[0]).toMatchObject({ type: 'thinking', thinking: 'internal evidence', signature: 'signed' });
    expect(messages.at(-1)?.content).toEqual([{ type: 'tool_result', tool_use_id: call.id, content: 'Access denied', is_error: true }]);
    expect((request.body.tools as unknown[])[0]).toMatchObject({ name: 'list_files', input_schema: { additionalProperties: false } });
  });

  it.each(['openai', 'ollama', 'responses', 'anthropic'] as const)('accepts complete JSON tool-only replies from %s', async (kind) => {
    const json = kind === 'responses' ? { output: [{ type: 'function_call', call_id: call.id, name: call.name, arguments: call.arguments }] }
      : kind === 'anthropic' ? { content: [{ type: 'tool_use', id: call.id, name: call.name, input: JSON.parse(call.arguments) }], stop_reason: 'tool_use' }
      : { choices: [{ message: { tool_calls: [{ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } }] }, finish_reason: 'tool_calls' }] };
    const reply = await new HttpModelGateway(vi.fn().mockResolvedValue(Response.json(json))).stream(input(kind), () => {});
    expect(reply.toolCalls).toEqual([call]);
  });

  it('rejects truncated, malformed, duplicate and oversized calls before exposing them', async () => {
    const cases = [
      stream([{ choices: [{ delta: { tool_calls: [{ index: 0, id: call.id, function: { name: call.name, arguments: '{}' } }] } }] }]),
      stream([{ choices: [{ delta: { tool_calls: [{ index: -1 }] } }] }, '[DONE]']),
      Response.json({ choices: [{ message: { tool_calls: [{ id: 'x', function: { name: 'read', arguments: 'a'.repeat(64_001) } }] } }] }),
      Response.json({ choices: [{ message: { tool_calls: [1, 2].map(() => ({ id: call.id, function: { name: call.name, arguments: '{}' } })) } }] }),
    ];
    for (const response of cases) await expect(new HttpModelGateway(vi.fn().mockResolvedValue(response)).stream(input('openai'), () => {})).rejects.toThrow();
    await expect(new HttpModelGateway(vi.fn().mockResolvedValue(stream([{ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: call.id, name: call.name } }, { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{invalid' } }, { type: 'message_stop' }]))).stream(input('anthropic'), () => {})).rejects.toThrow('invalid');
  });

  it.each(['response.failed', 'response.incomplete'])('reports Responses %s events without exposing provider details', async (type) => {
    await expect(new HttpModelGateway(vi.fn().mockResolvedValue(stream([{ type, response: { error: 'secret upstream details' } }]))).stream(input('responses'), () => {})).rejects.toThrow('interrupted');
  });

  it('rejects incomplete Responses, output limits and unsafe continuation mixing', () => {
    const collector = new ReplyCollector('responses', () => {});
    collector.accept({ type: 'response.output_text.delta', delta: 'Partial' });
    expect(() => collector.finish()).toThrow('before completion');
    expect(() => collector.accept({ type: 'response.output_item.added', output_index: -1 })).toThrow('invalid');
    expect(() => collector.complete({ status: 'incomplete', output: [] })).toThrow('before completing');
    const chat = new ReplyCollector('openai', () => {});
    expect(() => chat.complete({ choices: [{ message: { content: 'a'.repeat(4_000_001) } }] })).toThrow('size limit');
    expect(() => chat.complete({ choices: [{ message: { content: 'Partial' }, finish_reason: 'length' }] })).toThrow('before completing');
    expect(() => modelRequest({ ...input('responses'), exchanges: [{ reply: { kind: 'openai', items: [], toolCalls: [] }, results: [] }] })).toThrow('invalid');
  });

  it('reintroduces bounded project evidence from previous messages without treating it as tool calls', () => {
    const request = modelRequest({ ...input('openai'), instructions: '', tools: [], messages: [{ id: 'a', role: 'assistant', content: 'Analysis', attachments: [], createdAt: 1, status: 'complete',
      activities: [{ id: 'activity', name: 'read_file', input: '{}', output: 'Actual project fact', status: 'complete', startedAt: 1 }] }] });
    expect(request.body.tools).toBeUndefined();
    expect((request.body.messages as { content: string }[])[0].content).toContain('Actual project fact');
  });
});
