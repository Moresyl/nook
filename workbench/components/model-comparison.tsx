import { useLayoutEffect, useRef, useState } from 'react';
import type { ComposerDraft, Thread, Workspace } from '../../contracts/workspace';
import { comparisonReply, comparisonThreads, type ComparisonRequest, type ComparisonResult } from '../../contracts/model-comparisons';
import { uiErrorMessage } from '../../contracts/ui-errors';
import { Button, Field, Modal, Select, Textarea } from './controls';

type Props = { state: Workspace; draft: ComposerDraft; groupId?: string; onClose: () => void; onCompare: (models: ComparisonRequest['models']) => Promise<ComparisonResult>; onOpen: (id: string) => Promise<void> };
export function ModelComparison({ state, draft, groupId: initialGroupId, onClose, onCompare, onOpen }: Props) {
  const options = state.providers.flatMap((provider) => provider.models.map((model) => ({ providerId: provider.id, model })));
  const [models, setModels] = useState<ComparisonRequest['models']>(() => {
    const first = options.find((item) => item.providerId === draft.providerId && item.model === draft.model) ?? options[0];
    const second = options.find((item) => JSON.stringify(item) !== JSON.stringify(first));
    return [first, second].filter((item): item is ComparisonRequest['models'][number] => Boolean(item));
  });
  const [groupId, setGroupId] = useState(initialGroupId); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  let members: Thread[] = []; let historyError = '';
  try { if (groupId) members = comparisonThreads(state.threads, groupId); } catch (failure) { historyError = failure instanceof Error ? failure.message : '比较记录无法读取。'; }
  const errorRef = useRef<HTMLParagraphElement>(null); const failure = error || historyError;
  useLayoutEffect(() => { if (failure) errorRef.current?.scrollIntoView({ block: 'nearest' }); }, [failure]);
  const close = () => { if (!busy) onClose(); };
  async function run(action: () => Promise<void>) {
    if (busy) return; setBusy(true); setError('');
    try { await action(); } catch (failure) { setError(uiErrorMessage(failure)); } finally { setBusy(false); }
  }
  const valid = models.length >= 2 && models.length <= 4 && new Set(models.map((item) => JSON.stringify([item.providerId, item.model]))).size === models.length && models.every((item) => options.some((option) => option.providerId === item.providerId && option.model === item.model));
  return <Modal title="模型比较" dismissible={!busy} onClose={close} footer={<><Button disabled={busy} onClick={close}>关闭</Button>{groupId ? <Button disabled={busy || !members.some((thread) => thread.messages.some((message) => message.status === 'running'))} onClick={() => { void run(async () => { await Promise.all(members.filter((thread) => thread.messages.some((message) => message.status === 'running')).map((thread) => window.qiyao.stop(thread.id))); }); }}>停止本组生成</Button> : <Button tone="solid" disabled={busy || !valid || !draft.text.trim()} onClick={() => { void run(async () => { const result = await onCompare(models); setGroupId(result.groupId); }); }}>发送并比较</Button>}</>}>
    {groupId ? <><p className="field-hint">各个回复独立生成。停止、失败或继续某条对话不会影响其他模型。这里预览本次问题的回复；打开对话后可重试或继续，各自草稿保留。</p>{!members.length && !historyError && <p className="field-hint">本组对话已被删除。</p>}<div className="comparison-results">{members.map((thread) => {
      const { message: reply, providerName, model } = comparisonReply(thread); const running = reply?.status === 'running';
      return <section key={thread.id} className="comparison-result" aria-label={`比较回复 ${thread.comparison!.index + 1}`}><h3>{providerName ?? (!reply ? state.providers.find((provider) => provider.id === thread.providerId)?.name ?? '已移除的连接' : '未记录原始连接')} · {model ?? (!reply ? thread.model : '未记录原始模型')}</h3><p className="field-hint">{reply ? { running: '生成中', complete: '已完成', stopped: '已停止', error: '未完成' }[reply.status] : '正在准备'}{thread.temporary ? ' · 临时聊天' : ''}</p><Field label={`回复 ${thread.comparison!.index + 1}`}><Textarea readOnly rows={8} value={reply?.content ?? ''} /></Field>{reply?.error && <p className="inline-error">{reply.error}</p>}<div className="comparison-actions"><Button disabled={busy} onClick={() => { void run(async () => { await onOpen(thread.id); onClose(); }); }}>打开此对话</Button><Button disabled={busy || !running} onClick={() => { void run(async () => { await window.qiyao.stop(thread.id); }); }}>停止此回复</Button></div></section>;
    })}</div></> : <><p className="field-hint">选择 2–4 个不同的提供商／模型，发送同一问题、当前完整上下文和附件。使用当前助手与项目说明，以聊天方式比较，本次不调用工具或检索新资料。当前聊天和草稿保留；消息会发送给全部所选模型服务。</p><Field label="本次比较问题"><Textarea readOnly rows={4} value={draft.text} /></Field>{draft.attachments.length > 0 && <p className="field-hint">附件：{draft.attachments.map((file) => file.name).join('、')}</p>}{models.map((selected, index) => {
      const provider = state.providers.find((provider) => provider.id === selected.providerId);
      return <div key={index} className="comparison-model-row"><Field label={`比较连接 ${index + 1}`}><Select disabled={busy} value={selected.providerId} onChange={(event) => { const provider = state.providers.find((provider) => provider.id === event.target.value); setModels((models) => models.map((model, position) => position === index ? { providerId: event.target.value, model: provider?.models[0] ?? '' } : model)); }}>{state.providers.filter((provider) => provider.models.length).map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</Select></Field><Field label={`比较模型 ${index + 1}`}><Select disabled={busy} value={selected.model} onChange={(event) => setModels((models) => models.map((model, position) => position === index ? { ...model, model: event.target.value } : model))}>{provider?.models.map((model) => <option key={model} value={model}>{model}</option>)}</Select></Field><Button disabled={busy || models.length <= 2} aria-label={`移除比较模型 ${index + 1}`} onClick={() => setModels((models) => models.filter((_model, position) => position !== index))}>移除</Button></div>;
    })}<Button disabled={busy || models.length >= 4 || !options.length} onClick={() => { const next = options.find((item) => !models.some((selected) => JSON.stringify(selected) === JSON.stringify(item))); if (next) setModels([...models, next]); }}>添加比较模型</Button>{!valid && <p className="field-hint">请配置并选择至少两个不同的提供商／模型。</p>}{state.threads.find((thread) => thread.id === draft.threadId)?.temporary && <p className="field-hint">本组继承临时聊天：不写入本机历史和完整备份，关闭应用后清除。</p>}</>}
    {failure && <p ref={errorRef} className="inline-error" role="alert">{failure}</p>}
  </Modal>;
}
