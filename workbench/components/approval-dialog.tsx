import { useState } from 'react';
import type { ApprovalRequest } from '../../contracts/tools';
import { Button, Modal } from './controls';

export function ApprovalDialog({ request, onDecision, onStop, report }: {
  request: ApprovalRequest; onDecision: (allowed: boolean) => Promise<void>; onStop: () => Promise<void>; report: (error: unknown) => void;
}) {
  const [busy, setBusy] = useState(false);
  const details = request.details;
  async function act(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try { await operation(); } catch (error) { report(error); setBusy(false); }
  }
  return <Modal title={details.kind === 'file' ? details.exists ? '审批文件修改' : '审批新建文件' : details.kind === 'mcp' ? '审批 MCP 工具调用' : details.kind === 'plugin' ? '审批插件工具调用' : '审批命令执行'} onClose={() => { void act(() => onDecision(false)); }} footer={<>
    <Button disabled={busy} onClick={() => { void act(onStop); }}>停止任务</Button><span className="spacer" />
    <Button disabled={busy} onClick={() => { void act(() => onDecision(false)); }}>拒绝</Button>
    <Button tone="solid" disabled={busy} onClick={() => { void act(() => onDecision(true)); }}>{details.kind === 'file' ? '允许这次修改' : details.kind === 'plugin' ? '允许这次调用' : '允许这次执行'}</Button>
  </>}>
    {details.kind === 'file' ? <><p className="field-hint">{details.root}</p><p className="approval-path">{details.path}</p><div className="approval-file-preview"><section><h3>原内容</h3><pre>{details.exists ? details.before || '（空文件）' : '（新文件）'}</pre></section><section><h3>修改后</h3><pre>{details.after || '（空文件）'}</pre></section></div><p className="field-hint">批准后会再次检查文件版本，避免覆盖审批期间发生的修改。</p></>
      : details.kind === 'mcp' || details.kind === 'plugin' ? <><p className="field-hint">{details.kind === 'mcp' ? '服务器' : '插件'}</p><p className="approval-path">{details.kind === 'mcp' ? details.serverName : details.pluginName}</p><p className="field-hint">工具</p><p className="approval-path">{details.toolName}</p><p>调用参数</p><pre className="approval-command">{details.arguments}</pre><p className="field-hint">{details.kind === 'mcp' ? '批准后将把这些参数发送给服务器。' : '批准后将向插件传递这些参数。项目写入会另行展示修改内容。'}审批仅对本次调用有效。</p></>
        : <><p>程序与参数</p><pre className="approval-command">{JSON.stringify([details.program, ...details.args], null, 2)}</pre><p className="field-hint">工作目录</p><p className="approval-path">{details.cwd}</p><p className="field-hint">最长执行 {details.timeout / 1000} 秒。命令以你的当前用户身份运行。</p></>}
  </Modal>;
}
