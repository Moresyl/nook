import { useState } from 'react';
import { memoryLimits, memorySchema, type Memory } from '../../contracts/memories';
import type { Workspace } from '../../contracts/workspace';
import { Button, Empty, Field, Input, Modal, Select, Textarea, Toggle } from '../components/controls';
import { useSettingsDraft } from '../components/settings-drafts';

type Props = { state: Workspace; onState: (state: Workspace) => void; report: (error: unknown) => void };

export function MemorySettings({ state, onState, report }: Props) {
  const [editing, setEditing] = useState<Memory | null>(null);
  const [removing, setRemoving] = useState<Memory | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [baseline, setBaseline] = useState('');
  const leaveForm = useSettingsDraft('memories', Boolean(editing && JSON.stringify(editing) !== baseline), busy);
  function edit(memory: Memory) { setEditing({ ...memory }); setBaseline(JSON.stringify(memory)); }
  function cancelEditing() { void leaveForm(() => setEditing(null), '取消编辑将放弃这份未保存的记忆。'); }
  async function act(operation: () => Promise<Workspace>, done: () => void) {
    setBusy(true);
    try { onState(await operation()); done(); }
    catch (error) { report(error); }
    finally { setBusy(false); }
  }
  const scope = (item: Memory) => item.projectId ? state.projects.find((project) => project.id === item.projectId)?.name ?? '项目已移除' : '全局';
  const visible = state.memories.filter((item) => `${item.content}\n${scope(item)}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const total = state.memories.reduce((sum, item) => sum + (item.id === editing?.id ? 0 : item.content.length), editing?.content.trim().length ?? 0);
  if (editing) return <>
    <div className="section-heading"><h3>编辑记忆</h3><Button disabled={busy} onClick={cancelEditing}>取消编辑</Button></div>
    <Field label="适用范围" hint="全局用于普通聊天；项目范围只用于所选项目。临时聊天不读取记忆。"><Select disabled={busy} value={editing.projectId ?? ''} onChange={(event) => setEditing({ ...editing, projectId: event.target.value || undefined })}><option value="">全局</option>{state.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</Select></Field>
    <Field label="记忆内容" hint={`记录你希望保留的偏好或事实，每条最多 ${memoryLimits.content} 字符。`}><Textarea autoFocus disabled={busy} rows={6} maxLength={memoryLimits.content} value={editing.content} onChange={(event) => setEditing({ ...editing, content: event.target.value })} /></Field>
    <Toggle disabled={busy} label="在后续聊天中使用" checked={editing.enabled} onChange={(enabled) => setEditing({ ...editing, enabled })} />
    <p className="field-hint">启用的记忆会随后续请求发送给所选模型。修改或删除不会撤回已发送的内容。</p>
    {total > memoryLimits.totalContent && <p role="alert">全部记忆最多保存 32,000 字符，请缩短内容。</p>}
    <div className="form-actions"><Button disabled={busy} onClick={cancelEditing}>取消</Button><Button tone="solid" disabled={busy || !memorySchema.safeParse(editing).success || total > memoryLimits.totalContent} onClick={() => { void act(() => window.qiyao.saveMemory(editing), () => setEditing(null)); }}>保存记忆</Button></div>
  </>;
  return <>
    <div className="section-heading"><h3>记忆</h3><Button disabled={busy || state.memories.length >= memoryLimits.count} onClick={() => edit({ id: crypto.randomUUID(), content: '', enabled: true })}>添加记忆</Button></div>
    <p className="muted">由你决定记住什么。只保存你主动添加的内容，可随时编辑、停用或删除。</p>
    <p className="field-hint">启用的记忆会发送给所选模型；临时聊天不使用记忆。备份包含记忆，移除项目也会删除该项目的记忆。</p>
    <Input aria-label="搜索记忆" placeholder="搜索内容或项目…" value={search} onChange={(event) => setSearch(event.target.value)} />
    {visible.length ? <div className="item-list memory-list">{visible.map((item) => <div className="list-row" key={item.id}><Button className="row-content" disabled={busy} onClick={() => edit(item)}><strong>{item.content.length > 120 ? `${item.content.slice(0, 120)}…` : item.content}</strong><span>{scope(item)} · {item.enabled ? '已启用' : '已停用'}</span></Button><Button disabled={busy} aria-label={`删除记忆 ${item.content.slice(0, 120)}`} onClick={() => setRemoving(item)}>删除</Button></div>)}</div> : <Empty icon="library" title={search ? '没有匹配的记忆' : '还没有保存的记忆'} detail={search ? '试试其他关键词。' : '添加常用偏好，让后续对话更贴合你的需要。'} />}
    {removing && <Modal title="删除记忆？" onClose={() => { if (!busy) setRemoving(null); }} footer={<><Button disabled={busy} onClick={() => setRemoving(null)}>取消</Button><Button disabled={busy} tone="danger" onClick={() => { void act(() => window.qiyao.removeMemory(removing.id), () => setRemoving(null)); }}>确认删除</Button></>}><p>删除后不再用于新请求，已发送的内容和已有备份不受影响。</p><p>{removing.content}</p></Modal>}
  </>;
}
