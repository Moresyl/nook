import { useState } from 'react';
import { modelInfoSchema, type ModelInfo } from '../../contracts/models';
import type { Provider } from '../../contracts/workspace';
import { Field, Input, Select } from '../components/controls';
import { setModelInfo } from './model-settings';

const limits = [
  { key: 'inputTokenLimit', label: '输入上限', hint: '模型接受的输入 token 上限。' },
  { key: 'outputTokenLimit', label: '输出上限', hint: '模型支持的输出 token 上限。' },
  { key: 'contextWindow', label: '上下文窗口', hint: '输入和输出共享的窗口；与输入上限分别填写。' },
  { key: 'maxOutputTokens', label: '本次输出预算', hint: '发给服务的输出上限。留空使用服务默认值；Anthropic 默认最多 8,192。' },
] as const;
export function ModelCapacity({ provider, models, disabled, onChange }: { provider: Provider; models: string[]; disabled: boolean; onChange: (provider: Provider) => void }) {
  const [selected, setSelected] = useState('');
  const id = models.includes(selected) ? selected : models[0];
  if (!id) return null;
  const info = provider.modelCatalog?.find((item) => item.id === id);
  function capability(field: 'supportsTools' | 'supportsReasoning' | 'supportsImages', value: string) { onChange(setModelInfo(provider, id, field, value === '' ? undefined : value === 'true')); }
  return <section className="model-capacity"><h4>模型容量与能力</h4><p className="field-hint">服务未提供的信息保持未设置。请依据模型文档填写；修改容量或能力后标为手动设置。更改连接地址或 API 类型会清除这些信息。</p>
    <Field label="配置模型"><Select disabled={disabled} value={id} onChange={(event) => setSelected(event.target.value)}>{models.map((model) => <option value={model} key={model}>{model}</option>)}</Select></Field>
    <p className="field-hint">{info?.source === 'service' ? '模型资料来源：模型服务' : info ? '模型资料来源：手动设置' : '模型资料来源：未设置'}</p>
    <div className="capacity-grid">{limits.map((field) => <Field key={field.key} label={field.label} hint={field.hint}><Input type="number" min={1} max={1_000_000_000} step={1} disabled={disabled} placeholder="未设置" value={info?.[field.key] ?? ''} onChange={(event) => onChange(setModelInfo(provider, id, field.key, event.target.value === '' ? undefined : Number(event.target.value)))} /></Field>)}</div>
    {(provider.kind === 'openai' || provider.kind === 'ollama' || (provider.kind === 'azure' && provider.azureApi && provider.azureApi !== 'responses')) && <Field label="输出预算参数" hint="依据服务文档选择。旧版 Chat 服务常用 max_tokens，推理模型通常要求 max_completion_tokens。"><Select disabled={disabled} value={info?.outputParameter ?? ''} onChange={(event) => onChange(setModelInfo(provider, id, 'outputParameter', (event.target.value || undefined) as ModelInfo['outputParameter']))}><option value="">默认（{provider.kind === 'ollama' || provider.azureApi === 'deployment-chat' ? 'max_tokens' : 'max_completion_tokens'}）</option><option value="max_tokens">max_tokens</option><option value="max_completion_tokens">max_completion_tokens</option></Select></Field>}
    <div className="capacity-grid">{([{ key: 'supportsTools', label: '工具调用' }, { key: 'supportsReasoning', label: '推理能力' }, { key: 'supportsImages', label: '图片输入' }] as { key: keyof Pick<ModelInfo, 'supportsTools' | 'supportsReasoning' | 'supportsImages'>; label: string }[]).map((field) => <Field key={field.key} label={field.label}><Select disabled={disabled} value={info?.[field.key] === undefined ? '' : String(info[field.key])} onChange={(event) => capability(field.key, event.target.value)}><option value="">未设置</option><option value="true">支持</option><option value="false">不支持</option></Select></Field>)}</div>
    {info && !modelInfoSchema.safeParse(info).success && <p className="inline-error">容量必须为 1 至 1,000,000,000 的整数，输出预算不能超过输出上限。</p>}
  </section>;
}
