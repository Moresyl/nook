import { describe, expect, it } from 'vitest';
import type { ToolActivity } from '../contracts/tools';
import { toolActivityExpanded, toolActivitySummary, toggleToolActivity, type ToolDisclosure } from '../workbench/components/tool-activity-state';

const activity = (overrides: Partial<ToolActivity> = {}): ToolActivity => ({ id: 'activity', name: 'read_file', input: '{"path":"src/中文 😀.ts"}', output: '', status: 'running', startedAt: 1000, ...overrides });
describe('tool activity presentation', () => {
  it.each([
    ['list_files', '查看项目文件', 'folder'], ['read_file', '读取文件', 'file'], ['search_files', '搜索项目', 'search'],
    ['git_diff', '查看 Git 改动', 'branch'], ['write_file', '保存文件', 'save'], ['edit_file', '修改文件', 'compose'],
    ['run_command', '执行命令', 'code'], ['load_skill', '读取技能说明', 'library'], ['read_skill_file', '读取技能文件', 'file'],
    ['update_plan', '更新任务步骤', 'list'],
  ])('labels native tool %s', (name, label, icon) => { expect(toolActivitySummary(activity({ name }))).toMatchObject({ label, icon, status: '执行中', duration: null }); });
  it('summarizes paths/search without changing inputs or interpreting external schemas', () => {
    const value = activity({ name: 'search_files', input: '{"query":"a\\nb", "path":" src/文件 夹 "}' });
    expect(toolActivitySummary(value).detail).toBe('a b · src/文件 夹'); expect(value.input).toContain('a\\nb');
    expect(toolActivitySummary(activity()).detail).toBe('src/中文 😀.ts');
    expect(toolActivitySummary(activity({ name: 'search_files', input: '{"query":"only"}' })).detail).toBe('only');
    expect(toolActivitySummary(activity({ name: 'external_read', displayName: ' 自定义连接 ', input: value.input }))).toMatchObject({ label: '自定义连接', detail: '', icon: 'code' });
  });
  it.each(['constructor', '__proto__', 'toString', 'external'])('does not inherit a native label for %s', name => { expect(toolActivitySummary(activity({ name, displayName: ' ' }))).toMatchObject({ label: name, detail: '', icon: 'code' }); });
  it.each(['bad json', 'null', '[]', '1', '"path"', '{"path":false}', '{}'])('tolerates malformed or non-string input %s', input => { expect(toolActivitySummary(activity({ input })).detail).toBe(''); });
  it('quotes actual command arguments and preserves significant spaces and control characters', () => {
    const input = JSON.stringify({ program: 'C:/a  b/node.exe', args: ['a b', '中文😀', '\n', '"', '$(literal)'] });
    expect(toolActivitySummary(activity({ name: 'run_command', input })).detail).toBe('"C:/a  b/node.exe" "a b" "中文😀" "\\n" "\\\"" "$(literal)"');
    expect(toolActivitySummary(activity({ name: 'run_command', input: '{"program":"git","args":[]}' })).detail).toBe('"git"');
    for (const bad of [{ args: [] }, { program: 'git' }, { program: 1, args: [] }, { program: 'git', args: [1] }]) expect(toolActivitySummary(activity({ name: 'run_command', input: JSON.stringify(bad) })).detail).toBe('');
  });
  it.each([
    ['waiting', '等待审批', 'clock', null], ['running', '执行中', 'file', null], ['complete', '已完成', 'check', '1.5 秒'], ['error', '失败', 'close', '1.5 秒'], ['stopped', '已停止', 'stop', '1.5 秒'],
  ] as const)('uses explicit %s status even when output contains contradictory words', (status, label, icon, duration) => { expect(toolActivitySummary(activity({ status, finishedAt: 2500, output: 'error success stopped' }))).toMatchObject({ status: label, icon, duration }); });
  it('omits invalid elapsed time, supports zero and never treats missing timestamps as finished', () => {
    for (const finishedAt of [undefined, 999, Infinity, NaN]) expect(toolActivitySummary(activity({ status: 'complete', finishedAt })).duration).toBeNull();
    expect(toolActivitySummary(activity({ status: 'complete', finishedAt: 1000 })).duration).toBe('0.0 秒');
  });
});
describe('tool disclosure choices', () => {
  it('keeps live and settled choices independent through status changes', () => {
    const initial: ToolDisclosure = { running: true, settled: false };
    expect(toolActivityExpanded('running', initial)).toBe(true);
    for (const status of ['waiting', 'complete', 'error', 'stopped'] as const) expect(toolActivityExpanded(status, initial)).toBe(false);
    const collapsed = toggleToolActivity('running', initial); expect(collapsed).toEqual({ running: false, settled: false });
    const settled = toggleToolActivity('complete', collapsed); expect(settled).toEqual({ running: false, settled: true });
    expect(toolActivityExpanded('running', settled)).toBe(false); expect(toolActivityExpanded('error', settled)).toBe(true); expect(initial).toEqual({ running: true, settled: false });
    expect(toggleToolActivity('running', settled)).toEqual({ running: true, settled: true });
    for (const status of ['waiting', 'error', 'stopped'] as const) expect(toggleToolActivity(status, settled)).toEqual(collapsed);
  });
});
