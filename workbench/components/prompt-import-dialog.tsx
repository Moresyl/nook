import { useState } from 'react';
import type { PromptBundle } from '../../contracts/prompt-bundles';
import { promptParameters } from '../../contracts/prompt-templates';
import { Button, Field, Input, Modal, Select, Textarea } from './controls';

type Props = { bundle: PromptBundle; busy: boolean; onClose: () => void; onImport: () => void };
export function PromptImportDialog({ bundle, busy, onClose, onImport }: Props) {
  const [preview, setPreview] = useState(0);
  const template = bundle.templates[preview];
  const assistant = template.assistantIndex === undefined ? undefined : bundle.assistants[template.assistantIndex];
  return <Modal title="导入提示模板" onClose={() => { if (!busy) onClose(); }} footer={<><Button disabled={busy} onClick={onClose}>取消</Button><Button tone="solid" disabled={busy} onClick={onImport}>添加 {bundle.templates.length} 个模板</Button></>}>
    <p className="field-hint">将添加 {bundle.templates.length} 个模板和 {bundle.assistants.length} 个关联助手副本。先查看完整内容；添加后可自行填写变量并追加到草稿。</p>
    <Field label="查看模板"><Select autoFocus disabled={busy} value={preview} onChange={(event) => setPreview(Number(event.target.value))}>{bundle.templates.map((item, index) => <option key={index} value={index}>{item.title}</option>)}</Select></Field>
    <Field label="模板简介"><Input readOnly value={template.description} /></Field>
    <Field label="模板内容"><Textarea readOnly rows={10} value={template.content} /></Field>
    {promptParameters(template.content, template.parameters).map((parameter) => <details key={parameter.key} className="prompt-parameter"><summary>变量：{parameter.key}{parameter.label ? ` · ${parameter.label}` : ''} · {parameter.required ? '必填' : '可选'}</summary>
      <Field label={`参数说明 ${parameter.key}`}><Textarea readOnly rows={2} value={parameter.description ?? ''} /></Field>
      <Field label={`默认值 ${parameter.key}`}><Textarea readOnly rows={2} value={parameter.defaultValue ?? ''} /></Field>
      {parameter.choices && <Field label={`下拉选项 ${parameter.key}`}><Textarea readOnly rows={Math.min(6, parameter.choices.length)} value={parameter.choices.join('\n')} /></Field>}
    </details>)}
    <Field label="关联助手"><Input readOnly value={assistant?.name ?? '未关联助手'} /></Field>
    {assistant && <><Field label="助手简介"><Input readOnly value={assistant.description} /></Field><Field label="助手工作指令"><Textarea readOnly rows={8} value={assistant.instructions} /></Field></>}
  </Modal>;
}
