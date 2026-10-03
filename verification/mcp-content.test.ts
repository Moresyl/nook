import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ErrorCode, GetPromptRequestSchema, ListPromptsRequestSchema, ListResourcesRequestSchema, ListResourceTemplatesRequestSchema, McpError, ReadResourceRequestSchema, type GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mcpServerSchema } from '../contracts/extensions';
import { McpConnections } from '../desktop/services/mcp-connections';
import { mcpContentCatalog, McpContentAccess } from '../desktop/services/mcp-content';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map((close) => close())); });
async function setup() {
  const config = mcpServerSchema.parse({ id: 'content', name: 'Content', transport: 'stdio', command: 'node', timeout: 1000 });
  const server = new Server({ name: 'content-fixture', version: '1' }, { capabilities: { resources: { listChanged: true }, prompts: { listChanged: true } } });
  const resources = vi.fn(async () => ({ resources: [{ name: 'Document', uri: 'test://document', description: 'Evidence' }, { name: 'Binary', uri: 'test://binary' }] }));
  const templates = vi.fn(async () => ({ resourceTemplates: [{ name: 'Profile', uriTemplate: 'test://profiles/{user}' }] }));
  const prompts = vi.fn(async () => ({ prompts: [{ name: 'review', description: 'Review content', arguments: [{ name: 'topic', required: true }, { name: 'style', required: false }] }] }));
  const read = vi.fn(async (request: { params: { uri: string } }) => ({ contents: request.params.uri === 'test://binary' ? [{ uri: request.params.uri, blob: 'AP8=', mimeType: 'application/octet-stream' }] : [{ uri: request.params.uri, text: 'RESOURCE_EVIDENCE', mimeType: 'text/plain' }] }));
  const prompt = vi.fn(async (request: { params: { name: string; arguments?: Record<string, string> } }): Promise<GetPromptResult> => ({ messages: [{ role: 'user', content: { type: 'text', text: `Review ${request.params.arguments?.topic}` } }, { role: 'assistant', content: { type: 'resource', resource: { uri: 'test://document', text: 'PROMPT_RESOURCE_EVIDENCE' } } }] }));
  server.setRequestHandler(ListResourcesRequestSchema, resources); server.setRequestHandler(ListResourceTemplatesRequestSchema, templates); server.setRequestHandler(ListPromptsRequestSchema, prompts); server.setRequestHandler(ReadResourceRequestSchema, read); server.setRequestHandler(GetPromptRequestSchema, prompt);
  const [local, remote] = InMemoryTransport.createLinkedPair(); await server.connect(remote);
  const manager = new McpConnections(() => config, () => ({}), () => {}, () => local); cleanup.push(() => manager.shutdown());
  expect((await manager.connect('content')).status).toBe('connected');
  return { manager, server, config, resources, templates, prompts, read, prompt };
}
const context = () => ({ approve: vi.fn().mockResolvedValue(true), onProgress: vi.fn() });
describe('MCP resources and prompts', () => {
  it('refreshes a server that does not emit notifications and invalidates the previous selection', async () => {
    const { manager, resources } = await setup(); const selected = manager.select(['content']);
    resources.mockResolvedValue({ resources: [{ name: 'Updated', uri: 'test://updated', description: 'New' }] });
    expect((await manager.refreshCatalog('content')).resources[0].uri).toBe('test://updated');
    const call = { id: 'old', name: selected.definitions[0].name, arguments: '{"offset":0,"limit":10}' };
    expect((await selected.execute(call, new AbortController().signal, context())).error).toBe(true);
    await manager.disconnect('content'); await expect(manager.refreshCatalog('content')).rejects.toThrow('Connect');
  });
  it('handles optional template discovery and bounds paginated catalogs, identities and cursors', async () => {
    const resources = vi.fn().mockResolvedValueOnce({ resources: [{ name: 'One', uri: 'test://one' }], nextCursor: 'next' }).mockResolvedValue({ resources: [{ name: 'Two', uri: 'test://two' }] });
    const client = { getServerCapabilities: () => ({ resources: {} }), listResources: resources, listResourceTemplates: vi.fn().mockRejectedValue(new McpError(ErrorCode.MethodNotFound, 'Optional')) };
    const load = () => mcpContentCatalog(client as never, new AbortController().signal, 1000);
    expect((await load()).resources).toHaveLength(2); expect(resources).toHaveBeenNthCalledWith(2, { cursor: 'next' }, expect.anything());
    resources.mockResolvedValue({ resources: [], nextCursor: 'cycle' }); await expect(load()).rejects.toThrow('cursor');
    resources.mockResolvedValue({ resources: [{ name: 'One', uri: 'same' }, { name: 'Two', uri: 'same' }] }); await expect(load()).rejects.toThrow('duplicate');
    resources.mockResolvedValue({ resources: Array.from({ length: 1001 }, (_, i) => ({ name: String(i), uri: `test://${i}` })) }); await expect(load()).rejects.toThrow('large');
    resources.mockResolvedValue({ resources: [{ name: 'One', uri: 'one', description: 'x'.repeat(2_000_001) }] }); await expect(load()).rejects.toThrow('large');
    let index = 0; resources.mockImplementation(async () => ({ resources: [], nextCursor: String(index++) })); await expect(load()).rejects.toThrow('pages');
    resources.mockResolvedValue({ resources: [] }); client.listResourceTemplates.mockRejectedValue(new Error('Secret upstream error')); await expect(load()).rejects.toThrow('Secret upstream error');
  });
  it('discovers resources, templates and prompt arguments, and reads real protocol text/binary metadata', async () => {
    const { manager, read } = await setup(); const catalog = manager.catalog('content'); expect(catalog.resources).toHaveLength(2); expect(catalog.prompts[0].arguments[0].required).toBe(true);
    catalog.resources.length = 0; expect(manager.catalog('content').resources).toHaveLength(2);
    expect(await manager.readResource('content', 'test://document')).toMatchObject({ title: 'Document', text: 'Source: test://document\nRESOURCE_EVIDENCE', binaryItems: [] });
    expect((await manager.readResource('content', 'test://profiles/alice')).text).toContain('RESOURCE_EVIDENCE');
    expect((await manager.readResource('content', 'test://binary')).binaryItems).toEqual([{ uri: 'test://binary', mimeType: 'application/octet-stream', bytes: 2, data: 'AP8=' }]);
    const prompt = await manager.getPrompt('content', 'review', { topic: 'Project' }); expect(prompt.text).toContain('[user]\nReview Project'); expect(prompt.text).toContain('PROMPT_RESOURCE_EVIDENCE');
    await expect(manager.readResource('content', 'test://unknown')).rejects.toThrow('Could not read'); expect(read).toHaveBeenCalledTimes(3);
    await expect(manager.getPrompt('content', 'review', {})).rejects.toThrow('Could not load'); await expect(manager.getPrompt('content', 'review', { topic: 'Project', unknown: 'value' })).rejects.toThrow();
  });
  it('provides paginated metadata without a remote read and requires exact approval for content requests', async () => {
    const { manager, read } = await setup(); const selected = manager.select(['content']); expect(selected.definitions).toHaveLength(4);
    const find = (action: string) => selected.definitions.find((item) => item.name.startsWith(`mcp_${action}_`))!.name;
    const approval = context(); const signal = new AbortController().signal;
    const list = await selected.execute({ id: 'list', name: find('list_resources'), arguments: '{"offset":0,"limit":1}' }, signal, approval);
    expect(JSON.parse(list.output)).toMatchObject({ total: 3, nextOffset: 1 }); expect(approval.approve).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
    const prompts = await selected.execute({ id: 'prompts', name: find('list_prompts'), arguments: '{"offset":0,"limit":50}' }, signal, approval); expect(prompts.output).toContain('review');
    const call = { id: 'read', name: find('read_resource'), arguments: '{"uri":"test://document"}' };
    expect((await selected.execute(call, signal, approval)).error).toBe(false); expect(approval.approve).toHaveBeenCalledWith({ kind: 'mcp', serverId: 'content', serverName: 'Content', toolName: 'resources/read', arguments: call.arguments });
    approval.approve.mockResolvedValue(false); expect((await selected.execute(call, signal, approval)).output).toContain('declined'); expect(read).toHaveBeenCalledOnce();
    const get = { id: 'prompt', name: find('get_prompt'), arguments: '{"name":"review","arguments":{"topic":"Evidence"}}' }; approval.approve.mockResolvedValue(true); expect((await selected.execute(get, signal, approval)).output).toContain('Review Evidence');
    expect((await selected.execute({ ...call, arguments: '{bad' }, signal, approval)).error).toBe(true);
  });
  it('returns the exact binary snapshot for explicit UI use while approved model reads receive only bounded metadata', async () => {
    const { manager, read } = await setup(); const bytes = Buffer.from('MODEL_BINARY_PAYLOAD_SECRET');
    read.mockResolvedValue({ contents: [{ uri: 'test://binary', mimeType: 'application/octet-stream', blob: bytes.toString('base64') }] });
    expect((await manager.readResource('content', 'test://binary')).binaryItems[0]).toEqual({ uri: 'test://binary', mimeType: 'application/octet-stream', bytes: bytes.length, data: bytes.toString('base64') });
    const selected = manager.select(['content']); const approval = context(); const name = selected.definitions.find((item) => item.name.startsWith('mcp_read_resource_'))!.name;
    const result = await selected.execute({ id: 'binary', name, arguments: '{"uri":"test://binary"}' }, new AbortController().signal, approval);
    expect(result.error).toBe(false); expect(approval.approve).toHaveBeenCalledOnce();
    expect(result.output).toContain(`"bytes":${bytes.length}`); expect(result.output).not.toContain(bytes.toString('base64')); expect(result.output).not.toContain('MODEL_BINARY_PAYLOAD_SECRET'); expect(result.output).not.toContain('"data"');
  });
  it('bounds the aggregate binary bytes and file count on a real SDK reply, then permits a valid retry', async () => {
    const { manager, read } = await setup(); const small = { uri: 'test://binary', mimeType: 'application/octet-stream', blob: 'AP8=' };
    read.mockResolvedValue({ contents: Array.from({ length: 12 }, () => small) }); expect((await manager.readResource('content', 'test://binary')).binaryItems).toHaveLength(12);
    read.mockResolvedValue({ contents: Array.from({ length: 13 }, () => small) }); await expect(manager.readResource('content', 'test://binary')).rejects.toThrow('Could not read the MCP resource');
    const large = { ...small, blob: Buffer.alloc(2_000_000).toString('base64') };
    read.mockResolvedValue({ contents: Array.from({ length: 6 }, () => large) }); expect((await manager.readResource('content', 'test://binary')).binaryItems).toHaveLength(6);
    read.mockResolvedValue({ contents: [...Array.from({ length: 6 }, () => large), small] }); await expect(manager.readResource('content', 'test://binary')).rejects.toThrow('Could not read the MCP resource');
    read.mockResolvedValue({ contents: [small] }); expect((await manager.readResource('content', 'test://binary')).binaryItems).toHaveLength(1);
  });
  it('rejects an oversized padded binary and invalid returned metadata instead of exposing an unsafe export snapshot', async () => {
    const { manager, read } = await setup(); const small = { uri: 'test://binary', mimeType: 'application/octet-stream', blob: 'AP8=' };
    for (const invalid of [{ ...small, blob: Buffer.alloc(2_000_001).toString('base64') }, { ...small, mimeType: 'image/png\n' }, { ...small, uri: 'test://binary\0' }]) {
      read.mockResolvedValue({ contents: [invalid] }); await expect(manager.readResource('content', 'test://binary')).rejects.toThrow('Could not read the MCP resource');
    }
  });
  it('retains embedded prompt files, images and audio for explicit UI actions while approved model calls receive metadata only', async () => {
    const { manager, prompt } = await setup(); const data = Buffer.from('PROMPT_BINARY_PRIVATE 中文').toString('base64');
    prompt.mockResolvedValue({ messages: [
      { role: 'user', content: { type: 'text', text: 'PROMPT_LITERAL <img onerror="alert(1)">' } },
      { role: 'assistant', content: { type: 'resource', resource: { uri: 'test://prompt-file', mimeType: 'application/octet-stream', blob: data } } },
      { role: 'assistant', content: { type: 'image', mimeType: 'image/png', data } },
      { role: 'assistant', content: { type: 'audio', mimeType: 'audio/wav', data } },
      { role: 'assistant', content: { type: 'resource_link', name: 'Linked file', uri: 'test://linked' } },
      { role: 'assistant', content: { type: 'resource', resource: { uri: 'test://empty', blob: '' } } },
    ] });
    const content = await manager.getPrompt('content', 'review', { topic: 'Evidence' });
    expect(content.text).toContain('PROMPT_LITERAL <img onerror="alert(1)">'); expect(content.text).toContain('Resource: test://linked'); expect(content.text).not.toContain(data);
    expect(content.binaryItems.map((item) => item.uri)).toEqual(['test://prompt-file', 'prompt:review', 'prompt:review', 'test://empty']);
    expect(content.binaryItems.map((item) => item.data)).toEqual([data, data, data, '']); expect(content.binaryItems.at(-1)?.bytes).toBe(0);
    const selected = manager.select(['content']); const name = selected.definitions.find((item) => item.name.startsWith('mcp_get_prompt_'))!.name; const approval = context();
    const result = await selected.execute({ id: 'prompt-files', name, arguments: '{"name":"review","arguments":{"topic":"Evidence"}}' }, new AbortController().signal, approval);
    expect(result.error).toBe(false); expect(JSON.parse(result.output.split('\nBinary items:\n')[1])).toEqual(content.binaryItems.map(({ data: _data, ...metadata }) => metadata));
    expect(result.output).not.toContain(data); expect(result.output).not.toContain('PROMPT_BINARY_PRIVATE'); expect(approval.approve).toHaveBeenCalledOnce();
  });
  it('applies prompt binary size, aggregate, count and metadata limits before permitting another valid request', async () => {
    const { manager, prompt } = await setup();
    const small = { role: 'user' as const, content: { type: 'image' as const, mimeType: 'image/png', data: 'AP8=' } };
    prompt.mockResolvedValue({ messages: Array.from({ length: 12 }, () => small) }); expect((await manager.getPrompt('content', 'review', { topic: 'Evidence' })).binaryItems).toHaveLength(12);
    const large = { ...small, content: { ...small.content, data: Buffer.alloc(2_000_000).toString('base64') } };
    prompt.mockResolvedValue({ messages: Array.from({ length: 6 }, () => large) }); expect((await manager.getPrompt('content', 'review', { topic: 'Evidence' })).binaryItems).toHaveLength(6);
    for (const messages of [Array.from({ length: 13 }, () => small), [...Array.from({ length: 6 }, () => large), small], [{ ...small, content: { ...small.content, data: Buffer.alloc(2_000_001).toString('base64') } }], [{ ...small, content: { ...small.content, mimeType: 'image/png\n' } }]]) {
      prompt.mockResolvedValue({ messages }); await expect(manager.getPrompt('content', 'review', { topic: 'Evidence' })).rejects.toThrow('Could not load the MCP prompt');
    }
    prompt.mockResolvedValue({ messages: [small] }); expect((await manager.getPrompt('content', 'review', { topic: 'Evidence' })).binaryItems).toHaveLength(1);
  });
  it('invalidates stale catalogs after notifications and configuration changes during approval', async () => {
    const { manager, server, resources, config, read } = await setup(); const selected = manager.select(['content']); const name = selected.definitions.find((item) => item.name.startsWith('mcp_read_resource_'))!.name;
    resources.mockResolvedValue({ resources: [{ name: 'Changed', uri: 'test://changed', description: 'New' }] }); await server.sendResourceListChanged(); await vi.waitFor(() => expect(manager.catalog('content').resources[0].name).toBe('Changed'));
    const call = { id: 'read', name, arguments: '{"uri":"test://document"}' }; expect((await selected.execute(call, new AbortController().signal, context())).error).toBe(true); expect(read).not.toHaveBeenCalled();
    const current = manager.select(['content']); const approval = context(); approval.approve.mockImplementation(async () => { config.enabled = false; return true; });
    expect((await current.execute({ ...call, arguments: '{"uri":"test://changed"}' }, new AbortController().signal, approval)).error).toBe(true); expect(read).not.toHaveBeenCalled();
    await manager.disconnect('content'); expect(() => manager.catalog('content')).toThrow('Connect');
  });
  it('cancels a pending resource request through the run signal and sanitizes malformed server results', async () => {
    const { manager, server } = await setup(); let cancelled = false;
    server.setRequestHandler(ReadResourceRequestSchema, async (_request, extra) => new Promise((_resolve, reject) => { extra.signal.addEventListener('abort', () => { cancelled = true; reject(new Error('Stopped')); }, { once: true }); }));
    const selected = manager.select(['content']); const controller = new AbortController(); const call = { id: 'read', name: selected.definitions.find((item) => item.name.startsWith('mcp_read_resource_'))!.name, arguments: '{"uri":"test://document"}' };
    const running = selected.execute(call, controller.signal, context()); await new Promise((resolve) => setTimeout(resolve, 20)); controller.abort(); await expect(running).rejects.toThrow(); await vi.waitFor(() => expect(cancelled).toBe(true));
    server.setRequestHandler(ReadResourceRequestSchema, async () => ({ contents: [{ uri: 'test://binary', blob: 'invalid###' }] })); await expect(manager.readResource('content', 'test://binary')).rejects.toThrow('Could not read');
  });
  it('rejects unsafe content sizes and prompt metadata without issuing a request', async () => {
    const { manager, server } = await setup();
    server.setRequestHandler(ReadResourceRequestSchema, async () => ({ contents: [{ uri: 'test://document', text: 'x'.repeat(256_001) }] })); await expect(manager.readResource('content', 'test://document')).rejects.toThrow();
    const access = new McpContentAccess({} as never, manager.catalog('content'), new AbortController().signal, 1000, () => {});
    await expect(access.prompt('review', { topic: 'x'.repeat(16_001) })).rejects.toThrow();
    expect((await access.execute('unknown', { id: 'x', name: 'x', arguments: '{}' }, 'content', 'Content', new AbortController().signal, context())).error).toBe(true);
  });
});
