import { describe, expect, it, vi } from 'vitest';
import type { GitWorktree } from '../contracts/project-worktrees';
import type { Project } from '../contracts/workspace';
import { worktreeOverviewGroups, worktreeOverviewPage, worktreeOverviewPageSize, type WorktreeSnapshot } from '../contracts/worktree-overview';
import { loadWorktreeOverview } from '../workbench/lib/worktree-overview';
import { sampleThread } from './fixtures';

const project = (id = 'source', path = 'E:/Repo'): Project => ({ id, name: `项目 ${id}`, path, instructions: '', createdAt: 1 });
const tree = (path = 'E:/Repo', branch = 'main'): GitWorktree => ({ path, branch, head: 'a'.repeat(40), detached: false, bare: false });
const snapshot = (owner: Project, trees = [tree(owner.path)], failed = false): WorktreeSnapshot => ({ projectId: owner.id, projectPath: owner.path, trees, failed });

describe('worktree overview paging', () => {
  it('bounds each page and retains project order without changing the original list', () => {
    const projects = Array.from({ length: 41 }, (_, index) => project(String(index), `E:/repo-${index}`));
    const original = structuredClone(projects);
    expect(worktreeOverviewPageSize).toBe(20);
    expect(worktreeOverviewPage(projects, 0).map(item => item.id)).toEqual(projects.slice(0, 20).map(item => item.id));
    expect(worktreeOverviewPage(projects, 1).map(item => item.id)).toEqual(projects.slice(20, 40).map(item => item.id));
    expect(worktreeOverviewPage(projects, 2).map(item => item.id)).toEqual(['40']);
    expect(worktreeOverviewPage(projects, 3)).toEqual([]); expect(projects).toEqual(original);
  });
  it.each([-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])('rejects an invalid page: %s', page => {
    expect(() => worktreeOverviewPage([project()], page)).toThrow('valid worktree overview page');
  });
  it('handles an empty list and a safe page far beyond the last project', () => {
    expect(worktreeOverviewPage([], 0)).toEqual([]);
    expect(worktreeOverviewPage([project()], Number.MAX_SAFE_INTEGER)).toEqual([]);
  });
});

