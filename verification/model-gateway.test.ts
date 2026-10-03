import { describe, expect, it, vi } from 'vitest';
import { HttpModelGateway, serverEvents, type ModelInput } from '../desktop/services/model-gateway';
import { provider } from './fixtures';

function streamBytes(chunks: Uint8Array[]) { return new ReadableStream<Uint8Array>({ start(controller) { chunks.forEach((chunk) => controller.enqueue(chunk)); controller.close(); } }); }
function responseStream(value: string) { return new Response(streamBytes([new TextEncoder().encode(value)]), { headers: { 'Content-Type': 'text/event-stream' } }); }
function input(overrides: Partial<ModelInput> = {}): ModelInput {
  return { provider, key: '', model: 'test-model', instructions: 'Be helpful', messages: [{ id: 'u', role: 'user', content: 'Question', attachments: [{ id: 'f', name: 'data.txt', content: 'Context' }], createdAt: 1, status: 'complete' }], signal: new AbortController().signal, ...overrides };
}
describe('model transport', () => {
  it('decodes split Unicode, CRLF, comments, multiline fields, and EOF without a blank line', async () => {
    const bytes = new TextEncoder().encode(': heartbeat\r\ndata: 你好\r\ndata: second\r\n\r\ndata: final');
    const events: string[] = [];
    for await (const event of serverEvents(streamBytes([...bytes].map((byte) => new Uint8Array([byte]))))) events.push(event);
    expect(events).toEqual(['你好\nsecond', 'final']);
  });
  it('supports empty streams and event fields without data', async () => {
    const events: string[] = [];
    for await (const event of serverEvents(streamBytes([new TextEncoder().encode('event: ping\n\n')]))) events.push(event);
    expect(events).toEqual([]);
  });
  it('streams OpenAI deltas and sends system instructions and attachments', async () => {
    const fetcher = vi.fn().mockResolvedValue(responseStream('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: {"choices":[{"delta":{"content":" world"}}]}\n\ndata: [DONE]\n\n'));
    const output: string[] = [];
    await new HttpModelGateway(fetcher).stream(input({ provider: { ...provider, kind: 'openai' }, key: 'key' }), (text) => output.push(text));
    expect(output.join('')).toBe('Hello world');
    expect(fetcher.mock.calls[0][0]).toBe('http://localhost:11434/v1/chat/completions');
    const options = fetcher.mock.calls[0][1];
    expect(options.headers.Authorization).toBe('Bearer key');
    expect(JSON.parse(options.body).messages[1].content).toContain('data.txt ---\nContext');
  });
  it('streams Anthropic text deltas using its native headers and body', async () => {
    const fetcher = vi.fn().mockResolvedValue(responseStream('data: {"type":"message_start"}\n\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Answer"}}\n\n'));
    const output: string[] = [];
    await new HttpModelGateway(fetcher).stream(input({ provider: { ...provider, kind: 'anthropic' }, key: 'key' }), (text) => output.push(text));
    expect(output).toEqual(['Answer']);
    expect(fetcher.mock.calls[0][0]).toContain('/messages');
    expect(fetcher.mock.calls[0][1].headers['x-api-key']).toBe('key');
    expect(JSON.parse(fetcher.mock.calls[0][1].body).system).toBe('Be helpful');
  });
  it.each(['openai', 'anthropic'] as const)('accepts a complete JSON response from %s-compatible gateways', async (kind) => {
    const json = kind === 'anthropic' ? { content: [{ type: 'text', text: 'Text' }] } : { choices: [{ message: { content: 'Text' } }] };
    const fetcher = vi.fn().mockResolvedValue(Response.json(json));
    const output: string[] = [];
    await new HttpModelGateway(fetcher).stream(input({ provider: { ...provider, kind }, instructions: '' }), (text) => output.push(text));
    expect(output).toEqual(['Text']);
  });
  it.each([401, 403, 429, 500])('reports HTTP %s without leaking the response body', async (status) => {
    const fetcher = vi.fn().mockResolvedValue(new Response('secret-key-in-server-error', { status }));
    await expect(new HttpModelGateway(fetcher).stream(input(), () => {})).rejects.toThrow(/authentication|limit|HTTP/);
    try { await new HttpModelGateway(fetcher).stream(input(), () => {}); } catch (error) { expect(String(error)).not.toContain('secret-key'); }
  });
  it.each(['data: {bad}\n\n', 'data: {"error":"private upstream error"}\n\n', 'data: {"type":"error"}\n\n', 'data: [DONE]\n\n'])('rejects unusable streams (%s)', async (data) => {
    await expect(new HttpModelGateway(vi.fn().mockResolvedValue(responseStream(data))).stream(input(), () => {})).rejects.toThrow();
  });
  it('reports network errors without returning network exception details', async () => {
    await expect(new HttpModelGateway(vi.fn().mockRejectedValue(new Error('url-with-secret'))).stream(input(), () => {})).rejects.toThrow('Could not connect');
  });
  it('preserves cancellation and rejects a stream after it is aborted', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(new HttpModelGateway(vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'))).stream(input({ signal: controller.signal }), () => {})).rejects.toThrow('Aborted');
    await expect(new HttpModelGateway(vi.fn().mockResolvedValue(responseStream('data: {}\n\n'))).stream(input({ signal: controller.signal }), () => {})).rejects.toThrow('Aborted');
  });
  it('rejects empty HTTP bodies and non-chat JSON payloads', async () => {
    await expect(new HttpModelGateway(vi.fn().mockResolvedValue(new Response(null))).stream(input(), () => {})).rejects.toThrow('empty response');
    await expect(new HttpModelGateway(vi.fn().mockResolvedValue(Response.json({}))).stream(input(), () => {})).rejects.toThrow('no text');
    await expect(new HttpModelGateway(vi.fn().mockResolvedValue(Response.json({}))).stream(input({ provider: { ...provider, kind: 'anthropic' } }), () => {})).rejects.toThrow('no text');
  });
  it('redacts reader failures, cancels broken JSON/SSE bodies and rejects cancellation during JSON loading', async () => {
    for (const type of ['application/json', 'text/event-stream']) {
      const response = new Response(new ReadableStream({ start(controller) { controller.error(new Error('private endpoint and key')); } }), { headers: { 'Content-Type': type } });
      try { await new HttpModelGateway(vi.fn().mockResolvedValue(response)).stream(input(), () => {}); throw new Error('Expected rejection'); }
      catch (error) { expect(String(error)).toContain('disconnected'); expect(String(error)).not.toContain('private'); }
    }
    const controller = new AbortController();
    await expect(new HttpModelGateway(vi.fn().mockImplementation(async () => { controller.abort(); return Response.json({}); })).stream(input({ signal: controller.signal }), () => {})).rejects.toThrow('Aborted');
  });
  it('discovers sorted unique models, handles missing model lists and HTTP errors', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ data: [{ id: 'b' }, { id: 'a' }, { id: 'b' }, { id: '' }] })).mockResolvedValueOnce(Response.json({})).mockResolvedValueOnce(new Response('', { status: 500 }));
    const gateway = new HttpModelGateway(fetcher);
    expect(await gateway.discover(provider, '')).toEqual(['a', 'b']);
    await expect(gateway.discover(provider, '')).rejects.toThrow('Enter model names manually');
    await expect(gateway.discover(provider, '')).rejects.toThrow('HTTP 500');
  });
});
