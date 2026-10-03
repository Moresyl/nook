import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { CallToolResultSchema, PromptListChangedNotificationSchema, ResourceListChangedNotificationSchema, ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';
import type { JsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { mcpCredentialsSchema, type McpCatalog, type McpContent, type McpCredentials, type McpResourceUpdate, type McpServer, type McpTool, type McpView } from '../../contracts/extensions';
import type { ToolCall, ToolDefinition, ToolExecutionContext, ToolResult } from '../../contracts/tools';
import { boundedToolOutput } from './project-tools';
import { emptyMcpCatalog, mcpContentCatalog, McpContentAccess } from './mcp-content';
import { McpResourceSubscriptions } from './mcp-resource-subscriptions';
import { mcpDestination, mcpToolName } from './mcp-identity';
import { OAuthInteractionRequired, oauthWebUrl, type McpOAuthFactory, type McpOAuthSession } from './mcp-oauth';

export { mcpDestination, mcpToolName } from './mcp-identity';

type ToolBinding = { tool: McpTool; validate: JsonSchemaValidator<Record<string, unknown>> };
type Session = { id: string; config: McpServer; client: Client; transport?: Transport; controller: AbortController; status: McpView['status']; error?: string; bindings: Map<string, ToolBinding>; catalog: McpCatalog; oauth?: McpOAuthSession; connecting?: Promise<void>; subscriptions?: McpResourceSubscriptions };
export type McpSelection = { definitions: ToolDefinition[]; execute(call: ToolCall, signal: AbortSignal, context: ToolExecutionContext): Promise<ToolResult> };
export type McpTransportFactory = (config: McpServer, credentials: McpCredentials, signal: AbortSignal, authProvider?: OAuthClientProvider) => Transport;

function transportFor(server: McpServer, credentials: McpCredentials, signal: AbortSignal, authProvider?: OAuthClientProvider): Transport {
  if (server.transport === 'stdio') {
    const transport = new StdioClientTransport({ command: server.command, args: server.args, cwd: server.cwd || undefined,
      env: { ...getDefaultEnvironment(), ...credentials.env }, stderr: 'pipe', maxBufferSize: 4_000_000 });
    // Drain stderr without sending potentially private process output to the renderer.
    transport.stderr?.on('data', () => {});
    return transport;
  }
  const endpoint = new URL(server.endpoint);
  const fetchWithCredentials: typeof fetch = (input, init) => {
    const target = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (server.auth === 'oauth') oauthWebUrl(target, server.endpoint);
    else if (target.origin !== endpoint.origin) return Promise.reject(new Error('The MCP server advertised a different origin.'));
    const headers = new Headers(init?.headers);
    if (server.auth === 'bearer' && credentials.token) headers.set('Authorization', `Bearer ${credentials.token}`);
    if (headers.get('Authorization')?.startsWith('Bearer ') && target.origin !== endpoint.origin) return Promise.reject(new Error('MCP access tokens cannot be sent to a different origin.'));
    // Never forward a saved bearer token through a redirect to another destination.
    return fetch(input, { ...init, headers, redirect: 'error', signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal });
  };
  return server.transport === 'http' ? new StreamableHTTPClientTransport(endpoint, { fetch: fetchWithCredentials, authProvider })
    : new SSEClientTransport(endpoint, { fetch: fetchWithCredentials, authProvider, eventSourceInit: { fetch: fetchWithCredentials } });
}

async function closeTransport(session: Session): Promise<void> {
  // The SDK terminates its root process; Windows requires explicitly killing owned descendants.
  const pid = session.transport instanceof StdioClientTransport ? session.transport.pid : null;
  if (pid && process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const child = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      child.once('error', () => resolve()); child.once('close', () => resolve());
    });
  }
  try { await session.client.close(); } catch {}
  await session.oauth?.dispose();
}

async function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason ?? new DOMException('Stopped', 'AbortError'));
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([operation, cancelled]); }
  finally { signal.removeEventListener('abort', abort); }
}

