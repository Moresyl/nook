import { useState } from 'react';
import type { ReplyVersion } from '../../contracts/reply-versions';
import { Button, Field, Modal, Select, Textarea } from './controls';

type Props = { versions: ReplyVersion[]; messageId: string; onSelect: (threadId: string) => Promise<void> };
export function ReplyVersions({ versions, messageId, onSelect }: Props) {
  const [open, setOpen] = useState(false); const [selectedId, setSelectedId] = useState(messageId); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  if (versions.length < 2) return null;
  const selected = versions.find((item) => item.message.id === selectedId); const position = versions.findIndex((item) => item.message.id === messageId);
  const status = { complete: '已完成', stopped: '已停止', error: '未完成', running: '生成中' };
  const close = () => { if (!busy) setOpen(false); };
  async function select() {
    if (!selected || busy || selected.message.id === messageId) return;
    setBusy(true); setError('');
    try { await onSelect(selected.threadId); setOpen(false); } catch (failure) { setError(failure instanceof Error ? failure.message : '无法打开这个版本，请重试。'); } finally { setBusy(false); }
  }
  return <><Button className="reply-version-button" aria-label="查看回复版本" onClick={() => { setSelectedId(messageId); setError(''); setOpen(true); }}>版本 {position + 1} / {versions.length}</Button>
    {open && <Modal title="回复版本" onClose={close} footer={<><Button disabled={busy} onClick={close}>取消</Button><Button tone="solid" disabled={busy || !selected || selected.message.id === messageId} onClick={() => { void select(); }}>打开此版本</Button></>}>
      <p className="field-hint">切换后使用这个版本的上下文，各自的后续对话和草稿会保留。预览和切换不会请求模型。旧回复也可在“已归档”中管理。</p>
      <Field label="选择回复版本"><Select autoFocus disabled={busy} value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setError(''); }}>{versions.map((item, index) => <option key={item.message.id} value={item.message.id}>{index + 1} / {versions.length} · {item.message.editedAt !== undefined ? '手动编辑 · ' : ''}{item.model || '未记录模型'} · {status[item.message.status]}</option>)}</Select></Field>
      {selected ? <><Field label="回复预览"><Textarea readOnly rows={12} value={selected.message.content} /></Field>{selected.message.error && <p className="inline-error">{selected.message.error}</p>}</> : <p className="field-hint">这个版本已被删除，请选择其他版本。</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
    </Modal>}
  </>;
}
