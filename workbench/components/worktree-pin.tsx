import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { worktreePinError, type ManagedWorktree, type WorktreeOwnershipSource, type WorktreePinRequest } from '../../contracts/worktree-ownership';
import { Button } from './controls';

export function WorktreePinControl({ record, source, disabled, onPin, onSaved }: { record?: ManagedWorktree; source: WorktreeOwnershipSource; disabled: boolean; onPin(input: WorktreePinRequest): Promise<void>; onSaved(pinned: boolean): void }) {
  const [error, setError] = useState(''), [completed, setCompleted] = useState(0);
  const working = useRef(false), alive = useRef(true), focusPending = useRef(false), errorRef = useRef<HTMLParagraphElement>(null), buttonRef = useRef<HTMLButtonElement>(null), regionRef = useRef<HTMLDivElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setError(''); }, [record?.id, record?.pinned, record?.verified, source.projectId, source.path]);
  useLayoutEffect(() => { if (error) errorRef.current?.scrollIntoView({ block: 'nearest' }); }, [error]);
  useLayoutEffect(() => {
    if (disabled || !focusPending.current || !record?.verified) return;
    focusPending.current = false; regionRef.current?.scrollIntoView({ block: 'nearest' }); buttonRef.current?.focus({ preventScroll: true });
  }, [disabled, completed, record?.verified]);
  async function save() {
    if (disabled || working.current || !record?.verified) return;
    working.current = true; setError(''); const pinned = !record.pinned;
    try { await onPin({ source, path: record.path, pinned }); if (alive.current) onSaved(pinned); }
    catch (failure) { if (alive.current) setError(worktreePinError(failure)); }
    finally { working.current = false; if (alive.current) { focusPending.current = true; setCompleted(value => value + 1); } }
  }
  return record ? <div ref={regionRef} className="worktree-pin-control"><div className="worktree-conversation-actions"><span className="muted">{record.verified ? record.pinned ? '工作树已固定' : '本机创建' : '创建记录未核验'}</span><Button ref={buttonRef} disabled={disabled || !record.verified} aria-pressed={record.pinned} onClick={() => { void save(); }}>{record.pinned ? '取消固定工作树' : '固定工作树'}</Button></div>{error && <p ref={errorRef} className="inline-error" role="alert">{error}</p>}{!record.verified && <p className="field-hint">未能核实本机创建记录。文件会保留，请刷新列表后检查。</p>}</div> : null;
}
