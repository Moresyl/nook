import { realpath, stat } from 'node:fs/promises';
import { worktreeRegistrationSchema } from '../../contracts/worktree-registration';
import { worktreeNavigationProject } from '../../contracts/worktree-navigation';
import { worktreePathKey } from '../../contracts/worktree-overview';
import type { GitWorktree } from '../../contracts/project-worktrees';
import type { WorkspaceVault } from './vault';

export async function registerWorktreeProject(vault: Pick<WorkspaceVault, 'project' | 'update'>, readWorktrees: (root: string) => Promise<GitWorktree[]>, raw: unknown) {
  const input = worktreeRegistrationSchema.parse(raw);
  const registered = vault.project(input.source.projectId);
  const source = worktreeNavigationProject({ projects: registered ? [registered] : [] }, input.source);
  let trees: GitWorktree[];
  try { trees = await readWorktrees(source.path); }
  catch { throw new Error('The worktree list could not be read. Refresh the worktree list.'); }
  const tree = trees.find(tree => worktreePathKey(tree.path) === worktreePathKey(input.path));
  if (!tree || tree.bare || tree.prunable !== undefined || !tree.head) throw new Error('The selected worktree is no longer available. Refresh the worktree list.');
  let path: string;
  try { path = await realpath(tree.path); if (!(await stat(path)).isDirectory()) throw new Error(); }
  catch { throw new Error('The selected worktree folder is unavailable. Refresh the worktree list.'); }
  if (worktreePathKey(path) !== worktreePathKey(tree.path)) throw new Error('The selected worktree folder changed. Refresh the worktree list.');
  let actual: GitWorktree[];
  try { actual = await readWorktrees(path); }
  catch { throw new Error('The selected worktree repository is unavailable. Refresh the worktree list.'); }
  const current = actual.find(item => worktreePathKey(item.path) === worktreePathKey(path));
  if (!trees[0] || !actual[0] || worktreePathKey(trees[0].path) !== worktreePathKey(actual[0].path) || !current?.head || current.bare || current.prunable !== undefined) throw new Error('The selected worktree repository changed. Refresh the worktree list.');
  return vault.update(draft => {
    worktreeNavigationProject(draft, input.source);
    if (draft.projects.some(project => project.id === input.projectId && worktreePathKey(project.path) !== worktreePathKey(path))) throw new Error('This project identifier is already in use. Refresh the worktree list.');
    if (draft.projects.some(project => worktreePathKey(project.path) === worktreePathKey(path))) return;
    draft.projects.push({ id: input.projectId, name: input.name, path, instructions: '', createdAt: Date.now() });
  });
}
