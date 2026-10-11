import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { worktreeKeepCountSchema, worktreePreferencesSchema } from '../../contracts/project-worktrees';
import { uiErrorMessage } from '../../contracts/ui-errors';
import type { Workspace } from '../../contracts/workspace';
import { worktreeNavigationError, type WorktreeConversationTarget, type WorktreeProjectTarget } from '../../contracts/worktree-navigation';
import { Button, Field, IconButton, Input, Modal, Toggle } from '../components/controls';
import { WorktreeOverview } from '../components/worktree-overview';
import type { WorktreeRegistration } from '../../contracts/worktree-registration';
import type { WorktreePinRequest } from '../../contracts/worktree-ownership';
import type { CreateWorktreeSnapshot, RestoreWorktreeSnapshot } from '../../contracts/worktree-snapshots';
import type { RemoveManagedWorktree } from '../../contracts/worktree-cleanup';

type Props = { state: Workspace; busy: boolean; onBusyChange(value: boolean): void; onState(value: Workspace): void; onOpenConversation(target: WorktreeConversationTarget): Promise<void>; onCreateConversation(target: WorktreeProjectTarget): Promise<void> };
export function WorktreeSettings({ state, busy, onBusyChange, onState, onOpenConversation, onCreateConversation }: Props) {
  const savedRoot = state.preferences.worktrees?.root ?? '';
  const [root, setRoot] = useState(savedRoot), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const [defaultRoot, setDefaultRoot] = useState('');
  const savedKeepCount = state.preferences.worktrees?.keepCount ?? 5;
  const [keepCount, setKeepCount] = useState(String(savedKeepCount)), [disablingCleanup, setDisablingCleanup] = useState(false);
  const validKeepCount = keepCount.trim() !== '' && worktreeKeepCountSchema.safeParse(Number(keepCount)).success;
  const working = useRef(false), errorRef = useRef<HTMLParagraphElement>(null);
  const inputId = useId(), inputRef = useRef<HTMLInputElement>(null), restoreInputFocus = useRef(false);
  const valid = worktreePreferencesSchema.safeParse({ root }).success;
  useEffect(() => { setRoot(savedRoot); }, [savedRoot]);
  useEffect(() => { setKeepCount(String(savedKeepCount)); }, [savedKeepCount]);
  useEffect(() => {
    let active = true;
    void window.qiyao.defaultWorktreeRoot().then(value => { if (active) setDefaultRoot(value); }).catch(failure => { if (active) setError(uiErrorMessage(failure)); });
    return () => { active = false; };
  }, []);
  useLayoutEffect(() => { if (error) errorRef.current?.scrollIntoView({ block: 'nearest' }); }, [error]);
  useLayoutEffect(() => {
    if (!busy && restoreInputFocus.current) { restoreInputFocus.current = false; inputRef.current?.focus(); }
  }, [busy]);
  async function save() {
    if (busy || working.current || !valid || root === savedRoot) return;
    working.current = true; onBusyChange(true); setError(''); setSaved(false);
    try { onState(await window.qiyao.savePreferences({ ...state.preferences, worktrees: worktreePreferencesSchema.parse({ ...state.preferences.worktrees, root }) })); setSaved(true); }
    catch (failure) { setError(uiErrorMessage(failure)); }
    finally { working.current = false; onBusyChange(false); }
  }
  async function choose() {
    if (busy || working.current) return;
    working.current = true; onBusyChange(true); setError(''); setSaved(false);
    try {
      const selected = await window.qiyao.chooseWorktreeRoot();
      if (selected !== null) setRoot(worktreePreferencesSchema.parse({ root: selected }).root);
    } catch (failure) { setError(uiErrorMessage(failure)); }
    finally { working.current = false; restoreInputFocus.current = true; onBusyChange(false); }
  }
  async function navigate(operation: () => Promise<void>) {
    if (busy || working.current) return;
    working.current = true; onBusyChange(true); setError(''); setSaved(false);
    try { await operation(); }
    catch (failure) { setError(worktreeNavigationError(failure)); }
    finally { working.current = false; onBusyChange(false); }
  }
  async function saveUpstream(enabled: boolean) {
    if (busy || working.current) return;
    working.current = true; onBusyChange(true); setError(''); setSaved(false);
    try { onState(await window.qiyao.savePreferences({ ...state.preferences, worktrees: worktreePreferencesSchema.parse({ ...state.preferences.worktrees, root: savedRoot, upstreamRefresh: enabled ? 'best-effort' : 'never' }) })); setSaved(true); }
    catch { setError('未能保存上游刷新设置，请检查磁盘空间和文件夹权限，再重试。'); }
    finally { working.current = false; onBusyChange(false); }
  }
  async function register(input: WorktreeRegistration) {
    if (busy || working.current) throw new Error('A worktree settings operation is already running.');
    working.current = true; onBusyChange(true); setError(''); setSaved(false);
    try { onState(await window.qiyao.registerWorktreeProject(input)); }
    finally { working.current = false; onBusyChange(false); }
  }
  async function pin(input: WorktreePinRequest) {
    if (busy || working.current) throw new Error('A worktree settings operation is already running.');
    working.current = true; onBusyChange(true); setError(''); setSaved(false);
    try { await window.qiyao.setWorktreePinned(input); }
    finally { working.current = false; onBusyChange(false); }
  }
  async function captureSnapshot(input: CreateWorktreeSnapshot) {
    if (busy || working.current) throw new Error('A worktree settings operation is already running.');
    working.current = true; onBusyChange(true); setError(''); setSaved(false);
    try { return await window.qiyao.captureWorktreeSnapshot(input); }
    finally { working.current = false; onBusyChange(false); }
  }
  async function restoreSnapshot(input: RestoreWorktreeSnapshot) {
    if (busy || working.current) throw new Error('A worktree settings operation is already running.');
    working.current = true; onBusyChange(true); setError(''); setSaved(false);
    try { return await window.qiyao.restoreWorktreeSnapshot(input); }
    finally { working.current = false; onBusyChange(false); }
  }
  async function removeWorktree(input: RemoveManagedWorktree) {
    if (busy || working.current) throw new Error('A worktree settings operation is already running.');
    working.current = true; onBusyChange(true); setError(''); setSaved(false);
    try { return await window.qiyao.removeManagedWorktree(input); }
    finally { working.current = false; onBusyChange(false); }
  }
  async function saveCleanup(enabled: boolean, count = savedKeepCount) {
    if (busy || working.current) return;
    working.current = true; onBusyChange(true); setError(''); setSaved(false);
    try { onState(await window.qiyao.savePreferences({ ...state.preferences, worktrees: worktreePreferencesSchema.parse({ ...state.preferences.worktrees, root: savedRoot, autoCleanup: enabled, keepCount: count }) })); setSaved(true); setDisablingCleanup(false); }
    catch { setError('未能保存自动清理设置，请检查磁盘空间和文件夹权限，再重试。'); }
    finally { working.current = false; onBusyChange(false); }
  }
  return <section className="worktree-settings" aria-label="工作树设置"><h3>工作树</h3>
    <p className="muted">设置新工作树的创建位置，在独立目录中处理项目分支。</p>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="field"><label className="field-label" htmlFor={inputId}>工作树根目录</label>
        <div className="worktree-root-control"><Input ref={inputRef} id={inputId} aria-describedby={`${inputId}-hint`} disabled={busy} value={root} maxLength={4096} aria-invalid={!valid} placeholder={defaultRoot || '默认工作树目录'} onChange={event => { setRoot(event.target.value); setError(''); setSaved(false); }} /><IconButton icon="folder" label="选择工作树文件夹" disabled={busy} onClick={() => { void choose(); }} /></div>
        <span className="field-hint" id={`${inputId}-hint`}>填写或选择已有目录的完整路径。留空时使用默认目录，首次创建工作树时准备该目录。</span>
      </div>
      {!valid && <p className="inline-error" role="alert">请输入完整的绝对目录路径，或留空。</p>}
      <p className="field-hint">设置只影响之后新建工作树的默认路径。已创建的工作树保留当前位置，新建时仍可修改目标路径。</p>
      <div className="form-actions"><Button tone="solid" type="submit" disabled={busy || !valid || root === savedRoot}>保存工作树设置</Button></div>
    </form>
    <Toggle label="创建工作树前刷新上游" disabled={busy} checked={state.preferences.worktrees?.upstreamRefresh === 'best-effort'} onChange={value => { void saveUpstream(value); }} />
    <p className="field-hint">创建前获取所选分支的远程更新。仍从已选本地提交创建，不合并或改写原分支；获取失败时继续使用本地提交，完成后显示提示。</p>
    <Toggle label="自动清理旧工作树" disabled={busy} checked={state.preferences.worktrees?.autoCleanup === true} onChange={value => { if (value) void saveCleanup(true); else setDisablingCleanup(true); }} />
    <p className="field-hint">默认关闭。启用后，每次成功创建本机工作树，会保留最近指定数量，并先保存快照再清理更早的空闲工作树。固定、已登记、锁定或含修改、未跟踪及忽略文件的目录会跳过，实际保留数量可能更多。</p>
    <form className="worktree-cleanup-settings" onSubmit={event => { event.preventDefault(); if (validKeepCount) void saveCleanup(state.preferences.worktrees?.autoCleanup === true, Number(keepCount)); }}>
      <Field label="保留工作树数量" hint="每个仓库保留最近 1～50 个本机工作树；已保存快照最多 100 份，无法保存快照时不会清理。"><Input type="number" min={1} max={50} step={1} value={keepCount} disabled={busy} aria-invalid={!validKeepCount} onChange={event => { setKeepCount(event.target.value); setSaved(false); }} /></Field>
      <div className="form-actions"><Button type="submit" disabled={busy || !validKeepCount || Number(keepCount) === savedKeepCount}>保存保留数量</Button></div>
    </form>
    {disablingCleanup && <Modal title="停用自动清理？" dismissible={!busy} onClose={() => { if (!busy) setDisablingCleanup(false); }} footer={<><Button disabled={busy} onClick={() => setDisablingCleanup(false)}>保留自动清理</Button><Button disabled={busy} tone="solid" onClick={() => { void saveCleanup(false); }}>停用自动清理</Button></>}><p>之后创建工作树时不再自动清理旧目录。已有工作树和已保存快照继续保留，仍可手动删除符合条件的本机工作树。</p>{error && <p className="inline-error" role="alert">{error}</p>}</Modal>}
    {error && <p ref={errorRef} className="inline-error" role="alert">{error}</p>}
    {saved && <p role="status" className="field-hint">已保存工作树设置。</p>}
    <WorktreeOverview state={state} disabled={busy} onOpenConversation={target => { void navigate(() => onOpenConversation(target)); }} onCreateConversation={target => { void navigate(() => onCreateConversation(target)); }} onRegister={register} onPin={pin} onCapture={captureSnapshot} onRestore={restoreSnapshot} onRemove={removeWorktree} />
  </section>;
}
