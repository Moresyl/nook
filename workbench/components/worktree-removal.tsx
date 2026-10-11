import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ManagedWorktree, WorktreeOwnershipSource } from '../../contracts/worktree-ownership';
import { worktreeRemovalError, type RemoveManagedWorktree, type WorktreeRemoved } from '../../contracts/worktree-cleanup';
import { Button, Modal } from './controls';
import { TextHint } from './control-tooltip';

export function WorktreeRemovalControl({ record, source, disabled, protectedTree, onRemove, onRemoved }: { record: ManagedWorktree; source: WorktreeOwnershipSource; disabled: boolean; protectedTree: boolean; onRemove(input: RemoveManagedWorktree): Promise<WorktreeRemoved>; onRemoved(result: WorktreeRemoved): void }) {
  const [open, setOpen] = useState(false), [error, setError] = useState(''), [completed, setCompleted] = useState(0);
  const working = useRef(false), alive = useRef(true), focusPending = useRef(false), opener = useRef<HTMLButtonElement>(null), errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useLayoutEffect(() => { if (disabled || !focusPending.current) return; focusPending.current = false; (errorRef.current ?? opener.current)?.focus(); (errorRef.current ?? opener.current)?.scrollIntoView({ block: 'nearest' }); }, [disabled, completed]);
  function close() { if (working.current || disabled) return; setOpen(false); setError(''); }
  async function remove() {
    if (disabled || working.current || record.pinned || !record.verified || protectedTree) return;
    working.current = true; setError('');
    try { const result = await onRemove({ source, path: record.path, receiptId: record.id }); if (alive.current) { setOpen(false); onRemoved(result); } }
    catch (failure) { if (alive.current) setError(worktreeRemovalError(failure)); }
    finally { working.current = false; if (alive.current) { focusPending.current = true; setCompleted(value => value + 1); } }
  }
  return <><div className="worktree-conversation-actions"><Button ref={opener} tone="danger" disabled={disabled || record.pinned || !record.verified || protectedTree} title={record.pinned ? '先取消工作树固定' : protectedTree ? '已登记、锁定或关联固定聊天的工作树会保留' : '保存快照后删除这个本机工作树'} onClick={() => { setError(''); setOpen(true); }}>删除工作树</Button></div>
    {open && <Modal title="删除工作树？" returnFocus={opener} dismissible={!disabled} onClose={close} footer={<><Button disabled={disabled} onClick={close}>取消</Button><Button tone="danger" disabled={disabled} onClick={() => { void remove(); }}>保存快照并删除</Button></>}>
      <TextHint as="p" className="path-text" text={record.path}>{record.path}</TextHint>
      <p>先在本机保存可恢复快照，再删除这个工作树目录。原仓库和分支保留，可从「已保存快照」恢复到新目录。</p>
      <p className="field-hint">固定、已登记、正在使用、锁定或包含修改、未跟踪及忽略文件的工作树会保留。共享备份不包含本机快照。</p>
      {error && <p ref={errorRef} tabIndex={-1} className="inline-error" role="alert">{error}</p>}
    </Modal>}
  </>;
}
