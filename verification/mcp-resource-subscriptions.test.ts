import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListResourcesRequestSchema, ListResourceTemplatesRequestSchema, SubscribeRequestSchema, UnsubscribeRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mcpServerSchema } from '../contracts/extensions';
import { McpConnections } from '../desktop/services/mcp-connections';
import { McpResourceSubscriptions } from '../desktop/services/mcp-resource-subscriptions';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map((close) => close())); });

async function setup(supported = true) {
  const server = new Server({ name: 'subscriptions', version: '1' }, { capabilities: { resources: { subscribe: supported } } });
  const client = new Client({ name: 'subscriptions', version: '1' });
  const subscribe = vi.fn(async (_request: { params: { uri: string } }) => ({}));
  const unsubscribe = vi.fn(async (_request: { params: { uri: string } }) => ({}));
  if (supported) { server.setRequestHandler(SubscribeRequestSchema, subscribe); server.setRequestHandler(UnsubscribeRequestSchema, unsubscribe); }
  const [local, remote] = InMemoryTransport.createLinkedPair();
  await server.connect(remote); await client.connect(local);
  const controller = new AbortController();
  const allowed = new Set(Array.from({ length: 25 }, (_, index) => `test://resource/${index}`));
  let current = true;
  const validate = vi.fn((uri?: string) => { if (!current || (uri !== undefined && !allowed.has(uri))) throw new Error('SECRET_INVALID_CONNECTION'); });
  const changed = vi.fn(); const updated = vi.fn(); const onError = vi.fn(async (_error: unknown) => {});
  const subscriptions = new McpResourceSubscriptions(client, controller.signal, 1000, validate, changed, updated, onError);
  cleanup.push(async () => { controller.abort(); await client.close(); await server.close(); });
  return { server, client, controller, allowed, subscribe, unsubscribe, subscriptions, changed, updated, onError, invalidate: () => { current = false; } };
}
const uri = 'test://resource/0';

