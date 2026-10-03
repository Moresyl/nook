import { searchThreads, type Preferences, type Workspace } from './workspace';
import type { PluginView } from './plugins';

export type WorkspacePage = 'chat' | 'projects' | 'assistants' | 'library' | 'automations' | 'archive';
export type ProjectView = { projectId: string; panel: 'editor' | 'changes'; files: boolean; terminal: boolean };
export type CommandTarget = { kind: 'action'; action: 'new' | 'settings' | 'sidebar' | 'help' } | { kind: 'page'; page: WorkspacePage } | { kind: 'find'; threadId: string } | { kind: 'project-panel'; projectId: string; panel: 'files' | 'terminal' | 'review'; visible: boolean } | { kind: 'theme'; theme: Preferences['theme'] } | { kind: 'thread'; threadId: string } | { kind: 'thread-action'; threadId: string; action: 'pin' | 'archive' | 'rename' | 'export' } | { kind: 'plugin-command'; pluginId: string; commandId: string } | { kind: 'plugin-panel'; pluginId: string; panelId: string };
export type WorkspaceCommand = { key: string; title: string; description: string; group: '命令' | '当前项目' | '当前聊天' | '聊天' | '插件'; icon: 'compose' | 'settings' | 'panel' | 'folder' | 'assistant' | 'library' | 'clock' | 'archive' | 'code' | 'branch' | 'find' | 'pin' | 'download'; shortcut?: string; disabled?: string; target: CommandTarget };
export type CommandContext = { sidebar: boolean; threadId?: string; findThreadId?: string; project?: ProjectView; views: PluginView[] };
export const workspaceShortcuts = [
  ['搜索聊天与命令', 'Ctrl K'], ['仅搜索命令', 'Ctrl Shift P'], ['查找当前聊天', 'Ctrl F'], ['下一个／上一个匹配', 'Enter / Shift Enter'], ['新聊天', 'Ctrl N'], ['打开设置', 'Ctrl ,'], ['显示或隐藏侧边栏', 'Ctrl B'], ['切换最近聊天', 'Alt 1–9'], ['选择命令', '↑ / ↓ / Home / End'], ['执行所选命令', 'Enter'], ['关闭对话框或查找', 'Esc'],
] as const;

export function workspaceCommands(state: Workspace, context: CommandContext): WorkspaceCommand[] {
  const commands: WorkspaceCommand[] = [
    { key: 'new', title: '新聊天', description: '保留当前聊天的未发送草稿', group: '命令', icon: 'compose', shortcut: 'Ctrl N', target: { kind: 'action', action: 'new' } },
    { key: 'settings', title: '设置', description: '模型连接、扩展、外观与备份', group: '命令', icon: 'settings', shortcut: 'Ctrl ,', target: { kind: 'action', action: 'settings' } },
    { key: 'sidebar', title: context.sidebar ? '隐藏侧边栏' : '显示侧边栏', description: '切换工作台侧边栏', group: '命令', icon: 'panel', shortcut: 'Ctrl B', target: { kind: 'action', action: 'sidebar' } },
    { key: 'help', title: '键盘快捷键', description: '查看工作台和命令面板的快捷键', group: '命令', icon: 'settings', target: { kind: 'action', action: 'help' } },
  ];
  for (const [page, title, icon] of [['chat', '返回当前聊天', 'compose'], ['projects', '打开项目', 'folder'], ['assistants', '打开助手与模板', 'assistant'], ['library', '打开资料库', 'library'], ['automations', '打开自动任务', 'clock'], ['archive', '打开已归档', 'archive']] as const) commands.push({ key: `page:${page}`, title, description: '切换工作台页面，保留聊天输入', group: '命令', icon, target: { kind: 'page', page } });
  for (const [theme, title] of [['light', '切换到浅色主题'], ['dark', '切换到深色主题'], ['system', '跟随系统主题']] as const) commands.push({ key: `theme:${theme}`, title, description: '保存工作台外观设置', group: '命令', icon: 'settings', ...(state.preferences.theme === theme ? { disabled: '当前主题' } : {}), target: { kind: 'theme', theme } });
  const findThread = state.threads.find((item) => item.id === context.findThreadId);
  commands.push({ key: JSON.stringify(['find', context.findThreadId ?? '']), title: '查找当前聊天', description: '查找当前聊天的消息正文', group: '命令', icon: 'find', shortcut: 'Ctrl F', ...(!findThread ? { disabled: '请先打开聊天' } : {}), target: { kind: 'find', threadId: context.findThreadId ?? '' } });
  const project = state.projects.find((item) => item.id === context.project?.projectId);
  for (const [panel, label, icon, shown] of [['files', '文件树', 'folder', context.project?.files], ['terminal', '终端', 'code', context.project?.terminal], ['review', '审阅面板', 'branch', context.project?.panel === 'changes']] as const) {
    const visible = !shown;
    const disabled = !project ? '请先在项目页选择项目' : panel === 'files' && context.project?.panel === 'changes' ? '请先返回文件面板' : undefined;
    commands.push({ key: JSON.stringify(['project-panel', context.project?.projectId ?? '', panel, visible]), title: `${visible ? '显示' : '隐藏'}${label}`, description: project?.name ?? '切换当前项目面板', group: '当前项目', icon, ...(disabled ? { disabled } : {}), target: { kind: 'project-panel', projectId: context.project?.projectId ?? '', panel, visible } });
  }
  const thread = state.threads.find((item) => item.id === context.threadId);
  if (thread) for (const [action, title, icon] of [['pin', thread.pinned ? '取消置顶聊天' : '置顶聊天', 'pin'], ['archive', thread.archived ? '取消归档聊天' : '归档聊天', 'archive'], ['rename', '重命名聊天', 'compose'], ['export', '导出聊天', 'download']] as const) commands.push({ key: `thread-action:${action}`, title, description: thread.title, group: '当前聊天', icon, ...(action !== 'export' && thread.messages.some((message) => message.status === 'running') ? { disabled: '请先停止当前回复' } : {}), target: { kind: 'thread-action', threadId: thread.id, action } });
  for (const plugin of state.plugins) {
    if (!plugin.enabled) continue;
    const disabled = context.views.find((view) => view.id === plugin.id)?.status === 'running' ? undefined : '插件尚未运行';
    if (plugin.grants.includes('commands')) for (const command of plugin.manifest.commands) commands.push({ key: JSON.stringify(['plugin-command', plugin.id, command.id]), title: `${plugin.manifest.name}：${command.title}`, description: command.description, group: '插件', icon: 'code', ...(disabled ? { disabled } : {}), target: { kind: 'plugin-command', pluginId: plugin.id, commandId: command.id } });
    if (plugin.grants.includes('panels')) for (const panel of plugin.manifest.panels) commands.push({ key: JSON.stringify(['plugin-panel', plugin.id, panel.id]), title: `${plugin.manifest.name}：${panel.title}`, description: '打开已授权的插件面板', group: '插件', icon: 'panel', ...(disabled ? { disabled } : {}), target: { kind: 'plugin-panel', pluginId: plugin.id, panelId: panel.id } });
  }
  return commands;
}

