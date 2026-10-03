import { useState } from 'react';
import { summarizeUsage, type ModelInvocation, type TokenUsage } from '../../contracts/models';
import { Button, Modal } from './controls';

const fields: { key: keyof Omit<TokenUsage, 'invalid'>; label: string }[] = [
  { key: 'inputTokens', label: '输入' }, { key: 'outputTokens', label: '输出' }, { key: 'totalTokens', label: '合计' },
  { key: 'cachedInputTokens', label: '缓存读取（含在输入中）' }, { key: 'cacheWriteTokens', label: '缓存写入（含在输入中）' },
  { key: 'reasoningTokens', label: '推理（含在输出中）' }, { key: 'toolInputTokens', label: '工具提示明细' },
];
const status = { running: '进行中', complete: '已完成', interrupted: '已中断', error: '请求失败' };
const count = (value?: number) => value === undefined ? '未返回' : value.toLocaleString('zh-CN');

export function ModelUsage({ invocations }: { invocations: ModelInvocation[] }) {
  const [open, setOpen] = useState(false);
  const summary = summarizeUsage(invocations);
  return <div className="message-usage"><Button className="usage-button" aria-label="查看 token 用量" onClick={() => setOpen(true)}>{summary.reported ? `${summary.counts.totalTokens === undefined ? 'Token 用量' : `${count(summary.counts.totalTokens)} tokens`}${summary.partial ? ' · 部分数据' : ''}` : '用量未返回'} · {summary.requests} 次请求</Button>
    {open && <Modal title="Token 用量" onClose={() => setOpen(false)}>
      <p className="field-hint">统计来自模型服务。工具续接的每次请求分别计数；缓存与推理是明细，不再加到合计中。缺失或中断的数据不能用作最终账单。</p>
      <dl className="usage-counts">{fields.filter((field) => ['inputTokens', 'outputTokens', 'totalTokens'].includes(field.key) || summary.counts[field.key] !== undefined).map((field) => <div key={field.key}><dt>{field.label}</dt><dd>{count(summary.counts[field.key])}{summary.coverage[field.key] !== undefined && summary.coverage[field.key] !== summary.requests && <small> · {summary.coverage[field.key]}/{summary.requests} 次请求</small>}</dd></div>)}</dl>
      {summary.partial && <p className="field-hint">当前包含部分数据。已知值保留，未知值不按零计算。</p>}
      <div className="usage-requests">{invocations.map((item) => <section className="usage-request" key={item.round}><div className="section-heading"><strong>第 {item.round + 1} 次请求</strong><span className="muted">{status[item.status]}</span></div><p className="usage-model">{item.providerName} · {item.model}</p>{item.tokens && fields.some((field) => item.tokens?.[field.key] !== undefined) ? <dl className="usage-counts">{fields.filter((field) => ['inputTokens', 'outputTokens', 'totalTokens'].includes(field.key) || item.tokens?.[field.key] !== undefined).map((field) => <div key={field.key}><dt>{field.label}</dt><dd>{count(item.tokens?.[field.key])}</dd></div>)}</dl> : <p className="field-hint">服务未返回用量。</p>}{item.tokens?.invalid && <p className="field-hint">服务返回了无效的计数，已忽略异常字段。</p>}</section>)}</div>
    </Modal>}
  </div>;
}
