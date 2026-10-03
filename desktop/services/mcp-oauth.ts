import { createServer, type Server } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { OAuthClientInformationSchema, OAuthTokensSchema, type OAuthClientInformationMixed, type OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { McpCredentials, McpServer } from '../../contracts/extensions';
import type { WorkspaceVault } from './vault';
import { mcpDestination } from './mcp-identity';

type SavedAuth = { destination: string; redirectUrl?: string; clientInformation?: OAuthClientInformationMixed; tokens?: OAuthTokens };
export class OAuthInteractionRequired extends Error { constructor() { super('Sign in to this MCP server to continue.'); } }
export type McpOAuthSession = { provider: OAuthClientProvider; code(): Promise<string>; dispose(): Promise<void> };
export type McpOAuthFactory = (config: McpServer, credentials: McpCredentials, signal: AbortSignal, interactive: boolean, onRedirect: () => void) => Promise<McpOAuthSession>;

export function oauthWebUrl(value: string | URL, endpoint: string): URL {
  const url = new URL(value); const configured = new URL(endpoint);
  const loopback = (host: string) => ['127.0.0.1', '[::1]', 'localhost'].includes(host);
  if (url.toString().length > 16_000 || url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback(url.hostname) && loopback(configured.hostname)))) throw new Error('OAuth endpoints must use HTTPS or the configured local loopback server.');
  return url;
}

export class McpOAuthStore {
  constructor(private readonly vault: WorkspaceVault) {}

  load(config: McpServer): SavedAuth {
    const secret = this.vault.key(`\0mcp-oauth:${config.id}`);
    if (!secret) return { destination: mcpDestination(config) };
    try {
      const saved: SavedAuth = JSON.parse(secret);
      if (saved.destination !== mcpDestination(config)) return { destination: mcpDestination(config) };
      if (saved.tokens) OAuthTokensSchema.parse(saved.tokens);
      if (saved.clientInformation) OAuthClientInformationSchema.parse(saved.clientInformation);
      if (saved.redirectUrl) {
        const url = new URL(saved.redirectUrl);
        if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/oauth/callback' || !url.port || url.username || url.password || url.search || url.hash) throw new Error();
      }
      return saved;
    } catch { throw new Error('Saved MCP login data is invalid. Sign out and sign in again.'); }
  }

  async save(config: McpServer, saved: SavedAuth): Promise<void> {
    const json = JSON.stringify({ ...saved, destination: mcpDestination(config) });
    if (json.length > 256_000) throw new Error('The MCP login data exceeds its storage limit.');
    await this.vault.setKey(`\0mcp-oauth:${config.id}`, json);
  }

  async clear(id: string): Promise<void> { await this.vault.setKey(`\0mcp-oauth:${id}`, ''); }
}

class LoopbackAuthorization {
  private server: Server;
  private resolve!: (code: string) => void;
  private reject!: (error: unknown) => void;
  readonly code: Promise<string>;
  readonly state = randomBytes(32).toString('base64url');
  private settled = false;
  private abort: () => void;
  private timer: ReturnType<typeof setTimeout>;
  redirectUrl = '';

