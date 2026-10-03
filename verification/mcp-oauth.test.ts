import { readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mcpServerSchema, type McpServer } from '../contracts/extensions';
import { McpOAuthSessions, McpOAuthStore, oauthWebUrl } from '../desktop/services/mcp-oauth';
import { McpConnections } from '../desktop/services/mcp-connections';
import { ExtensionSettings } from '../desktop/services/extension-settings';
import { LocalSkills } from '../desktop/services/local-skills';
import { WorkspaceVault } from '../desktop/services/vault';
import { codec, testVault } from './fixtures';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map((close) => close())); });
async function setup(endpoint = 'http://127.0.0.1:8000/mcp', open = vi.fn(async (_url: string) => {}), timeout?: number) {
  const { vault, directory } = await testVault(); cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const config = mcpServerSchema.parse({ id: 'oauth', name: 'OAuth', transport: 'http', endpoint, auth: 'oauth', timeout: 2000 });
  await vault.update((draft) => { draft.mcpServers.push(config); });
  const store = new McpOAuthStore(vault); const sessions = new McpOAuthSessions(store, open, () => config, timeout);
  return { vault, directory, config, store, sessions, open };
}
describe('MCP OAuth', () => {
  it('keeps issuer bindings unchanged, encrypts client/tokens and isolates them from provider keys and backups', async () => {
    const { vault, store, config, directory } = await setup();
    const tokens = { access_token: 'private-access', refresh_token: 'private-refresh', token_type: 'Bearer', issuer: 'http://127.0.0.1:8000/authorization' };
    await store.save(config, { destination: '', tokens, clientInformation: { client_id: 'id', client_secret: 'private-client', issuer: tokens.issuer } });
    expect(store.load(config).tokens).toEqual(tokens); expect(store.load({ ...config, endpoint: 'http://127.0.0.1:9000/mcp' }).tokens).toBeUndefined();
    expect(await readFile(join(directory, 'credentials.json'), 'utf8')).not.toContain('private-'); expect(JSON.stringify(vault.backup())).not.toContain('private-');
    const restarted = new WorkspaceVault(directory, codec); await restarted.initialize(); expect(new McpOAuthStore(restarted).load(config).tokens).toEqual(tokens);
    await vault.setKey('mcp-oauth:oauth', 'provider-secret'); expect(store.load(config).tokens).toEqual(tokens); await store.clear(config.id); expect(store.load(config).tokens).toBeUndefined();
    await vault.setKey('\0mcp-oauth:oauth', '{bad'); expect(() => store.load(config)).toThrow('invalid'); await store.clear(config.id);
    await expect(store.save(config, { destination: '', tokens: { ...tokens, access_token: 'x'.repeat(256_001) } })).rejects.toThrow('storage limit');
  });
  it('validates loopback state, callback path and one-time use without persisting codes or verifiers', async () => {
    const { config, sessions, store } = await setup(); const controller = new AbortController(); const session = await sessions.create(config, {}, controller.signal, true, () => {}); cleanup.push(() => session.dispose());
    const redirect = session.provider.redirectUrl!; const state = await session.provider.state!();
    const wrong = new URL(redirect); wrong.searchParams.set('state', 'wrong'); wrong.searchParams.set('code', 'code'); expect((await fetch(wrong)).status).toBe(400);
    const wrongPath = new URL(redirect); wrongPath.pathname = '/wrong'; expect((await fetch(wrongPath)).status).toBe(404);
    const callback = new URL(redirect); callback.searchParams.set('state', state); expect((await fetch(callback)).status).toBe(400);
    session.provider.saveCodeVerifier('private-verifier'); expect(await session.provider.codeVerifier()).toBe('private-verifier');
    callback.searchParams.set('code', 'private-code'); expect((await fetch(callback)).status).toBe(200); expect(await session.code()).toBe('private-code'); expect((await fetch(callback)).status).toBe(409);
    expect(JSON.stringify(store.load(config))).not.toContain('private-verifier'); expect(JSON.stringify(store.load(config))).not.toContain('private-code');
    await session.dispose(); await expect(session.provider.redirectToAuthorization(new URL('http://127.0.0.1/authorize'))).rejects.toThrow('Sign in');
  });
  it('expires and cancels login sessions, releases the callback port and refuses background browser redirects', async () => {
    const fixture = await setup(undefined, undefined, 20); const session = await fixture.sessions.create(fixture.config, {}, new AbortController().signal, true, () => {}); cleanup.push(() => session.dispose());
    const address = String(session.provider.redirectUrl); await expect(session.code()).rejects.toThrow('timed out'); await session.dispose(); await expect(fetch(address)).rejects.toThrow();
    const controller = new AbortController(); const cancelled = await fixture.sessions.create(fixture.config, {}, controller.signal, true, () => {}); cleanup.push(() => cancelled.dispose()); controller.abort(); await expect(cancelled.code()).rejects.toThrow();
    const background = await fixture.sessions.create(fixture.config, {}, new AbortController().signal, false, () => {}); cleanup.push(() => background.dispose());
    expect(() => background.provider.clientInformation()).toThrow('Sign in'); await expect(background.provider.redirectToAuthorization(new URL('http://127.0.0.1/authorize'))).rejects.toThrow('Sign in'); expect(fixture.open).not.toHaveBeenCalled();
  });
  it('binds pre-registered clients to the configured issuer and invalidates specific saved credentials', async () => {
    const { config, sessions, store } = await setup(); config.oauthClientId = 'registered'; config.oauthIssuer = 'https://auth.example.com';
    const session = await sessions.create(config, { clientSecret: 'private-client' }, new AbortController().signal, true, () => {}); cleanup.push(() => session.dispose());
    expect(await session.provider.clientInformation()).toEqual({ client_id: 'registered', client_secret: 'private-client', issuer: 'https://auth.example.com' });
    await session.provider.saveClientInformation!({ client_id: 'dynamic', issuer: 'https://auth.example.com' }); await session.provider.saveTokens({ access_token: 'private', token_type: 'Bearer', issuer: 'https://auth.example.com' });
    session.provider.saveCodeVerifier('verifier'); await session.provider.invalidateCredentials!('verifier'); expect(() => session.provider.codeVerifier()).toThrow('unavailable');
    await session.provider.invalidateCredentials!('tokens'); expect(store.load(config).tokens).toBeUndefined(); await session.provider.invalidateCredentials!('client'); expect(store.load(config).clientInformation).toBeUndefined();
    config.enabled = false; await expect(session.provider.saveTokens({ access_token: 'new', token_type: 'Bearer' })).rejects.toThrow('changed');
  });
  it('allows secure authorization URLs and refuses embedded credentials and remote-to-loopback downgrade', () => {
    expect(oauthWebUrl('https://auth.example.com/authorize', 'https://mcp.example.com/mcp').hostname).toBe('auth.example.com');
    expect(oauthWebUrl('http://127.0.0.1/authorize', 'http://127.0.0.1:8000/mcp').protocol).toBe('http:');
    for (const value of ['file:///secret', 'http://auth.example.com/authorize', 'https://user:secret@auth.example.com/authorize', 'http://127.0.0.1/authorize']) expect(() => oauthWebUrl(value, 'https://mcp.example.com/mcp')).toThrow('HTTPS');
    expect(() => mcpServerSchema.parse({ id: 'x', name: 'X', transport: 'stdio', command: 'node', auth: 'oauth' })).toThrow();
  });
  it.each(['http', 'sse'] as const)('completes real %s discovery, dynamic registration, PKCE authorization/token exchange, refresh and restart reuse', async (transport) => {
    const { oauthFixture } = await import('./oauth-fixture.mjs'); const remote = await oauthFixture(transport); cleanup.push(() => remote.close());
    const fixture = await setup(remote.endpoint, vi.fn((url: string) => remote.authorize(url))); const { sessions, store, config } = fixture;
    config.transport = transport;
    const manager = new McpConnections(() => config, () => ({}), () => {}, undefined, (...args) => sessions.create(...args)); cleanup.push(() => manager.shutdown());
    expect((await manager.connect(config.id)).status).toBe('auth-required'); expect(fixture.open).not.toHaveBeenCalled();
    expect((await manager.connect(config.id, true)).status).toBe('connected'); expect(fixture.open).toHaveBeenCalledOnce();
    expect((await manager.testTool(config.id, 'authenticated_echo', '{}')).output).toBe('OAUTH_PROTOCOL_EVIDENCE'); expect(store.load(config).tokens?.issuer).toBe(remote.issuer);
    remote.expire(); expect((await manager.readResource(config.id, 'fixture://authorized')).text).toContain('OAUTH_RESOURCE_EVIDENCE'); expect(remote.requests.some((request) => request.grant === 'refresh_token')).toBe(true);
    await manager.disconnect(config.id); expect((await manager.connect(config.id)).status).toBe('connected'); expect(fixture.open).toHaveBeenCalledOnce();
    remote.disableRefresh(); remote.expire(); await expect(manager.readResource(config.id, 'fixture://authorized')).rejects.toThrow('Could not read'); expect(manager.view(config.id).status).toBe('auth-required');
    expect(remote.errors).toEqual([]);
  });
  it.each(['http', 'sse'] as const)('uses a pre-registered client, issuer, secret and fixed callback through real %s OAuth', async (transport) => {
    const { oauthFixture } = await import('./oauth-fixture.mjs'); const remote = await oauthFixture(transport); cleanup.push(() => remote.close());
    const fixture = await setup(remote.endpoint, vi.fn((url: string) => remote.authorize(url))); const { sessions, store, config, vault, directory } = fixture;
    const listener = createServer(); await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve)); const port = (listener.address() as AddressInfo).port; await new Promise<void>((resolve) => listener.close(() => resolve()));
    Object.assign(config, { transport, oauthClientId: 'registered-client', oauthIssuer: remote.issuer, oauthRedirectPort: port, oauthScope: 'fixture.read' });
    remote.registerClient(config.oauthClientId, 'private-client-secret', `http://127.0.0.1:${port}/oauth/callback`);
    const settings = new ExtensionSettings(vault, new LocalSkills(join(directory, 'skills'))); await settings.saveServer(config, { clientSecret: 'private-client-secret' });
    const manager = new McpConnections(() => config, (id) => settings.credentials(id), () => {}, undefined, (...args) => sessions.create(...args)); cleanup.push(() => manager.shutdown());
    expect((await manager.connect(config.id, true)).status).toBe('connected'); expect((await manager.testTool(config.id, 'authenticated_echo', '{}')).output).toBe('OAUTH_PROTOCOL_EVIDENCE');
    expect(remote.requests.some((request) => request.path === '/register')).toBe(false); expect(remote.requests.find((request) => request.path === '/token')?.authorization).toMatch(/^Basic /);
    expect(store.load(config).tokens?.issuer).toBe(remote.issuer); expect(store.load(config).redirectUrl).toContain(`:${port}/oauth/callback`);
    expect(await readFile(join(directory, 'credentials.json'), 'utf8')).not.toContain('private-client-secret');
    remote.expire(); expect((await manager.readResource(config.id, 'fixture://authorized')).text).toContain('OAUTH_RESOURCE_EVIDENCE');
    remote.disableRefresh(); remote.expire(); await remote.notifyTools(); await vi.waitFor(() => expect(manager.view(config.id).status).toBe('auth-required'));
    expect(remote.errors).toEqual([]);
  });
  it('clears login state on endpoint changes and removal, and restores it if the settings write fails', async () => {
    const { vault, config, store, directory } = await setup(); const settings = new ExtensionSettings(vault, new LocalSkills(join(directory, 'skills')));
    await store.save(config, { destination: '', tokens: { access_token: 'private', token_type: 'Bearer' } });
    vi.spyOn(vault, 'update').mockRejectedValueOnce(new Error('Disk full')); await expect(settings.saveServer({ ...config, endpoint: 'http://127.0.0.1:9999/mcp' })).rejects.toThrow(); expect(store.load(config).tokens?.access_token).toBe('private');
    await settings.saveServer({ ...config, endpoint: 'http://127.0.0.1:9999/mcp' }); expect(vault.key('\0mcp-oauth:oauth')).toBe('');
    await settings.saveServer(config, { clientSecret: 'private-client' }); await store.save(config, { destination: '', tokens: { access_token: 'private', token_type: 'Bearer' } });
    const setKey = vault.setKey.bind(vault); vi.spyOn(vault, 'setKey').mockImplementationOnce(setKey).mockRejectedValueOnce(new Error('Disk full'));
    await expect(settings.removeServer(config.id)).rejects.toThrow('Disk full'); expect(settings.credentials(config.id).clientSecret).toBe('private-client'); expect(store.load(config).tokens?.access_token).toBe('private');
    await settings.removeServer(config.id); expect(vault.key('\0mcp-oauth:oauth')).toBe('');
  });
});
