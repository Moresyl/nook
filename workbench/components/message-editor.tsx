import { useEffect, useRef, useState } from 'react';
import { conversationRevision } from '../../contracts/conversations';
import type { Message, Thread } from '../../contracts/workspace';
import { Button, Field, Modal, Textarea } from './controls';
import { AttachmentList } from './attachments';
import { MessageDraftBuffer } from './message-drafts';

type Props = { thread: Thread; message: Message; onSubmit: (content: string, revision: string) => Promise<void>; onSave: (content: string, revision: string) => Promise<void>; onDiscard: () => Promise<void>; onClose: () => void };
export function MessageEditor({ thread, message, onSubmit, onSave, onDiscard, onClose }: Props) {
  const [content, setContent] = useState(message.content);
  const [revision, setRevision] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const buffer = useRef<MessageDraftBuffer | null>(null); const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const limit = message.role === 'user' ? 256_000 : 4_000_000;
  const failureText = (failure: unknown) => failure instanceof Error ? failure.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : '保存失败，请重试。';
  async function flush() { clearTimeout(timer.current); await buffer.current?.flush(); }
  useEffect(() => {
    let live = true;
    void Promise.all([conversationRevision(thread), window.qiyao.load()]).then(([value, state]) => {
      if (!live) return;
      const saved = state.messageDrafts.find((draft) => draft.threadId === thread.id && draft.messageId === message.id);
      const draft = saved ?? { threadId: thread.id, messageId: message.id, content: message.content, revision: value, updatedAt: Date.now() };
      buffer.current = new MessageDraftBuffer(draft, (input) => window.qiyao.saveMessageDraft(input), () => window.qiyao.removeMessageDraft({ threadId: thread.id, messageId: message.id }));
      setContent(draft.content); setRevision(draft.revision); setStale(draft.revision !== value);
    }).catch(() => { if (live) setError('无法打开这条消息，请关闭后重试。'); });
    const unsubscribe = window.qiyao.onBeforeClose(flush);
    return () => { live = false; unsubscribe(); clearTimeout(timer.current); void buffer.current?.flush().catch(() => {}); };
  }, [thread, message]);
  const ready = Boolean(revision && content.trim() && content.length <= limit && !busy);
  async function submit(saveOnly = false) {
    if (!ready) return;
    setBusy(true); setError('');
    try { await flush(); await (saveOnly ? onSave : onSubmit)(content, revision); buffer.current?.consume(); }
    catch (failure) { setError(failureText(failure)); }
    finally { setBusy(false); }
  }
  async function close() { if (busy) return; setBusy(true); try { await flush(); onClose(); } catch (failure) { setError(failureText(failure)); } finally { setBusy(false); } }
  async function discard() { if (busy || !buffer.current) return; setBusy(true); setError(''); clearTimeout(timer.current); try { await buffer.current.discard(); await onDiscard(); } catch (failure) { setError(failureText(failure)); } finally { setBusy(false); } }
  return <Modal title="编辑消息" onClose={() => { void close(); }} footer={<><Button disabled={busy} onClick={() => { void close(); }}>取消</Button><Button tone={message.role === 'assistant' ? 'solid' : 'ghost'} disabled={!ready} onClick={() => { void submit(true); }}>仅保存</Button>{message.role === 'user' && <Button tone="solid" disabled={!ready} onClick={() => { void submit(); }}>在新分支中发送</Button>}</>}>
    <p className="field-hint">仅保存会更新当前消息并保留后续对话，编辑前的完整对话{thread.temporary ? '作为临时版本保留至退出应用' : '存入“已归档”'}，不会请求模型。用户消息还可在新分支中发送。编辑草稿{thread.temporary ? '仅在本次应用运行期间保留' : '会单独保留'}，取消后可重新打开。</p>
    {stale && <p className="inline-error">保存草稿后对话已有变化，保存和发送会拒绝覆盖。请先复制需要的文本，或放弃编辑草稿后重新编辑当前消息。</p>}
    <Field label="消息内容"><Textarea autoFocus rows={8} maxLength={limit} disabled={busy || !revision} value={content} onChange={(event) => { const value = event.target.value; setContent(value); buffer.current?.stage(value); clearTimeout(timer.current); timer.current = setTimeout(() => { void flush().catch((failure) => setError(failureText(failure))); }, 250); }} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && (event.key === 'Enter' || event.key.toLowerCase() === 's')) { event.preventDefault(); void submit(message.role === 'assistant' || event.key.toLowerCase() === 's'); } }} /></Field>
    <Button disabled={busy || !revision} onClick={() => { void discard(); }}>放弃编辑草稿</Button>
    {message.attachments.length > 0 && <><p className="field-hint">保留附件</p><AttachmentList files={message.attachments} /></>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </Modal>;
}
