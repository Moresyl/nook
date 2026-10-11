import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { WorktreeOwnershipSource } from '../../contracts/worktree-ownership';
import { restoreWorktreeSnapshotSchema, type CreateWorktreeSnapshot, type RestoreWorktreeSnapshot, type WorktreeRestored, type WorktreeSnapshotSummary } from '../../contracts/worktree-snapshots';
import { Button, Field, Input } from './controls';
import { TextHint } from './control-tooltip';

type Capture = (input: CreateWorktreeSnapshot) => Promise<WorktreeSnapshotSummary>;
type Restore = (input: RestoreWorktreeSnapshot) => Promise<WorktreeRestored>;

export function WorktreeSnapshotCapture({ source, path, disabled, onCapture, onSaved }: { source: WorktreeOwnershipSource; path: string; disabled: boolean; onCapture: Capture; onSaved(snapshot: WorktreeSnapshotSummary): void }) {
  const [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const working = useRef(false), alive = useRef(true), button = useRef<HTMLButtonElement>(null), errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useLayoutEffect(() => { if (error) errorRef.current?.scrollIntoView({ block: 'nearest' }); }, [error]);
  async function capture() {
    if (disabled || working.current) return;
    working.current = true; setError(''); setSaved(false);
    try { const snapshot = await onCapture({ source, path }); if (alive.current) { onSaved(snapshot); setSaved(true); } }
    catch { if (alive.current) setError('未能完整保存快照。已有文件和快照会保留，请检查目录、磁盘空间与 Git 后重试。'); }
    finally { working.current = false; requestAnimationFrame(() => { if (alive.current) button.current?.focus(); }); }
  }
  return <div className="worktree-snapshot-capture"><div className="worktree-conversation-actions"><Button ref={button} disabled={disabled} onClick={() => { void capture(); }}>保存工作树快照</Button></div>{error && <p ref={errorRef} className="inline-error" role="alert">{error}</p>}{saved && <p className="field-hint" role="status">快照已保存，可在本仓库的「已保存快照」中恢复。</p>}</div>;
}

function SnapshotRestoreForm({ source, snapshot, disabled, onRestore, onRestored, onCancel }: { source: WorktreeOwnershipSource; snapshot: WorktreeSnapshotSummary; disabled: boolean; onRestore: Restore; onRestored(result: WorktreeRestored): void; onCancel(): void }) {
  const [path, setPath] = useState(''), [error, setError] = useState('');
  const working = useRef(false), alive = useRef(true), input = useRef<HTMLInputElement>(null), errorRef = useRef<HTMLParagraphElement>(null);
  const request = restoreWorktreeSnapshotSchema.safeParse({ source, snapshotId: snapshot.id, path });
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useLayoutEffect(() => { if (error) errorRef.current?.scrollIntoView({ block: 'nearest' }); }, [error]);
  async function restore() {
    if (disabled || working.current || !request.success) return;
    working.current = true; setError('');
    try { const result = await onRestore(request.data); if (alive.current) onRestored(result); }
    catch { if (alive.current) setError('恢复未完成，快照已保留。请检查目标目录；如已有部分文件，请保留它们并换一个新目录重试。'); }
    finally { working.current = false; requestAnimationFrame(() => { if (alive.current) input.current?.focus(); }); }
  }
  return <form className="worktree-registration" aria-label="恢复工作树快照" onSubmit={event => { event.preventDefault(); void restore(); }}>
    <Field label="恢复到新目录" hint="填写尚不存在的完整目录路径，父目录须已存在，且位于现有工作树之外。"><Input ref={input} autoFocus value={path} maxLength={4096} disabled={disabled} aria-invalid={Boolean(path) && !request.success} onChange={event => { setPath(event.target.value); setError(''); }} /></Field>
    <p className="field-hint">在新目录恢复快照中的提交、暂存内容和工作文件。原分支与原目录保持原状，恢复的工作树处于游离 HEAD；可添加为项目后继续使用。</p>
    {error && <p ref={errorRef} className="inline-error" role="alert">{error}</p>}
    <div className="form-actions"><Button disabled={disabled} onClick={() => { if (!working.current) onCancel(); }}>取消恢复</Button><Button type="submit" tone="solid" disabled={disabled || !request.success}>恢复快照</Button></div>
  </form>;
}

export function SavedWorktreeSnapshotList({ source, snapshots, failed, disabled, onRestore, onRestored }: { source: WorktreeOwnershipSource; snapshots: WorktreeSnapshotSummary[]; failed: boolean; disabled: boolean; onRestore: Restore; onRestored(result: WorktreeRestored): void }) {
  const [selected, setSelected] = useState('');
  const opener = useRef<HTMLButtonElement | null>(null);
  function cancel() { setSelected(''); requestAnimationFrame(() => opener.current?.focus()); }
  return <details className="worktree-conversations"><summary>已保存快照 · {failed ? '读取失败' : snapshots.length}</summary>
    <p className="field-hint">快照仅保存在本机，包含暂存、未暂存、未跟踪和忽略文件。每份最多 64 MiB 工作文件，本机最多保留 100 份；共享备份不包含这些快照。</p>
    {failed ? <p className="inline-error" role="alert">未能读取本机快照。已有快照会保留，请检查磁盘权限并刷新重试。</p> : snapshots.length ? snapshots.map(snapshot => <article className="worktree-row" key={snapshot.id}>
      <div className="worktree-row-heading"><span>{new Date(snapshot.createdAt).toLocaleString()}</span><span className="muted">{snapshot.head.slice(0, 8)} · {snapshot.entries} 项</span></div>
      <TextHint as="p" className="path-text" text={snapshot.originalPath}>{snapshot.originalPath}</TextHint>
      {selected === snapshot.id ? <SnapshotRestoreForm key={snapshot.id} source={source} snapshot={snapshot} disabled={disabled} onRestore={onRestore} onRestored={onRestored} onCancel={cancel} /> : <div className="worktree-conversation-actions"><Button disabled={disabled} onClick={event => { opener.current = event.currentTarget; setSelected(snapshot.id); }}>恢复到新目录</Button></div>}
    </article>) : <p className="field-hint">尚无已保存快照。可为已核验的本机工作树保存一份。</p>}
  </details>;
}
