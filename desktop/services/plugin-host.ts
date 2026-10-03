import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';
import type { Plugin, PluginInvocation, PluginPermission, PluginView } from '../../contracts/plugins';
import type { Project } from '../../contracts/workspace';
import type { ToolCall, ToolDefinition, ToolExecutionContext, ToolResult } from '../../contracts/tools';
import type { WorkspaceVault } from './vault';
import type { LocalPlugins } from './local-plugins';
import { ExecutionTools } from './execution-tools';
import { allowedProjectPath, boundedToolOutput } from './project-tools';
import { projectDocument } from './project-files';

export interface PluginProcess { invoke(call: PluginInvocation, signal: AbortSignal, timeout: number): Promise<unknown>; close(): Promise<void> }
export type PluginProcessFactory = (plugin: Plugin, callbacks: { request(method: string, params: unknown, token?: string): Promise<unknown>; failed(): void }) => Promise<PluginProcess>;
type Session = { plugin: Plugin; controller: AbortController; status: PluginView['status']; process?: PluginProcess; loading?: Promise<void>; error?: string };
type InvocationContext = { pluginId: string; signal: AbortSignal; project?: Project; context?: ToolExecutionContext; mode: string };
const permissionError = () => new Error('This plugin permission or execution context is unavailable.');
const identity = (plugin: Plugin) => JSON.stringify([plugin.manifest, plugin.enabled, plugin.grants, plugin.projectIds, plugin.hashes]);
const keySchema = z.string().min(1).max(128);
const networkSchema = z.object({ url: z.string().max(4096), method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'), headers: z.record(z.string().max(100), z.string().max(2000)).default({}), body: z.string().max(60_000).optional() }).strict();

export function pluginToolName(id: string, name: string): string { return `plugin_${createHash('sha256').update(id).digest('hex').slice(0, 12)}_${createHash('sha256').update(name).digest('hex').slice(0, 24)}`; }

export class PluginHost {
  private sessions = new Map<string, Session>();
  private invocations = new Map<string, InvocationContext>();
  private requests = new Map<string, number>();
  private closing = false;
  constructor(private readonly vault: WorkspaceVault, private readonly assets: LocalPlugins, private readonly factory: PluginProcessFactory, private readonly emit: (view: PluginView) => void = () => {}, private readonly tools = new ExecutionTools(), private readonly fetcher: typeof fetch = fetch) {}

  private record(id: string): Plugin {
    const plugin = this.vault.snapshot().plugins.find((item) => item.id === id);
    if (!plugin?.enabled) throw permissionError(); return plugin;
  }
  private current(session: Session): Plugin {
    const plugin = this.record(session.plugin.id);
    if (this.sessions.get(plugin.id) !== session || session.controller.signal.aborted || identity(plugin) !== identity(session.plugin)) throw permissionError();
    return plugin;
  }
  private permission(session: Session, permission: PluginPermission): Plugin {
    const plugin = this.current(session); if (!plugin.grants.includes(permission)) throw permissionError(); return plugin;
  }
  private notify(id: string): void { try { this.emit(this.view(id)); } catch {} }
  view(id: string): PluginView {
    const session = this.sessions.get(id); const plugin = this.vault.snapshot().plugins.find((item) => item.id === id);
    return { id, status: session?.status ?? (plugin?.enabled ? 'stopped' : 'disabled'), error: session?.error };
  }

  async load(id: string): Promise<PluginView> {
    if (this.closing) throw new Error('Plugins are shutting down.');
    const existing = this.sessions.get(id);
    if (existing?.status === 'running') { this.current(existing); return this.view(id); }
    if (existing?.loading && existing.status === 'loading') { await existing.loading; return this.view(id); }
    await this.unload(id); const plugin = this.record(id);
    const session: Session = { plugin, controller: new AbortController(), status: 'loading' }; this.sessions.set(id, session); this.notify(id);
    session.loading = (async () => {
      try {
        await this.assets.verify(plugin); this.current(session);
        session.process = await this.factory(plugin, { request: async (method, params, token) => { this.current(session); return this.request(id, method, params, token); }, failed: () => { void this.fail(session); } });
        this.current(session); session.status = 'running'; this.notify(id);
      } catch {
        if (this.sessions.get(id) === session && !session.controller.signal.aborted) await this.fail(session);
        else await session.process?.close();
      }
    })();
    await session.loading; return this.view(id);
  }

  private async fail(session: Session): Promise<void> {
    if (this.sessions.get(session.plugin.id) !== session || session.controller.signal.aborted) return;
    session.controller.abort(); session.status = 'error'; session.error = 'The plugin failed to load or its runtime stopped. Check its package and enable it again.';
    this.notify(session.plugin.id); await session.process?.close();
    try { await this.vault.update((draft) => { const plugin = draft.plugins.find((item) => item.id === session.plugin.id); if (plugin && identity(plugin) === identity(session.plugin)) plugin.enabled = false; }); }
    catch { session.error = 'The plugin stopped, but its disabled state could not be saved. Check disk space.'; }
    this.notify(session.plugin.id);
  }

  async unload(id: string): Promise<void> {
    const session = this.sessions.get(id); if (!session) return;
    this.sessions.delete(id); session.controller.abort();
    await session.process?.close(); await session.loading;
    this.notify(id);
  }

  private async invoke(session: Session, kind: 'tool' | 'command', name: string, args: unknown, rawSignal: AbortSignal, projectId?: string, context?: ToolExecutionContext, mode = 'chat', timeout = 60_000): Promise<unknown> {
    const plugin = this.permission(session, kind === 'tool' ? 'tools' : 'commands'); rawSignal.throwIfAborted();
    const project = projectId ? this.vault.snapshot().projects.find((item) => item.id === projectId) : undefined;
    if (projectId && (!project || plugin.projectIds.length && !plugin.projectIds.includes(projectId))) throw permissionError();
    const signal = AbortSignal.any([rawSignal, session.controller.signal]); const token = randomUUID();
    this.invocations.set(token, { pluginId: plugin.id, signal, project, context, mode });
    try {
      if (!session.process || session.status !== 'running') throw new Error('Reload the plugin before invoking it.');
      const result = await session.process.invoke({ id: randomUUID(), kind, name, arguments: args, context: { token, projectId, mode } }, signal, timeout);
      this.current(session); signal.throwIfAborted();
      const text = JSON.stringify(result); if (text === undefined || text.length > 256_000) throw new Error('The plugin result exceeds its limit.');
      return JSON.parse(text);
    } catch (error) {
      if (rawSignal.aborted) { await this.unload(plugin.id); rawSignal.throwIfAborted(); }
      throw error;
    } finally { this.invocations.delete(token); }
  }

  select(ids: string[], projectId?: string, mode = 'chat'): { definitions: ToolDefinition[]; execute(call: ToolCall, signal: AbortSignal, context: ToolExecutionContext): Promise<ToolResult> } {
    const captured = new Map<string, { session: Session; name: string; validate: ReturnType<AjvJsonSchemaValidator['getValidator']>; timeout: number }>();
    const definitions: ToolDefinition[] = [];
    if (mode !== 'plan') for (const id of new Set(ids)) {
      const session = this.sessions.get(id); if (!session || session.status !== 'running') throw new Error('Enable and load the selected plugin before sending.');
      const plugin = this.permission(session, 'tools');
      if (plugin.projectIds.length && (!projectId || !plugin.projectIds.includes(projectId))) throw new Error('This plugin is unavailable in the selected project.');
      for (const tool of plugin.manifest.tools) {
        const name = pluginToolName(id, tool.name);
        if (captured.has(name)) throw new Error('Plugin tool names collide. Rename the tool.');
        captured.set(name, { session, name: tool.name, timeout: tool.timeout, validate: new AjvJsonSchemaValidator().getValidator(tool.parameters) });
        definitions.push({ name, displayName: `${plugin.manifest.name} · ${tool.name}`, description: `[${plugin.manifest.name}] ${tool.description}`, parameters: tool.parameters, strict: false });
      }
    }
    if (definitions.length > 120) throw new Error('Too many selected plugin tools. Select fewer plugins.');
    return { definitions, execute: async (call, signal, context) => {
      signal.throwIfAborted();
      try {
        const binding = captured.get(call.name); if (!binding) throw permissionError();
        const plugin = this.permission(binding.session, 'tools');
        if (call.arguments.length > 64_000) throw new Error('Plugin arguments exceed 64 KB.');
        const args: unknown = JSON.parse(call.arguments);
        if (!args || typeof args !== 'object' || Array.isArray(args) || !binding.validate(args).valid) throw new Error('Plugin arguments do not match its schema.');
        if (!await context.approve({ kind: 'plugin', pluginId: plugin.id, pluginName: plugin.manifest.name, toolName: binding.name, arguments: call.arguments })) return { callId: call.id, output: 'The user declined this plugin operation. Respect that decision.', error: true };
        this.current(binding.session); signal.throwIfAborted();
        const result = await this.invoke(binding.session, 'tool', binding.name, args, signal, projectId, context, mode, binding.timeout);
        return { callId: call.id, output: boundedToolOutput(typeof result === 'string' ? result : JSON.stringify(result)), error: false };
      } catch { signal.throwIfAborted(); return { callId: call.id, output: 'The plugin operation failed. Check its permissions, arguments and runtime.', error: true }; }
    } };
  }

  async command(id: string, name: string, args: unknown, projectId?: string, context?: ToolExecutionContext): Promise<unknown> {
    const session = this.sessions.get(id);
    let text: string | undefined; try { text = JSON.stringify(args); } catch { throw permissionError(); }
    if (!session || !this.permission(session, 'commands').manifest.commands.some((item) => item.id === name) || !text || text.length > 64_000) throw permissionError();
    try { return await this.invoke(session, 'command', name, JSON.parse(text), new AbortController().signal, projectId, context, 'command'); }
    catch { throw new Error('The plugin command failed. Check its permissions and runtime.'); }
  }

  async request(id: string, method: string, params: unknown, token?: string): Promise<unknown> {
    const session = this.sessions.get(id); if (!session) throw permissionError();
    this.current(session);
    if (JSON.stringify(params)?.length > 64_000 || (this.requests.get(id) ?? 0) >= 16) throw new Error('The plugin request exceeds its limit.');
    this.requests.set(id, (this.requests.get(id) ?? 0) + 1);
    try {
      if (method === 'context') return { id, name: session.plugin.manifest.name, locale: 'zh-CN', theme: this.vault.snapshot().preferences.theme };
      if (method.startsWith('storage.')) {
        this.permission(session, 'storage'); const input = z.object({ key: keySchema, value: z.unknown().optional() }).strict().parse(params);
        if (method === 'storage.get') { const data = this.record(id).data; return Object.hasOwn(data, input.key) ? structuredClone(data[input.key]) : null; }
        if (!['storage.set', 'storage.delete'].includes(method)) throw permissionError();
        const text = JSON.stringify(input.value); if (method === 'storage.set' && (!text || text.length > 60_000)) throw new Error('Plugin storage values must be JSON smaller than 60 KB.');
        await this.vault.update((draft) => { this.permission(session, 'storage'); const plugin = draft.plugins.find((item) => item.id === id)!;
          const data = Object.assign(Object.create(null), plugin.data);
          if (method === 'storage.delete') delete data[input.key]; else data[input.key] = JSON.parse(text!);
          plugin.data = data;
        }); this.current(session); return null;
      }
      const invocation = token ? this.invocations.get(token) : undefined;
      if (token && (!invocation || invocation.pluginId !== id)) throw permissionError();
      const signal = invocation ? AbortSignal.any([invocation.signal, session.controller.signal]) : session.controller.signal; signal.throwIfAborted();
      if (method === 'network.fetch') return await this.network(session, params, signal);
      if (method.startsWith('project.')) {
        const project = invocation?.project;
        const checkProject = () => { if (!project || !this.vault.snapshot().projects.some((item) => item.id === project.id && item.path === project.path)) throw permissionError(); };
        checkProject(); if (!project) throw permissionError();
        const writing = method === 'project.write'; this.permission(session, writing ? 'project.write' : 'project.read');
        if (writing && (invocation.mode === 'plan' || !invocation.context)) throw permissionError();
        if (method === 'project.document') {
          const input = z.object({ path: z.string().min(1).max(4096) }).strict().parse(params);
          await allowedProjectPath(project, input.path);
          const document = { path: input.path, ...await projectDocument(project.path, input.path) };
          if (JSON.stringify(document).length > 256_000) throw new Error('The plugin request exceeds its limit.');
          this.current(session); checkProject(); signal.throwIfAborted(); return document;
        }
        let args: unknown; let name: string;
        if (method === 'project.read') { name = 'read_file'; args = z.object({ path: z.string(), start_line: z.number().optional(), max_lines: z.number().optional() }).strict().parse(params); args = { start_line: 1, max_lines: 200, ...args as object }; }
        else if (method === 'project.list') { name = 'list_files'; args = z.object({ path: z.string().default('') }).strict().parse(params); }
        else if (writing) { name = 'write_file'; args = params; }
        else throw permissionError();
        const guarded = invocation.context ? { ...invocation.context, approve: async (details: import('../../contracts/tools').ApprovalDetails) => {
          const allowed = await invocation.context!.approve(details); this.permission(session, writing ? 'project.write' : 'project.read'); signal.throwIfAborted();
          checkProject(); return allowed;
        } } : undefined;
        const result = await this.tools.execute({ id: randomUUID(), name, arguments: JSON.stringify(args) }, project, signal, guarded);
        this.current(session); checkProject(); signal.throwIfAborted(); return result;
      }
      throw permissionError();
    } catch (error) {
      if (error instanceof Error && /^(?:This plugin|Plugin storage|The plugin request)/.test(error.message)) throw error;
      throw new Error('The plugin host request failed. Check its permissions and parameters.');
    } finally { const count = Math.max(0, (this.requests.get(id) ?? 1) - 1); if (count) this.requests.set(id, count); else this.requests.delete(id); }
  }

  private async network(session: Session, raw: unknown, signal: AbortSignal): Promise<unknown> {
    const plugin = this.permission(session, 'network'); const input = networkSchema.parse(raw); const url = new URL(input.url);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash || !plugin.manifest.domains.some((host) => host.toLowerCase() === url.host.toLowerCase()) || Object.keys(input.headers).length > 30) throw permissionError();
    const response = await this.fetcher(url, { method: input.method, headers: input.headers, body: input.body, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
    const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let total = 0;
    try {
      if (reader) for (;;) { const part = await reader.read(); if (part.done) break; total += part.value.byteLength; if (total > 256_000) throw new Error('Plugin network response exceeded 256 KB.'); chunks.push(part.value); }
      this.current(session); signal.throwIfAborted();
      return { status: response.status, contentType: response.headers.get('Content-Type') ?? '', text: new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)) };
    } finally { await reader?.cancel().catch(() => {}); }
  }

  async shutdown(): Promise<void> { this.closing = true; await Promise.all([...this.sessions.keys()].map((id) => this.unload(id))); }
}