  constructor(private readonly signal: AbortSignal, timeout: number) {
    this.code = new Promise<string>((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    void this.code.catch(() => {});
    this.abort = () => { if (!this.settled) { this.settled = true; this.reject(signal.reason ?? new DOMException('Stopped', 'AbortError')); } };
    signal.addEventListener('abort', this.abort, { once: true });
    this.timer = setTimeout(() => { if (!this.settled) { this.settled = true; this.reject(new Error('MCP login timed out. Try signing in again.')); } }, timeout);
    this.server = createServer((request, response) => {
      response.setHeader('Cache-Control', 'no-store'); response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
      const finish = (status: number, message: string) => { response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>栖曜登录</title><body style="font:16px system-ui;padding:48px;line-height:1.6"><h1>栖曜 Qiyao</h1><p>${message}</p></body></html>`); };
      if (request.method !== 'GET' || (request.url?.length ?? 0) > 16_000) { finish(400, '无效的登录回调。'); return; }
      let url: URL;
      try { url = new URL(request.url ?? '/', 'http://127.0.0.1'); }
      catch { finish(400, '无效的登录回调。'); return; }
      if (url.pathname !== '/oauth/callback') { finish(404, '找不到此页面。'); return; }
      const received = Buffer.from(url.searchParams.get('state') ?? ''); const expected = Buffer.from(this.state);
      if (received.length !== expected.length || !timingSafeEqual(received, expected)) { finish(400, '登录状态不匹配，请返回工作台重新登录。'); return; }
      if (this.settled) { finish(409, '此登录请求已结束。'); return; }
      if (url.searchParams.has('error')) { this.settled = true; this.reject(new Error('MCP sign-in was declined.')); finish(400, '登录未完成，请返回工作台。'); return; }
      const code = url.searchParams.get('code');
      if (!code || code.length > 4096) { finish(400, '登录回调缺少有效授权码。'); return; }
      this.settled = true; this.resolve(code); finish(200, '授权已收到。请返回工作台查看连接结果。');
    });
    this.server.maxHeadersCount = 20; this.server.headersTimeout = 10_000; this.server.requestTimeout = 10_000;
  }

  async listen(port: number): Promise<void> {
    this.signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => { this.server.once('error', reject); this.server.listen(port, '127.0.0.1', () => { this.server.removeListener('error', reject); resolve(); }); });
    this.redirectUrl = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/oauth/callback`;
  }

  async dispose(): Promise<void> {
    clearTimeout(this.timer); this.signal.removeEventListener('abort', this.abort); this.abort();
    this.server.closeAllConnections();
    if (this.server.listening) await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

export class McpOAuthSessions {
  constructor(private readonly store: McpOAuthStore, private readonly open: (url: string) => Promise<void>, private readonly config: (id: string) => McpServer | undefined, private readonly loginTimeout = 300_000) {}

  async create(config: McpServer, credentials: McpCredentials, signal: AbortSignal, interactive: boolean, onRedirect: () => void): Promise<McpOAuthSession> {
    let saved = this.store.load(config); let flow: LoopbackAuthorization | undefined; let verifier = '';
    if (interactive) {
      flow = new LoopbackAuthorization(signal, this.loginTimeout);
      try {
        const port = saved.redirectUrl ? Number(new URL(saved.redirectUrl).port) : config.oauthRedirectPort;
        await flow.listen(port); saved.redirectUrl = flow.redirectUrl;
      } catch { await flow.dispose(); throw new Error('Could not open the local MCP login callback. Check the callback port and retry.'); }
    }
    const check = () => { signal.throwIfAborted(); const current = this.config(config.id); if (!current?.enabled || mcpDestination(current) !== mcpDestination(config)) throw new Error('The MCP login configuration changed. Start sign-in again.'); };
    const persist = async () => { check(); await this.store.save(config, saved); check(); };
    const provider: OAuthClientProvider = {
      get redirectUrl() { if (!saved.redirectUrl) throw new OAuthInteractionRequired(); return saved.redirectUrl; },
      get clientMetadata() { return { redirect_uris: saved.redirectUrl ? [saved.redirectUrl] : [], client_name: 'Qiyao', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: credentials.clientSecret ? 'client_secret_basic' : 'none', ...(config.oauthScope ? { scope: config.oauthScope } : {}) }; },
      state: () => { if (!flow) throw new OAuthInteractionRequired(); return flow.state; },
      clientInformation: () => {
        check();
        if (config.oauthClientId) return { client_id: config.oauthClientId, client_secret: credentials.clientSecret, issuer: config.oauthIssuer };
        if (!saved.clientInformation && !flow) throw new OAuthInteractionRequired();
        return saved.clientInformation;
      },
      saveClientInformation: async (value) => { OAuthClientInformationSchema.parse(value); saved.clientInformation = structuredClone(value); await persist(); },
      tokens: () => { check(); return saved.tokens ? structuredClone(saved.tokens) : undefined; },
      saveTokens: async (value) => { OAuthTokensSchema.parse(value); saved.tokens = structuredClone(value); await persist(); },
      redirectToAuthorization: async (url) => { check(); if (!flow) throw new OAuthInteractionRequired(); onRedirect(); await this.open(oauthWebUrl(url, config.endpoint).toString()); },
      saveCodeVerifier: (value) => { check(); verifier = value; },
      codeVerifier: () => { check(); if (!verifier) throw new Error('The MCP login verifier is unavailable.'); return verifier; },
      invalidateCredentials: async (scope) => {
        check(); if (scope === 'all' || scope === 'tokens') delete saved.tokens;
        if (scope === 'all' || scope === 'client') delete saved.clientInformation;
        if (scope === 'all' || scope === 'verifier') verifier = '';
        if (scope !== 'verifier' && scope !== 'discovery') await persist();
      },
    };
    return { provider, code: async () => { if (!flow) throw new OAuthInteractionRequired(); return flow.code; }, dispose: async () => { verifier = ''; await flow?.dispose(); flow = undefined; } };
  }
}
