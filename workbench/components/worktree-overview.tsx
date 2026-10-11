import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Workspace } from '../../contracts/workspace';
import { worktreeOverviewGroups, worktreeOverviewPage, worktreeOverviewPageSize, worktreePathKey, type WorktreeSnapshot } from '../../contracts/worktree-overview';
import { loadWorktreeOverview } from '../lib/worktree-overview';
import { Button, IconButton } from './controls';
import { TextHint } from './control-tooltip';
import type { WorktreeConversationTarget, WorktreeProjectTarget } from '../../contracts/worktree-navigation';
import type { WorktreeRegistration } from '../../contracts/worktree-registration';
import { WorktreeRegistrationForm } from './worktree-registration';
import type { WorktreeOwnershipSource, WorktreePinRequest } from '../../contracts/worktree-ownership';
import { loadWorktreeOwnership, type WorktreeOwnershipSnapshot } from '../lib/worktree-ownership';
import { WorktreePinControl } from './worktree-pin';
import type { CreateWorktreeSnapshot, RestoreWorktreeSnapshot, WorktreeRestored, WorktreeSnapshotSummary } from '../../contracts/worktree-snapshots';
import { loadSavedWorktreeSnapshots, type SavedWorktreeSnapshots } from '../lib/worktree-snapshots';
import { SavedWorktreeSnapshotList, WorktreeSnapshotCapture } from './worktree-snapshots';
import { WorktreeRemovalControl } from './worktree-removal';
import type { RemoveManagedWorktree, WorktreeRemoved, WorktreeCleanupReport } from '../../contracts/worktree-cleanup';

