import { z } from 'zod';
import { ownedWorktreePathSchema, worktreeOwnershipSourceSchema } from './worktree-ownership';
import type { WorktreeSnapshotSummary } from './worktree-snapshots';
import type { WorktreeOwnershipSource } from './worktree-ownership';
import { uiErrorMessage } from './ui-errors';

export const removeManagedWorktreeSchema = z.object({ source: worktreeOwnershipSourceSchema, path: ownedWorktreePathSchema, receiptId: z.uuid() }).strict();
export type RemoveManagedWorktree = z.infer<typeof removeManagedWorktreeSchema>;
export type WorktreeRemoved = { path: string; snapshot: WorktreeSnapshotSummary; managedRecord: 'saved' | 'failed' };
export { worktreeKeepCountSchema } from './project-worktrees';
export type WorktreeCleanupResult = { removed: WorktreeRemoved[]; skipped: number; considered: number };
export type WorktreeCleanupReport = { source: WorktreeOwnershipSource; removed: number; skipped: number; receiptFailures: number; completedAt: number; failed: boolean };

const removalErrors = new Map([
  ['The workspace is busy. Retry worktree cleanup after current actions finish.', '工作区正在处理其他操作，请完成后重试。'],
  ['A response or terminal is active. Stop it before removing a worktree.', '请先停止正在运行的回复与终端，再删除工作树。'],
  ['This worktree has modified, untracked or ignored files. Its files were retained. Commit or move them before removing the folder.', '工作树包含修改、未跟踪或忽略文件，文件已保留。请先提交或移走这些文件，再重试。'],
  ['This worktree is registered as a project. Remove the project entry before removing its folder.', '请先在项目页移除该项目，再删除工作树目录。'],
  ['Unsaved editor drafts or a pinned conversation still need protection. Resolve them before removing a worktree.', '请先保存或丢弃文件草稿，并处理仍关联已移除项目的固定聊天，再重试。'],
  ['The private snapshot could not be saved. Worktree files were retained.', '未能保存删除前快照，工作树文件已保留。请检查磁盘空间和权限，再重试。'],
]);
export function worktreeRemovalError(problem: unknown): string {
  const message = uiErrorMessage(problem);
  return ['关联项目已变更，请刷新工作树列表后重试。', '工作区正在处理其他操作，请完成后重试。'].includes(message) ? message : removalErrors.get(message) ?? '删除未完成。请刷新检查工作树与已保存快照；如目录已有变化，请先保留现有文件再重试。';
}
