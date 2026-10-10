import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { commandArguments, commandMatches, moveCommandSelection, workspaceCommands, workspaceShortcuts, type CommandContext } from '../contracts/commands';
import { pluginSchema, type Plugin } from '../contracts/plugins';
import { emptyWorkspace, type Message } from '../contracts/workspace';
import { sampleThread } from './fixtures';

const context: CommandContext = { sidebar: true, views: [] };
function plugin(change: Partial<Plugin> = {}): Plugin {
  return pluginSchema.parse({ id: randomUUID(), enabled: true, grants: ['commands', 'panels'], projectIds: [], installedAt: 0, hashes: {}, data: {}, manifest: { schemaVersion: 1, id: 'example.palette', name: '命令插件', version: '1.0.0', main: 'main.js', permissions: ['commands', 'panels'], commands: [{ id: 'run', title: '运行中文😀', description: 'Exact literal <img src="https://example.invalid"> $& {{name}}' }], panels: [{ id: 'run', title: '查看面板', entry: 'ui/index.html' }] }, ...change });
}
const user: Message = { id: 'message', role: 'user', content: 'FULL_TEXT_EVIDENCE', createdAt: 0, status: 'complete', attachments: [] };

describe('workspace command catalog and keyboard selection', () => {
  it('lists only implemented navigation, appearance and shortcut actions with unique stable keys', () => {
    const state = emptyWorkspace(); const commands = workspaceCommands(state, context); expect(commands).toHaveLength(18); expect(new Set(commands.map((item) => item.key)).size).toBe(18); expect(workspaceCommands(state, context)).toEqual(commands);
    expect(commands.find(item => item.key === 'page:browser')).toMatchObject({ title: '打开浏览器', target: { kind: 'page', page: 'browser' } });
    expect(commands.find((item) => item.key === 'sidebar')?.title).toBe('隐藏侧边栏'); expect(workspaceCommands(state, { ...context, sidebar: false }).find((item) => item.key === 'sidebar')?.title).toBe('显示侧边栏'); expect(commands.find((item) => item.key === 'theme:system')?.disabled).toBe('当前主题'); expect(commands.filter((item) => item.target.kind === 'page').map((item) => item.target)).toHaveLength(7);
    expect(workspaceShortcuts.map(([title]) => title)).toContain('仅搜索命令'); expect(new Set(workspaceShortcuts.map(([title]) => title)).size).toBe(workspaceShortcuts.length);
  });
  it('binds chat find to the displayed conversation and retains availability during streaming', () => {
    const state = emptyWorkspace(); state.threads = [sampleThread({ messages: [{ ...user, status: 'running' }] }), sampleThread({ id: 'other' })];
    const find = workspaceCommands(state, { ...context, findThreadId: 'thread' }).find((command) => command.target.kind === 'find')!; expect(find).toMatchObject({ title: '查找当前聊天', shortcut: 'Ctrl F', target: { kind: 'find', threadId: 'thread' } }); expect(find.disabled).toBeUndefined();
    const other = workspaceCommands(state, { ...context, findThreadId: 'other' }).find((command) => command.target.kind === 'find')!; expect(other.disabled).toBeUndefined(); expect(other.key).not.toBe(find.key);
    expect(commandMatches(state, { ...context, findThreadId: 'thread' }, '>查找当前聊天').map((command) => command.target)).toEqual([{ kind: 'find', threadId: 'thread' }]);
  });
  it('disables chat find in other pages and after the displayed owner disappears', () => {
    const state = emptyWorkspace(); state.threads = [sampleThread({ title: 'UNIQUE_FIND_OWNER' })];
    for (const findThreadId of [undefined, '', 'deleted']) { const find = workspaceCommands(state, { ...context, threadId: 'thread', findThreadId }).find((command) => command.target.kind === 'find')!; expect(find.disabled).toBe('请先打开聊天'); expect(moveCommandSelection([find], '', 'Enter')).toBe(''); }
    expect(commandMatches(state, { ...context, findThreadId: 'thread' }, 'UNIQUE_FIND_OWNER').some((command) => command.target.kind === 'find')).toBe(false);
  });
  it('explains unavailable project actions outside the project page or after project removal', () => {
    const state = emptyWorkspace(); state.projects = [{ id: 'project', name: '项目', path: 'D:/workspace', instructions: '', createdAt: 0 }];
    for (const project of [undefined, { projectId: '', panel: 'editor' as const, files: true, terminal: false }, { projectId: 'deleted', panel: 'editor' as const, files: true, terminal: false }]) {
      const commands = workspaceCommands(state, { ...context, project }).filter((command) => command.group === '当前项目');
      expect(commands).toHaveLength(3); expect(commands.every((command) => command.disabled === '请先在项目页选择项目')).toBe(true); expect(commands.every((command) => command.description === '切换当前项目面板')).toBe(true);
      expect(moveCommandSelection(commands, '', 'Enter')).toBe('');
    }
  });
  it('binds project actions to the selected project and visibility direction with literal full names', () => {
    const state = emptyWorkspace(); state.projects = [{ id: 'project', name: '中文😀 $& {{name}} <img>', path: 'D:/workspace', instructions: '', createdAt: 0 }, { id: 'other', name: '中文😀 $& {{name}} <img>', path: 'D:/other', instructions: '', createdAt: 0 }];
    const project = { projectId: 'project', panel: 'editor' as const, files: true, terminal: false }; const before = structuredClone(state);
    const commands = workspaceCommands(state, { ...context, project }).filter((command) => command.group === '当前项目');
    expect(commands.map((command) => command.title)).toEqual(['隐藏文件树', '显示终端', '显示审阅面板']); expect(commands.every((command) => !command.disabled && command.description === state.projects[0].name)).toBe(true);
    expect(commands.map((command) => command.target)).toEqual([{ kind: 'project-panel', projectId: 'project', panel: 'files', visible: false }, { kind: 'project-panel', projectId: 'project', panel: 'terminal', visible: true }, { kind: 'project-panel', projectId: 'project', panel: 'review', visible: true }]);
    const changed = workspaceCommands(state, { ...context, project: { ...project, files: false, terminal: true, panel: 'changes' } }).filter((command) => command.group === '当前项目');
    expect(changed.map((command) => command.title)).toEqual(['显示文件树', '隐藏终端', '隐藏审阅面板']); expect(changed.every((command) => !commands.some((previous) => previous.key === command.key))).toBe(true);
    const other = workspaceCommands(state, { ...context, project: { ...project, projectId: 'other' } }).filter((command) => command.group === '当前项目'); expect(other.every((command) => !commands.some((previous) => previous.key === command.key))).toBe(true); expect(state).toEqual(before);
  });
  it('retains hidden-file state during review and permits terminal and return-to-editor commands', () => {
    const state = emptyWorkspace(); state.projects = [{ id: 'project', name: '项目', path: 'D:/workspace', instructions: '', createdAt: 0 }]; const project = { projectId: 'project', panel: 'changes' as const, files: false, terminal: true };
    const commands = workspaceCommands(state, { ...context, project }).filter((command) => command.group === '当前项目'); expect(commands[0]).toMatchObject({ title: '显示文件树', disabled: '请先返回文件面板' }); expect(commands[1].disabled).toBeUndefined(); expect(commands[2].disabled).toBeUndefined(); expect(moveCommandSelection(commands, '', 'Home')).toBe(commands[1].key);
    expect(workspaceCommands(state, { ...context, project: { ...project, panel: 'editor' } }).find((command) => command.title === '显示文件树')?.disabled).toBeUndefined();
  });
  it('does not match project mutations through project names and supports command-only literal searches', () => {
    const state = emptyWorkspace(); state.projects = [{ id: 'project', name: 'UNIQUE_PROJECT_TITLE', path: 'D:/workspace', instructions: '', createdAt: 0 }]; const current = { ...context, project: { projectId: 'project', panel: 'editor' as const, files: true, terminal: false } };
    expect(commandMatches(state, current, 'UNIQUE_PROJECT_TITLE')).toEqual([]); expect(commandMatches(state, current, '>UNIQUE_PROJECT_TITLE')).toEqual([]); expect(commandMatches(state, current, '> 隐藏 文件树').map((command) => command.title)).toEqual(['隐藏文件树']); expect(commandMatches(state, current, '>当前项目')).toHaveLength(3);
  });
  it('uses current pin/archive labels and disables mutations during a running reply while retaining export', () => {
    const state = emptyWorkspace(); state.threads = [sampleThread({ pinned: true, archived: true, messages: [{ ...user }] })]; let commands = workspaceCommands(state, { ...context, threadId: 'thread' }); expect(commands.find((item) => item.key === 'thread-action:pin')?.title).toBe('取消置顶聊天'); expect(commands.find((item) => item.key === 'thread-action:archive')?.title).toBe('取消归档聊天');
    state.threads[0].pinned = false; state.threads[0].archived = false; state.threads[0].messages[0].status = 'running'; commands = workspaceCommands(state, { ...context, threadId: 'thread' }); expect(commands.find((item) => item.key === 'thread-action:pin')?.title).toBe('置顶聊天'); expect(commands.find((item) => item.key === 'thread-action:archive')?.title).toBe('归档聊天'); expect(commands.filter((item) => item.group === '当前聊天' && item.disabled)).toHaveLength(3); expect(commands.find((item) => item.key === 'thread-action:export')?.disabled).toBeUndefined(); expect(workspaceCommands(state, { ...context, threadId: 'deleted' }).filter((item) => item.group === '当前聊天')).toEqual([]);
  });
  it('keeps command/panel namespaces and same-name installed plugins separate', () => {
    const state = emptyWorkspace(); state.plugins = [plugin(), plugin()]; const views = state.plugins.map((item) => ({ id: item.id, status: 'running' as const })); const commands = workspaceCommands(state, { ...context, views }).filter((item) => item.group === '插件'); expect(commands).toHaveLength(4); expect(new Set(commands.map((item) => item.key)).size).toBe(4); expect(commands.every((item) => !item.disabled)).toBe(true); expect(commands.filter((item) => item.target.kind === 'plugin-command')).toHaveLength(2);
  });
  it('omits disabled or ungranted contributions and explains missing/stopped/error runtimes', () => {
    const state = emptyWorkspace(); const installed = plugin(); state.plugins = [installed]; expect(workspaceCommands(state, context).filter((item) => item.group === '插件').every((item) => item.disabled)).toBe(true);
    for (const status of ['loading', 'stopped', 'error', 'disabled'] as const) expect(workspaceCommands(state, { ...context, views: [{ id: installed.id, status }] }).filter((item) => item.group === '插件').every((item) => item.disabled)).toBe(true);
    installed.grants = ['commands']; expect(workspaceCommands(state, context).filter((item) => item.group === '插件')).toHaveLength(1); installed.grants = ['panels']; expect(workspaceCommands(state, context).filter((item) => item.group === '插件')[0].target.kind).toBe('plugin-panel'); installed.grants = []; expect(workspaceCommands(state, context).filter((item) => item.group === '插件')).toEqual([]); installed.grants = ['commands']; installed.enabled = false; expect(workspaceCommands(state, context).filter((item) => item.group === '插件')).toEqual([]);
  });
  it('supports command-only prefixes, case-insensitive literal multi-term search and exact metadata without executing markup', () => {
    const state = emptyWorkspace(); state.plugins = [plugin()]; const views = [{ id: state.plugins[0].id, status: 'running' as const }]; const query = '  >   中文😀 EXACT  '; const commands = commandMatches(state, { ...context, views }, query); expect(commands).toHaveLength(1); expect(commands[0].description).toContain('<img src='); expect(commandMatches(state, context, '>设置')[0].title).toBe('设置'); expect(commandMatches(state, context, 'NO_MATCH')).toEqual([]); expect(commandMatches(state, { ...context, views }, '>')).not.toEqual([]);
    state.threads = [sampleThread({ title: 'a.*b' }), sampleThread({ id: 'other', title: 'axxb' })]; expect(commandMatches(state, context, 'a.*b').filter((item) => item.group === '聊天').map((item) => item.title)).toEqual(['a.*b']); expect(commandMatches(state, context, ' > a.*b').filter((item) => item.group === '聊天')).toEqual([]);
  });
  it('preserves full-text archived search and pinned/recent ordering with collision-free thread keys', () => {
    const state = emptyWorkspace(); state.threads = [sampleThread({ id: 'theme:light', title: 'Older', archived: true, messages: [user] }), sampleThread({ id: 'pinned', title: 'Pinned', pinned: true, updatedAt: 0, messages: [user] }), sampleThread({ id: 'newer', title: 'Newer', updatedAt: 4, messages: [user] })]; const matches = commandMatches(state, context, 'full_text_evidence'); expect(matches.map((item) => item.title)).toEqual(['Pinned', 'Newer', 'Older']); expect(matches[2]).toMatchObject({ description: '已归档', icon: 'archive', target: { kind: 'thread', threadId: 'theme:light' } }); expect(commandMatches(state, context, '>full_text_evidence')).toEqual([]);
  });
  it('prioritizes chat search over same-name commands and never matches mutation commands through a conversation title', () => {
    const state = emptyWorkspace(); state.threads = [sampleThread({ title: '设置' })]; const current = { ...context, threadId: 'thread' };
    expect(commandMatches(state, current, '设置')[0].target).toEqual({ kind: 'thread', threadId: 'thread' }); expect(commandMatches(state, current, '>设置')[0].target).toEqual({ kind: 'action', action: 'settings' }); expect(commandMatches(state, current, '>设置').some((command) => command.target.kind === 'thread-action')).toBe(false);
    state.threads[0].title = 'UNIQUE_CONVERSATION_TITLE'; expect(commandMatches(state, current, 'UNIQUE_CONVERSATION_TITLE').map((command) => command.target.kind)).toEqual(['thread']); expect(commandMatches(state, current, '>UNIQUE_CONVERSATION_TITLE')).toEqual([]);
  });
  it('bounds visible chats/contributions and query length without modifying the workspace', () => {
    const state = emptyWorkspace(); state.threads = Array.from({ length: 31 }, (_, index) => sampleThread({ id: String(index), title: 'CHAT_MATCH' })); const before = structuredClone(state); expect(commandMatches(state, context, 'CHAT_MATCH')).toHaveLength(30); expect(state).toEqual(before); expect(() => commandMatches(state, context, 'x'.repeat(513))).toThrow('512'); expect(commandMatches(state, context, 'x'.repeat(512))).toEqual([]);
    state.plugins = Array.from({ length: 3 }, () => plugin()); for (const installed of state.plugins) installed.manifest.commands = Array.from({ length: 50 }, (_, index) => ({ id: `run${index}`, title: 'MANY_MATCH', description: '' })); expect(commandMatches(state, context, '>MANY_MATCH')).toHaveLength(100);
  });
  it('avoids reading message bodies when listing recent chats with an empty query', () => {
    const state = emptyWorkspace(); const message = { ...user }; Object.defineProperty(message, 'content', { get() { throw new Error('An empty query must not scan message bodies'); } }); state.threads = [sampleThread({ messages: [message] })]; expect(commandMatches(state, context, ' ').find((item) => item.group === '聊天')?.title).toBe('A conversation');
  });
  it('wraps keyboard navigation, skips disabled commands and safely handles an absent/currently disabled selection', () => {
    const commands = workspaceCommands(emptyWorkspace(), context); const first = commands[0].key; const last = commands.filter((item) => !item.disabled).at(-1)!.key; expect(moveCommandSelection(commands, '', 'ArrowDown')).toBe(first); expect(moveCommandSelection(commands, '', 'ArrowUp')).toBe(last); expect(moveCommandSelection(commands, first, 'ArrowUp')).toBe(last); expect(moveCommandSelection(commands, last, 'ArrowDown')).toBe(first); expect(moveCommandSelection(commands, first, 'End')).toBe(last); expect(moveCommandSelection(commands, last, 'Home')).toBe(first); expect(moveCommandSelection(commands, last, 'Enter')).toBe(last); expect(moveCommandSelection(commands, 'missing', 'Enter')).toBe(first); expect(moveCommandSelection(commands.map((item) => ({ ...item, disabled: 'Unavailable' })), first, 'ArrowDown')).toBe(''); expect(moveCommandSelection([], '', 'Home')).toBe('');
  });
});

describe('plugin command arguments', () => {
  it('preserves exact JSON objects, arrays, primitives and Unicode/literal text', () => {
    for (const value of [{ text: '中文😀 $& {{literal}} <img>' }, ['Exact'], null, 2, true, 'text']) expect(commandArguments(JSON.stringify(value))).toEqual(value);
    const object = commandArguments('{"__proto__":{"polluted":true}}') as Record<string, unknown>; expect(Object.hasOwn(object, '__proto__')).toBe(true); expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it('accepts the exact character quota and reports malformed/oversized data without repeating private input', () => {
    expect(commandArguments(`"${'x'.repeat(63_998)}"`)).toHaveLength(63_998); expect(() => commandArguments('x'.repeat(64_001))).toThrow('64 KB'); for (const value of ['', '{', '{"PRIVATE_SECRET"', 'undefined', 'NaN']) expect(() => commandArguments(value)).toThrow('must be valid JSON');
  });
});