export class McpConnections {
  private sessions = new Map<string, Session>();
  private closing = false;
  constructor(private readonly config: (id: string) => McpServer | undefined,
    private readonly credentials: (id: string) => McpCredentials,
    private readonly emit: (view: McpView) => void = () => {}, private readonly factory: McpTransportFactory = transportFor, private readonly oauthFactory?: McpOAuthFactory,
    private readonly resourceUpdated: (event: McpResourceUpdate) => void = () => {}) {}

  view(id: string): McpView {
    const session = this.sessions.get(id);
    return { id, status: session?.status ?? 'disconnected', error: session?.error,
      tools: session?.status === 'connected' ? [...session.bindings.values()].map(({ tool }) => structuredClone(tool)) : [],
      resourceSubscriptionsSupported: session?.status === 'connected' && session.subscriptions?.supported === true,
      subscribedResources: session?.status === 'connected' ? session.subscriptions?.uris() ?? [] : [] };
  }

  private notify(id: string): void { try { this.emit(this.view(id)); } catch {} }

  async connect(id: string, interactive = false): Promise<McpView> {
    if (this.closing) throw new Error('MCP connections are shutting down.');
    const current = this.sessions.get(id);
    if (current?.status === 'connected') return this.view(id);
    if (current?.status === 'connecting') { await current.connecting; return this.view(id); }
    await this.disconnect(id);
    if (this.closing) throw new Error('MCP connections are shutting down.');
    const config = this.config(id);
    if (!config || !config.enabled) throw new Error('Enable this MCP server before connecting.');
    const credentials = mcpCredentialsSchema.parse(this.credentials(id));
    if (interactive && config.auth !== 'oauth') throw new Error('Choose OAuth authentication before signing in.');
    const createClient = () => new Client({ name: 'qiyao-workspace', version: '0.1.0-alpha.1' }, { capabilities: {} });
    let client = createClient();
    const controller = new AbortController();
    const session: Session = { id, config: structuredClone(config), client, controller, status: 'connecting', bindings: new Map(), catalog: emptyMcpCatalog() };
    this.sessions.set(id, session);
    let timedOut = false;
    const bounded = async <T>(operation: () => Promise<T>) => {
      const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, config.timeout);
      try { return await abortable(operation(), controller.signal); } finally { clearTimeout(deadline); }
    };
    const options = { signal: session.controller.signal, timeout: config.timeout, maxTotalTimeout: config.timeout };
    session.connecting = (async () => {
      try {
        if (config.auth === 'oauth') {
          if (!this.oauthFactory) throw new OAuthInteractionRequired();
          session.oauth = await this.oauthFactory(config, credentials, controller.signal, interactive, () => { session.status = 'authorizing'; this.notify(id); });
        }
        controller.signal.throwIfAborted();
        let transport = this.factory(config, credentials, controller.signal, session.oauth?.provider); session.transport = transport;
        // Legacy EventSource can silently stop on abort without settling start().
        try { await bounded(() => client.connect(transport, options)); }
        catch (error) {
          if (!(error instanceof UnauthorizedError) || !interactive || !session.oauth || !(transport instanceof StreamableHTTPClientTransport || transport instanceof SSEClientTransport)) throw error;
          const code = await abortable(session.oauth.code(), controller.signal);
          const authorizedTransport = transport;
          await bounded(() => authorizedTransport.finishAuth(code));
          await client.close(); client = createClient(); session.client = client;
          transport = this.factory(config, credentials, controller.signal, session.oauth.provider); session.transport = transport;
          await bounded(() => client.connect(transport, options));
        }
        await bounded(() => this.refresh(session));
        session.controller.signal.throwIfAborted();
        if (this.sessions.get(id) !== session) throw new Error('This connection was replaced.');
        session.status = 'connected';
        session.subscriptions = new McpResourceSubscriptions(client, controller.signal, config.timeout,
          (uri) => { const access = this.contentAccess(id); if (uri !== undefined) access.validateResource(uri); },
          () => this.notify(id), (uri) => this.resourceUpdated({ id, uri }), (error) => this.authenticationFailed(session, error));
        this.notify(id);
        client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
          if (this.sessions.get(id) !== session || session.status !== 'connected') return;
          try { await this.refresh(session); this.notify(id); }
          catch (error) {
            await this.authenticationFailed(session, error);
            if (this.sessions.get(id) === session && session.status === 'connected') { session.status = 'error'; session.error = 'The MCP tool catalog could not be refreshed. Reconnect the server.'; this.notify(id); }
          }
        });
        for (const schema of [ResourceListChangedNotificationSchema, PromptListChangedNotificationSchema]) client.setNotificationHandler(schema, async () => {
          if (this.sessions.get(id) !== session || session.status !== 'connected') return;
          try { await this.refreshCatalog(id); }
          catch { if (this.sessions.get(id) === session && session.status === 'connected') { session.status = 'error'; session.error = 'The MCP content catalog could not be refreshed. Reconnect the server.'; this.notify(id); } }
        });
        client.onclose = () => {
          if (this.sessions.get(id) === session && !session.controller.signal.aborted) {
            session.status = 'disconnected'; session.controller.abort(); this.notify(id);
          }
        };
        client.onerror = () => {}; // Individual requests return bounded, sanitized errors.
      } catch (error) {
        const cancelled = session.controller.signal.aborted && !timedOut;
        session.controller.abort(); await closeTransport(session);
        if (this.sessions.get(id) === session) {
          const requiresLogin = error instanceof OAuthInteractionRequired || error instanceof UnauthorizedError;
          session.status = cancelled ? 'disconnected' : requiresLogin ? 'auth-required' : 'error';
          session.error = cancelled ? undefined : requiresLogin ? 'Sign in to this MCP server to continue.' : 'Could not connect. Check the program, endpoint and credentials, then retry.';
          this.notify(id);
        }
      } finally { await session.oauth?.dispose(); }
    })();
    this.notify(id);
    await session.connecting;
    return this.view(id);
  }

  private async refresh(session: Session): Promise<void> {
    session.catalog = await mcpContentCatalog(session.client, session.controller.signal, session.config.timeout);
    if (!session.client.getServerCapabilities()?.tools) { session.bindings = new Map(); return; }
    const next = new Map<string, ToolBinding>(); const cursors = new Set<string>();
    let cursor: string | undefined; let bytes = 0;
    for (let page = 0; ; page++) {
      if (page >= 20) throw new Error('Too many MCP catalog pages.');
      const reply = await session.client.listTools(cursor ? { cursor } : undefined, { signal: session.controller.signal, timeout: session.config.timeout, maxTotalTimeout: session.config.timeout });
      for (const tool of reply.tools) {
        if (next.has(tool.name) || tool.name.length > 256) throw new Error('Invalid MCP tool name.');
        const parameters = structuredClone(tool.inputSchema);
        bytes += JSON.stringify(parameters).length;
        if (bytes > 2_000_000 || next.size >= 1000) throw new Error('The MCP catalog is too large.');
        const validate = new AjvJsonSchemaValidator().getValidator<Record<string, unknown>>(parameters);
        next.set(tool.name, { tool: { name: tool.name, description: (tool.description ?? '').slice(0, 4000), parameters }, validate });
      }
      cursor = reply.nextCursor;
      if (!cursor) break;
      if (cursors.has(cursor)) throw new Error('The MCP catalog repeated a cursor.');
      cursors.add(cursor);
    }
    session.bindings = next;
  }

  async refreshCatalog(id: string): Promise<McpCatalog> {
    const session = this.sessions.get(id);
    if (!session || session.status !== 'connected') throw new Error('Connect this MCP server before refreshing its content.');
    try {
      const catalog = await mcpContentCatalog(session.client, session.controller.signal, session.config.timeout);
      if (this.sessions.get(id) !== session || session.controller.signal.aborted || JSON.stringify(this.config(id)) !== JSON.stringify(session.config)) throw new Error('This MCP connection changed.');
      session.catalog = catalog; session.subscriptions?.refresh(); this.notify(id); return structuredClone(catalog);
    } catch (error) { await this.authenticationFailed(session, error); throw new Error('The MCP content catalog could not be refreshed. Check the connection and retry.'); }
  }

  private assertCurrent(session: Session, name: string, binding: ToolBinding): void {
    const current = this.config(session.id);
    if (!current?.enabled || current.disabledTools.includes(name) || JSON.stringify(current) !== JSON.stringify(session.config)
      || this.sessions.get(session.id) !== session || session.status !== 'connected' || session.bindings.get(name) !== binding) {
      throw new Error('This MCP tool or connection changed. Start a new request.');
    }
  }

  select(ids: string[]): McpSelection {
    const captured = new Map<string, { session: Session; name: string; binding: ToolBinding }>();
    const definitions: ToolDefinition[] = [];
    const contents = new Map<string, { session: Session; access: McpContentAccess; action: string }>();
    for (const id of new Set(ids)) {
      const session = this.sessions.get(id); const config = this.config(id);
      if (!session || session.status !== 'connected' || !config?.enabled) throw new Error('Connect the selected MCP servers in settings before sending.');
      for (const [name, binding] of session.bindings) {
        if (config.disabledTools.includes(name)) continue;
        this.assertCurrent(session, name, binding);
        const toolName = mcpToolName(id, name);
        captured.set(toolName, { session, name, binding });
        definitions.push({ name: toolName, displayName: `${config.name} · ${name}`, description: `[${config.name}] ${name}: ${binding.tool.description}`, parameters: binding.tool.parameters, strict: false });
      }
      const access = this.contentAccess(id);
      const hash = createHash('sha256').update(id).digest('hex').slice(0, 12);
      for (const definition of access.definitions(hash, config.name)) {
        definitions.push(definition); contents.set(definition.name, { session, access, action: definition.name.slice(4, -13) });
      }
    }
    if (definitions.length > 120) throw new Error('Too many selected MCP tools. Disable some tools or select fewer servers.');
    return { definitions, execute: async (call, signal, context) => {
      const content = contents.get(call.name);
      if (content) return content.access.execute(content.action, call, content.session.id, content.session.config.name, signal, context);
      const selected = captured.get(call.name);
      if (!selected) return { callId: call.id, output: 'This MCP tool was not selected.', error: true };
      return this.invoke(selected.session, selected.name, selected.binding, call, signal, context);
    } };
  }

  private contentAccess(id: string): McpContentAccess {
    const session = this.sessions.get(id);
    if (!session || session.status !== 'connected') throw new Error('Connect this MCP server before browsing its content.');
    const catalog = session.catalog;
    const check = () => {
      const config = this.config(id);
      if (!config?.enabled || JSON.stringify(config) !== JSON.stringify(session.config) || this.sessions.get(id) !== session || session.status !== 'connected' || session.catalog !== catalog) throw new Error('This MCP content or connection changed. Refresh the catalog and retry.');
    };
    check();
    return new McpContentAccess(session.client, catalog, session.controller.signal, session.config.timeout, check, (error) => this.authenticationFailed(session, error));
  }

  catalog(id: string): McpCatalog { return structuredClone(this.contentAccess(id).catalog); }

  async setResourceSubscription(id: string, uri: string, subscribed: boolean): Promise<McpView> {
    const session = this.sessions.get(id);
    if (!session || session.status !== 'connected' || !session.subscriptions) throw new Error('Connect this MCP server before subscribing to resources.');
    await session.subscriptions.set(uri, subscribed);
    return this.view(id);
  }

  async readResource(id: string, uri: string): Promise<McpContent> {
    try { return await this.contentAccess(id).resource(uri); }
    catch { throw new Error('Could not read the MCP resource. Check its URI and connection.'); }
  }

  async getPrompt(id: string, name: string, argumentsMap: Record<string, string>): Promise<McpContent> {
    try { return await this.contentAccess(id).prompt(name, argumentsMap); }
    catch { throw new Error('Could not load the MCP prompt. Check its arguments and connection.'); }
  }

  private async authenticationFailed(session: Session, error: unknown): Promise<void> {
    if (this.sessions.get(session.id) !== session || !(error instanceof OAuthInteractionRequired || error instanceof UnauthorizedError)) return;
    session.status = 'auth-required'; session.error = 'Sign in to this MCP server to continue.'; this.notify(session.id);
    session.controller.abort(); await closeTransport(session);
  }

  private async invoke(session: Session, name: string, binding: ToolBinding, call: ToolCall, signal: AbortSignal, context?: ToolExecutionContext): Promise<ToolResult> {
    signal.throwIfAborted();
    try {
      this.assertCurrent(session, name, binding);
      if (call.arguments.length > 64_000) throw new Error('MCP tool arguments exceed 64 KB.');
      let args: unknown;
      try { args = JSON.parse(call.arguments); } catch { throw new Error('MCP tool arguments must be valid JSON.'); }
      if (!args || typeof args !== 'object' || Array.isArray(args) || !binding.validate(args).valid) throw new Error('MCP tool arguments do not match the server’s input schema.');
      if (context && !await context.approve({ kind: 'mcp', serverId: session.id, serverName: session.config.name, toolName: name, arguments: call.arguments })) {
        return { callId: call.id, output: 'The user declined this MCP operation. Respect that decision.', error: true };
      }
      signal.throwIfAborted(); this.assertCurrent(session, name, binding);
      const result = CallToolResultSchema.parse(await session.client.callTool({ name, arguments: args as Record<string, unknown> }, CallToolResultSchema,
        { signal: AbortSignal.any([signal, session.controller.signal]), timeout: session.config.timeout, maxTotalTimeout: session.config.timeout,
          onprogress: (progress) => context?.onProgress(`${progress.message ?? 'MCP operation'} (${progress.progress}${progress.total === undefined ? '' : `/${progress.total}`})`) }));
      signal.throwIfAborted();
      const text = result.content.map((item) => item.type === 'text' ? item.text : item.type === 'image' || item.type === 'audio'
        ? `[${item.type}: ${item.mimeType}]` : JSON.stringify(item)).join('\n');
      const structured = result.structuredContent ? `\nStructured result:\n${JSON.stringify(result.structuredContent)}` : '';
      return { callId: call.id, output: boundedToolOutput(text + structured), error: Boolean(result.isError) };
    } catch (error) {
      signal.throwIfAborted();
      await this.authenticationFailed(session, error);
      // Do not expose server errors, environment variables, URLs with tokens or protocol bodies.
      const local = error instanceof Error && /^(?:This MCP|MCP tool|The user)/.test(error.message);
      return { callId: call.id, output: local ? error.message : 'The MCP operation failed or the server disconnected. Check the connection and retry.', error: true };
    }
  }

  async testTool(id: string, name: string, argumentsJson: string): Promise<ToolResult> {
    const session = this.sessions.get(id); const binding = session?.bindings.get(name);
    if (!session || !binding) throw new Error('Connect the server and choose an available tool first.');
    return this.invoke(session, name, binding, { id: 'manual-test', name: mcpToolName(id, name), arguments: argumentsJson }, new AbortController().signal);
  }

  async disconnect(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id); session.controller.abort();
    await closeTransport(session); await session.connecting; this.notify(id);
  }

  async shutdown(): Promise<void> { this.closing = true; await Promise.all([...this.sessions.keys()].map((id) => this.disconnect(id))); }
}
