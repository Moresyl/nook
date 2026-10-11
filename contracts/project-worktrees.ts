import { z } from 'zod';
import { gitBranchNameSchema, type GitBranches } from './projects';

const pathSchema = z.string().min(1).max(4096).refine(value => !/[\x00-\x1f\x7f]/.test(value), 'Enter a valid worktree folder path.');
export const createWorktreeSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('new'), path: pathSchema, branch: gitBranchNameSchema, baseBranch: gitBranchNameSchema.optional() }).strict(),
  z.object({ mode: z.literal('existing'), path: pathSchema, branch: gitBranchNameSchema }).strict(),
]);
export type CreateWorktree = z.infer<typeof createWorktreeSchema>;
export type GitWorktree = { path: string; head?: string; branch?: string; detached: boolean; bare: boolean; locked?: string; prunable?: string };
export type WorktreeCreated = { worktree: GitWorktree; branches: GitBranches; warning?: 'post-add-error' };