export function WorktreeOverview({ state, disabled, onOpenConversation, onCreateConversation, onRegister, onPin, onCapture, onRestore, onRemove }: { state: Workspace; disabled: boolean; onOpenConversation(target: WorktreeConversationTarget): void; onCreateConversation(target: WorktreeProjectTarget): void; onRegister(input: WorktreeRegistration): Promise<void>; onPin(input: WorktreePinRequest): Promise<void>; onCapture(input: CreateWorktreeSnapshot): Promise<WorktreeSnapshotSummary>; onRestore(input: RestoreWorktreeSnapshot): Promise<WorktreeRestored>; onRemove(input: RemoveManagedWorktree): Promise<WorktreeRemoved> }) {
  const [page, setPage] = useState(0), [refresh, setRefresh] = useState(0), [loading, setLoading] = useState(true);
  const [snapshots, setSnapshots] = useState<WorktreeSnapshot[]>([]);
  const [ownership, setOwnership] = useState<WorktreeOwnershipSnapshot[]>([]);
  const [savedSnapshots, setSavedSnapshots] = useState<SavedWorktreeSnapshots[]>([]);
  const [restored, setRestored] = useState<WorktreeRestored>();
  const [removed, setRemoved] = useState<WorktreeRemoved>(), [cleanup, setCleanup] = useState<WorktreeCleanupReport>();
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const request = useRef(0), totalPages = Math.max(1, Math.ceil(state.projects.length / worktreeOverviewPageSize));
  const currentPage = Math.min(page, totalPages - 1);
  const projectsKey = JSON.stringify(state.projects.map(project => [project.id, project.path]));
  useEffect(() => window.qiyao.onWorktreeCleanup(report => { setCleanup(report); setRefresh(value => value + 1); }), []);
  useEffect(() => {
    const revision = ++request.current; let active = true;
    setPage(currentPage);
    setLoading(true); setSnapshots([]); setOwnership([]); setSavedSnapshots([]);
    const current = () => active && request.current === revision;
    void (async () => {
      const next = await loadWorktreeOverview(worktreeOverviewPage(state.projects, currentPage), id => window.qiyao.gitWorktrees(id), current);
      if (!current()) return;
      setSnapshots(next);
      const sources = worktreeOverviewGroups(state.projects, state.threads, next).filter(group => !group.failed).flatMap(group => {
        const source = state.projects.find(project => project.id === group.projectIds[0]);
        return source ? [{ projectId: source.id, path: source.path }] : [];
      });
      const managed = await loadWorktreeOwnership(sources, source => window.qiyao.managedWorktrees(source), current);
      if (!current()) return;
      setOwnership(managed);
      const saved = await loadSavedWorktreeSnapshots(sources, source => window.qiyao.worktreeSnapshots(source), current);
      if (current()) { setSavedSnapshots(saved); setLoading(false); }
    })();
    return () => { active = false; };
  }, [projectsKey, currentPage, refresh]);
  useLayoutEffect(() => { if ((restored || removed) && !loading) { noticeRef.current?.focus(); noticeRef.current?.scrollIntoView({ block: 'nearest' }); } }, [restored, removed, loading]);
  const groups = useMemo(() => worktreeOverviewGroups(state.projects, state.threads, snapshots), [state.projects, state.threads, snapshots]);
  function savedPin(source: WorktreeOwnershipSource, path: string, pinned: boolean) {
    setOwnership(current => current.map(snapshot => snapshot.source.projectId === source.projectId && worktreePathKey(snapshot.source.path) === worktreePathKey(source.path) ? { ...snapshot, records: snapshot.records.map(record => worktreePathKey(record.path) === worktreePathKey(path) ? { ...record, pinned } : record) } : snapshot));
  }
  function savedSnapshot(source: WorktreeOwnershipSource, snapshot: WorktreeSnapshotSummary) {
    setSavedSnapshots(current => current.map(row => row.source.projectId === source.projectId && worktreePathKey(row.source.path) === worktreePathKey(source.path) ? { ...row, failed: false, snapshots: [snapshot, ...row.snapshots.filter(saved => saved.id !== snapshot.id)] } : row));
  }
  function restoredSnapshot(result: WorktreeRestored) { setRemoved(undefined); setRestored(result); setRefresh(value => value + 1); }
  function removedWorktree(result: WorktreeRemoved) { setRestored(undefined); setRemoved(result); setRefresh(value => value + 1); }
  return <section className="worktree-overview" aria-label="已登记项目的工作树" aria-busy={loading}>
    <div className="section-heading"><h3>{loading || groups.length ? '项目工作树' : '暂无项目工作树'}</h3><IconButton icon="retry" label="刷新项目工作树" disabled={disabled || loading} onClick={() => setRefresh(value => value + 1)} /></div>
    <p className="field-hint">列出本页已登记项目所属仓库中的 Git 工作树与关联会话。未登记的仓库可在项目页添加。</p>
    {removed && <p ref={noticeRef} tabIndex={-1} role="status" className={removed.managedRecord === 'saved' ? 'field-hint' : 'inline-error'}>{removed.managedRecord === 'saved' ? '工作树已删除，快照已保存，可从「已保存快照」恢复到新目录。' : '工作树已删除，快照已保存，但本机创建记录未能更新。请刷新列表；原目录不再具有删除权限。'}<TextHint as="span" className="path-text" text={removed.path}>{removed.path}</TextHint></p>}
    {cleanup && <p role="status" className={cleanup.failed || cleanup.receiptFailures ? 'inline-error' : 'field-hint'}>{cleanup.failed ? '自动清理未能执行，请完成其他操作后重试；工作树会保留。' : `自动清理已删除 ${cleanup.removed} 个工作树，并为其保存快照；${cleanup.skipped} 个受保护或无法清理的工作树已跳过。`}{cleanup.receiptFailures > 0 && ` ${cleanup.receiptFailures} 条本机创建记录未能更新，请刷新检查。`}<TextHint as="span" className="path-text" text={cleanup.source.path}>{cleanup.source.path}</TextHint></p>}
    {restored && <p ref={noticeRef} tabIndex={-1} role="status" className={restored.managedRecord === 'saved' ? 'field-hint' : 'inline-error'}>{restored.managedRecord === 'saved' ? '快照已恢复，可在列表中将新工作树添加为项目。' : '快照已恢复，但本机创建记录未能保存。请保留已恢复文件；该工作树暂不支持本机管理操作。'}<TextHint as="span" className="path-text" text={restored.worktree.path}>{restored.worktree.path}</TextHint></p>}
    {loading ? <p className="muted" role="status">正在读取项目工作树…</p> : groups.length ? <div className="worktree-overview-groups">{groups.map(group => {
      const source = state.projects.find(project => project.id === group.projectIds[0]);
      const local = source ? ownership.find(snapshot => snapshot.source.projectId === source.id && worktreePathKey(snapshot.source.path) === worktreePathKey(source.path)) : undefined;
      const saved = source ? savedSnapshots.find(snapshot => snapshot.source.projectId === source.id && worktreePathKey(snapshot.source.path) === worktreePathKey(source.path)) : undefined;
      return <section className="worktree-overview-group" key={`${group.failed ? 'error:' : ''}${group.path}:${group.projectIds.join(',')}`}>
      <div className="worktree-row-heading"><h4 className="worktree-title"><TextHint text={group.name}>{group.name}</TextHint></h4><span className="muted">{group.failed ? '读取失败' : `${group.rows.length} 个工作树`}</span></div>
      {local?.failed && <p className="inline-error" role="alert">未能读取本机创建记录。已有文件会保留，请刷新重试。</p>}
      {group.failed ? <p className="inline-error" role="alert">未能读取此项目的工作树。请检查仓库与 Git，然后刷新重试。</p> : group.rows.map(({ tree, projects, conversations }) => <article className="worktree-row" key={tree.path}>
        <div className="worktree-row-heading"><TextHint as="span" className="worktree-title" text={tree.branch || (tree.bare ? '裸仓库' : '游离 HEAD')}>{tree.branch || (tree.bare ? '裸仓库' : '游离 HEAD')}</TextHint><span className="muted">{tree.locked !== undefined ? '已锁定' : tree.prunable !== undefined ? '文件夹不可用' : projects.length ? '已登记项目' : '未登记项目'}</span></div>
        <TextHint as="p" className="path-text" text={tree.path}>{tree.path}</TextHint>
        {source && <WorktreePinControl record={local?.records.find(record => worktreePathKey(record.path) === worktreePathKey(tree.path))} source={{ projectId: source.id, path: source.path }} disabled={disabled} onPin={onPin} onSaved={pinned => savedPin({ projectId: source.id, path: source.path }, tree.path, pinned)} />}
        {source && local?.records.some(record => record.verified && worktreePathKey(record.path) === worktreePathKey(tree.path)) && <WorktreeSnapshotCapture source={{ projectId: source.id, path: source.path }} path={tree.path} disabled={disabled} onCapture={onCapture} onSaved={snapshot => savedSnapshot({ projectId: source.id, path: source.path }, snapshot)} />}
        {source && local?.records.filter(record => record.verified && worktreePathKey(record.path) === worktreePathKey(tree.path)).map(record => <WorktreeRemovalControl key={record.id} record={record} source={{ projectId: source.id, path: source.path }} disabled={disabled} protectedTree={Boolean(projects.length || tree.locked !== undefined || tree.prunable !== undefined || record.conversationIds?.some(id => state.threads.some(thread => thread.id === id && thread.pinned)))} onRemove={onRemove} onRemoved={removedWorktree} />)}
        {local?.records.some(record => worktreePathKey(record.path) === worktreePathKey(tree.path) && record.conversationIds?.some(id => state.threads.some(thread => thread.id === id && thread.pinned))) && <p className="field-hint">关联聊天已固定，删除已暂停。请在聊天列表中取消固定后重试。</p>}
        <details className="worktree-conversations"><summary>关联会话 · {conversations.length}</summary>{conversations.length ? <ul>{conversations.map(thread => <li key={thread.id}><Button className="worktree-conversation-link" title={thread.title || '未命名会话'} disabled={disabled} onClick={() => onOpenConversation({ threadId: thread.id, projectId: thread.projectId ?? '', path: tree.path })}>{thread.title || '未命名会话'}</Button>{thread.pinned && <span className="muted">已固定</span>}{thread.archived && <span className="muted">已归档</span>}</li>)}</ul> : <p className="field-hint">此工作树还没有关联会话。</p>}</details>
        {projects[0] && <div className="worktree-conversation-actions"><Button disabled={disabled} onClick={() => onCreateConversation({ projectId: projects[0].id, path: tree.path })}>新建项目聊天</Button></div>}
        {!projects.length && source && <WorktreeRegistrationForm tree={tree} source={{ projectId: source.id, path: source.path }} disabled={disabled} onRegister={onRegister} />}
      </article>)}
      {!group.failed && source && saved && <SavedWorktreeSnapshotList source={{ projectId: source.id, path: source.path }} snapshots={saved.snapshots} failed={saved.failed} disabled={disabled} onRestore={onRestore} onRestored={restoredSnapshot} />}
    </section>; })}</div> : <p className="muted">添加本地 Git 项目后，可在这里查看和管理工作树。</p>}
    {totalPages > 1 && <nav className="worktree-overview-pages" aria-label="项目工作树分页"><Button disabled={disabled || loading || currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</Button><span className="muted" role="status">第 {currentPage + 1} / {totalPages} 页 · {state.projects.length} 个项目</span><Button disabled={disabled || loading || currentPage === totalPages - 1} onClick={() => setPage(currentPage + 1)}>下一页</Button></nav>}
  </section>;
}
