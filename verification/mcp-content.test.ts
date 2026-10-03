import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ErrorCode, GetPromptRequestSchema, ListPromptsRequestSchema, ListResourcesRequestSchema, ListResourceTemplatesRequestSchema, McpError, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
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
  const prompt = vi.fn(async (request: { params: { name: string; arguments?: Record<string, string> } }) => ({ messages: [{ role: 'user' as const, content: { type: 'text' as const, text: `Review ${request.params.arguments?.topic}` } }, { role: 'assistant' as const, content: { type: 'resource' as const, resource: { uri: 'test://document', text: 'PROMPT_RESOURCE_EVIDENCE' } } }] }));
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
    expect((await manager.readResource('content', 'test://binary')).binaryItems).toEqual([{ uri: 'test://binary', mimeType: 'application/octet-stream', bytes: 2 }]);
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
