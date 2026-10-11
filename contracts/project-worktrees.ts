import { z } from 'zod';
import { gitBranchNameSchema, type GitBranches } from './projects';

const pathSchema = z.string().min(1).max(4096).refine(value => !/[\x00-\x1f\x7f]/.test(value), 'Enter a valid worktree folder path.');
export const worktreeUpstreamPolicySchema = z.enum(['best-effort', 'never']);
export type WorktreeUpstreamPolicy = z.infer<typeof worktreeUpstreamPolicySchema>;
export const worktreePreferencesSchema = z.object({
  root: z.string().max(4096).refine(value => value === '' || (!/[\x00-\x1f\x7f]/.test(value) && (/^[A-Za-z]:[\\/]/.test(value) || /^\/(?!\/)/.test(value) || /^[\\/]{2}[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/.test(value))), 'Enter an absolute worktree root folder path.').default(''),
  upstreamRefresh: worktreeUpstreamPolicySchema.optional(),
}).strict();
export const createWorktreeSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('new'), path: pathSchema, branch: gitBranchNameSchema, baseBranch: gitBranchNameSchema.optional() }).strict(),
  z.object({ mode: z.literal('existing'), path: pathSchema, branch: gitBranchNameSchema }).strict(),
]);
export type CreateWorktree = z.infer<typeof createWorktreeSchema>;
export type GitWorktree = { path: string; head?: string; branch?: string; detached: boolean; bare: boolean; locked?: string; prunable?: string };
export type WorktreeCreated = { worktree: GitWorktree; branches: GitBranches; warning?: 'post-add-error'; upstreamRefresh?: 'fetched' | 'not-configured' | 'failed'; managedRecord?: 'saved' | 'failed' };
