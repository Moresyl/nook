import { useEffect, useId, useRef, useState } from 'react';
import { commandArguments, commandMatches, moveCommandSelection, workspaceCommands, workspaceShortcuts, type CommandContext, type WorkspaceCommand } from '../../contracts/commands';
import type { PluginView } from '../../contracts/plugins';
import type { Workspace } from '../../contracts/workspace';
import { Button, Field, Input, Modal, Select, Textarea } from './controls';
import { Glyph } from './glyphs';

type Props = { state: Workspace; context: Omit<CommandContext, 'views'>; query: string; onQuery: (query: string) => void; onState: (state: Workspace) => void; onClose: () => void; onExecute: (command: WorkspaceCommand) => Promise<boolean>; onPluginCommand: (command: WorkspaceCommand, args: unknown, projectId?: string) => Promise<unknown> };
export function CommandPalette({ state, context, query, onQuery, onState, onClose, onExecute, onPluginCommand }: Props) {
  const [views, setViews] = useState<PluginView[]>([]); const [active, setActive] = useState(''); const [selected, setSelected] = useState<WorkspaceCommand | null>(null); const [help, setHelp] = useState(false);
  const [args, setArgs] = useState('{}'); const [projectId, setProjectId] = useState(''); const [result, setResult] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const live = useRef(true); const wasBusy = useRef(false); const id = useId(); const commands = commandMatches(state, { ...context, views }, query); const current = commands.find((command) => command.key === active && !command.disabled) ?? commands.find((command) => !command.disabled); const activeId = current ? `${id}-${commands.indexOf(current)}` : undefined;
  const selectedTarget = selected?.target; const plugin = selectedTarget?.kind === 'plugin-command' ? state.plugins.find((item) => item.id === selectedTarget.pluginId) : undefined;
  const available = selected && workspaceCommands(state, { ...context, views }).find((command) => command.key === selected.key && !command.disabled);
  const failureText = (failure: unknown) => failure instanceof Error ? failure.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : '命令执行失败，请重试。';
  useEffect(() => {
    live.current = true; let pending = true;
    void window.qiyao.pluginViews().then((next) => { if (pending) setViews((current) => [...next.filter((view) => !current.some((item) => item.id === view.id)), ...current]); }).catch((failure) => { if (pending) setError(failureText(failure)); });
    const unsubscribe = window.qiyao.onPlugin((view) => { setViews((current) => [...current.filter((item) => item.id !== view.id), view]); });
    return () => { pending = false; live.current = false; unsubscribe(); };
  }, []);
  useEffect(() => { if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' }); }, [activeId]);
  useEffect(() => { if (wasBusy.current && !busy) document.getElementById(`${id}-${help ? 'refresh' : selected ? 'args' : 'query'}`)?.focus(); wasBusy.current = busy; }, [busy, help, selected, id]);
  async function refresh() {
    if (busy) return; setBusy(true); setError('');
    try { const [next, current] = await Promise.all([window.qiyao.load(), window.qiyao.pluginViews()]); if (live.current) { onState(next); setViews(current); } }
    catch (failure) { if (live.current) setError(failureText(failure)); } finally { if (live.current) setBusy(false); }
  }
  async function choose(command: WorkspaceCommand) {
    if (busy || command.disabled) return;
    if (command.target.kind === 'action' && command.target.action === 'help') { setHelp(true); return; }
    if (command.target.kind === 'plugin-command') { setSelected(command); setArgs('{}'); setResult(''); setError(''); setProjectId(''); return; }
    setBusy(true); setError(''); try { if (await onExecute(command) && live.current) onClose(); } catch (failure) { if (live.current) setError(failureText(failure)); } finally { if (live.current) setBusy(false); }
  }
  async function runPlugin() {
    if (busy || !selected || !available) return; setBusy(true); setError(''); setResult('');
    try { const parsed = commandArguments(args); const output = await onPluginCommand(selected, parsed, projectId || undefined); if (live.current) setResult(typeof output === 'string' ? output : JSON.stringify(output, null, 2) ?? '命令已完成。'); }
    catch (failure) { if (live.current) setError(failureText(failure)); } finally { if (live.current) setBusy(false); }
  }
  function back() { setSelected(null); setHelp(false); setError(''); setResult(''); }
  return <Modal title="搜索与命令" className={`command-palette ${selected || help ? 'command-detail' : ''}`} onClose={() => { if (!busy) onClose(); }} footer={<><span className="command-hint">{help ? 'Esc 关闭' : selected ? '检查参数后点击执行 · Esc 关闭' : '↑ ↓ 选择 · Enter 执行 · Esc 关闭'}</span>{(selected || help) && <Button disabled={busy} onClick={back}>返回命令</Button>}<Button id={`${id}-refresh`} disabled={busy} onClick={() => { void refresh(); }}>刷新命令</Button>{selected && <Button tone="solid" disabled={busy || !available} onClick={() => { void runPlugin(); }}>{busy ? '执行中…' : '执行命令'}</Button>}</>}>
    {help ? <><h3>键盘快捷键</h3><table className="shortcut-table"><thead><tr><th>动作</th><th>快捷键</th></tr></thead><tbody>{workspaceShortcuts.map(([title, shortcut]) => <tr key={title}><td>{title}</td><td><kbd>{shortcut}</kbd></td></tr>)}</tbody></table><p className="field-hint">对话框打开时，工作台导航快捷键暂停。输入法组词期间不会执行所选命令。</p></> : selected ? <>
      <h3>{selected.title}</h3><p className="field-hint command-description">{selected.description || '检查参数后执行此插件命令。'}</p>{!available && <p className="inline-error">插件命令当前不可用，请返回并刷新命令。</p>}
      <Field label="命令参数"><Textarea id={`${id}-args`} autoFocus rows={4} maxLength={64_000} spellCheck={false} value={args} disabled={busy} onChange={(event) => setArgs(event.target.value)} /></Field>
      <Field label="命令所用项目"><Select value={projectId} disabled={busy} onChange={(event) => setProjectId(event.target.value)}><option value="">不使用项目</option>{state.projects.filter((project) => !plugin?.projectIds.length || plugin.projectIds.includes(project.id)).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</Select></Field>
      {result && <pre className="extension-preview" aria-label="插件命令结果">{result}</pre>}
    </> : <>
      <Input id={`${id}-query`} autoFocus role="combobox" aria-label="搜索聊天与命令" aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-list`} aria-activedescendant={activeId} placeholder="搜索聊天与命令，输入 > 仅搜索命令…" maxLength={512} value={query} disabled={busy} onChange={(event) => { onQuery(event.target.value); setActive(''); setError(''); }} onKeyDown={(event) => { if (event.nativeEvent.isComposing) return; if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); setActive(moveCommandSelection(commands, current?.key ?? '', event.key)); } else if (event.key === 'Enter' && current) { event.preventDefault(); void choose(current); } }} />
      <div role="listbox" aria-label="聊天与命令结果" id={`${id}-list`} className="command-list">{commands.map((command, index) => <Button key={command.key} id={`${id}-${index}`} role="option" aria-label={command.title} aria-selected={current?.key === command.key} aria-disabled={busy || Boolean(command.disabled)} data-command-group={command.group} title={command.disabled || command.description} tabIndex={-1} disabled={busy || Boolean(command.disabled)} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => { if (!command.disabled) setActive(command.key); }} onClick={() => { void choose(command); }}><Glyph name={command.icon} /><span className="command-row-text"><strong>{command.title}</strong><small>{command.disabled || command.description}</small></span><span className="command-group">{command.group}</span>{command.shortcut && <kbd>{command.shortcut}</kbd>}</Button>)}</div>
      <p className="field-hint" role="status">{commands.length ? `显示 ${commands.length} 项${commands.length === 100 ? '，输入更具体的关键词可查找更多结果' : ''}` : '没有匹配的聊天或命令。'}</p>
    </>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </Modal>;
}
