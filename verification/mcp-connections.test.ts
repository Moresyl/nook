import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mcpServerSchema, type McpServer } from '../contracts/extensions';
import { McpConnections, mcpDestination, mcpToolName } from '../desktop/services/mcp-connections';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map((close) => close())); });
const tool = { name: 'echo', description: 'Echo optional text', inputSchema: { type: 'object' as const, properties: { text: { type: 'string' } }, additionalProperties: false } };
const context = () => ({ approve: vi.fn().mockResolvedValue(true), onProgress: vi.fn() });
async function setup(tools = [tool]) {
  const config = mcpServerSchema.parse({ id: 'one', name: 'Test server', transport: 'stdio', command: 'node', timeout: 1000 });
  const server = new Server({ name: 'fixture', version: '1' }, { capabilities: { tools: { listChanged: true } } });
  const list = vi.fn(async () => ({ tools })); const invoke = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'REAL_PROTOCOL_EVIDENCE' }], structuredContent: { verified: true } }));
  server.setRequestHandler(ListToolsRequestSchema, list); server.setRequestHandler(CallToolRequestSchema, invoke);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair(); await server.connect(serverTransport);
  const emit = vi.fn(); const manager = new McpConnections(() => config, () => ({}), emit, () => clientTransport);
  cleanup.push(() => manager.shutdown()); await manager.connect('one');
  return { manager, config, server, invoke, list, emit };
}
describe('MCP connections', () => {
  it('names tools without collisions, keeps optional schemas non-strict and approves the exact call', async () => {
    expect(mcpToolName('one', 'echo')).not.toBe(mcpToolName('two', 'echo')); expect(mcpToolName('one', 'echo')).not.toBe(mcpToolName('one', 'other'));
    expect(mcpToolName('one', 'echo')).toMatch(/^[a-z0-9_]{1,64}$/);
    const { manager, invoke, config } = await setup(); expect((await manager.connect('one')).status).toBe('connected');
    const selection = manager.select(['one', 'one']); expect(selection.definitions).toHaveLength(1); expect(selection.definitions[0]).toMatchObject({ strict: false, parameters: tool.inputSchema });
    const approval = context(); const call = { id: 'call', name: selection.definitions[0].name, arguments: '{}' };
    expect(await selection.execute(call, new AbortController().signal, approval)).toMatchObject({ error: false, output: expect.stringContaining('REAL_PROTOCOL_EVIDENCE') });
    expect(approval.approve).toHaveBeenCalledWith({ kind: 'mcp', serverId: 'one', serverName: config.name, toolName: 'echo', arguments: '{}' }); expect(invoke).toHaveBeenCalledTimes(1);
    expect(mcpDestination(config)).toContain('node'); expect(mcpDestination({ ...config, transport: 'http', endpoint: 'https://example.com/mcp' })).toContain('https://example.com');
  });
  it('rejects invalid arguments and respects denials without calling the server', async () => {
    const { manager, invoke } = await setup(); const selected = manager.select(['one']); const approval = context(); approval.approve.mockResolvedValue(false);
    const call = { id: 'call', name: selected.definitions[0].name, arguments: '{}' };
    expect((await selected.execute(call, new AbortController().signal, approval)).output).toContain('declined');
    for (const args of ['{bad', '[]', 'null', '{"text":3}', '{"text":"x","extra":true}', ' '.repeat(64_001)]) {
      expect((await selected.execute({ ...call, arguments: args }, new AbortController().signal, context())).error).toBe(true);
    }
    expect((await selected.execute({ ...call, name: 'unknown' }, new AbortController().signal, context())).error).toBe(true); expect(invoke).not.toHaveBeenCalled();
  });
  it('invalidates selected bindings on configuration changes and on tool-list notifications', async () => {
    const { manager, config, server, list, invoke } = await setup(); const selected = manager.select(['one']); const call = { id: 'call', name: selected.definitions[0].name, arguments: '{}' };
    const approval = context(); approval.approve.mockImplementation(async () => { config.disabledTools.push('echo'); return true; });
    expect((await selected.execute(call, new AbortController().signal, approval)).error).toBe(true); expect(invoke).not.toHaveBeenCalled();
    config.disabledTools = []; list.mockResolvedValue({ tools: [{ ...tool, description: 'Changed tool' }] });
    await server.sendToolListChanged(); await vi.waitFor(() => expect(manager.view('one').tools[0].description).toBe('Changed tool'));
    expect((await selected.execute(call, new AbortController().signal, context())).error).toBe(true);
    const next = manager.select(['one']); expect((await next.execute(call, new AbortController().signal, context())).error).toBe(false);
    await server.close(); await vi.waitFor(() => expect(manager.view('one').status).toBe('disconnected')); expect(() => manager.select(['one'])).toThrow('Connect');
  });
  it('sanitizes remote protocol errors and aborts cancelled requests', async () => {
    const { manager, server } = await setup(); server.setRequestHandler(CallToolRequestSchema, async () => { throw new Error('SECRET_SERVER_TOKEN'); });
    const output = await manager.testTool('one', 'echo', '{}'); expect(output.error).toBe(true); expect(output.output).not.toContain('SECRET_SERVER_TOKEN');
    let cancelled = false;
    server.setRequestHandler(CallToolRequestSchema, async (_request, extra) => new Promise((_resolve, reject) => { extra.signal.addEventListener('abort', () => { cancelled = true; reject(new Error('cancelled')); }, { once: true }); }));
    const selected = manager.select(['one']); const controller = new AbortController();
    const running = selected.execute({ id: 'call', name: selected.definitions[0].name, arguments: '{}' }, controller.signal, context());
    await new Promise((resolve) => setTimeout(resolve, 20)); controller.abort(); await expect(running).rejects.toThrow(); await vi.waitFor(() => expect(cancelled).toBe(true));
    await manager.disconnect('one'); await manager.disconnect('missing'); await expect(manager.testTool('one', 'echo', '{}')).rejects.toThrow('Connect');
    await manager.shutdown(); await expect(manager.connect('one')).rejects.toThrow('shutting down');
  });
  it('reports startup failures, disabled servers and empty catalogs without leaking launch details', async () => {
    const config = mcpServerSchema.parse({ id: 'bad', name: 'Missing', transport: 'stdio', command: 'qiyao-nonexistent-program', timeout: 1000 });
    const manager = new McpConnections(() => config, () => ({})); cleanup.push(() => manager.shutdown());
    expect((await manager.connect('bad')).status).toBe('error'); config.enabled = false; await expect(manager.connect('bad')).rejects.toThrow('Enable');
    const fixture = await setup([]); expect(fixture.manager.view('one').tools).toEqual([]); expect(fixture.manager.select(['one']).definitions).toEqual([]);
  });
  it('bounds large tool selections and rejects cyclic paginated catalogs', async () => {
    const fixture = await setup(Array.from({ length: 121 }, (_, index) => ({ ...tool, name: `tool_${index}` })));
    expect(() => fixture.manager.select(['one'])).toThrow('Too many');
    const config = mcpServerSchema.parse({ id: 'cycle', name: 'Cycle', transport: 'stdio', command: 'node', timeout: 1000 });
    const server = new Server({ name: 'cycle-fixture', version: '1' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [], nextCursor: 'repeat' }));
    const [client, remote] = InMemoryTransport.createLinkedPair(); await server.connect(remote);
    const manager = new McpConnections(() => config, () => ({}), () => {}, () => client); cleanup.push(() => manager.shutdown());
    expect((await manager.connect('cycle')).status).toBe('error');
  });
  it('times out an SSE handshake and refuses HTTP redirects before forwarding credentials', async () => {
    const target = createServer((_req, res) => res.end('Should never receive credentials')); const received = vi.fn(); target.on('request', received);
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
    const http = createServer((req, res) => { if (req.url === '/redirect') { res.writeHead(307, { Location: `http://127.0.0.1:${(target.address() as import('node:net').AddressInfo).port}/capture` }); res.end(); } });
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const config = mcpServerSchema.parse({ id: 'timeout', name: 'Timeout', transport: 'sse', endpoint: `http://127.0.0.1:${(http.address() as import('node:net').AddressInfo).port}/hang`, timeout: 1000 });
    const manager = new McpConnections(() => config, () => ({ token: 'private-bearer' }));
    cleanup.push(async () => { await manager.shutdown(); http.closeAllConnections(); target.closeAllConnections(); await Promise.all([new Promise<void>((resolve) => http.close(() => resolve())), new Promise<void>((resolve) => target.close(() => resolve()))]); });
    const started = Date.now(); expect((await manager.connect('timeout')).status).toBe('error'); expect(Date.now() - started).toBeLessThan(2500);
    config.transport = 'http'; config.endpoint = config.endpoint.replace('/hang', '/redirect'); expect((await manager.connect('timeout')).status).toBe('error'); expect(received).not.toHaveBeenCalled();
  });
  it('uses a real stdio subprocess, passes explicitly configured environment and kills its owned process tree', async () => {
    const config = mcpServerSchema.parse({ id: 'process', name: 'Process', transport: 'stdio', command: process.execPath, args: [resolve('verification/mcp-fixture.mjs')], timeout: 5000 });
    const manager = new McpConnections(() => config, () => ({ env: { QIYAO_FIXTURE_SECRET: 'configured-env' } })); cleanup.push(() => manager.shutdown());
    expect((await manager.connect('process')).status).toBe('connected'); expect((await manager.testTool('process', 'echo', '{}')).output).toContain('STDIO_EVIDENCE:optional:configured-env');
    if (process.platform === 'win32') {
      const processes = JSON.parse((await manager.testTool('process', 'child', '{}')).output); process.kill(processes.child, 0);
      await manager.disconnect('process'); await vi.waitFor(() => expect(() => process.kill(processes.child, 0)).toThrow()); expect(() => process.kill(processes.pid, 0)).toThrow();
    }
  });
  it.each(['http', 'sse'] as const)('connects through real %s transport with an encrypted-store supplied bearer token', async (transport) => {
    const server = new Server({ name: 'remote-fixture', version: '1' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [tool] })); server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: 'HTTP_SSE_EVIDENCE' }] }));
    let sdkTransport: StreamableHTTPServerTransport | SSEServerTransport | undefined; const received: string[] = [];
    const http = createServer((req, res) => {
      received.push(req.headers.authorization ?? '');
      void (async () => {
        if (transport === 'sse' && req.method === 'GET') { sdkTransport = new SSEServerTransport('/messages', res); await server.connect(sdkTransport); }
        else if (transport === 'sse') { await (sdkTransport as SSEServerTransport).handlePostMessage(req, res); }
        else {
          if (!sdkTransport) { sdkTransport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() }); await server.connect(sdkTransport); }
          await (sdkTransport as StreamableHTTPServerTransport).handleRequest(req, res);
        }
      })().catch(() => { res.destroy(); });
    });
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const config: McpServer = mcpServerSchema.parse({ id: 'remote', name: 'Remote', transport, endpoint: `http://127.0.0.1:${(http.address() as import('node:net').AddressInfo).port}/${transport === 'sse' ? 'sse' : 'mcp'}`, timeout: 3000 });
    const manager = new McpConnections(() => config, () => ({ token: 'bearer-fixture' }));
    cleanup.push(async () => { await manager.shutdown(); await server.close(); http.closeAllConnections(); await new Promise<void>((resolve) => http.close(() => resolve())); });
    expect((await manager.connect('remote')).status).toBe('connected'); expect((await manager.testTool('remote', 'echo', '{}')).output).toBe('HTTP_SSE_EVIDENCE');
    expect(received.length).toBeGreaterThan(2); expect(received.every((header) => header === 'Bearer bearer-fixture')).toBe(true);
  });
});
