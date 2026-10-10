import type { ToolActivity } from '../../contracts/tools';
import type { GlyphName } from './glyphs';

const tools: Record<string, { label: string; icon: GlyphName }> = {
  list_files: { label: '查看项目文件', icon: 'folder' }, read_file: { label: '读取文件', icon: 'file' }, search_files: { label: '搜索项目', icon: 'search' },
  git_diff: { label: '查看 Git 改动', icon: 'branch' }, write_file: { label: '保存文件', icon: 'save' }, edit_file: { label: '修改文件', icon: 'compose' },
  run_command: { label: '执行命令', icon: 'code' }, load_skill: { label: '读取技能说明', icon: 'library' }, read_skill_file: { label: '读取技能文件', icon: 'file' },
};
const statuses = { waiting: '等待审批', running: '执行中', complete: '已完成', error: '失败', stopped: '已停止' };
function inputRecord(text: string): Record<string, unknown> | null {
  try { const value: unknown = JSON.parse(text); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; } catch { return null; }
}
function field(input: Record<string, unknown> | null, name: string): string {
  return input && Object.hasOwn(input, name) && typeof input[name] === 'string' ? (input[name] as string).replace(/\s+/g, ' ').trim() : '';
}
export function toolActivitySummary(activity: ToolActivity): { label: string; detail: string; status: string; icon: GlyphName; duration: string | null } {
  const tool = Object.hasOwn(tools, activity.name) ? tools[activity.name] : undefined, input = inputRecord(activity.input);
  let detail = '';
  if (tool) {
    if (activity.name === 'run_command') {
      const program = input && Object.hasOwn(input, 'program') && typeof input.program === 'string' ? input.program : '', args = input?.args;
      if (program && Array.isArray(args) && args.every(value => typeof value === 'string')) detail = [program, ...args].map(value => JSON.stringify(value)).join(' ');
    } else if (activity.name === 'search_files') detail = [field(input, 'query'), field(input, 'path')].filter(Boolean).join(' · ');
    else detail = field(input, 'path');
  }
  const elapsed = activity.finishedAt === undefined ? NaN : activity.finishedAt - activity.startedAt;
  const duration = ['complete', 'error', 'stopped'].includes(activity.status) && Number.isFinite(elapsed) && elapsed >= 0 ? `${(elapsed / 1000).toFixed(1)} 秒` : null;
  const icon = activity.status === 'complete' ? 'check' : activity.status === 'error' ? 'close' : activity.status === 'stopped' ? 'stop' : activity.status === 'waiting' ? 'clock' : tool?.icon ?? 'code';
  return { label: activity.displayName?.trim() || tool?.label || activity.name, detail, status: statuses[activity.status], icon, duration };
}
export type ToolDisclosure = { running: boolean; settled: boolean };
export function toolActivityExpanded(status: ToolActivity['status'], choice: ToolDisclosure): boolean { return status === 'running' ? choice.running : choice.settled; }
export function toggleToolActivity(status: ToolActivity['status'], choice: ToolDisclosure): ToolDisclosure { return status === 'running' ? { ...choice, running: !choice.running } : { ...choice, settled: !choice.settled }; }
