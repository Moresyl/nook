import { worktreeOwnershipSourceSchema, worktreePinRequestSchema, type WorktreeOwnershipSource } from '../../contracts/worktree-ownership';
import { worktreeNavigationProject } from '../../contracts/worktree-navigation';
import type { WorkspaceVault } from './vault';
import type { WorktreeOwnership } from './worktree-ownership';

type Projects = Pick<WorkspaceVault, 'project'>;
type Ownership = Pick<WorktreeOwnership, 'list' | 'setPinned'>;
function currentProject(vault: Projects, source: WorktreeOwnershipSource) {
  const project = vault.project(source.projectId);
  return worktreeNavigationProject({ projects: project ? [project] : [] }, source);
}

export async function managedWorktrees(vault: Projects, ownership: Ownership, raw: unknown) {
  const source = worktreeOwnershipSourceSchema.parse(raw);
  const records = await ownership.list(currentProject(vault, source).path);
  currentProject(vault, source);
  return records;
}

export async function setWorktreePinned(vault: Projects, ownership: Ownership, raw: unknown): Promise<void> {
  const input = worktreePinRequestSchema.parse(raw);
  const root = currentProject(vault, input.source).path;
  await ownership.setPinned(root, { path: input.path, pinned: input.pinned }, () => { currentProject(vault, input.source); });
}
