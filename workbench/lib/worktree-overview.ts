import type { GitWorktree } from '../../contracts/project-worktrees';
import type { Project } from '../../contracts/workspace';
import type { WorktreeSnapshot } from '../../contracts/worktree-overview';

export async function loadWorktreeOverview(projects: readonly Project[], read: (id: string) => Promise<GitWorktree[]>, active: () => boolean, progress?: (snapshots: WorktreeSnapshot[]) => void): Promise<WorktreeSnapshot[]> {
  const snapshots: WorktreeSnapshot[] = [];
  for (const project of projects) {
    if (!active()) break;
    let trees: GitWorktree[] = [], failed = false;
    try { trees = await read(project.id); }
    catch { failed = true; }
    if (!active()) break;
    snapshots.push({ projectId: project.id, projectPath: project.path, trees, failed });
    progress?.(snapshots.slice());
  }
  return snapshots;
}
