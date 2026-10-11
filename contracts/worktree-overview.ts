import type { GitWorktree } from './project-worktrees';
import type { Project, Thread } from './workspace';

export const worktreeOverviewPageSize = 20;
export type WorktreeSnapshot = { projectId: string; projectPath: string; trees: GitWorktree[]; failed: boolean };
export type WorktreeOverviewRow = { tree: GitWorktree; projects: Project[]; conversations: Thread[] };
export type WorktreeOverviewGroup = { path: string; name: string; projectIds: string[]; rows: WorktreeOverviewRow[]; failed: boolean };

function pathKey(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/\/+$/, '') || '/';
  return /^[A-Za-z]:(?:\/|$)/.test(normalized) || normalized.startsWith('//') ? normalized.toLowerCase() : normalized;
}

export function worktreeOverviewPage(projects: readonly Project[], page: number): Project[] {
  if (!Number.isSafeInteger(page) || page < 0) throw new Error('Choose a valid worktree overview page.');
  return projects.slice(page * worktreeOverviewPageSize, (page + 1) * worktreeOverviewPageSize);
}

export function worktreeOverviewGroups(projects: readonly Project[], threads: readonly Thread[], snapshots: readonly WorktreeSnapshot[]): WorktreeOverviewGroup[] {
  const groups = new Map<string, WorktreeOverviewGroup>();
  for (const snapshot of snapshots) {
    const owner = projects.find(project => project.id === snapshot.projectId);
    if (!owner || pathKey(owner.path) !== pathKey(snapshot.projectPath)) continue;
    const first = snapshot.trees[0], path = first?.path ?? owner.path;
    const key = snapshot.failed ? `error:${owner.id}` : pathKey(path);
    let group = groups.get(key);
    if (!group) { group = { path, name: owner.name, projectIds: [], rows: [], failed: snapshot.failed }; groups.set(key, group); }
    if (!group.projectIds.includes(owner.id)) group.projectIds.push(owner.id);
    if (snapshot.failed) continue;
    for (const tree of snapshot.trees) {
      if (group.rows.some(row => pathKey(row.tree.path) === pathKey(tree.path))) continue;
      const registered = projects.filter(project => pathKey(project.path) === pathKey(tree.path));
      const ids = new Set(registered.map(project => project.id));
      const conversations = threads.filter(thread => !thread.temporary && thread.projectId && ids.has(thread.projectId)).slice().sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt - left.updatedAt);
      group.rows.push({ tree: { ...tree }, projects: registered, conversations });
    }
  }
  return [...groups.values()];
}
