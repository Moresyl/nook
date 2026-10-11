import { z } from 'zod';

export const ownedWorktreePathSchema = z.string().min(1).max(4096).refine(value => !/[\x00-\x1f\x7f]/.test(value) && (/^[A-Za-z]:[\\/]/.test(value) || /^\/(?!\/)/.test(value) || /^[\\/]{2}[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/.test(value)), 'Choose an absolute worktree path.');
export const worktreePinSchema = z.object({ path: ownedWorktreePathSchema, pinned: z.boolean() }).strict();
export type ManagedWorktree = { id: string; path: string; createdAt: number; pinned: boolean; verified: boolean };
