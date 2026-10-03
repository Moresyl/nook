import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { providerSchema } from '../contracts/workspace';
import { HttpModelGateway, type ModelInput } from '../desktop/services/model-gateway';
import { modelRequest, providerProtocol, ReplyCollector } from '../desktop/services/model-protocol';
import { provider } from './fixtures';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
function input(kind: ModelInput['provider']['kind'], options: Partial<ModelInput['provider']> = {}): ModelInput {
  return { provider: { ...provider, kind, ...options }, key: 'fixture-secret', model: 'gemini-fixture', instructions: 'System rules',
    messages: [{ id: 'u', role: 'user', content: 'Question', attachments: [{ id: 'f', name: 'notes.txt', content: 'Attachment evidence' }], createdAt: 1, status: 'complete' }],
    signal: new AbortController().signal, tools: [{ name: 'read_file', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' } } }, strict: false }] };
}
function sse(events: unknown[]) { return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } }); }
function gemini(parts: unknown[], finishReason?: string) { return { candidates: [{ index: 0, content: { role: 'model', parts }, ...(finishReason ? { finishReason } : {}) }] }; }

describe('native Gemini and Azure providers', () => {
  it('validates provider options and prevents URL-embedded credentials and fragments', () => {
    expect(providerSchema.parse(input('gemini').provider).kind).toBe('gemini');
    expect(providerSchema.parse(input('azure').provider).azureApi).toBeUndefined();
    for (const overrides of [{ endpoint: 'https://key:secret@example.com' }, { endpoint: 'https://example.com/#key' }, { azureApi: 'chat' as const }]) {
      expect(providerSchema.safeParse({ ...provider, ...overrides }).success).toBe(false);
    }
    expect(providerSchema.safeParse(input('azure', { azureApi: 'deployment-chat' }).provider).success).toBe(false);
    expect(providerSchema.safeParse(input('azure', { azureApi: 'deployment-chat', apiVersion: '2024-10-21' }).provider).success).toBe(true);
    expect(providerSchema.safeParse(input('azure', { apiVersion: 'secret?key=private' }).provider).success).toBe(false);
    expect(['responses', 'openai', 'anthropic', 'ollama', 'gemini', 'azure'].map((kind) => providerProtocol(input(kind as ModelInput['provider']['kind']).provider))).toEqual(['responses', 'openai', 'anthropic', 'openai', 'gemini', 'responses']);
  });

  it('sends Gemini native instructions, history, attachments and unmodified optional JSON schemas', async () => {
    const request = input('gemini', { endpoint: 'https://generativelanguage.googleapis.com/v1beta/?custom=value' }); request.model = 'models/gemini-fixture';
    request.messages.push({ id: 'a', role: 'assistant', content: 'Earlier reply', attachments: [], createdAt: 2, status: 'complete' });
    const fetcher = vi.fn().mockResolvedValue(sse([gemini([{ text: 'Answer' }]), gemini([], 'STOP')])); const text = vi.fn();
    const reply = await new HttpModelGateway(fetcher).stream(request, text);
    const url = new URL(fetcher.mock.calls[0][0]);
    expect(url.pathname).toBe('/v1beta/models/gemini-fixture:streamGenerateContent'); expect(url.searchParams.get('alt')).toBe('sse'); expect(url.searchParams.get('custom')).toBe('value'); expect(url.searchParams.has('key')).toBe(false);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'manual', headers: { 'x-goog-api-key': 'fixture-secret' } }); expect(fetcher.mock.calls[0][1].headers.Authorization).toBeUndefined();
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.systemInstruction.parts).toEqual([{ text: 'System rules' }]); expect(body.contents[0].parts[0].text).toContain('Attachment evidence'); expect(body.contents[1].role).toBe('model');
    expect(body.tools[0].functionDeclarations[0]).toEqual({ name: 'read_file', description: 'Read a file', parametersJsonSchema: request.tools![0].parameters });
    expect(text).toHaveBeenCalledWith('Answer'); expect(reply.kind).toBe('gemini');
    expect(modelRequest({ ...request, instructions: '', tools: [] }).body.systemInstruction).toBeUndefined();
    for (const model of ['../secret', '', 'models/../secret']) expect(() => modelRequest({ ...request, model })).toThrow('model name');
  });

  it('retains signed thought, function and empty-text parts while correlating parallel native tool results', async () => {
    const parts = [{ text: 'Private reasoning', thought: true, thoughtSignature: 'opaque-thought' },
      { functionCall: { id: 'native-call', name: 'read_file', args: { path: 'README.md' } }, thoughtSignature: 'opaque-call', partMetadata: { exact: true } },
      { functionCall: { name: 'read_file' } }, { text: '', thoughtSignature: 'opaque-tail' }];
    const output = vi.fn(); const reply = await new HttpModelGateway(vi.fn().mockResolvedValue(sse(parts.map((part, index) => gemini([part], index === parts.length - 1 ? 'STOP' : undefined))))).stream(input('gemini'), output);
    expect(output).not.toHaveBeenCalled(); expect(reply.items).toEqual([{ role: 'model', parts }]); expect(reply.toolCalls[0]).toEqual({ id: 'native-call', name: 'read_file', arguments: '{"path":"README.md"}' }); expect(reply.toolCalls[1].id).toMatch(/^[\da-f-]{36}$/);
    const results = [{ callId: reply.toolCalls[1].id, output: 'Denied', error: true }, { callId: 'native-call', output: 'File evidence', error: false }];
    const body = modelRequest({ ...input('gemini'), exchanges: [{ reply, results }] }).body;
    expect((body.contents as unknown[]).slice(1)).toEqual([{ role: 'model', parts }, { role: 'user', parts: [
      { functionResponse: { id: 'native-call', name: 'read_file', response: { output: 'File evidence' } } }, { functionResponse: { name: 'read_file', response: { error: 'Denied' } } },
    ] }]);
    for (const bad of [[], [results[0]], [results[0], results[0]]]) expect(() => modelRequest({ ...input('gemini'), exchanges: [{ reply, results: bad }] })).toThrow('invalid');
    expect(() => modelRequest({ ...input('gemini'), exchanges: [{ reply: { ...reply, kind: 'azure' }, results }] })).toThrow('invalid');
    expect(() => modelRequest({ ...input('gemini'), exchanges: [{ reply: { ...reply, toolCalls: [reply.toolCalls[0], { ...reply.toolCalls[1], id: 'missing' }] }, results }] })).toThrow('invalid');
    expect(() => modelRequest({ ...input('gemini'), exchanges: [{ reply: { ...reply, items: [] }, results }] })).toThrow('invalid');
  });

  it('merges thousands of unsigned deltas without rewriting signed parts', () => {
    const text = vi.fn(); const collector = new ReplyCollector('gemini', text);
    collector.accept({ usageMetadata: {} });
    for (let index = 0; index < 1000; index++) collector.accept(gemini([{ text: 'a' }]));
    collector.accept(gemini([{ text: 'b', thoughtSignature: 'signed' }])); collector.accept(gemini([{ text: 'hidden', thought: true }, { text: 'thought', thought: true }])); collector.accept(gemini([], 'STOP'));
    expect(collector.finish().items[0].parts).toEqual([{ text: 'a'.repeat(1000) }, { text: 'b', thoughtSignature: 'signed' }, { text: 'hiddenthought', thought: true }]); expect(text).toHaveBeenCalledTimes(1001);
  });

  it.each(['MAX_TOKENS', 'SAFETY', 'MALFORMED_FUNCTION_CALL', 'MISSING_THOUGHT_SIGNATURE', 'OTHER'])('rejects Gemini %s before tools can execute', (reason) => {
    const collector = new ReplyCollector('gemini', () => {}); collector.accept(gemini([{ functionCall: { name: 'read_file', args: {} } }], reason)); expect(() => collector.finish()).toThrow('before completing');
  });

  it('rejects blocked, incomplete, malformed, duplicate, oversized and excessive Gemini output', () => {
    const collector = () => new ReplyCollector('gemini', () => {});
    expect(() => collector().complete({ promptFeedback: { blockReason: 'SAFETY', private: 'secret' } })).toThrow('blocked');
    const unfinished = collector(); unfinished.accept(gemini([{ functionCall: { name: 'read_file', args: {} } }])); unfinished.done(); expect(() => unfinished.finish()).toThrow('before completion');
    for (const raw of [{ candidates: {} }, { candidates: [{}, {}] }, { candidates: [{ index: 1 }] }, { candidates: [{ content: { role: 'user' } }] }, { candidates: [{ content: { parts: {} } }] }, gemini([null]), gemini([{ text: 1 }]), gemini([{ functionCall: { name: 'read_file', args: [] } }], 'STOP'), gemini([{ functionCall: { name: 'read_file', args: null } }], 'STOP'), gemini([{ text: 'x'.repeat(4_000_001) }], 'STOP'), gemini(Array.from({ length: 129 }, () => ({ text: 'x', thoughtSignature: 'signed' })), 'STOP'), gemini([{ functionCall: { name: 'read_file', args: { value: 'x'.repeat(64_001) } } }], 'STOP'), gemini(Array.from({ length: 33 }, () => ({ functionCall: { name: 'read_file' } })), 'STOP'), gemini([1, 2].map(() => ({ functionCall: { id: 'duplicate', name: 'read_file' } })), 'STOP')]) {
      expect(() => collector().complete(raw)).toThrow();
    }
    expect(() => collector().complete(gemini([], 'STOP'))).toThrow('no text'); expect(() => collector().complete({ error: { message: 'secret' } })).toThrow('interrupted');
    expect(collector().complete({ promptFeedback: { blockReason: 'BLOCK_REASON_UNSPECIFIED' }, ...gemini([{ text: 'JSON answer' }], 'STOP') }).toolCalls).toEqual([]);
  });

  it('discovers only Gemini generation models across encoded pages and deduplicates results', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ models: [{ name: 'models/b', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embed', supportedGenerationMethods: ['embedContent'] }, null], nextPageToken: 'page/+?token' }))
      .mockResolvedValueOnce(Response.json({ models: [{ name: 'models/a', supportedGenerationMethods: ['generateContent'] }, { name: 'models/b', supportedGenerationMethods: ['generateContent'] }, { name: 'models/no-method' }] }));
    expect(await new HttpModelGateway(fetcher).discover(input('gemini').provider, 'fixture-secret')).toEqual(['a', 'b']);
    expect(new URL(fetcher.mock.calls[1][0]).searchParams.get('pageToken')).toBe('page/+?token'); expect(fetcher.mock.calls[1][1].headers['x-goog-api-key']).toBe('fixture-secret');
  });

  it('rejects looping, excessive, malformed and failed model discovery without exposing upstream details', async () => {
    for (const result of [{ models: [], nextPageToken: 'same' }, { models: [], nextPageToken: 1 }, { models: [], nextPageToken: 'x'.repeat(2049) }, { models: Array.from({ length: 201 }, (_, index) => ({ name: `models/${index}`, supportedGenerationMethods: ['generateContent'] })) }]) {
      await expect(new HttpModelGateway(vi.fn().mockImplementation(async () => Response.json(result))).discover(input('gemini').provider, 'secret')).rejects.toThrow(/model list/);
    }
    let page = 0; await expect(new HttpModelGateway(vi.fn().mockImplementation(async () => Response.json({ models: [], nextPageToken: String(++page) }))).discover(input('gemini').provider, 'secret')).rejects.toThrow('excessive');
    for (const response of [new Response('secret-invalid-json'), Response.json([]), Response.json(null), new Response(null), new Response('secret', { status: 302, headers: { Location: 'https://example.invalid' } }), new Response('secret', { status: 403 }), new Response('x'.repeat(16_000_001))]) {
      try { await new HttpModelGateway(vi.fn().mockResolvedValue(response)).discover(provider, 'secret'); throw new Error('Expected a rejection'); } catch (error) { expect(String(error)).not.toContain('secret'); }
    }
    await expect(new HttpModelGateway(vi.fn().mockRejectedValue(new Error('private URL'))).discover(provider, 'secret')).rejects.toThrow('Could not connect');
    expect(await new HttpModelGateway(vi.fn().mockResolvedValue(Response.json({ data: [null, { id: 'x'.repeat(129) }, { id: '\0bad' }, { id: 'good' }] }))).discover(provider, '')).toEqual(['good']);
  });

  it.each(['responses', 'chat', 'deployment-chat'] as const)('uses Azure %s routing, api-key authentication and correlated tool continuations', async (azureApi) => {
    const request = input('azure', { endpoint: 'https://resource.openai.azure.com/', azureApi, ...(azureApi === 'deployment-chat' ? { apiVersion: '2024-10-21' } : {}) }); request.model = 'deployed model/中文';
    const output = azureApi === 'responses' ? { status: 'completed', output: [{ type: 'reasoning', encrypted_content: 'opaque' }, { type: 'function_call', call_id: 'azure-call', name: 'read_file', arguments: '{}' }] }
      : { choices: [{ message: { tool_calls: [{ id: 'azure-call', function: { name: 'read_file', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] };
    const fetcher = vi.fn().mockImplementation(async () => Response.json(output)); const gateway = new HttpModelGateway(fetcher); const reply = await gateway.stream(request, () => {});
    expect(reply.kind).toBe('azure'); expect(reply.toolCalls[0].id).toBe('azure-call');
    const url = new URL(fetcher.mock.calls[0][0]); expect(url.pathname).toBe(azureApi === 'deployment-chat' ? `/openai/deployments/${encodeURIComponent(request.model)}/chat/completions` : `/openai/v1/${azureApi === 'responses' ? 'responses' : 'chat/completions'}`);
    expect(url.searchParams.get('api-version')).toBe(azureApi === 'deployment-chat' ? '2024-10-21' : null); expect(fetcher.mock.calls[0][1].headers).toMatchObject({ 'api-key': 'fixture-secret' }); expect(fetcher.mock.calls[0][1].headers.Authorization).toBeUndefined();
    await gateway.stream({ ...request, exchanges: [{ reply, results: [{ callId: 'azure-call', output: 'Azure evidence', error: false }] }] }, () => {});
    const body = JSON.parse(fetcher.mock.calls[1][1].body); expect((body.input ?? body.messages).at(-1)).toEqual(azureApi === 'responses' ? { type: 'function_call_output', call_id: 'azure-call', output: 'Azure evidence' } : { role: 'tool', tool_call_id: 'azure-call', content: 'Azure evidence' });
    const alternate = { ...request.provider, endpoint: 'https://resource.openai.azure.com/openai/v1/' }; await gateway.stream({ ...request, provider: alternate }, () => {});
    expect(new URL(fetcher.mock.calls[2][0]).pathname).toBe(url.pathname);
    if (azureApi === 'deployment-chat') await expect(gateway.discover(request.provider, 'secret')).rejects.toThrow('deployment names manually');
    expect(() => modelRequest({ ...input('openai'), exchanges: [{ reply, results: [] }] })).toThrow('invalid');
    expect(() => modelRequest({ ...request, provider: { ...request.provider, azureApi: azureApi === 'responses' ? 'chat' : 'responses' }, exchanges: [{ reply, results: [] }] })).toThrow('invalid');
    if (azureApi === 'deployment-chat') for (const model of ['.', '..']) expect(() => modelRequest({ ...request, model })).toThrow('valid Azure');
  });

  it('streams, continues native tools, cancels sockets and refuses key-bearing redirects using real HTTP peers', async () => {
    let received: unknown; let closed!: () => void; let followUps = 0;
    const disconnected = new Promise<void>((resolve) => { closed = resolve; });
    const server = createServer(async (request, response) => {
      if (request.url === '/redirect/models') { response.writeHead(302, { Location: '/must-not-follow' }); response.end(); return; }
      if (request.url === '/must-not-follow') { followUps++; response.end(); return; }
      let text = ''; for await (const chunk of request) text += chunk; const body = JSON.parse(text); received = { url: request.url, headers: request.headers, body };
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const user = body.contents[0].parts[0].text;
      if (user.includes('slow')) { response.write(`data: ${JSON.stringify(gemini([{ text: 'Partial' }]))}\n\n`); response.on('close', closed); return; }
      const result = body.contents.at(-1).parts[0].functionResponse;
      if (result) { expect(result).toEqual({ id: 'peer-call', name: 'read_file', response: { output: 'Peer evidence' } }); response.end(`data: ${JSON.stringify(gemini([{ text: 'Final answer' }], 'STOP'))}\n\n`); }
      else response.end(`data: ${JSON.stringify(gemini([{ functionCall: { id: 'peer-call', name: 'read_file', args: {} }, thoughtSignature: 'peer-signature' }], 'STOP'))}\n\n`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); cleanups.push(() => new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }));
    const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1beta`; const request = input('gemini', { endpoint }); const gateway = new HttpModelGateway();
    const reply = await gateway.stream(request, () => {}); expect(received).toMatchObject({ url: '/v1beta/models/gemini-fixture:streamGenerateContent?alt=sse', headers: { 'x-goog-api-key': 'fixture-secret' } });
    const output = vi.fn(); await gateway.stream({ ...request, exchanges: [{ reply, results: [{ callId: 'peer-call', output: 'Peer evidence', error: false }] }] }, output); expect(output).toHaveBeenCalledWith('Final answer');
    const controller = new AbortController(); const stopped = gateway.stream({ ...request, messages: [{ ...request.messages[0], content: 'slow' }], signal: controller.signal }, () => controller.abort()); await expect(stopped).rejects.toThrow(); await disconnected;
    await expect(gateway.discover({ ...provider, endpoint: endpoint.replace('/v1beta', '/redirect') }, 'fixture-secret')).rejects.toThrow('HTTP 302'); expect(followUps).toBe(0);
  });
});