describe('connection-scoped MCP resource subscriptions', () => {
  it('subscribes once for concurrent duplicates, delivers only watched real protocol updates and stops delivery after unsubscribe', async () => {
    const fixture = await setup(); const { subscriptions, server, subscribe, unsubscribe, updated } = fixture;
    expect(subscriptions.supported).toBe(true);
    await Promise.all([subscriptions.set(uri, true), subscriptions.set(uri, true)]);
    expect(subscribe).toHaveBeenCalledTimes(1); expect(subscriptions.uris()).toEqual([uri]);
    const snapshot = subscriptions.uris(); snapshot.length = 0; expect(subscriptions.uris()).toEqual([uri]);
    await server.sendResourceUpdated({ uri: 'test://resource/1' }); expect(updated).not.toHaveBeenCalled();
    await server.sendResourceUpdated({ uri }); await vi.waitFor(() => expect(updated).toHaveBeenCalledWith(uri));
    await subscriptions.set(uri, false); await subscriptions.set(uri, false);
    expect(unsubscribe).toHaveBeenCalledTimes(1); expect(subscriptions.uris()).toEqual([]);
    updated.mockClear(); await server.sendResourceUpdated({ uri }); expect(updated).not.toHaveBeenCalled();
  });

  it('serializes an unsubscribe and resubscribe behind an actual pending subscribe', async () => {
    const { subscriptions, subscribe, unsubscribe } = await setup();
    let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; });
    subscribe.mockImplementationOnce(async () => { await held; return {}; });
    const first = subscriptions.set(uri, true); await vi.waitFor(() => expect(subscribe).toHaveBeenCalledTimes(1));
    const second = subscriptions.set(uri, false); const third = subscriptions.set(uri, true);
    expect(subscriptions.uris()).toEqual([]); expect(unsubscribe).not.toHaveBeenCalled();
    release(); await Promise.all([first, second, third]);
    expect(subscribe).toHaveBeenCalledTimes(2); expect(unsubscribe).toHaveBeenCalledTimes(1); expect(subscriptions.uris()).toEqual([uri]);
  });

  it('retains state on failed wire operations, sanitizes errors and allows the next queued retry', async () => {
    const { subscriptions, subscribe, unsubscribe, onError } = await setup();
    subscribe.mockRejectedValueOnce(new Error('SECRET_REMOTE_TOKEN'));
    await expect(subscriptions.set(uri, true)).rejects.toThrow('Could not change'); expect(subscriptions.uris()).toEqual([]);
    await subscriptions.set(uri, true);
    unsubscribe.mockRejectedValueOnce(new Error('SECRET_REMOTE_TOKEN'));
    await expect(subscriptions.set(uri, false)).rejects.not.toThrow('SECRET'); expect(subscriptions.uris()).toEqual([uri]);
    await subscriptions.set(uri, false); expect(subscriptions.uris()).toEqual([]); expect(onError).toHaveBeenCalledTimes(2);
  });

  it('rejects unknown resources and invalid input without contacting the server', async () => {
    const { subscriptions, subscribe, unsubscribe } = await setup();
    for (const value of ['', 'x'.repeat(4097), undefined, 3]) await expect(subscriptions.set(value as string, true)).rejects.toThrow();
    await expect(subscriptions.set(uri, 'true' as unknown as boolean)).rejects.toThrow('valid');
    await expect(subscriptions.set('test://outside', true)).rejects.not.toThrow('SECRET');
    expect(subscribe).not.toHaveBeenCalled(); expect(unsubscribe).not.toHaveBeenCalled();
  });

  it('enforces the actual twenty-resource connection quota under concurrent changes and frees space after unsubscribe', async () => {
    const { subscriptions, subscribe } = await setup();
    await Promise.all(Array.from({ length: 20 }, (_, index) => subscriptions.set(`test://resource/${index}`, true)));
    await expect(subscriptions.set('test://resource/20', true)).rejects.toThrow('At most 20');
    expect(subscriptions.uris()).toHaveLength(20); expect(subscribe).toHaveBeenCalledTimes(20);
    await subscriptions.set(uri, false); await subscriptions.set('test://resource/20', true);
    expect(subscriptions.uris()).toHaveLength(20); expect(subscriptions.uris()).toContain('test://resource/20');
  });

  it('bounds pending changes without poisoning the queue or duplicating the same wire subscription', async () => {
    const { subscriptions, subscribe } = await setup();
    let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; });
    subscribe.mockImplementationOnce(async () => { await held; return {}; });
    const requests = Array.from({ length: 40 }, () => subscriptions.set(uri, true));
    await expect(subscriptions.set(uri, true)).rejects.toThrow('Too many pending');
    release(); await Promise.all(requests); expect(subscribe).toHaveBeenCalledTimes(1);
    await subscriptions.set(uri, false); expect(subscriptions.uris()).toEqual([]);
  });

  it('undoes a successful wire subscription if the resource disappears before its response arrives', async () => {
    const { subscriptions, subscribe, unsubscribe, allowed } = await setup();
    let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; });
    subscribe.mockImplementationOnce(async () => { await held; return {}; });
    const request = subscriptions.set(uri, true); await vi.waitFor(() => expect(subscribe).toHaveBeenCalledTimes(1));
    allowed.delete(uri); release(); await expect(request).rejects.toThrow('Could not change');
    expect(subscriptions.uris()).toEqual([]); expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('prunes removed catalog entries, retains other watched resources and handles remote cleanup failure', async () => {
    const { subscriptions, allowed, unsubscribe, onError } = await setup();
    await subscriptions.set(uri, true); await subscriptions.set('test://resource/1', true);
    unsubscribe.mockRejectedValueOnce(new Error('SECRET_CLEANUP')); allowed.delete(uri); subscriptions.refresh();
    expect(subscriptions.uris()).toEqual(['test://resource/1']);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    subscriptions.refresh(); expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('ignores updates from a changed connection and rejects subscription changes before any new wire operation', async () => {
    const { subscriptions, subscribe, server, updated, invalidate } = await setup();
    await subscriptions.set(uri, true); invalidate();
    await server.sendResourceUpdated({ uri }); expect(updated).not.toHaveBeenCalled();
    await expect(subscriptions.set('test://resource/1', true)).rejects.toThrow('Could not change'); expect(subscribe).toHaveBeenCalledTimes(1);
    expect(() => subscriptions.refresh()).toThrow('SECRET_INVALID_CONNECTION');
  });

  it('clears observable watches on abort and rejects a real pending protocol request', async () => {
    const { subscriptions, server, controller, updated } = await setup();
    await subscriptions.set(uri, true);
    let began!: () => void; const started = new Promise<void>((resolve) => { began = resolve; });
    server.setRequestHandler(SubscribeRequestSchema, async (_request, extra) => new Promise((_resolve, reject) => { began(); extra.signal.addEventListener('abort', () => reject(new Error('Stopped')), { once: true }); }));
    const request = subscriptions.set('test://resource/1', true); await started;
    controller.abort(); await expect(request).rejects.toThrow('Could not change'); expect(subscriptions.uris()).toEqual([]);
    await server.sendResourceUpdated({ uri }); expect(updated).not.toHaveBeenCalled();
  });

  it('reports unsupported servers without a subscription request and treats an unwatched unsubscribe as a no-op', async () => {
    const { subscriptions, subscribe, unsubscribe } = await setup(false);
    expect(subscriptions.supported).toBe(false);
    await expect(subscriptions.set(uri, true)).rejects.toThrow('does not support'); await subscriptions.set(uri, false);
    expect(subscribe).not.toHaveBeenCalled(); expect(unsubscribe).not.toHaveBeenCalled();
  });

  it('keeps transport state and sanitized failures valid when renderer and error callbacks throw', async () => {
    const { subscriptions, subscribe, changed, updated, server, onError } = await setup();
    changed.mockImplementation(() => { throw new Error('Renderer closed'); }); updated.mockImplementation(() => { throw new Error('Renderer closed'); });
    await subscriptions.set(uri, true); await server.sendResourceUpdated({ uri }); expect(subscriptions.uris()).toEqual([uri]);
    subscribe.mockRejectedValueOnce(new Error('SECRET_REMOTE')); onError.mockRejectedValueOnce(new Error('SECRET_CALLBACK'));
    await expect(subscriptions.set('test://resource/1', true)).rejects.not.toThrow('SECRET');
    await subscriptions.set(uri, false); expect(subscriptions.uris()).toEqual([]);
  });
});