describe('worktree overview association', () => {
  it('groups actual repeated repository snapshots and joins conversations from all registered worktree projects', () => {
    const source = project(), child = project('child', 'E:/Trees/中文'), duplicate = project('duplicate', 'e:\\TREES\\中文\\');
    const trees = [tree(), tree(child.path, 'feature/中文')];
    const threads = [sampleThread({ id: 'source-chat', projectId: source.id }), sampleThread({ id: 'child-chat', projectId: child.id }), sampleThread({ id: 'duplicate-chat', projectId: duplicate.id })];
    const groups = worktreeOverviewGroups([source, child, duplicate], threads, [snapshot(source, trees), snapshot(child, trees)]);
    expect(groups).toHaveLength(1); expect(groups[0].projectIds).toEqual(['source', 'child']); expect(groups[0].rows).toHaveLength(2);
    expect(groups[0].rows[0].conversations.map(item => item.id)).toEqual(['source-chat']);
    expect(groups[0].rows[1].projects.map(item => item.id)).toEqual(['child', 'duplicate']);
    expect(groups[0].rows[1].conversations.map(item => item.id)).toEqual(['child-chat', 'duplicate-chat']);
  });
  it('excludes temporary and unrelated chats while retaining archived chats and ordering pins before recency', () => {
    const source = project();
    const threads = [sampleThread({ id: 'latest', projectId: source.id, updatedAt: 100 }), sampleThread({ id: 'pin', projectId: source.id, pinned: true, updatedAt: 2 }), sampleThread({ id: 'archive', projectId: source.id, archived: true, updatedAt: 20 }), sampleThread({ id: 'temporary', projectId: source.id, temporary: true, updatedAt: 200 }), sampleThread({ id: 'global' }), sampleThread({ id: 'other', projectId: 'other' })];
    const original = structuredClone(threads);
    const result = worktreeOverviewGroups([source], threads, [snapshot(source)]);
    expect(result[0].rows[0].conversations.map(item => item.id)).toEqual(['pin', 'latest', 'archive']); expect(threads).toEqual(original);
  });
  it('shows unregistered worktrees without inventing projects or conversations', () => {
    const source = project(); const groups = worktreeOverviewGroups([source], [], [snapshot(source, [tree(), tree('E:/Unregistered', 'feature/free')])]);
    expect(groups[0].rows[1]).toMatchObject({ projects: [], conversations: [], tree: { path: 'E:/Unregistered' } });
  });
  it('retains bare, detached, locked and unavailable metadata including empty reason strings', () => {
    const source = project(); const metadata: GitWorktree = { path: source.path, detached: true, bare: true, locked: '', prunable: '' };
    expect(worktreeOverviewGroups([source], [], [snapshot(source, [metadata])])[0].rows[0].tree).toEqual(metadata);
  });
  it('does not combine distinct Unix paths merely because their casing differs', () => {
    const lower = project('lower', '/repo'), upper = project('upper', '/Repo');
    const groups = worktreeOverviewGroups([lower, upper], [], [snapshot(lower), snapshot(upper)]);
    expect(groups).toHaveLength(2); expect(groups[0].rows[0].projects.map(item => item.id)).toEqual(['lower']);
  });
  it('matches case-insensitive UNC paths while retaining their exact displayed spelling', () => {
    const owner = project('owner', '\\\\SERVER\\Share\\Repo'), another = project('another', '//server/share/repo/');
    const result = worktreeOverviewGroups([owner, another], [], [snapshot(owner)]);
    expect(result[0].path).toBe(owner.path); expect(result[0].rows[0].projects.map(item => item.id)).toEqual(['owner', 'another']);
  });
  it('matches Windows drive roots case-insensitively without combining them with the Unix root', () => {
    const upper = project('upper', 'C:/'), lower = project('lower', 'c:\\'), unix = project('unix', '/');
    const result = worktreeOverviewGroups([upper, lower, unix], [], [snapshot(upper), snapshot(lower), snapshot(unix)]);
    expect(result).toHaveLength(2); expect(result[0].rows[0].projects.map(item => item.id)).toEqual(['upper', 'lower']); expect(result[1].rows[0].projects.map(item => item.id)).toEqual(['unix']);
  });
  it('ignores unknown owners and snapshots from an earlier project path', () => {
    const owner = project(), changed = { ...owner, path: 'E:/NewRepository' };
    expect(worktreeOverviewGroups([owner], [], [snapshot(project('unknown'))])).toEqual([]);
    expect(worktreeOverviewGroups([changed], [], [snapshot(owner)])).toEqual([]);
  });
  it('keeps a failed project visible alongside successful repository reads', () => {
    const source = project(), failed = project('failed', 'E:/Missing');
    const groups = worktreeOverviewGroups([source, failed], [], [snapshot(source), snapshot(failed, [], true)]);
    expect(groups).toHaveLength(2); expect(groups[1]).toEqual({ path: failed.path, name: failed.name, projectIds: [failed.id], rows: [], failed: true });
  });
  it('handles empty snapshots and Git lists without synthesizing files or mutating inputs', () => {
    const owner = project(), snapshots = [snapshot(owner, [])], original = structuredClone(snapshots);
    expect(worktreeOverviewGroups([owner], [], [])).toEqual([]);
    expect(worktreeOverviewGroups([owner], [], snapshots)[0].rows).toEqual([]); expect(snapshots).toEqual(original);
  });
  it('deduplicates repeated Windows rows and snapshots but preserves the first returned path', () => {
    const owner = project(), rows = [tree('E:/Repo'), tree('e:\\repo\\')];
    const groups = worktreeOverviewGroups([owner], [], [snapshot(owner, rows), snapshot(owner, rows)]);
    expect(groups[0].projectIds).toEqual([owner.id]); expect(groups[0].rows).toHaveLength(1); expect(groups[0].rows[0].tree.path).toBe('E:/Repo');
  });
});

