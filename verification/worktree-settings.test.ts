import { describe, expect, it } from 'vitest';
import { worktreePreferencesSchema } from '../contracts/project-worktrees';
import { emptyWorkspace, preferencesSchema, workspaceSchema } from '../contracts/workspace';

describe('worktree root preferences', () => {
  it('keeps legacy preferences unchanged and uses an empty root when the section is explicitly added', () => {
    expect(preferencesSchema.parse(emptyWorkspace().preferences).worktrees).toBeUndefined();
    expect(worktreePreferencesSchema.parse({})).toEqual({ root: '' });
  });
  it.each(['', 'C:\\工作树 根目录', 'E:/', '\\\\server\\share\\工作树', '//server/share/root', '/tmp/工作树', '/'])('preserves the explicit root %j', root => {
    expect(worktreePreferencesSchema.parse({ root }).root).toBe(root);
    const workspace = emptyWorkspace(); workspace.preferences.worktrees = { root };
    expect(workspaceSchema.parse(JSON.parse(JSON.stringify(workspace))).preferences.worktrees).toEqual({ root });
  });
  it.each(['C:relative', 'C:', 'relative', '\\relative', '//server', '///folder', ' C:/root', 'C:/root\0', 'C:/root\n', 'C:/' + 'x'.repeat(4094), null, true, 42])('rejects the invalid root %j', root => {
    expect(worktreePreferencesSchema.safeParse({ root }).success).toBe(false);
    expect(preferencesSchema.safeParse({ ...emptyWorkspace().preferences, worktrees: { root } }).success).toBe(false);
  });
  it('rejects unsupported deletion or force preferences', () => {
    for (const field of ['force', 'automaticDeletion', 'fetchUpstream']) expect(worktreePreferencesSchema.safeParse({ root: 'C:/root', [field]: true }).success).toBe(false);
  });
  it('keeps cleanup disabled implicitly for legacy settings and accepts only explicit bounded cleanup settings', () => {
    expect(worktreePreferencesSchema.parse({}).autoCleanup).toBeUndefined();
    expect(worktreePreferencesSchema.parse({ autoCleanup: false, keepCount: 5 })).toEqual({ root: '', autoCleanup: false, keepCount: 5 });
    for (const keepCount of [1, 50]) expect(worktreePreferencesSchema.safeParse({ autoCleanup: true, keepCount }).success).toBe(true);
    for (const keepCount of [0, 51, 1.5, '5', NaN, Infinity]) expect(worktreePreferencesSchema.safeParse({ keepCount }).success).toBe(false);
    expect(worktreePreferencesSchema.safeParse({ autoCleanup: 'true' }).success).toBe(false);
  });
});
