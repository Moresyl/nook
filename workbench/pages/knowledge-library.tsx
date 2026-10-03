import { useEffect, useRef, useState } from 'react';
import type { Note, Workspace } from '../../contracts/workspace';
import type { KnowledgeCollection, KnowledgeSource, KnowledgeView } from '../../contracts/knowledge';
import { Button, Empty, Field, IconButton, Input, Modal, Select, Textarea } from '../components/controls';
import { Glyph } from '../components/glyphs';
import { attachmentInputs } from '../components/attachments';
import { KnowledgeSources } from '../components/knowledge-sources';

type Props = { state: Workspace; onState: (next: Workspace) => void; report: (error: unknown) => void; onUse: (type: 'note' | 'collection', id: string) => void };
export function KnowledgeLibrary({ state, onState, report, onUse }: Props) {
  const [collectionId, setCollectionId] = useState('notes');
  const [filter, setFilter] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<KnowledgeSource[] | null>(null);
  const [views, setViews] = useState<KnowledgeView[]>([]);
  const [editing, setEditing] = useState<Note | null>(null);
  const [editingCollection, setEditingCollection] = useState<KnowledgeCollection | null>(null);
  const [remove, setRemove] = useState<{ kind: 'note' | 'collection'; id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [indexId, setIndexId] = useState<string | null>(null);
  const mounted = useRef(false); const searchEpoch = useRef(0); const owner = useRef(collectionId); owner.current = collectionId;
  const searchId = useRef<string | undefined>(undefined);
  const collection = state.knowledgeCollections.find((item) => item.id === collectionId);
  const documents = state.notes.filter((item) => collectionId === 'notes' ? !item.collectionId || !state.knowledgeCollections.some((base) => base.id === item.collectionId) : item.collectionId === collectionId);
  const filtered = documents.filter((item) => `${item.title}\n${item.content}`.toLowerCase().includes(filter.toLowerCase()));
  const view = views.find((item) => item.collectionId === collectionId);
  useEffect(() => {
    mounted.current = true; let active = true; let timer: ReturnType<typeof setTimeout>;
    async function refresh() { try { const next = await window.qiyao.knowledgeViews(); if (active) setViews(next); } catch (error) { if (active) report(error); } finally { if (active) timer = setTimeout(() => { void refresh(); }, 1000); } }
    void refresh(); return () => { active = false; mounted.current = false; searchEpoch.current++; clearTimeout(timer); if (searchId.current) void window.qiyao.stopKnowledgeSearch(searchId.current).catch(() => {}); };
  }, [report]);
  useEffect(() => { if (collectionId !== 'notes' && !collection) setCollectionId('notes'); }, [collectionId, collection]);
  function cancelSearch() { searchEpoch.current++; if (searchId.current) { void window.qiyao.stopKnowledgeSearch(searchId.current).catch(report); searchId.current = undefined; } setSearching(false); }
  function select(id: string) { cancelSearch(); setCollectionId(id); setResults(null); setFilter(''); setQuery(''); }
  async function mutate(operation: () => Promise<Workspace>, close?: () => void) {
    if (busy) return; setBusy(true);
    try { onState(await operation()); if (mounted.current) close?.(); } catch (error) { report(error); } finally { if (mounted.current) setBusy(false); }
  }
  async function importDocuments(files?: File[]) {
    if (busy) return; const target = collectionId;
    await mutate(async () => {
      const attachments = files ? await window.qiyao.importAttachments(await attachmentInputs(files)) : await window.qiyao.attachFiles();
      if (!attachments.length) return window.qiyao.load();
      if (!mounted.current || owner.current !== target) throw new Error('导入期间已切换资料集，文件未保存。请在目标资料集重新导入。');
      return window.qiyao.importKnowledgeDocuments(target, attachments);
    });
  }
  async function search() {
    if (!query.trim() || searching) return; const epoch = ++searchEpoch.current; const target = collectionId; const id = crypto.randomUUID(); searchId.current = id; setSearching(true);
    try { const found = await window.qiyao.searchKnowledge({ collections: [target], query, limit: 8 }, id); if (mounted.current && epoch === searchEpoch.current) setResults(found); }
    catch (error) { if (mounted.current && epoch === searchEpoch.current) report(error); } finally { if (mounted.current && epoch === searchEpoch.current) { searchId.current = undefined; setSearching(false); } }
  }
  async function buildIndex() {
    if (view?.status === 'indexing' || indexId) return; const id = collectionId; setIndexId(id);
    try { onState(await window.qiyao.buildKnowledgeIndex(id, Boolean(view?.indexed))); }
    catch (error) { if (!(error instanceof Error && /aborted/i.test(error.message))) report(error); } finally { if (mounted.current) setIndexId(null); }
  }
  return <div className="collection-page knowledge-library"><div className="page-heading knowledge-heading"><div><h1>资料库</h1><p>保存文档，检索片段，在对话中核对来源。</p></div><div className="knowledge-heading-actions">
    <Button disabled={busy} onClick={() => setEditingCollection({ id: crypto.randomUUID(), name: '', mode: 'keyword', createdAt: Date.now() })}>创建资料集</Button>
    <Button disabled={busy} onClick={() => { void importDocuments(); }}><Glyph name="attach" size={14} />导入文档</Button>
    <Button tone="solid" disabled={busy} onClick={() => setEditing({ id: crypto.randomUUID(), title: '', content: '', createdAt: Date.now(), ...(collectionId !== 'notes' ? { collectionId } : {}) })}><Glyph name="plus" size={16} />添加资料</Button>
  </div></div>
  <div className="knowledge-layout"><nav className="knowledge-collections" aria-label="资料集"><Button className={collectionId === 'notes' ? 'selected' : ''} aria-pressed={collectionId === 'notes'} onClick={() => select('notes')}>未分类资料</Button>{state.knowledgeCollections.map((item) => <Button className={collectionId === item.id ? 'selected' : ''} aria-pressed={collectionId === item.id} key={item.id} onClick={() => select(item.id)}>{item.name}</Button>)}</nav>
    <section className="knowledge-documents" onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = busy ? 'none' : 'copy'; } }} onDrop={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); void importDocuments([...event.dataTransfer.files]); } }}>
      <div className="knowledge-collection-heading"><h2>{collection?.name ?? '未分类资料'}</h2><div><Button onClick={() => onUse('collection', collectionId)}>用于对话<Glyph name="right" size={14} /></Button>{collection && <><IconButton icon="settings" label="编辑资料集" disabled={busy} onClick={() => setEditingCollection(collection)} /><IconButton icon="trash" label="删除资料集" disabled={busy} onClick={() => setRemove({ kind: 'collection', id: collectionId })} /></>}</div></div>
      <p className="field-hint">{documents.length} 份资料 · {collection?.mode === 'semantic' ? '语义检索' : collection?.mode === 'hybrid' ? '关键词与语义检索' : '本地关键词检索'}{collection?.mode !== 'keyword' && collection?.embedding ? ` · 已索引 ${view?.indexed ?? 0}/${documents.filter((note) => note.content.trim()).length}` : ''}</p>
      {collection?.mode !== 'keyword' && collection?.embedding && <div className="knowledge-index-controls">{view?.status === 'indexing' || indexId === collectionId ? <><p role="status">正在建立语义索引 {view?.status === 'indexing' ? view.completed : 0}/{view?.status === 'indexing' ? view.total : documents.filter((note) => note.content.trim()).length}</p><Button onClick={() => { void window.qiyao.stopKnowledgeIndex(collectionId).catch(report); }}>停止索引</Button></> : <Button disabled={busy || Boolean(indexId) || !documents.some((note) => note.content.trim())} onClick={() => { void buildIndex(); }}>{view?.indexed ? '重建语义索引' : '建立语义索引'}</Button>}{view?.error && <p className="inline-error">{view.error}</p>}</div>}
      <div className="knowledge-query"><Input aria-label="检索资料内容" placeholder="输入问题，查找相关片段…" maxLength={2000} value={query} onChange={(event) => { cancelSearch(); setQuery(event.target.value); setResults(null); }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void search(); } }} /><Button disabled={!query.trim() || searching} onClick={() => { void search(); }}>{searching ? '正在检索…' : '检索'}</Button>{searching && <Button onClick={cancelSearch}>停止检索</Button>}</div>
      {results && (results.length ? <KnowledgeSources sources={results} /> : <p className="field-hint" role="status">没有找到匹配片段，请换一个问题或检查资料集。</p>)}
      {busy && <p role="status" className="field-hint">正在保存或导入资料…</p>}
      <Input aria-label="筛选列表" className="collection-search" placeholder="筛选资料…" value={filter} onChange={(event) => setFilter(event.target.value)} />
      {filtered.length ? <div className="item-list">{filtered.map((item) => <div className="list-row" key={item.id}><span className="row-symbol"><Glyph name="library" size={22} /></span><Button className="row-content" onClick={() => setEditing(item)}><strong>{item.title}</strong><span>{item.source ? `${item.source.format.toUpperCase()} · ` : ''}{item.content.slice(0, 100)}</span></Button><Button onClick={() => onUse('note', item.id)}>用于对话<Glyph name="right" size={14} /></Button><IconButton icon="trash" label={`删除 ${item.title}`} disabled={busy} onClick={() => setRemove({ kind: 'note', id: item.id })} /></div>)}</div> : <Empty icon="library" title={filter ? '没有匹配的内容' : '这里还没有资料'} detail={filter ? '试试更短的关键词。' : '添加文本或导入 PDF、Office 与 OpenDocument 文档。'} />}
    </section>
  </div>
    {editing && <Modal title="编辑资料" onClose={() => setEditing(null)} footer={<><Button disabled={busy} onClick={() => setEditing(null)}>取消</Button><Button tone="solid" disabled={busy || !editing.title.trim()} onClick={() => { void mutate(() => window.qiyao.saveNote(editing), () => { setEditing(null); setResults(null); }); }}>保存</Button></>}>
      <Field label="标题"><Input autoFocus maxLength={160} value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} /></Field>
      <Field label="资料集"><Select value={editing.collectionId ?? 'notes'} onChange={(event) => setEditing({ ...editing, collectionId: event.target.value === 'notes' ? undefined : event.target.value })}><option value="notes">未分类资料</option>{state.knowledgeCollections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
      {editing.source && <p className="field-hint">{editing.source.name} · {editing.source.format.toUpperCase()} · 保存修改后需重建语义索引。</p>}
      <Field label="内容"><Textarea rows={10} maxLength={1_000_000} value={editing.content} placeholder="粘贴文档、笔记或资料…" onChange={(event) => setEditing({ ...editing, content: event.target.value })} /></Field>
    </Modal>}
    {editingCollection && <Modal title="编辑资料集" onClose={() => setEditingCollection(null)} footer={<><Button disabled={busy} onClick={() => setEditingCollection(null)}>取消</Button><Button tone="solid" disabled={busy || !editingCollection.name.trim() || editingCollection.mode !== 'keyword' && (!editingCollection.embedding?.providerId || !editingCollection.embedding.model.trim())} onClick={() => { const item = editingCollection; void mutate(() => window.qiyao.saveKnowledgeCollection(item), () => { setEditingCollection(null); select(item.id); }); }}>保存</Button></>}>
      <Field label="资料集名称"><Input autoFocus maxLength={160} value={editingCollection.name} onChange={(event) => setEditingCollection({ ...editingCollection, name: event.target.value })} /></Field>
      <Field label="检索方式"><Select value={editingCollection.mode} onChange={(event) => setEditingCollection({ ...editingCollection, mode: event.target.value as KnowledgeCollection['mode'], ...(event.target.value !== 'keyword' && !editingCollection.embedding ? { embedding: { providerId: state.providers.find((item) => item.kind !== 'anthropic')?.id ?? '', model: '', geminiTask: 'none' } } : {}) })}><option value="keyword">本地关键词</option><option value="hybrid">关键词与语义</option><option value="semantic">语义</option></Select></Field>
      {editingCollection.mode !== 'keyword' && editingCollection.embedding && <><p className="field-hint">建立索引时，文档片段会发送到所选连接；检索时会发送问题。更换模型、地址或修改资料后需重建索引。</p>
        <Field label="嵌入模型连接"><Select value={editingCollection.embedding.providerId} onChange={(event) => setEditingCollection({ ...editingCollection, embedding: { ...editingCollection.embedding!, providerId: event.target.value } })}><option value="">选择连接…</option>{state.providers.filter((item) => item.kind !== 'anthropic').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
        <Field label="嵌入模型"><Input maxLength={128} value={editingCollection.embedding.model} placeholder="模型或 Azure 部署名称" onChange={(event) => setEditingCollection({ ...editingCollection, embedding: { ...editingCollection.embedding!, model: event.target.value } })} /></Field>
        <Field label="向量维度（可选）"><Input type="number" min="1" max="4096" value={editingCollection.embedding.dimensions ?? ''} onChange={(event) => setEditingCollection({ ...editingCollection, embedding: { ...editingCollection.embedding!, dimensions: event.target.value ? Number(event.target.value) : undefined } })} /></Field>
        {state.providers.find((item) => item.id === editingCollection.embedding!.providerId)?.kind === 'gemini' && <Field label="Gemini 任务格式"><Select value={editingCollection.embedding.geminiTask} onChange={(event) => setEditingCollection({ ...editingCollection, embedding: { ...editingCollection.embedding!, geminiTask: event.target.value as 'none' | 'task-type' | 'instruction' } })}><option value="none">不指定任务</option><option value="task-type">任务字段（Embedding 1）</option><option value="instruction">任务前缀（Embedding 2）</option></Select></Field>}
      </>}
    </Modal>}
    {remove && <Modal title={remove.kind === 'collection' ? '删除资料集？' : '删除资料？'} onClose={() => setRemove(null)} footer={<><Button disabled={busy} onClick={() => setRemove(null)}>取消</Button><Button tone="danger" disabled={busy} onClick={() => { const target = remove; void mutate(() => target.kind === 'collection' ? window.qiyao.removeKnowledgeCollection(target.id) : window.qiyao.removeNote(target.id), () => { setRemove(null); setResults(null); if (target.kind === 'collection') select('notes'); }); }}>删除</Button></>}><p>{remove.kind === 'collection' ? '资料将保留在未分类资料中，语义索引和对话中的资料集选择会移除。已有回复的来源片段会保留。' : '此项将从本地资料库移除，已有对话及其来源片段会保留。'}</p></Modal>}
  </div>;
}