export function commandMatches(state: Workspace, context: CommandContext, query: string): WorkspaceCommand[] {
  if (query.length > 512) throw new Error('Command search exceeds 512 characters.');
  const onlyCommands = query.trimStart().startsWith('>'); const text = (onlyCommands ? query.trimStart().slice(1) : query).trim().toLocaleLowerCase(); const terms = text.split(/\s+/).filter(Boolean);
  const commands = workspaceCommands(state, context).filter((command) => { const corpus = `${command.title}\n${command.target.kind === 'thread-action' || command.target.kind === 'project-panel' ? '' : command.description}\n${command.group}`.toLocaleLowerCase(); return terms.every((term) => corpus.includes(term)); });
  const rank = (command: WorkspaceCommand) => command.title.toLocaleLowerCase() === text ? 0 : command.title.toLocaleLowerCase().startsWith(text) ? 1 : 2;
  commands.sort((a, b) => rank(a) - rank(b));
  const threads: WorkspaceCommand[] = onlyCommands ? [] : searchThreads(state.threads, text).slice(0, 30).map((thread) => ({ key: JSON.stringify(['thread', thread.id]), title: thread.title, description: thread.archived ? '已归档' : '最近聊天', group: '聊天', icon: thread.archived ? 'archive' : 'compose', target: { kind: 'thread', threadId: thread.id } }));
  return (text && !onlyCommands ? [...threads, ...commands] : [...commands.filter((item) => item.group !== '插件'), ...threads, ...commands.filter((item) => item.group === '插件')]).slice(0, 100);
}

export function moveCommandSelection(commands: WorkspaceCommand[], current: string, key: string): string {
  const enabled = commands.filter((command) => !command.disabled); if (!enabled.length) return '';
  if (!['Home', 'End', 'ArrowUp', 'ArrowDown'].includes(key)) return enabled.some((command) => command.key === current) ? current : enabled[0].key;
  if (key === 'Home') return enabled[0].key; if (key === 'End') return enabled.at(-1)!.key;
  const index = enabled.findIndex((command) => command.key === current); const direction = key === 'ArrowUp' ? -1 : 1;
  return enabled[index < 0 ? direction < 0 ? enabled.length - 1 : 0 : (index + direction + enabled.length) % enabled.length].key;
}

export function commandArguments(text: string): unknown {
  if (text.length > 64_000) throw new Error('Command arguments exceed 64 KB.');
  try { return JSON.parse(text); } catch { throw new Error('Command arguments must be valid JSON.'); }
}
