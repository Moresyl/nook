import { useState, type ReactNode } from 'react';
import type { Workspace } from '../../contracts/workspace';
import { promptTemplateSchema, promptVariables, type PromptParameter, type PromptTemplate } from '../../contracts/prompt-templates';
import { Button, Empty, Field, IconButton, Input, Modal, Select, Textarea, Toggle } from '../components/controls';
import { Glyph } from '../components/glyphs';
import { PromptUseDialog } from '../components/prompt-use-dialog';

type Props = { state: Workspace; onState: (state: Workspace) => void; report: (error: unknown) => void; onUse: (text: string, assistantId?: string) => boolean; navigation: ReactNode };
export function PromptTemplatesPage({ state, onState, report, onUse, navigation }: Props) {
  const [search, setSearch] = useState(''); const [editing, setEditing] = useState<PromptTemplate | null>(null);
  const [using, setUsing] = useState<string | null>(null); const [removing, setRemoving] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const templates = state.promptTemplates.filter((item) => `${item.title}\n${item.description}\n${item.content}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  let variables: string[] = [];
  if (editing) try { variables = promptVariables(editing.content); } catch { /* Retain incomplete content and parameter settings while editing. */ }
  function configureParameter(key: string, change: Partial<PromptParameter>) {
    if (!editing) return;
    const parameter = { key, ...editing.parameters?.find((item) => item.key === key), ...change };
    setEditing({ ...editing, parameters: [...(editing.parameters ?? []).filter((item) => item.key !== key), parameter] });
  }
  function resetParameter(key: string) {
    if (editing) setEditing({ ...editing, parameters: editing.parameters?.filter((item) => item.key !== key) });
  }
  async function save() {
    if (!editing || busy) return; setBusy(true);
    try { onState(await window.qiyao.savePromptTemplate(editing)); setEditing(null); } catch (error) { report(error); } finally { setBusy(false); }
  }
  async function remove() {
    if (!removing || busy) return; setBusy(true);
    try { onState(await window.qiyao.removePromptTemplate(removing)); setRemoving(null); } catch (error) { report(error); } finally { setBusy(false); }
  }
  return <><div className="page-heading"><div><h1>提示模板</h1><p>保存常用任务，填写变量后放入草稿。</p></div><Button tone="solid" onClick={() => setEditing({ id: crypto.randomUUID(), title: '', description: '', content: '' })}><Glyph name="plus" size={16} />创建模板</Button></div>
    {navigation}<Input aria-label="搜索提示模板" className="collection-search" value={search} placeholder="搜索名称、简介或内容…" onChange={(event) => setSearch(event.target.value)} />
    {templates.length ? <div className="item-list">{templates.map((item) => <div className="list-row" data-template-id={item.id} key={item.id}><span className="row-symbol"><Glyph name="compose" size={22} /></span><Button className="row-content" onClick={() => setEditing(item)}><strong>{item.title}</strong><span>{item.description || `${promptVariables(item.content).length} 个变量`}</span></Button><Button onClick={() => setUsing(item.id)}>使用模板</Button><IconButton icon="copy" label={`复制模板 ${item.title}`} onClick={() => setEditing({ ...item, id: crypto.randomUUID(), title: `${item.title.slice(0, 77)} 副本` })} /><IconButton icon="trash" label={`删除模板 ${item.title}`} onClick={() => setRemoving(item.id)} /></div>)}</div> : <Empty icon="compose" title={search ? '没有匹配的模板' : '还没有提示模板'} detail={search ? '试试其他关键词。' : '创建一个模板，保存写作、研究或项目任务。'} />}
    {editing && <Modal title="编辑提示模板" onClose={() => { if (!busy) setEditing(null); }} footer={<><Button disabled={busy} onClick={() => setEditing(null)}>取消</Button><Button tone="solid" disabled={busy || !promptTemplateSchema.safeParse(editing).success} onClick={() => { void save(); }}>保存</Button></>}>
      <Field label="模板名称"><Input autoFocus maxLength={80} disabled={busy} value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} /></Field>
      <Field label="模板简介"><Input maxLength={512} disabled={busy} value={editing.description} onChange={(event) => setEditing({ ...editing, description: event.target.value })} /></Field>
      <Field label="模板助手" hint="追加到草稿时选择这个助手。保留现有消息与附件，由你决定何时发送。"><Select disabled={busy} value={editing.assistantId ?? ''} onChange={(event) => setEditing({ ...editing, assistantId: event.target.value || undefined })}><option value="">保持当前助手</option>{state.assistants.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
      <Field label="模板内容" hint="例如：请按 {{风格}} 改写 {{文本}}。变量支持中英文、数字、下划线和短横线，最多 20 种；前面加反斜杠可保留变量标记的原文。"><Textarea rows={12} maxLength={32000} disabled={busy} value={editing.content} onChange={(event) => setEditing({ ...editing, content: event.target.value })} /></Field>
      {variables.map((key) => {
        const parameter = editing.parameters?.find((item) => item.key === key);
        return <details key={key} className="prompt-parameter"><summary>变量设置：{key}</summary>
          <Field label={`参数名称 ${key}`}><Input maxLength={80} disabled={busy} value={parameter?.label ?? ''} placeholder={key} onChange={(event) => configureParameter(key, { label: event.target.value })} /></Field>
          <Field label={`参数说明 ${key}`}><Input maxLength={512} disabled={busy} value={parameter?.description ?? ''} onChange={(event) => configureParameter(key, { description: event.target.value })} /></Field>
          <Toggle label={`参数 ${key} 必填`} disabled={busy} checked={parameter?.required ?? true} onChange={(required) => configureParameter(key, { required })} />
          <Field label={`默认值 ${key}`}><Textarea rows={2} maxLength={32000} disabled={busy} value={parameter?.defaultValue ?? ''} onChange={(event) => configureParameter(key, { defaultValue: event.target.value || undefined })} /></Field>
          <Field label={`下拉选项 ${key}`} hint="每行一个选项，最多 50 项、每项 512 个字符。选项不能重复或留空行；默认值须与某个选项完全一致。留空使用文本输入。"><Textarea rows={3} maxLength={25649} disabled={busy} value={parameter?.choices?.join('\n') ?? ''} onChange={(event) => configureParameter(key, { choices: event.target.value ? event.target.value.split('\n') : undefined })} /></Field>
          <Button disabled={busy || !parameter} onClick={() => resetParameter(key)}>恢复变量 {key} 的默认设置</Button>
        </details>;
      })}
      {editing.parameters?.filter((item) => !variables.includes(item.key)).map((item) => <div key={item.key} className="field"><p className="field-hint">内容中没有变量 {item.key}。补回变量标记或移除其设置后保存。</p><Button disabled={busy} onClick={() => resetParameter(item.key)}>移除变量设置 {item.key}</Button></div>)}
    </Modal>}
    {removing && <Modal title="删除提示模板？" onClose={() => { if (!busy) setRemoving(null); }} footer={<><Button disabled={busy} onClick={() => setRemoving(null)}>取消</Button><Button tone="danger" disabled={busy} onClick={() => { void remove(); }}>删除</Button></>}><p>已有消息和草稿会保留。这个模板将从本地工作台移除。</p></Modal>}
    {using && <PromptUseDialog templates={state.promptTemplates} assistants={state.assistants} initialId={using} onUse={onUse} onClose={() => setUsing(null)} />}
  </>;
}
