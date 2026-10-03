import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListResourcesRequestSchema, ListResourceTemplatesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export async function oauthFixture(mode = 'http') {
  const registrations = new Map(); const codes = new Map(); const accessTokens = new Set(); const refreshTokens = new Set(); const sessions = new Map();
  const requests = []; const errors = []; let refreshEnabled = true; let base;
  const endpointPath = mode === 'sse' ? '/sse' : '/mcp';
  const json = (response, status, value) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
  const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  async function body(request) { let text = ''; for await (const chunk of request) text += chunk; return text; }
  const http = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url, base); requests.push({ path: url.pathname, authorization: request.headers.authorization ?? '' });
      if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) return json(response, 200, { resource: `${base}${endpointPath}`, authorization_servers: [`${base}/authorization`], scopes_supported: ['fixture.read'] });
      if (url.pathname.includes('.well-known')) return json(response, 200, { issuer: `${base}/authorization`, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, registration_endpoint: `${base}/register`, response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none', 'client_secret_basic'], scopes_supported: ['fixture.read'] });
      if (url.pathname === '/register') {
        const metadata = JSON.parse(await body(request)); const clientId = `fixture-client-${registrations.size + 1}`; registrations.set(clientId, metadata);
        return json(response, 201, { ...metadata, client_id: clientId });
      }
      if (url.pathname === '/authorize') {
        assert.equal(url.searchParams.get('code_challenge_method'), 'S256'); assert.equal(url.searchParams.get('resource'), `${base}${endpointPath}`);
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Qiyao OAuth verification</title><body><h1>授权验证服务器</h1><form action="/approve">${[...url.searchParams].map(([key, value]) => `<input type="hidden" name="${escape(key)}" value="${escape(value)}">`).join('')}<button>授权</button></form></body></html>`); return;
      }
      if (url.pathname === '/approve') {
        const clientId = url.searchParams.get('client_id'); const registration = registrations.get(clientId); assert.ok(registration);
        const redirect = url.searchParams.get('redirect_uri'); assert.ok(registration.redirect_uris.includes(redirect)); const code = randomUUID();
        codes.set(code, { clientId, redirect, challenge: url.searchParams.get('code_challenge') });
        const callback = new URL(redirect); callback.searchParams.set('code', code); callback.searchParams.set('state', url.searchParams.get('state'));
        response.writeHead(302, { Location: callback.toString() }); response.end(); return;
      }
      if (url.pathname === '/token') {
        const params = new URLSearchParams(await body(request)); requests.at(-1).grant = params.get('grant_type');
        const clientId = params.get('client_id') ?? Buffer.from((request.headers.authorization ?? '').replace(/^Basic /, ''), 'base64').toString().split(':')[0];
        const client = registrations.get(clientId); assert.ok(client);
        if (client.client_secret) assert.equal(request.headers.authorization, `Basic ${Buffer.from(`${clientId}:${client.client_secret}`).toString('base64')}`);
        if (params.get('grant_type') === 'refresh_token') {
          if (!refreshEnabled || !refreshTokens.has(params.get('refresh_token'))) return json(response, 400, { error: 'invalid_grant' });
          refreshTokens.delete(params.get('refresh_token'));
        } else {
          const code = codes.get(params.get('code')); assert.ok(code); assert.equal(clientId, code.clientId); assert.equal(params.get('redirect_uri'), code.redirect);
          assert.equal(createHash('sha256').update(params.get('code_verifier')).digest('base64url'), code.challenge); codes.delete(params.get('code'));
        }
        const access = `access-${randomUUID()}`; const refresh = `refresh-${randomUUID()}`; accessTokens.add(access); refreshTokens.add(refresh);
        return json(response, 200, { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: 60, scope: 'fixture.read' });
      }
      if (url.pathname === endpointPath || url.pathname === '/messages') {
        if (!accessTokens.has((request.headers.authorization ?? '').replace(/^Bearer /, ''))) {
          request.resume(); response.writeHead(401, { 'WWW-Authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"` }); response.end(); return;
        }
        const sessionId = mode === 'sse' ? url.searchParams.get('sessionId') : request.headers['mcp-session-id']; let session = sessions.get(sessionId);
        if (mode === 'sse' && url.pathname === '/messages') { assert.ok(session); await session.transport.handlePostMessage(request, response); return; }
        if (!session) {
          const server = new Server({ name: 'oauth-fixture', version: '1' }, { capabilities: { tools: { listChanged: true }, resources: {} } });
          server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [{ name: '授权文档', uri: 'fixture://authorized' }] }));
          server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: [] }));
          server.setRequestHandler(ReadResourceRequestSchema, async () => ({ contents: [{ uri: 'fixture://authorized', text: 'OAUTH_RESOURCE_EVIDENCE' }] }));
          server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'authenticated_echo', description: 'Requires OAuth', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }] }));
          server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: 'OAUTH_PROTOCOL_EVIDENCE' }] }));
          const transport = mode === 'sse' ? new SSEServerTransport('/messages', response) : new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), onsessioninitialized: (id) => sessions.set(id, session) });
          session = { server, transport }; await server.connect(transport);
          if (mode === 'sse') { sessions.set(transport.sessionId, session); return; }
        }
        await session.transport.handleRequest(request, response); return;
      }
      response.writeHead(404); response.end();
    })().catch((error) => { errors.push(String(error)); response.destroy(); });
  });
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${http.address().port}`;
  return { endpoint: `${base}${endpointPath}`, issuer: `${base}/authorization`, requests, errors,
    registerClient: (id, secret, redirect) => registrations.set(id, { client_id: id, client_secret: secret, redirect_uris: [redirect] }),
    notifyTools: async () => { await Promise.all([...sessions.values()].map((session) => session.server.sendToolListChanged())); },
    authorize: async (url) => { const authorize = new URL(url); const page = await fetch(authorize); assert.equal(page.status, 200); authorize.pathname = '/approve'; const callback = await fetch(authorize); assert.equal(callback.status, 200); },
    expire: () => accessTokens.clear(), disableRefresh: () => { refreshEnabled = false; },
    close: async () => { await Promise.all([...sessions.values()].map((session) => session.server.close())); http.closeAllConnections(); await new Promise((resolve) => http.close(resolve)); } };
}
