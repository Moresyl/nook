import type { Provider } from './workspace';

export const settingsTabs = [
  { id: 'models', label: '模型连接', icon: 'assistant' }, { id: 'mcp', label: 'MCP 工具', icon: 'code' },
  { id: 'skills', label: '本地技能', icon: 'library' }, { id: 'plugins', label: '本地插件', icon: 'code' },
  { id: 'memories', label: '记忆', icon: 'library' }, { id: 'worktrees', label: '工作树', icon: 'branch' },
  { id: 'appearance', label: '外观与交互', icon: 'sun' }, { id: 'data', label: '数据与备份', icon: 'download' },
  { id: 'about', label: '关于 Nook', icon: 'settings' },
] as const;
export type SettingsTab = typeof settingsTabs[number]['id'];
export type SettingsDestination = { id: string; tab: SettingsTab; label: string; focusLabel: string; keywords: string };
const destinations: [SettingsTab, string, string, string][] = [
  ['models', '添加模型连接', '添加模型连接', 'provider API 本地 云端'],
  ['mcp', '添加服务器', '添加服务器', 'MCP stdio HTTP SSE 工具'],
  ['skills', '导入技能', '导入技能…', 'SKILL.md 文件夹'],
  ['plugins', '导入插件', '导入插件…', '扩展 文件夹'],
  ['memories', '添加记忆', '添加记忆', '偏好 全局 项目'],
  ['worktrees', '工作树根目录', '工作树根目录', '创建位置 文件夹 路径'],
  ['worktrees', '创建工作树前刷新上游', '创建工作树前刷新上游', 'Git fetch 远程'],
  ['worktrees', '自动清理旧工作树', '自动清理旧工作树', '保留 数量 快照'],
  ['worktrees', '保留工作树数量', '保留工作树数量', '自动清理'],
  ['appearance', '主题', '主题', '浅色 深色 系统 light dark theme'],
  ['appearance', '按 Enter 发送消息', '按 Enter 发送消息', '回车 输入'],
  ['appearance', '键盘快捷键', '键盘快捷键', 'keyboard shortcut'],
  ['appearance', '显示系统托盘', '显示系统托盘', 'tray 桌面'],
  ['appearance', '关闭窗口后保持运行', '关闭窗口后保持运行', '托盘 后台'],
  ['appearance', '快捷键打开', '快捷键打开', '快速聊天 工作台 quick chat'],
  ['appearance', '唤起快捷键', '唤起快捷键', '全局 accelerator 桌面'],
  ['data', '导出工作台', '导出备份…', 'JSON 压缩 backup 备份'],
  ['data', '恢复工作台', '恢复备份…', 'JSON 压缩 restore 备份'],
];

export function settingsMatches(query: string, provider?: Pick<Provider, 'kind' | 'azureApi'>): SettingsDestination[] {
  if (query.length > 512) throw new Error('Settings search is limited to 512 characters.');
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const entries = destinations.filter(([tab]) => !provider || tab !== 'models');
  if (provider) {
    for (const label of ['连接名称', 'API 类型', 'API 地址', 'API 密钥', '模型']) entries.push(['models', label, label, '连接 provider']);
    if (provider.kind === 'azure') entries.push(['models', 'Azure 接口', 'Azure 接口', '部署']);
    if (provider.kind === 'azure' && provider.azureApi === 'deployment-chat') entries.push(['models', 'API 版本', 'API 版本', 'Azure 部署']);
    if (provider.kind === 'openai' || provider.kind === 'ollama' || (provider.kind === 'azure' && provider.azureApi && provider.azureApi !== 'responses')) entries.push(['models', '请求流式 token 用量', '请求流式 token 用量', 'stream usage']);
  }
  const all = [...settingsTabs.map(tab => ({ id: tab.id, tab: tab.id, label: tab.label, focusLabel: '', keywords: '' })), ...entries.map(([tab, label, focusLabel, keywords]) => ({ id: `${tab}:${label}`, tab, label, focusLabel, keywords }))];
  return all.filter(item => {
    const panel = settingsTabs.find(tab => tab.id === item.tab)!;
    const text = `${item.label}\n${panel.label}\n${item.keywords}`.toLocaleLowerCase();
    return terms.every(term => text.includes(term));
  }).sort((a, b) => Number(b.label.toLocaleLowerCase() === terms.join(' ')) - Number(a.label.toLocaleLowerCase() === terms.join(' ')));
}

export function moveSettingsSelection(results: SettingsDestination[], current: string, key: string): string {
  if (!results.length) return '';
  const index = results.findIndex(item => item.id === current);
  if (key === 'Home') return results[0].id;
  if (key === 'End') return results.at(-1)!.id;
  if (key === 'ArrowDown') return results[(index + 1) % results.length].id;
  if (key === 'ArrowUp') return results[(index < 0 ? results.length - 1 : index - 1 + results.length) % results.length].id;
  return index < 0 ? '' : current;
}
