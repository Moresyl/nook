import { z } from 'zod';

const identifier = z.string().min(1).max(128).refine((value) => !value.includes('\0'), 'Identifiers cannot contain NUL characters');
const plainText = z.string().max(4096).refine((value) => !value.includes('\0'), 'NUL characters are not allowed');
export const mcpServerSchema = z.object({
  id: identifier, name: z.string().trim().min(1).max(80),
  transport: z.enum(['stdio', 'http', 'sse']),
  command: plainText.default(''), args: z.array(plainText).max(100).default([]),
  cwd: plainText.default(''), endpoint: plainText.default(''),
  enabled: z.boolean().default(true), autoConnect: z.boolean().default(false),
  timeout: z.number().int().min(1000).max(180_000).default(60_000),
  disabledTools: z.array(z.string().min(1).max(256)).max(1000).default([]),
  hasCredentials: z.boolean().default(false),
  auth: z.enum(['bearer', 'none', 'oauth']).default('bearer'),
  oauthClientId: z.string().max(1024).default(''), oauthIssuer: plainText.default(''),
  oauthScope: z.string().max(2000).default(''), oauthRedirectPort: z.number().int().min(0).max(65535).default(0),
}).superRefine((server, context) => {
  if (server.transport === 'stdio') {
    if (!server.command.trim()) context.addIssue({ code: 'custom', path: ['command'], message: 'Enter a program to launch' });
    if (server.auth === 'oauth') context.addIssue({ code: 'custom', path: ['auth'], message: 'OAuth is supported for HTTP and SSE servers' });
  } else {
    try {
      const url = new URL(server.endpoint);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error();
    } catch { context.addIssue({ code: 'custom', path: ['endpoint'], message: 'Use an HTTP or HTTPS URL without embedded credentials or fragments' }); }
  }
  if (server.auth === 'oauth' && server.oauthClientId) {
    try { const issuer = new URL(server.oauthIssuer); if (!['http:', 'https:'].includes(issuer.protocol) || issuer.username || issuer.password) throw new Error(); }
    catch { context.addIssue({ code: 'custom', path: ['oauthIssuer'], message: 'Enter the authorization server URL for a pre-registered client' }); }
  }
});
export const mcpCredentialsSchema = z.object({
  token: z.string().max(16_000).optional(),
  clientSecret: z.string().max(16_000).optional(),
  env: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), plainText).refine((env) => Object.keys(env).length <= 100).optional(),
});
export const skillSchema = z.object({
  id: z.uuid(), name: z.string().min(1).max(100), description: z.string().max(2000),
  enabled: z.boolean().default(true), importedAt: z.number().int().nonnegative(),
});
export type McpServer = z.infer<typeof mcpServerSchema>;
export type McpCredentials = z.infer<typeof mcpCredentialsSchema>;
export type Skill = z.infer<typeof skillSchema>;
export type McpTool = { name: string; description: string; parameters: Record<string, unknown> };
export type McpResource = { uri: string; name: string; description: string; mimeType?: string };
export type McpResourceTemplate = { uriTemplate: string; name: string; description: string; mimeType?: string };
export type McpPrompt = { name: string; description: string; arguments: { name: string; description: string; required: boolean }[] };
export type McpCatalog = { resources: McpResource[]; templates: McpResourceTemplate[]; prompts: McpPrompt[] };
export type McpContent = { title: string; text: string; binaryItems: { uri: string; mimeType?: string; bytes: number }[] };
export type McpView = { id: string; status: 'disconnected' | 'connecting' | 'connected' | 'error' | 'auth-required' | 'authorizing'; error?: string; tools: McpTool[]; resourceSubscriptionsSupported?: boolean; subscribedResources?: string[] };
export type McpResourceUpdate = { id: string; uri: string };
export type SkillDocument = { instructions: string; files: string[]; directory: string };
export const skillBundleSchema = z.object({
  id: z.uuid(), files: z.array(z.object({ path: z.string().min(1).max(4096), base64: z.string().max(2_666_672) })).max(1000),
});
export type SkillBundle = z.infer<typeof skillBundleSchema>;
