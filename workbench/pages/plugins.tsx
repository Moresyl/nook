import { useEffect, useState } from 'react';
import type { PluginPermission, PluginUpdate, PluginView } from '../../contracts/plugins';
import type { Workspace } from '../../contracts/workspace';
import { Button, Empty, Field, IconButton, Select, Textarea, Toggle } from '../components/controls';

type Props = { state: Workspace; onState: (next: Workspace) => void; report: (error: unknown) => void; onOpenPanel: (pluginId: string, panelId: string) => void };
const statuses = { disabled: '已停用', loading: '启动中', running: '运行中', stopped: '未运行', error: '启动失败' };
const permissions: Record<PluginPermission, string> = { tools: '向模型提供工具（每次调用审批）', commands: '执行你点击的插件命令', panels: '显示插件面板', storage: '保存插件自己的数据', 'project.read': '读取当前调用所选项目', 'project.write': '请求写入项目文件（单独审批）', network: '访问声明的网络地址' };
export function PluginSettingsPage({ state, onState, report, onOpenPanel }: Props) {
  const [selected, setSelected] = useState('');
  const [draft, setDraft] = useState<PluginUpdate | null>(null);
  const [limited, setLimited] = useState(false);
  const [views, setViews] = useState<PluginView[]>([]);
  const [busy, setBusy] = useState(false);
  const [command, setCommand] = useState('');
  const [projectId, setProjectId] = useState('');
  const [args, setArgs] = useState('{}');
  const [result, setResult] = useState('');
  useEffect(() => {
    let live = true; const unsubscribe = window.qiyao.onPlugin((view) => { if (live) setViews((current) => [...current.filter((item) => item.id !== view.id), view]); });
    void window.qiyao.pluginViews().then((next) => { if (live) setViews((current) => [...next.filter((item) => !current.some((known) => known.id === item.id)), ...current]); }).catch(report);
    return () => { live = false; unsubscribe(); };
  }, [report]);
  async function act<T>(operation: () => Promise<T>, success?: (value: T) => void) {
    if (busy) return; setBusy(true);
    try { const value = await operation(); success?.(value); } catch (error) { report(error); } finally { setBusy(false); }
  }
  const plugin = state.plugins.find((item) => item.id === selected);
  const view = views.find((item) => item.id === selected);
  function edit(id: string) {
    const item = state.plugins.find((entry) => entry.id === id)!;
    setSelected(id); setDraft({ id, enabled: item.enabled, grants: [...item.grants], projectIds: [...item.projectIds] }); setLimited(Boolean(item.projectIds.length)); setCommand(''); setResult('');
  }
  if (plugin && draft) return <>
    <Button disabled={busy} onClick={() => setSelected('')}>← 返回插件列表</Button>
    <div className="section-heading"><div><h3>{plugin.manifest.name}</h3><p>{plugin.manifest.description}</p><p>{plugin.manifest.version} · {plugin.manifest.author || plugin.manifest.id} · {statuses[view?.status ?? (plugin.enabled ? 'stopped' : 'disabled')]}</p></div></div>
    {view?.error && <p role="alert" className="field-hint">{view.error}</p>}
    <Toggle label="启用插件" disabled={busy} checked={draft.enabled} onChange={(enabled) => setDraft({ ...draft, enabled })} />
    <h4>允许的能力</h4><p className="field-hint">更改后保存生效。只开放你需要的能力。</p>
    {plugin.manifest.permissions.map((permission) => <Toggle key={permission} disabled={busy} label={permissions[permission]} checked={draft.grants.includes(permission)} onChange={(checked) => setDraft({ ...draft, grants: checked ? [...draft.grants, permission] : draft.grants.filter((item) => item !== permission) })} />)}
    {plugin.manifest.domains.length > 0 && <p className="field-hint">网络地址：{plugin.manifest.domains.join('、')}</p>}
    {(plugin.manifest.permissions.includes('project.read') || plugin.manifest.permissions.includes('project.write')) && <>
      <Toggle label="限定使用的项目" disabled={busy} checked={limited} onChange={setLimited} />
      {limited ? state.projects.map((project) => <Toggle key={project.id} disabled={busy} label={project.name} checked={draft.projectIds.includes(project.id)} onChange={(checked) => setDraft({ ...draft, projectIds: checked ? [...draft.projectIds, project.id] : draft.projectIds.filter((id) => id !== project.id) })} />) : <p className="field-hint">允许在你选择的项目中使用。面板没有项目文件访问权。</p>}
    </>}
    <div className="form-actions"><Button tone="solid" disabled={busy || limited && !draft.projectIds.length} onClick={() => { void act(() => window.qiyao.savePlugin({ ...draft, projectIds: limited ? draft.projectIds : [] }), (next) => { onState(next); const saved = next.plugins.find((item) => item.id === plugin.id)!; setDraft({ id: saved.id, enabled: saved.enabled, grants: saved.grants, projectIds: saved.projectIds }); }); }}>保存插件设置</Button><Button disabled={busy || !plugin.enabled} onClick={() => { void act(() => window.qiyao.pluginReload(plugin.id)); }}>重新加载</Button></div>
    {plugin.manifest.tools.length > 0 && <details><summary>模型工具 · {plugin.manifest.tools.length}</summary>{plugin.manifest.tools.map((tool) => <div className="extension-tool" key={tool.name}><strong>{tool.name}</strong><p>{tool.description}</p><pre className="extension-preview">{JSON.stringify(tool.parameters, null, 2)}</pre></div>)}</details>}
    {plugin.manifest.commands.length > 0 && <>
      <h4>插件命令</h4><Field label="选择命令"><Select value={command} onChange={(event) => setCommand(event.target.value)}><option value="">选择命令…</option>{plugin.manifest.commands.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</Select></Field>
      {state.projects.length > 0 && <Field label="命令所用项目"><Select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">不使用项目</option>{state.projects.filter((item) => !plugin.projectIds.length || plugin.projectIds.includes(item.id)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>}
      <Field label="命令参数"><Textarea rows={3} spellCheck={false} value={args} onChange={(event) => setArgs(event.target.value)} /></Field>
      <Button disabled={busy || !command || view?.status !== 'running' || !plugin.grants.includes('commands')} onClick={() => { void act(() => window.qiyao.pluginCommand(plugin.id, command, JSON.parse(args), projectId || undefined), (output) => setResult(typeof output === 'string' ? output : JSON.stringify(output, null, 2))); }}>{busy ? '执行中…' : '执行命令'}</Button>
      {result && <pre className="extension-preview" aria-label="插件命令结果">{result}</pre>}
    </>}
    {plugin.manifest.panels.length > 0 && <><h4>插件面板</h4><div className="extension-actions">{plugin.manifest.panels.map((panel) => <Button key={panel.id} disabled={busy || view?.status !== 'running' || !plugin.grants.includes('panels')} onClick={() => onOpenPanel(plugin.id, panel.id)}>{panel.title}</Button>)}</div></>}
    <div className="form-actions"><Button tone="danger" disabled={busy} onClick={() => { void act(() => window.qiyao.removePlugin(plugin.id), (next) => { onState(next); setSelected(''); }); }}>移除此插件</Button></div>
  </>;
  return <>
    <div className="section-heading"><div><h3>本地插件</h3><p>导入完整插件文件夹，检查能力后启用。</p></div><Button disabled={busy} onClick={() => { void act(() => window.qiyao.importPlugin(), (next) => { if (next) onState(next); }); }}>导入插件…</Button></div>
    {state.plugins.length ? <div className="item-list">{state.plugins.map((item) => <div className="list-row" key={item.id}><Button className="row-content" disabled={busy} onClick={() => edit(item.id)}><strong>{item.manifest.name}</strong><span>{statuses[views.find((view) => view.id === item.id)?.status ?? (item.enabled ? 'stopped' : 'disabled')]} · {item.manifest.version}</span></Button><IconButton icon="trash" label={`移除插件 ${item.manifest.name}`} disabled={busy} onClick={() => { void act(() => window.qiyao.removePlugin(item.id), onState); }} /></div>)}</div> : <Empty icon="code" title="添加适合你的插件" detail="使用 qiyao-plugin.json 清单，保留完整资源与许可证。" />}
  </>;
}
