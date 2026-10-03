import { useLayoutEffect, useRef, useState } from 'react';
import type { Assistant, Workspace } from '../../contracts/workspace';
import type { AssistantBundle } from '../../contracts/assistant-profiles';
import { Button, Empty, Field, IconButton, Input, Modal, Select, Textarea } from '../components/controls';
import { Glyph } from '../components/glyphs';
import { PromptTemplatesPage } from './prompt-templates';

type Props = { state: Workspace; onState: (next: Workspace) => void; report: (error: unknown) => void; onUse: (id: string) => void; onPrompt: (text: string, assistantId?: string) => boolean };
export function Collections({ state, onState, report, onUse, onPrompt }: Props) {
  const [tab, setTab] = useState('assistants');
  const focusTab = useRef(false);
  useLayoutEffect(() => { if (focusTab.current) { document.getElementById(`qiyao-tab-${tab}`)?.focus(); focusTab.current = false; } }, [tab]);
  function selectTab(name: string) {
    if (name === tab) document.getElementById(`qiyao-tab-${name}`)?.focus(); else { focusTab.current = true; setTab(name); }
  }
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Assistant | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [incoming, setIncoming] = useState<AssistantBundle | null>(null);
  const [preview, setPreview] = useState(0);
  const filtered = state.assistants.filter((item) => JSON.stringify(item).toLowerCase().includes(search.toLowerCase()));
  async function save() {
    if (!editing) return; setBusy(true);
    try { onState(await window.qiyao.saveAssistant(editing)); setEditing(null); }
    catch (error) { report(error); } finally { setBusy(false); }
  }
  async function readImport() {
    setBusy(true);
    try { const bundle = await window.qiyao.readAssistantImport(); if (bundle) { setIncoming(bundle); setPreview(0); } }
    catch (error) { report(error); } finally { setBusy(false); }
  }
  async function importProfiles() {
    if (!incoming) return; setBusy(true);
    try { onState(await window.qiyao.importAssistants(incoming)); setIncoming(null); }
    catch (error) { report(error); } finally { setBusy(false); }
  }
  async function exportProfiles(ids?: string[]) {
    setBusy(true);
    try { await window.qiyao.exportAssistants(ids); }
    catch (error) { report(error); } finally { setBusy(false); }
  }
  const tabNames = ['assistants', 'templates'];
  const tabs = <div className="assistant-tabs" role="tablist" aria-label="助手与模板" onKeyDown={(event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : (tabNames.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : -1) + 2) % 2;
    event.preventDefault(); selectTab(tabNames[index]);
  }}>{tabNames.map((name) => <Button key={name} id={`qiyao-tab-${name}`} role="tab" tabIndex={tab === name ? 0 : -1} aria-selected={tab === name} className={tab === name ? 'active' : ''} onClick={() => selectTab(name)}>{name === 'assistants' ? '助手配置' : '提示模板'}</Button>)}</div>;
  if (tab === 'templates') return <div className="collection-page assistants-page prompt-templates-page"><PromptTemplatesPage state={state} onState={onState} report={report} onUse={onPrompt} navigation={tabs} /></div>;
  return <div className="collection-page assistants-page"><div className="page-heading"><div><h1>你的助手</h1><p>把常用的工作方式，交给熟悉的搭档。</p></div><div className="assistant-actions"><Button disabled={busy} onClick={() => { void readImport(); }}>导入助手</Button><Button disabled={busy || !state.assistants.length} onClick={() => { void exportProfiles(); }}>导出全部</Button><Button disabled={busy} tone="solid" onClick={() => setEditing({ id: crypto.randomUUID(), name: '', description: '', instructions: '' })}><Glyph name="plus" size={16} />创建助手</Button></div></div>
    {tabs}<Input aria-label="筛选列表" className="collection-search" placeholder="搜索助手…" value={search} onChange={(event) => setSearch(event.target.value)} />
    {filtered.length ? <div className="item-list">{filtered.map((item) => <div className="list-row" key={item.id}><span className="row-symbol"><Glyph name="assistant" size={22} /></span><Button disabled={busy} className="row-content" onClick={() => setEditing(item)}><strong>{item.name}</strong><span>{item.description}</span></Button><Button disabled={busy} onClick={() => onUse(item.id)}>开始聊天<Glyph name="right" size={14} /></Button><Button disabled={busy} aria-label={`导出助手 ${item.name}`} onClick={() => { void exportProfiles([item.id]); }}>导出</Button><IconButton disabled={busy} icon="trash" label="删除" onClick={() => setRemoveId(item.id)} /></div>)}</div> : <Empty icon="assistant" title={search ? '没有匹配的内容' : '这里还没有助手'} detail={search ? '试试更短的关键词。' : '创建助手，保存常用的工作指令。'} />}
    {editing && <Modal title="编辑助手" onClose={() => { if (!busy) setEditing(null); }} footer={<><Button disabled={busy} onClick={() => setEditing(null)}>取消</Button><Button tone="solid" disabled={busy || !editing.name.trim()} onClick={() => { void save(); }}>保存</Button></>}>
      <Field label="助手名称"><Input autoFocus disabled={busy} maxLength={80} value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></Field>
      <Field label="简介"><Input disabled={busy} maxLength={512} value={editing.description} onChange={(event) => setEditing({ ...editing, description: event.target.value })} /></Field>
      <Field label="工作指令"><Textarea disabled={busy} maxLength={32000} rows={10} value={editing.instructions} placeholder="描述助手的角色、目标和工作方式…" onChange={(event) => setEditing({ ...editing, instructions: event.target.value })} /></Field>
    </Modal>}
    {incoming && <Modal title="导入助手配置" onClose={() => { if (!busy) setIncoming(null); }} footer={<><Button disabled={busy} onClick={() => setIncoming(null)}>取消</Button><Button tone="solid" disabled={busy} onClick={() => { void importProfiles(); }}>添加 {incoming.assistants.length} 个助手</Button></>}>
      <p className="field-hint">将创建新的助手，已有配置保持不变。请先查看工作指令；导入后可自行选择用于聊天。</p>
      <Field label="查看助手"><Select autoFocus disabled={busy} value={preview} onChange={(event) => setPreview(Number(event.target.value))}>{incoming.assistants.map((item, index) => <option key={index} value={index}>{item.name}</option>)}</Select></Field>
      <Field label="简介"><Input readOnly value={incoming.assistants[preview].description} /></Field>
      <Field label="工作指令"><Textarea readOnly rows={12} value={incoming.assistants[preview].instructions} /></Field>
    </Modal>}
    {removeId && <Modal title="删除助手？" onClose={() => setRemoveId(null)} footer={<><Button onClick={() => setRemoveId(null)}>取消</Button><Button tone="danger" onClick={() => { void window.qiyao.removeAssistant(removeId).then((next) => { onState(next); setRemoveId(null); }).catch(report); }}>删除</Button></>}><p>此项将从本地工作台移除，已有对话不会被删除。</p></Modal>}
  </div>;
}
