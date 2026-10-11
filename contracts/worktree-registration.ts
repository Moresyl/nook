import { z } from 'zod';
import { projectSchema } from './workspace';
import { worktreePreferencesSchema } from './project-worktrees';
import { uiErrorMessage } from './ui-errors';

const path = worktreePreferencesSchema.shape.root.refine(value => value !== '', 'Choose an absolute worktree folder path.');
export const worktreeRegistrationSchema = z.object({
  source: z.object({ projectId: projectSchema.shape.id, path }).strict(),
  projectId: projectSchema.shape.id,
  name: projectSchema.shape.name.refine(value => !/[\x00-\x1f\x7f]/.test(value), 'Enter a valid project name.').transform(value => value.trim()).pipe(projectSchema.shape.name),
  path,
}).strict();
export type WorktreeRegistration = z.infer<typeof worktreeRegistrationSchema>;

export function worktreeRegistrationError(problem: unknown): string {
  const message = uiErrorMessage(problem);
  return ['关联项目已变更，请刷新工作树列表后重试。', '本地数据未能保存。请检查磁盘空间和文件夹权限，再重试。'].includes(message)
    ? message : '未能登记工作树项目。请检查文件夹与仓库，然后刷新重试。';
}
