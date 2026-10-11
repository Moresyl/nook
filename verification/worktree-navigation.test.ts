import { describe, expect, it } from 'vitest';
import type { Project } from '../contracts/workspace';
import { worktreeNavigationConversation, worktreeNavigationError, worktreeNavigationProject } from '../contracts/worktree-navigation';
import { worktreePathKey } from '../contracts/worktree-overview';
import { sampleThread } from './fixtures';

const project: Project = { id: 'project', name: '中文项目', path: 'E:/Trees/中文', instructions: '', createdAt: 1 };
const target = { projectId: project.id, path: project.path, threadId: 'chat' };

describe('worktree navigation targets', () => {
  it.each([
    ['The linked worktree project changed. Refresh the worktree list.', '关联项目已变更，请刷新工作树列表后重试。'],
    ['The linked worktree conversation changed. Refresh the worktree list.', '关联会话已变更，请刷新工作树列表后重试。'],
    ['The current chat changed. Retry the worktree navigation.', '当前聊天已变更，请重新打开项目聊天。'],
    ["Error invoking remote method 'qiyao:invoke': Error: Local data could not be saved. Check disk space and directory permissions.", '本地数据未能保存。请检查磁盘空间和文件夹权限，再重试。'],
    ['PRIVATE_KEY SECRET_PATH fixture', '未能打开项目聊天，请重试。'],
  ])('presents a safe navigation error for %s', (message, expected) => {
    expect(worktreeNavigationError(new Error(message))).toBe(expected);
  });
  it.each([null, undefined, 42, { message: 'PRIVATE_KEY SECRET_PATH' }, 'PRIVATE_KEY SECRET_PATH'])('sanitizes unrecognized error values: %s', problem => {
    expect(worktreeNavigationError(problem)).toBe('未能打开项目聊天，请重试。');
  });
  it('retains the actual project and conversation identities without mutating their context', () => {
    const thread = sampleThread({ id: target.threadId, projectId: project.id, pinned: true, archived: true });
    const state = { projects: [project], threads: [thread] }, original = structuredClone(state);
    expect(worktreeNavigationProject(state, target)).toBe(project);
    expect(worktreeNavigationConversation(state, target)).toBe(thread); expect(state).toEqual(original);
  });
  it('matches canonical Windows and UNC path variants while preserving Unix case', () => {
    expect(worktreeNavigationProject({ projects: [project] }, { ...target, path: 'e:\\TREES\\中文\\' })).toBe(project);
    expect(worktreePathKey('E:/')).toBe('e:'); expect(worktreePathKey('\\\\SERVER\\SHARE\\')).toBe('//server/share');
    expect(worktreePathKey('/Trees')).not.toBe(worktreePathKey('/trees'));
  });
  it.each([{ projects: [] }, { projects: [{ ...project, id: 'other' }] }, { projects: [{ ...project, path: 'E:/Other' }] }])('rejects removed or relocated projects: %s', ({ projects }) => {
    expect(() => worktreeNavigationProject({ projects }, target)).toThrow('project changed');
    expect(() => worktreeNavigationConversation({ projects, threads: [sampleThread({ id: target.threadId, projectId: project.id })] }, target)).toThrow('project changed');
  });
  it.each([
    { threads: [] }, { threads: [sampleThread({ id: 'other', projectId: project.id })] },
    { threads: [sampleThread({ id: target.threadId, projectId: project.id, temporary: true })] },
    { threads: [sampleThread({ id: target.threadId, projectId: 'other' })] }, { threads: [sampleThread({ id: target.threadId })] },
  ])('rejects missing, temporary and reassigned conversation targets: %s', ({ threads }) => {
    expect(() => worktreeNavigationConversation({ projects: [project], threads }, target)).toThrow('conversation changed');
  });
  it('does not substitute an identically named project or conversation for the selected identity', () => {
    const duplicate = { ...project, id: 'duplicate' }, thread = sampleThread({ id: 'chat', projectId: duplicate.id });
    expect(() => worktreeNavigationConversation({ projects: [project, duplicate], threads: [thread] }, target)).toThrow('conversation changed');
  });
});
