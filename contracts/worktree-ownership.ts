import { z } from 'zod';
import { uiErrorMessage } from './ui-errors';
import { projectSchema } from './workspace';

export const ownedWorktreePathSchema = z.string().min(1).max(4096).refine(value => !/[\x00-\x1f\x7f]/.test(value) && (/^[A-Za-z]:[\\/]/.test(value) || /^\/(?!\/)/.test(value) || /^[\\/]{2}[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/.test(value)), 'Choose an absolute worktree path.');
export const worktreePinSchema = z.object({ path: ownedWorktreePathSchema, pinned: z.boolean() }).strict();
export const worktreeOwnershipSourceSchema = z.object({ projectId: projectSchema.shape.id, path: ownedWorktreePathSchema }).strict();
export const worktreePinRequestSchema = worktreePinSchema.extend({ source: worktreeOwnershipSourceSchema });
export type WorktreeOwnershipSource = z.infer<typeof worktreeOwnershipSourceSchema>;
export type WorktreePinRequest = z.infer<typeof worktreePinRequestSchema>;
export type ManagedWorktree = { id: string; path: string; createdAt: number; pinned: boolean; verified: boolean; conversationIds?: string[] };

export function worktreePinError(problem: unknown): string {
  const message = uiErrorMessage(problem);
  return message === '关联项目已变更，请刷新工作树列表后重试。' ? message : '未能保存工作树固定状态。请刷新列表后重试。';
}
