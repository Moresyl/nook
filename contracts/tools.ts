import { z } from 'zod';

export const toolCallSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(80),
  arguments: z.string().max(64_000),
});
export const toolActivitySchema = z.object({
  id: z.string().min(1).max(128), name: z.string().min(1).max(80),
  displayName: z.string().max(512).optional(),
  input: z.string().max(64_000), output: z.string().max(64_000),
  status: z.enum(['waiting', 'running', 'complete', 'error', 'stopped']),
  startedAt: z.number().int().nonnegative(), finishedAt: z.number().int().nonnegative().optional(),
});
export type ToolCall = z.infer<typeof toolCallSchema>;
export type ToolActivity = z.infer<typeof toolActivitySchema>;
export type ToolDefinition = { name: string; description: string; parameters: Record<string, unknown>; strict?: boolean; displayName?: string };
export type ToolResult = { callId: string; output: string; error: boolean };
export type ConversationMode = 'chat' | 'plan' | 'agent';
export type ApprovalDetails = { kind: 'file'; root: string; path: string; exists: boolean; before: string; after: string }
  | { kind: 'command'; program: string; args: string[]; cwd: string; timeout: number }
  | { kind: 'mcp'; serverId: string; serverName: string; toolName: string; arguments: string }
  | { kind: 'plugin'; pluginId: string; pluginName: string; toolName: string; arguments: string };
export type ApprovalRequest = { id: string; threadId: string; messageId: string; toolName: string; details: ApprovalDetails; createdAt: number };
export type ToolExecutionContext = { approve(details: ApprovalDetails): Promise<boolean>; onProgress(output: string): void };
