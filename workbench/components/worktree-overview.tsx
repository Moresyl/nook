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

export function WorktreeOverview({ state, disabled, onOpenConversation, onCreateConversation, onRegister, onPin, onCapture, onRestore }: { state: Workspace; disabled: boolean; onOpenConversation(target: WorktreeConversationTarget): void; onCreateConversation(target: WorktreeProjectTarget): void; onRegister(input: WorktreeRegistration): Promise<void>; onPin(input: WorktreePinRequest): Promise<void>; onCapture(input: CreateWorktreeSnapshot): Promise<WorktreeSnapshotSummary>; onRestore(input: RestoreWorktreeSnapshot): Promise<WorktreeRestored> }) {
  const [page, setPage] = useState(0), [refresh, setRefresh] = useState(0), [loading, setLoading] = useState(true);
  const [snapshots, setSnapshots] = useState<WorktreeSnapshot[]>([]);
  const [ownership, setOwnership] = useState<WorktreeOwnershipSnapshot[]>([]);
  const [savedSnapshots, setSavedSnapshots] = useState<SavedWorktreeSnapshots[]>([]);
  const [restored, setRestored] = useState<WorktreeRestored>();
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const request = useRef(0), totalPages = Math.max(1, Math.ceil(state.projects.length / worktreeOverviewPageSize));
  const currentPage = Math.min(page, totalPages - 1);
  const projectsKey = JSON.stringify(state.projects.map(project => [project.id, project.path]));
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
  useLayoutEffect(() => { if (restored && !loading) { noticeRef.current?.focus(); noticeRef.current?.scrollIntoView({ block: 'nearest' }); } }, [restored, loading]);
  const groups = useMemo(() => worktreeOverviewGroups(state.projects, state.threads, snapshots), [state.projects, state.threads, snapshots]);
  function savedPin(source: WorktreeOwnershipSource, path: string, pinned: boolean) {
    setOwnership(current => current.map(snapshot => snapshot.source.projectId === source.projectId && worktreePathKey(snapshot.source.path) === worktreePathKey(source.path) ? { ...snapshot, records: snapshot.records.map(record => worktreePathKey(record.path) === worktreePathKey(path) ? { ...record, pinned } : record) } : snapshot));
  }
  function savedSnapshot(source: WorktreeOwnershipSource, snapshot: WorktreeSnapshotSummary) {
    setSavedSnapshots(current => current.map(row => row.source.projectId === source.projectId && worktreePathKey(row.source.path) === worktreePathKey(source.path) ? { ...row, failed: false, snapshots: [snapshot, ...row.snapshots.filter(saved => saved.id !== snapshot.id)] } : row));
  }
  function restoredSnapshot(result: WorktreeRestored) { setRestored(result); setRefresh(value => value + 1); }
  return <section className="worktree-overview" aria-label="已登记项目的工作树" aria-busy={loading}>
    <div className="section-heading"><h3>项目工作树</h3><IconButton icon="retry" label="刷新项目工作树" disabled={disabled || loading} onClick={() => setRefresh(value => value + 1)} /></div>
    <p className="field-hint">列出本页已登记项目所属仓库中的 Git 工作树与关联会话。未登记的仓库可在项目页添加。</p>
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
        <details className="worktree-conversations"><summary>关联会话 · {conversations.length}</summary>{conversations.length ? <ul>{conversations.map(thread => <li key={thread.id}><Button className="worktree-conversation-link" title={thread.title || '未命名会话'} disabled={disabled} onClick={() => onOpenConversation({ threadId: thread.id, projectId: thread.projectId ?? '', path: tree.path })}>{thread.title || '未命名会话'}</Button>{thread.pinned && <span className="muted">已固定</span>}{thread.archived && <span className="muted">已归档</span>}</li>)}</ul> : <p className="field-hint">此工作树还没有关联会话。</p>}</details>
        {projects[0] && <div className="worktree-conversation-actions"><Button disabled={disabled} onClick={() => onCreateConversation({ projectId: projects[0].id, path: tree.path })}>新建项目聊天</Button></div>}
        {!projects.length && source && <WorktreeRegistrationForm tree={tree} source={{ projectId: source.id, path: source.path }} disabled={disabled} onRegister={onRegister} />}
      </article>)}
      {!group.failed && source && saved && <SavedWorktreeSnapshotList source={{ projectId: source.id, path: source.path }} snapshots={saved.snapshots} failed={saved.failed} disabled={disabled} onRestore={onRestore} onRestored={restoredSnapshot} />}
    </section>; })}</div> : <p className="muted">尚无已登记项目。添加本地 Git 项目后可在这里查看工作树。</p>}
    {totalPages > 1 && <nav className="worktree-overview-pages" aria-label="项目工作树分页"><Button disabled={disabled || loading || currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</Button><span className="muted" role="status">第 {currentPage + 1} / {totalPages} 页 · {state.projects.length} 个项目</span><Button disabled={disabled || loading || currentPage === totalPages - 1} onClick={() => setPage(currentPage + 1)}>下一页</Button></nav>}
  </section>;
}