describe('serial cancellable worktree reads', () => {
  it('loads only one repository at a time and retains the original project path receipt', async () => {
    const projects = [project('first'), project('second', 'E:/Other')];
    let release!: (value: GitWorktree[]) => void;
    const held = new Promise<GitWorktree[]>(resolve => { release = resolve; });
    const read = vi.fn().mockReturnValueOnce(held).mockResolvedValueOnce([tree(projects[1].path)]);
    const pending = loadWorktreeOverview(projects, read, () => true);
    expect(read.mock.calls).toEqual([['first']]); release([tree()]);
    const results = await pending; expect(read.mock.calls).toEqual([['first'], ['second']]); expect(results.map(item => item.projectPath)).toEqual(projects.map(item => item.path));
  });
  it('continues after a failed repository and omits raw error details', async () => {
    const projects = [project('first'), project('second', 'E:/Other')];
    const read = vi.fn().mockRejectedValueOnce(new Error('PRIVATE_KEY SECRET_PATH')).mockResolvedValueOnce([tree(projects[1].path)]);
    const result = await loadWorktreeOverview(projects, read, () => true);
    expect(result[0]).toEqual({ projectId: 'first', projectPath: projects[0].path, trees: [], failed: true }); expect(result[1].failed).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_KEY|SECRET_PATH/);
  });
  it('publishes completed repositories before the next held read resolves without mutating earlier progress arrays', async () => {
    const projects = [project('first'), project('second', 'E:/Other')];
    let release!: (value: GitWorktree[]) => void;
    const held = new Promise<GitWorktree[]>(resolve => { release = resolve; });
    const progress = vi.fn(), read = vi.fn().mockResolvedValueOnce([tree()]).mockReturnValueOnce(held);
    const pending = loadWorktreeOverview(projects, read, () => true, progress);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(progress).toHaveBeenCalledTimes(1);
    const first = progress.mock.calls[0][0];
    expect(first.map((item: WorktreeSnapshot) => item.projectId)).toEqual(['first']);
    release([tree('E:/Other')]); const result = await pending;
    expect(progress).toHaveBeenCalledTimes(2); expect(progress.mock.calls[1][0]).toEqual(result);
    expect(first).toHaveLength(1); expect(progress.mock.calls[1][0]).not.toBe(result);
  });
  it('publishes a sanitized failure immediately while the next repository is still loading', async () => {
    let release!: (value: GitWorktree[]) => void;
    const held = new Promise<GitWorktree[]>(resolve => { release = resolve; });
    const read = vi.fn().mockRejectedValueOnce(new Error('PRIVATE_KEY SECRET_PATH')).mockReturnValueOnce(held), progress = vi.fn();
    const pending = loadWorktreeOverview([project('first'), project('second')], read, () => true, progress);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(progress.mock.calls[0][0]).toEqual([{ projectId: 'first', projectPath: 'E:/Repo', trees: [], failed: true }]);
    expect(JSON.stringify(progress.mock.calls)).not.toMatch(/PRIVATE_KEY|SECRET_PATH/);
    release([]); await pending;
  });
  it('stops before the next project when the progress observer closes the owner', async () => {
    let active = true;
    const read = vi.fn().mockResolvedValue([tree()]), progress = vi.fn(() => { active = false; });
    const result = await loadWorktreeOverview([project(), project('next')], read, () => active, progress);
    expect(result).toHaveLength(1); expect(read).toHaveBeenCalledTimes(1); expect(progress).toHaveBeenCalledTimes(1);
  });
  it('does not start reads for an already closed owner', async () => {
    const read = vi.fn(); expect(await loadWorktreeOverview([project()], read, () => false)).toEqual([]); expect(read).not.toHaveBeenCalled();
  });
  it.each([false, true])('ignores a late %s failure/success receipt after close and never starts the next project', async failed => {
    let active = true, release!: (value: GitWorktree[]) => void, reject!: (error: Error) => void;
    const held = new Promise<GitWorktree[]>((resolve, fail) => { release = resolve; reject = fail; });
    const read = vi.fn().mockReturnValue(held), progress = vi.fn(), pending = loadWorktreeOverview([project(), project('next')], read, () => active, progress);
    active = false; if (failed) reject(new Error('PRIVATE fixture error')); else release([tree()]);
    expect(await pending).toEqual([]); expect(read).toHaveBeenCalledTimes(1); expect(progress).not.toHaveBeenCalled();
  });
  it('returns no receipts for an empty project page', async () => {
    const read = vi.fn(), progress = vi.fn(); expect(await loadWorktreeOverview([], read, () => true, progress)).toEqual([]); expect(read).not.toHaveBeenCalled(); expect(progress).not.toHaveBeenCalled();
  });
});
