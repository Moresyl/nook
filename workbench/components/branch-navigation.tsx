import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { conversationBranches } from '../../contracts/conversation-branches';
import type { Thread } from '../../contracts/workspace';
import { Button, Field, IconButton, Input, Modal, Textarea } from './controls';

type Props = { thread: Thread; threads: Thread[]; onSelect: (threadId: string) => Promise<void> };
const pageSize = 200;
const relation = { branch: '消息分支', edit: '编辑分支', reply: '回复版本', message: '编辑前记录' };

export function BranchNavigation({ thread, threads, onSelect }: Props) {
  const [open, setOpen] = useState(false); const [selectedId, setSelectedId] = useState(thread.id); const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(-1); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const errorRef = useRef<HTMLParagraphElement>(null);
  const navigation = useMemo(() => {
    try { return { nodes: open ? conversationBranches(threads, thread.id) : [], error: '' }; }
    catch { return { nodes: [], error: '无法读取对话分支，请恢复有效的备份后重试。' }; }
  }, [open, threads, thread.id]);
  const nodes = navigation.nodes; const failure = error || navigation.error;
  useEffect(() => { if (failure) errorRef.current?.scrollIntoView({ block: 'nearest' }); }, [failure]);
  const filtered = nodes.filter(({ thread }) => `${thread.title}\n${thread.model}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const currentIndex = Math.max(0, filtered.findIndex((node) => node.thread.id === thread.id));
  const start = Math.min(offset < 0 ? Math.floor(currentIndex / pageSize) * pageSize : offset, Math.max(0, Math.ceil(filtered.length / pageSize) - 1) * pageSize);
  const selected = nodes.find((node) => node.thread.id === selectedId); const parentId = thread.forkedFrom?.threadId;
  const parent = nodes.find((node) => node.thread.id === parentId && node.thread.id !== thread.id);
  const source = selected?.thread.messages.at(-1)?.content ?? ''; const preview = source.slice(0, (source.codePointAt(3999) ?? 0) > 0xffff ? 3999 : 4000);
  const close = () => { if (!busy) setOpen(false); };
  async function select(id: string) {
    if (busy || id === thread.id) return; setBusy(true); setError('');
    try { await onSelect(id); setOpen(false); } catch (failure) { setError(failure instanceof Error ? failure.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : '无法打开这条对话，请重试。'); } finally { setBusy(false); }
  }
  if (!thread.forkedFrom && !threads.some((item) => item.forkedFrom?.threadId === thread.id)) return null;
  return <><IconButton icon="branch" label="查看对话分支" onClick={() => { setSelectedId(thread.id); setQuery(''); setOffset(-1); setError(''); setOpen(true); }} />
    {open && <Modal title="对话分支" className="branch-navigation" onClose={close} footer={<><Button disabled={busy} onClick={close}>取消</Button>{parent && <Button disabled={busy} onClick={() => { void select(parent.thread.id); }}>打开原对话</Button>}<Button tone="solid" disabled={busy || !selected || selected.thread.id === thread.id} onClick={() => { if (selected) void select(selected.thread.id); }}>打开所选对话</Button></>}>
      <p className="field-hint">每条路径保留完整的上下文和独立草稿。浏览和切换不会请求模型，已归档的分支也可以继续使用。</p>
      {failure && <p ref={errorRef} className="inline-error" role="alert">{failure}</p>}
      {!navigation.error && <><Input autoFocus aria-label="搜索对话分支" maxLength={512} disabled={busy} placeholder="搜索对话名称或模型…" value={query} onChange={(event) => { setQuery(event.target.value); setOffset(0); }} />
      <ol className="branch-tree" aria-label="对话分支关系">{filtered.slice(start, start + pageSize).map((node) => <li key={node.thread.id} style={{ '--branch-depth': Math.min(node.depth, 8) } as CSSProperties}><Button className={`branch-node ${node.thread.id === selectedId ? 'selected' : ''}`} data-thread-id={node.thread.id} aria-pressed={node.thread.id === selectedId} aria-current={node.thread.id === thread.id ? 'page' : undefined} disabled={busy} onClick={() => { setSelectedId(node.thread.id); setError(''); }}><strong>{node.thread.title}</strong><span>{node.parentMissing ? '原对话已删除' : node.cycleRoot ? '原对话关系异常' : node.parentId && node.thread.forkedFrom ? relation[node.thread.forkedFrom.kind] : '起始对话'} · {node.thread.model || '未选择模型'} · {node.thread.messages.length} 条消息{node.thread.archived && ' · 已归档'}{node.thread.id === thread.id && ' · 当前对话'}</span></Button></li>)}</ol>
      <div className="branch-pagination"><span className="field-hint" aria-live="polite">{filtered.length ? `${start + 1}–${Math.min(start + pageSize, filtered.length)} / ${filtered.length}` : '没有匹配的对话'}</span><Button disabled={busy || start === 0} onClick={() => setOffset(Math.max(0, start - pageSize))}>上一页</Button><Button disabled={busy || start + pageSize >= filtered.length} onClick={() => setOffset(start + pageSize)}>下一页</Button></div>
      {selected ? <Field label={`最后一条消息预览 · ${selected.thread.title}`} hint="预览最多 4,000 个字符，打开后保留完整内容。"><Textarea readOnly rows={6} value={preview} /></Field> : <p className="field-hint">所选对话已被删除，请选择其他分支。</p>}</>}
    </Modal>}
  </>;
}
