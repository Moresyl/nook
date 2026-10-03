import { useEffect, useState } from 'react';
import { promptParameters, renderPrompt, type PromptTemplate } from '../../contracts/prompt-templates';
import type { Assistant } from '../../contracts/workspace';
import { Button, Empty, Field, Modal, Select, Textarea } from './controls';

type Props = { templates: PromptTemplate[]; assistants: Assistant[]; initialId?: string; onUse: (text: string, assistantId?: string) => boolean; onClose: () => void };
export function PromptUseDialog({ templates, assistants, initialId, onUse, onClose }: Props) {
  const [id, setId] = useState(initialId ?? templates[0]?.id ?? '');
  const [values, setValues] = useState<Record<string, string>>({});
  const template = templates.find((item) => item.id === id); const parameters = template ? promptParameters(template.content, template.parameters) : [];
  const parameterRevision = JSON.stringify(template?.parameters ?? []);
  const assistant = assistants.find((item) => item.id === template?.assistantId);
  const missingAssistant = Boolean(template?.assistantId && !assistant);
  useEffect(() => { setValues({}); }, [template?.id, template?.content, parameterRevision]);
  let preview: string | null = null;
  if (template) try { preview = renderPrompt(template.content, values, template.parameters); } catch { /* Keep the incomplete form available. */ }
  return <Modal title="使用提示模板" onClose={onClose} footer={<><Button onClick={onClose}>取消</Button><Button tone="solid" disabled={preview === null || missingAssistant} onClick={() => { if (preview !== null && !missingAssistant && onUse(preview, template?.assistantId)) onClose(); }}>追加到草稿</Button></>}>
    <Field label="选择提示模板"><Select autoFocus value={id} onChange={(event) => setId(event.target.value)}><option value="">请选择模板</option>{templates.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</Select></Field>
    {template ? <><p className="field-hint">{template.description || '填写变量后查看完整内容。追加会保留现有消息与附件，之后可自行发送。'}</p>
      {assistant && <p className="field-hint">追加时选择助手：{assistant.name}。现有消息和附件会保留。</p>}
      {missingAssistant && <p role="alert">关联的助手已移除。编辑模板并重新选择助手。</p>}
      {parameters.map((parameter) => {
        const value = Object.hasOwn(values, parameter.key) ? values[parameter.key] : parameter.defaultValue ?? '';
        const change = (next: string) => setValues({ ...values, [parameter.key]: next });
        return <Field key={parameter.key} label={`变量 ${parameter.label || parameter.key}`} hint={[parameter.description, parameter.required ? '必填' : '可选'].filter(Boolean).join(' · ')}>
          {parameter.choices ? <Select required={parameter.required} value={value} onChange={(event) => change(event.target.value)}><option value="">请选择</option>{parameter.choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}</Select>
            : <Textarea required={parameter.required} rows={3} maxLength={32000} value={value} onChange={(event) => change(event.target.value)} />}
        </Field>;
      })}
      <Field label="提示预览" hint={preview === null ? '请填写全部变量。展开内容最多 256 KB，变量值最多 32000 个字符。' : '此处仅显示文本；追加后仍由你决定是否发送。'}><Textarea readOnly rows={10} value={preview ?? template.content} /></Field>
    </> : <Empty icon="compose" title="模板不可用" detail="请选择已有模板，或返回助手页面创建提示模板。" />}
  </Modal>;
}
