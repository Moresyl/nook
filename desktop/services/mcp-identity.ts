import { createHash } from 'node:crypto';
import type { McpServer } from '../../contracts/extensions';

export function mcpToolName(serverId: string, toolName: string): string {
  const hash = (text: string) => createHash('sha256').update(text).digest('hex');
  return `mcp_${hash(serverId).slice(0, 12)}_${hash(toolName).slice(0, 24)}`;
}

export function mcpDestination(server: McpServer): string {
  if (server.transport === 'stdio') return JSON.stringify([server.transport, server.command, server.args, server.cwd]);
  // Keep existing static-token fingerprints compatible with earlier workspaces.
  return JSON.stringify(server.auth === 'bearer' ? [server.transport, server.endpoint] : [server.transport, server.endpoint,
    server.auth, server.oauthClientId, server.oauthIssuer, server.oauthScope, server.oauthRedirectPort]);
}
