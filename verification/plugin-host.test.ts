import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginInvocation } from '../contracts/plugins';
import type { ToolExecutionContext } from '../contracts/tools';
import { LocalPlugins } from '../desktop/services/local-plugins';
import { PluginHost, pluginToolName, type PluginProcessFactory } from '../desktop/services/plugin-host';
import { ConversationEngine } from '../desktop/services/conversation-engine';
import { ConversationExtensions } from '../desktop/services/conversation-extensions';
import { LocalSkills } from '../desktop/services/local-skills';
import type { McpConnections } from '../desktop/services/mcp-connections';
import type { ModelGateway } from '../desktop/services/model-gateway';
import { createPluginFixture } from './plugin-fixture.mjs';
import { request, testVault } from './fixtures';

const directories: string[] = []; const hosts: PluginHost[] = [];
afterEach(async () => { await Promise.all(hosts.splice(0).map((host) => host.shutdown())); await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function setup() {
  const { directory, vault } = await testVault(); directories.push(directory); const source = join(directory, 'source'); await createPluginFixture(source);
  const assets = new LocalPlugins(join(directory, 'plugins')); const plugin = await assets.importPath(source);
  plugin.enabled = true; plugin.grants = [...plugin.manifest.permissions];
  await writeFile(join(directory, 'README.md'), 'PROJECT_PLUGIN_EVIDENCE'); await writeFile(join(directory, '.env'), 'PRIVATE_PLUGIN_MUST_NOT_READ');
  await vault.update((draft) => { draft.plugins.push(plugin); draft.projects.push({ id: 'project', name: 'Project', path: directory, instructions: '', createdAt: 1 }); });
  const callbacks: Parameters<PluginProcessFactory>[1][] = [];
  const close = vi.fn(async () => {}); const invoke = vi.fn(async (_call: PluginInvocation, _signal: AbortSignal, _timeout: number): Promise<unknown> => 'PLUGIN_TOOL_EVIDENCE');
  const factory = vi.fn<PluginProcessFactory>(async (_plugin, handlers) => { callbacks.push(handlers); return { invoke, close }; });
  const emit = vi.fn(); const fetcher = vi.fn<typeof fetch>(async () => new Response('NETWORK_EVIDENCE', { headers: { 'Content-Type': 'text/plain' } }));
  const host = new PluginHost(vault, assets, factory, emit, undefined, fetcher); hosts.push(host);
  await host.load(plugin.id);
  const call = { id: 'call', name: pluginToolName(plugin.id, 'evidence'), arguments: '{}' };
  const context: ToolExecutionContext = { approve: vi.fn(async () => true), onProgress: vi.fn() };
  return { vault, directory, source, plugin, assets, host, invoke, close, callbacks, factory, emit, fetcher, call, context };
}
describe('permission checked plugin execution', () => {
  it('loads pinned packages once and approves selected optional schemas before invoking with bounded output', async () => {
    const { host, plugin, factory, invoke, call, context } = await setup();
    expect(await host.load(plugin.id)).toMatchObject({ status: 'running' }); expect(factory).toHaveBeenCalledOnce();
    const selection = host.select([plugin.id, plugin.id]); expect(selection.definitions).toHaveLength(1); expect(selection.definitions[0]).toMatchObject({ strict: false, displayName: '验证插件 · evidence' });
    const signal = new AbortController().signal; expect(await selection.execute(call, signal, context)).toMatchObject({ output: 'PLUGIN_TOOL_EVIDENCE', error: false });
    expect(context.approve).toHaveBeenCalledWith({ kind: 'plugin', pluginId: plugin.id, pluginName: '验证插件', toolName: 'evidence', arguments: '{}' });
    expect(invoke.mock.calls[0][0]).toMatchObject({ kind: 'tool', name: 'evidence', arguments: {}, context: { mode: 'chat' } });
    invoke.mockResolvedValueOnce({ text: 'JSON_EVIDENCE' }); expect((await selection.execute(call, signal, context)).output).toContain('JSON_EVIDENCE');
    invoke.mockResolvedValueOnce('x'.repeat(70_000)); expect((await selection.execute(call, signal, context)).output.length).toBeLessThanOrEqual(64_000);
    invoke.mockResolvedValueOnce('x'.repeat(256_001)); expect((await selection.execute(call, signal, context)).error).toBe(true);
    invoke.mockResolvedValueOnce(undefined); expect((await selection.execute(call, signal, context)).error).toBe(true);
    expect(pluginToolName(plugin.id, 'a'.repeat(64))).not.toBe(pluginToolName(plugin.id, `${'a'.repeat(63)}b`));
  });
  it('denies unselected, invalid and declined calls and rechecks revoked permissions after approval', async () => {
    const { host, plugin, vault, invoke, call, context } = await setup(); const selection = host.select([plugin.id]); const signal = new AbortController().signal;
    for (const bad of [{ name: 'unselected' }, { arguments: '{bad' }, { arguments: '[]' }, { arguments: '{"text":123}' }, { arguments: 'x'.repeat(64_001) }]) expect((await selection.execute({ ...call, ...bad }, signal, context)).error).toBe(true);
    expect(context.approve).not.toHaveBeenCalled(); expect(invoke).not.toHaveBeenCalled();
    vi.mocked(context.approve).mockResolvedValueOnce(false); expect((await selection.execute(call, signal, context)).output).toContain('declined'); expect(invoke).not.toHaveBeenCalled();
    vi.mocked(context.approve).mockImplementationOnce(async () => { await vault.update((draft) => { draft.plugins[0].grants = []; }); return true; });
    expect((await selection.execute(call, signal, context)).error).toBe(true); expect(invoke).not.toHaveBeenCalled();
    expect(() => host.select([plugin.id])).toThrow('permission'); expect(host.select([plugin.id], undefined, 'plan').definitions).toEqual([]);
    expect(() => host.select(['missing'])).toThrow('load');
    const controller = new AbortController(); controller.abort(); await expect(selection.execute(call, controller.signal, context)).rejects.toThrow();
  });
  it('restricts project access to active invocation tokens and separately approves writes', async () => {
    const { host, plugin, vault, invoke, callbacks, call, context, directory } = await setup(); const rpc = callbacks[0].request; let token = '';
    await expect(rpc('project.read', { path: 'README.md' })).rejects.toThrow('permission'); await expect(rpc('project.read', {}, 'forged')).rejects.toThrow('permission');
    invoke.mockImplementationOnce(async (input) => { token = input.context.token; const result = await rpc('project.read', { path: 'README.md' }, token); await expect(rpc('project.read', { path: '../outside' }, token)).resolves.toMatchObject({ error: true }); return result; });
    expect((await host.select([plugin.id], 'project').execute(call, new AbortController().signal, context)).output).toContain('PROJECT_PLUGIN_EVIDENCE');
    invoke.mockImplementationOnce(async (input) => {
      await expect(rpc('project.document', { path: '.env' }, input.context.token)).rejects.toThrow('request failed');
      await expect(rpc('project.document', { path: '../outside' }, input.context.token)).rejects.toThrow('request failed');
      const document = await rpc('project.document', { path: 'README.md' }, input.context.token) as { text: string; sha256: string };
      expect(document.sha256).toMatch(/^[a-f0-9]{64}$/);
      return rpc('project.write', { path: 'README.md', content: `${document.text}\nPLUGIN_EDIT`, expected_sha256: document.sha256 }, input.context.token);
    });
    expect((await host.select([plugin.id], 'project').execute(call, new AbortController().signal, context)).error).toBe(false); expect(await readFile(join(directory, 'README.md'), 'utf8')).toContain('PLUGIN_EDIT');
    await expect(rpc('project.list', {}, token)).rejects.toThrow('permission');
    invoke.mockImplementationOnce((input) => rpc('project.write', { path: 'created.txt', content: 'PLUGIN_FILE', expected_sha256: null }, input.context.token));
    const result = await host.select([plugin.id], 'project', 'agent').execute(call, new AbortController().signal, context); expect(result.error).toBe(false);
    expect(await readFile(join(directory, 'created.txt'), 'utf8')).toBe('PLUGIN_FILE'); expect(context.approve).toHaveBeenCalledWith(expect.objectContaining({ kind: 'file', path: 'created.txt', before: '', after: 'PLUGIN_FILE' }));
    invoke.mockImplementationOnce((input) => rpc('project.write', { path: 'revoked.txt', content: 'NO', expected_sha256: null }, input.context.token));
    vi.mocked(context.approve).mockImplementation(async (details) => { if (details.kind === 'file') await vault.update((draft) => { draft.plugins[0].grants = draft.plugins[0].grants.filter((permission) => permission !== 'project.write'); }); return true; });
    expect((await host.select([plugin.id], 'project').execute(call, new AbortController().signal, context)).error).toBe(true); await expect(readFile(join(directory, 'revoked.txt'))).rejects.toThrow();
    await host.unload(plugin.id); await vault.update((draft) => { draft.plugins[0].projectIds = ['project']; }); await host.load(plugin.id);
    expect(() => host.select([plugin.id])).toThrow('selected project'); expect(() => host.select([plugin.id], 'other')).toThrow('selected project');
    await expect(host.command(plugin.id, 'greet', {}, 'other')).rejects.toThrow('failed');
  });
  it('owns storage namespaces, validates requests and gives no workspace secrets to plugins', async () => {
    const { host, plugin, vault, callbacks } = await setup(); const rpc = callbacks[0].request;
    await vault.setKey('private-provider', 'SECRET_EVIDENCE');
    expect(await rpc('context', {})).toEqual({ id: plugin.id, name: '验证插件', locale: 'zh-CN', theme: 'system' });
    expect(await rpc('storage.get', { key: 'missing' })).toBeNull(); await rpc('storage.set', { key: 'value', value: { nested: [1, 'text'] } }); expect(await rpc('storage.get', { key: 'value' })).toEqual({ nested: [1, 'text'] });
    await rpc('storage.delete', { key: 'value' }); expect(await rpc('storage.get', { key: 'value' })).toBeNull();
    await expect(rpc('storage.set', { key: 'empty' })).rejects.toThrow('JSON'); await expect(rpc('storage.set', { key: 'huge', value: 'x'.repeat(61_000) })).rejects.toThrow('60 KB');
    await expect(rpc('storage.unknown', { key: 'value' })).rejects.toThrow('permission'); await expect(rpc('anything', {})).rejects.toThrow('permission'); await expect(rpc('context', { huge: 'x'.repeat(64_001) })).rejects.toThrow('limit');
    await expect(rpc('storage.get', { key: '' })).rejects.toThrow('parameters');
    expect(JSON.stringify(await rpc('context', {}))).not.toContain('SECRET_EVIDENCE');
    await vault.update((draft) => { draft.plugins[0].grants = ['tools']; }); await expect(rpc('storage.get', { key: 'value' })).rejects.toThrow('permission');
  });
  it('allows only declared network hosts, rejects redirects and bounds concurrent responses', async () => {
    const { callbacks, fetcher } = await setup(); const rpc = callbacks[0].request;
    expect(await rpc('network.fetch', { url: 'http://127.0.0.1:9999/evidence' })).toMatchObject({ status: 200, text: 'NETWORK_EVIDENCE' });
    expect(fetcher).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }));
    for (const url of ['http://127.0.0.1:9998/', 'https://outside.example/', 'file:///tmp', 'http://user:secret@127.0.0.1:9999/', 'http://127.0.0.1:9999/#hash']) await expect(rpc('network.fetch', { url })).rejects.toThrow('permission');
    fetcher.mockResolvedValueOnce(new Response('x'.repeat(256_001))); await expect(rpc('network.fetch', { url: 'http://127.0.0.1:9999/' })).rejects.toThrow('request failed');
    fetcher.mockResolvedValueOnce(new Response(new Uint8Array([255]))); await expect(rpc('network.fetch', { url: 'http://127.0.0.1:9999/' })).rejects.toThrow('request failed');
    fetcher.mockResolvedValueOnce(new Response(null, { status: 204 })); expect(await rpc('network.fetch', { url: 'http://127.0.0.1:9999/' })).toMatchObject({ status: 204, text: '' });
    let release!: () => void; const blocked = new Promise<void>((resolve) => { release = resolve; }); fetcher.mockImplementation(async () => { await blocked; return new Response('done'); });
    const running = Array.from({ length: 16 }, () => rpc('network.fetch', { url: 'http://127.0.0.1:9999/' })); await expect(rpc('context', {})).rejects.toThrow('limit'); release(); await Promise.all(running); expect(await rpc('context', {})).toHaveProperty('id');
  });
  it('unloads aborted operations and rejects stale callbacks even after the same plugin reloads', async () => {
    const { host, plugin, invoke, close, callbacks, call, context } = await setup(); const controller = new AbortController();
    invoke.mockImplementationOnce(async (_input, signal) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(new Error('Stopped')), { once: true }); }));
    const running = host.select([plugin.id]).execute(call, controller.signal, context); await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce()); controller.abort(new Error('Stopped'));
    await expect(running).rejects.toThrow('Stopped'); expect(close).toHaveBeenCalledOnce(); expect(host.view(plugin.id).status).toBe('stopped');
    await host.load(plugin.id); await expect(callbacks[0].request('storage.set', { key: 'stale', value: true })).rejects.toThrow('permission');
    expect(await callbacks[1].request('storage.get', { key: 'stale' })).toBeNull(); await host.unload('missing');
    await host.shutdown(); await expect(host.load(plugin.id)).rejects.toThrow('shutting down');
  });
  it('executes declared commands, checks JSON limits and project tokens, and sanitizes handler failures', async () => {
    const { host, plugin, callbacks, invoke, vault } = await setup(); const rpc = callbacks[0].request;
    invoke.mockImplementationOnce(async (input) => { expect(input.kind).toBe('command'); expect(input.arguments).toEqual({ value: 1 }); return rpc('project.list', {}, input.context.token); });
    expect(await host.command(plugin.id, 'greet', { value: 1 }, 'project')).toMatchObject({ error: false });
    invoke.mockImplementationOnce((input) => rpc('project.write', {}, input.context.token)); await expect(host.command(plugin.id, 'greet', {}, 'project')).rejects.toThrow('command failed');
    for (const args of [undefined, 'x'.repeat(64_001)]) await expect(host.command(plugin.id, 'greet', args)).rejects.toThrow('permission');
    const cyclic: Record<string, unknown> = {}; cyclic.value = cyclic; await expect(host.command(plugin.id, 'greet', cyclic)).rejects.toThrow('permission');
    await expect(host.command(plugin.id, 'unknown', {})).rejects.toThrow('permission'); await expect(host.command('missing', 'greet', {})).rejects.toThrow('permission');
    invoke.mockRejectedValueOnce(new Error('SENSITIVE_ERROR')); await expect(host.command(plugin.id, 'greet', {})).rejects.toThrow('Check its permissions');
    invoke.mockImplementationOnce(async (input) => { await vault.update((draft) => { draft.projects = []; }); return rpc('project.read', { path: 'README.md' }, input.context.token); });
    await expect(host.command(plugin.id, 'greet', {}, 'project')).rejects.toThrow('command failed');
  });
  it('waits for concurrent startup and closes a runtime returned after unloading began', async () => {
    const { host, plugin, factory, close } = await setup(); await host.unload(plugin.id); close.mockClear();
    let release!: () => void; const blocked = new Promise<void>((resolve) => { release = resolve; }); factory.mockImplementationOnce(async () => { await blocked; return { invoke: vi.fn(), close }; });
    const loading = host.load(plugin.id); await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(2)); const concurrent = host.load(plugin.id); const unloading = host.unload(plugin.id);
    release(); await Promise.all([loading, concurrent, unloading]); expect(close).toHaveBeenCalledOnce(); expect(host.view(plugin.id).status).toBe('stopped');
  });
  it('disables damaged or crashed plugins, handles persistence failure and waits for startup during unloading', async () => {
    const { host, plugin, vault, callbacks, directory, factory, emit } = await setup();
    callbacks[0].failed(); await vi.waitFor(() => expect(vault.snapshot().plugins[0].enabled).toBe(false)); expect(host.view(plugin.id)).toMatchObject({ status: 'error', error: expect.stringContaining('runtime stopped') });
    await host.unload(plugin.id); await expect(host.load(plugin.id)).rejects.toThrow('permission');
    await vault.update((draft) => { draft.plugins[0].enabled = true; }); await host.load(plugin.id);
    vi.spyOn(vault, 'update').mockRejectedValueOnce(new Error('Disk full')); callbacks[1].failed(); await vi.waitFor(() => expect(host.view(plugin.id).error).toContain('disk space'));
    await host.unload(plugin.id); await writeFile(join(directory, 'plugins', plugin.id, 'main.js'), 'Modified'); expect(await host.load(plugin.id)).toMatchObject({ status: 'error' }); expect(factory).toHaveBeenCalledTimes(2); expect(emit).toHaveBeenCalled();
  });
  it('routes plugin tools through conversation approvals, persists selection and stops pending work by plugin', async () => {
    const { host, plugin, vault, directory, call, invoke } = await setup();
    const mcp = { select: () => ({ definitions: [], execute: vi.fn() }) } as unknown as McpConnections;
    const extensions = new ConversationExtensions(mcp, new LocalSkills(join(directory, 'skills')), () => vault.snapshot(), host);
    const gateway: ModelGateway = { stream: async (input, onText) => {
      if (!input.exchanges?.length) { expect(input.tools?.some((item) => item.name === call.name)).toBe(true); return { kind: 'ollama', items: [], toolCalls: [call] }; }
      expect(input.exchanges[0].results[0].output).toBe('PLUGIN_TOOL_EVIDENCE'); onText('Verified plugin continuation');
    } };
    const engine = new ConversationEngine(vault, gateway, () => {}, undefined, undefined, extensions);
    const one = await engine.start({ ...request, pluginIds: [plugin.id] }); await vi.waitFor(() => expect(engine.pendingApprovals()).toHaveLength(1)); expect(invoke).not.toHaveBeenCalled();
    engine.resolveApproval(engine.pendingApprovals()[0].id, true); await engine.settle(one.threadId); expect(vault.snapshot().threads[0]).toMatchObject({ pluginIds: [plugin.id], messages: [{ role: 'user' }, { status: 'complete', content: 'Verified plugin continuation' }] });
    await engine.start({ ...request, threadId: one.threadId }); await vi.waitFor(() => expect(engine.pendingApprovals()).toHaveLength(1)); await engine.stopPlugin(plugin.id); expect(engine.pendingApprovals()).toEqual([]); expect(invoke).toHaveBeenCalledOnce();
    await expect(new ConversationEngine(vault, gateway, () => {}).start({ ...request, pluginIds: [plugin.id] })).rejects.toThrow('unavailable');
    expect(() => new ConversationExtensions(mcp, new LocalSkills(join(directory, 'skills')), () => vault.snapshot()).select(vault.snapshot(), [], [], [plugin.id])).toThrow('unavailable');
  });
});