describe('MCP manager resource-subscription integration', () => {
  it('validates the exact catalog and URI templates, emits scoped updates, prunes changes and clears watches on disconnect', async () => {
    const config = mcpServerSchema.parse({ id: 'watch', name: 'Watch fixture', transport: 'stdio', command: 'node', timeout: 1000 });
    const server = new Server({ name: 'manager-watch', version: '1' }, { capabilities: { resources: { subscribe: true, listChanged: true } } });
    const resources = vi.fn(async () => ({ resources: [{ name: 'Document', uri: 'fixture://document' }] }));
    const subscribe = vi.fn(async () => ({})); const unsubscribe = vi.fn(async () => ({}));
    server.setRequestHandler(ListResourcesRequestSchema, resources);
    server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: [{ name: 'Profile', uriTemplate: 'fixture://profile/{name}' }] }));
    server.setRequestHandler(SubscribeRequestSchema, subscribe); server.setRequestHandler(UnsubscribeRequestSchema, unsubscribe);
    const [local, remote] = InMemoryTransport.createLinkedPair(); await server.connect(remote);
    const updated = vi.fn(); const manager = new McpConnections(() => config, () => ({}), () => {}, () => local, undefined, updated);
    cleanup.push(async () => { await manager.shutdown(); await server.close(); });
    const connected = await manager.connect('watch'); expect(connected.resourceSubscriptionsSupported).toBe(true);
    await expect(manager.setResourceSubscription('watch', 'fixture://outside', true)).rejects.toThrow('Could not change'); expect(subscribe).not.toHaveBeenCalled();
    await manager.setResourceSubscription('watch', 'fixture://document', true); await manager.setResourceSubscription('watch', 'fixture://profile/中文', true);
    expect(manager.view('watch').subscribedResources).toEqual(['fixture://document', 'fixture://profile/中文']);
    await server.sendResourceUpdated({ uri: 'fixture://document' }); await vi.waitFor(() => expect(updated).toHaveBeenCalledWith({ id: 'watch', uri: 'fixture://document' }));
    resources.mockResolvedValue({ resources: [] }); await server.sendResourceListChanged();
    await vi.waitFor(() => expect(manager.view('watch').subscribedResources).toEqual(['fixture://profile/中文']));
    await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(1));
    config.enabled = false; updated.mockClear(); await server.sendResourceUpdated({ uri: 'fixture://profile/中文' }); expect(updated).not.toHaveBeenCalled();
    await manager.disconnect('watch'); expect(manager.view('watch').subscribedResources).toEqual([]); expect(manager.view('watch').resourceSubscriptionsSupported).toBe(false);
    await expect(manager.setResourceSubscription('watch', 'fixture://document', true)).rejects.toThrow('Connect');
  });
});
