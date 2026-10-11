import type { Project, Thread, Workspace } from './workspace';
import { worktreePathKey } from './worktree-overview';
import { uiErrorMessage } from './ui-errors';

export type WorktreeProjectTarget = { projectId: string; path: string };
export type WorktreeConversationTarget = WorktreeProjectTarget & { threadId: string };

export function worktreeNavigationError(problem: unknown): string {
  const message = uiErrorMessage(problem);
  return ['关联项目已变更，请刷新工作树列表后重试。', '关联会话已变更，请刷新工作树列表后重试。', '当前聊天已变更，请重新打开项目聊天。', '本地数据未能保存。请检查磁盘空间和文件夹权限，再重试。'].includes(message)
    ? message : '未能打开项目聊天，请重试。';
}

export function worktreeNavigationProject(state: Pick<Workspace, 'projects'>, target: WorktreeProjectTarget): Project {
  const project = state.projects.find(project => project.id === target.projectId);
  if (!project || worktreePathKey(project.path) !== worktreePathKey(target.path)) throw new Error('The linked worktree project changed. Refresh the worktree list.');
  return project;
}

export function worktreeNavigationConversation(state: Pick<Workspace, 'projects' | 'threads'>, target: WorktreeConversationTarget): Thread {
  worktreeNavigationProject(state, target);
  const thread = state.threads.find(thread => thread.id === target.threadId);
  if (!thread || thread.temporary || thread.projectId !== target.projectId) throw new Error('The linked worktree conversation changed. Refresh the worktree list.');
  return thread;
}
