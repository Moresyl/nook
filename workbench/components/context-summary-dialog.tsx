import { useEffect, useRef, useState } from 'react';
import type { ContextSummaryPreview } from '../../contracts/context-summary-actions';
import type { Thread, Workspace } from '../../contracts/workspace';
import { contextSummaryPrefix } from '../../contracts/context-summaries';
import { uiErrorMessage } from '../../contracts/ui-errors';
import { Button, Field, Input, Modal, Select, Textarea } from './controls';
import { ModelUsage } from './model-usage';

const digest = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, '0')).join('');
export function ContextSummaryDialog({ thread, state, providerId: initialProvider, model: initialModel, onState, onClose }: { thread: Thread; state: Workspace; providerId: string; model: string; onState: (state: Workspace) => void; onClose: () => void }) {
  const [providerId, setProviderId] = useState(initialProvider), [model, setModel] = useState(initialModel), [keep, setKeep] = useState(2);
  const [preview, setPreview] = useState<ContextSummaryPreview>(), [selected, setSelected] = useState(thread.activeContextSummaryId ?? thread.contextSummaries?.at(-1)?.id ?? '');
  const [text, setText] = useState(thread.contextSummaries?.find(item => item.id === selected)?.content ?? '');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [valid, setValid] = useState<boolean>();
  const pending = useRef<string | undefined>(undefined), alive = useRef(true), working = useRef(false), cancelled = useRef(false), drafts = useRef(new Map<string, string>());
  const provider = state.providers.find(item => item.id === providerId);
  const summary = selected === preview?.id ? preview : thread.contextSummaries?.find(item => item.id === selected);
  const running = thread.messages.some(item => item.status === 'running');
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (pending.current) void window.qiyao.stopContextSummary(pending.current).catch(() => {}); }; }, []);
  useEffect(() => {
    let current = true; setValid(undefined);
    if (!summary) { setValid(false); return; }
    void (async () => {
      try { const prefix = contextSummaryPrefix(thread, summary.throughMessageId); const matches = prefix.messages.length === summary.messageCount && await digest(prefix.history) === summary.sourceRevision; if (current) setValid(matches); }
      catch { if (current) setValid(false); }
    })(); return () => { current = false; };
  }, [thread, summary]);
  async function run(action: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true); setError(''); setNotice(''); cancelled.current = false;
    try { await action(); } catch (problem) { if (alive.current) { if (cancelled.current) setNotice('已停止生成，现有摘要与原文已保留。'); else setError(uiErrorMessage(problem)); } }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }
  function choose(id: string) {
    drafts.current.set(selected, text); setSelected(id);
    setText(drafts.current.get(id) ?? (id === preview?.id ? preview.content : thread.contextSummaries?.find(item => item.id === id)?.content) ?? '');
  }
  async function generate() {
    const requestId = crypto.randomUUID(); pending.current = requestId;
    try {
      const next = await window.qiyao.generateContextSummary({ threadId: thread.id, requestId, providerId, model, keepRecentTurns: keep });
      if (alive.current) { drafts.current.set(selected, text); setPreview(next); setSelected(next.id); setText(next.content); }
    } finally { if (pending.current === requestId) pending.current = undefined; }
  }
  async function change(input: Parameters<typeof window.qiyao.changeContextSummary>[0]) {
    const next = await window.qiyao.changeContextSummary(input); if (alive.current) onState(next);
  }
  return <Modal title="会话上下文" className="context-summary-dialog" dismissible={!busy} onClose={onClose} footer={<>
    {pending.current ? <Button onClick={() => { cancelled.current = true; void window.qiyao.stopContextSummary(pending.current!).catch(problem => setError(uiErrorMessage(problem))); }}>停止生成</Button> : <Button disabled={busy} onClick={onClose}>关闭</Button>}
    {thread.activeContextSummaryId && <Button disabled={busy || running} onClick={() => { void run(() => change({ action: 'select', threadId: thread.id })); }}>恢复完整上下文</Button>}
    {summary && <Button tone="solid" disabled={busy || running || !valid || !text.trim()} onClick={() => { void run(async () => {
      if (summary.id === preview?.id) { await change({ action: 'apply', threadId: thread.id, previewId: summary.id, content: text }); setPreview(undefined); }
      else { if (text !== summary.content) await change({ action: 'edit', threadId: thread.id, summaryId: summary.id, revision: await digest(JSON.stringify(summary)), content: text }); await change({ action: 'select', threadId: thread.id, summaryId: summary.id }); }
    }); }}>保存并使用摘要</Button>}
  </>}>
    <p className="field-hint">完整消息、附件和工具记录仍保留在聊天历史中。使用摘要后，下次请求只发送摘要和未覆盖的近期消息。摘要可能遗漏信息，请先检查。</p>
    <div className="section-heading"><strong>{thread.activeContextSummaryId ? '已选择摘要' : '使用完整上下文'}</strong><span className="muted">原始消息 {thread.messages.length} 条</span></div>
    <details className="context-summary-options" open={!summary}><summary>生成选项</summary><div className="context-summary-settings">
      <Field label="摘要提供商"><Select disabled={busy || running} value={providerId} onChange={event => { setProviderId(event.target.value); setModel(state.providers.find(item => item.id === event.target.value)?.models[0] ?? ''); }}>{state.providers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
      <Field label="摘要模型"><Select disabled={busy || running} value={model} onChange={event => setModel(event.target.value)}>{provider?.models.map(item => <option key={item} value={item}>{item}</option>)}</Select></Field>
      <Field label="保留最近轮数" hint="保留完整的用户提问和对应回复；0 表示概括全部已完成消息。"><Input type="number" min={0} max={20} step={1} disabled={busy || running} value={Number.isNaN(keep) ? '' : keep} onChange={event => setKeep(event.target.value === '' ? NaN : Number(event.target.value))} /></Field>
    </div>
    <Button disabled={busy || running || !provider?.models.includes(model) || !Number.isInteger(keep) || keep < 0 || keep > 20} onClick={() => { void run(generate); }}>{busy && pending.current ? '正在生成摘要…' : '生成新摘要'}</Button>
    <p className="field-hint">生成摘要会向所选模型发送较早的原文和附件，并产生一次模型请求。项目工具和扩展不会参与。当前每次原文请求上限为 4 MB，实际可接受长度取决于模型。</p></details>
    {(preview || thread.contextSummaries?.length) ? <Field label="摘要版本"><Select value={selected} disabled={busy} onChange={event => choose(event.target.value)}><option value="">选择摘要…</option>{preview && <option value={preview.id}>新摘要 · 尚未保存</option>}{thread.contextSummaries?.map((item, index) => <option key={item.id} value={item.id}>摘要 {index + 1} · {item.messageCount} 条原文{item.id === thread.activeContextSummaryId ? ' · 当前使用' : ''}</option>)}</Select></Field> : null}
    {summary && <>
      <p className="field-hint" role="status">{valid === undefined ? '正在检查原文…' : valid ? `覆盖前 ${summary.messageCount} 条消息，保留 ${Math.max(0, thread.messages.length - summary.messageCount)} 条近期消息。` : '原文已变化，此摘要不能使用。发送时会恢复完整上下文，请重新生成。'}</p>
      <Field label="摘要内容"><Textarea className="context-summary-text" maxLength={256_000} disabled={busy} value={text} onChange={event => { setText(event.target.value); drafts.current.set(selected, event.target.value); }} /></Field>
      {!!summary.invocations?.length && <ModelUsage invocations={summary.invocations} />}
      {summary.id !== preview?.id && <Button disabled={busy || running || summary.id === thread.activeContextSummaryId} onClick={() => { void run(async () => { await change({ action: 'delete', threadId: thread.id, summaryId: summary.id }); drafts.current.delete(summary.id); setSelected(''); setText(''); }); }}>删除此摘要</Button>}
    </>}
    {error && <p className="error-banner" role="alert">{error}</p>}
    {notice && <p className="field-hint" role="status">{notice}</p>}
  </Modal>;
}
