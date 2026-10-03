import { useEffect, useState } from 'react';
import { promptVariables, renderPrompt, type PromptTemplate } from '../../contracts/prompt-templates';
import { Button, Empty, Field, Modal, Select, Textarea } from './controls';

type Props = { templates: PromptTemplate[]; initialId?: string; onUse: (text: string) => boolean; onClose: () => void };
export function PromptUseDialog({ templates, initialId, onUse, onClose }: Props) {
  const [id, setId] = useState(initialId ?? templates[0]?.id ?? '');
  const [values, setValues] = useState<Record<string, string>>({});
  const template = templates.find((item) => item.id === id); const variables = template ? promptVariables(template.content) : [];
  useEffect(() => { setValues({}); }, [template?.id, template?.content]);
  let preview: string | null = null;
  if (template) try { preview = renderPrompt(template.content, values); } catch { /* Keep the incomplete form available. */ }
  return <Modal title="使用提示模板" onClose={onClose} footer={<><Button onClick={onClose}>取消</Button><Button tone="solid" disabled={preview === null} onClick={() => { if (preview !== null && onUse(preview)) onClose(); }}>追加到草稿</Button></>}>
    <Field label="选择提示模板"><Select autoFocus value={id} onChange={(event) => setId(event.target.value)}><option value="">请选择模板</option>{templates.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</Select></Field>
    {template ? <><p className="field-hint">{template.description || '填写变量后查看完整内容。追加会保留现有消息与附件，之后可自行发送。'}</p>
      {variables.map((key) => <Field key={key} label={`变量 ${key}`}><Textarea rows={3} maxLength={32000} value={Object.hasOwn(values, key) ? values[key] : ''} onChange={(event) => setValues({ ...values, [key]: event.target.value })} /></Field>)}
      <Field label="提示预览" hint={preview === null ? '请填写全部变量。展开内容最多 256 KB，变量值最多 32000 个字符。' : '此处仅显示文本；追加后仍由你决定是否发送。'}><Textarea readOnly rows={10} value={preview ?? template.content} /></Field>
    </> : <Empty icon="compose" title="模板不可用" detail="请选择已有模板，或返回助手页面创建提示模板。" />}
  </Modal>;
}
