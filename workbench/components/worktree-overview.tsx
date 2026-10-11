import { useEffect, useMemo, useRef, useState } from 'react';
import type { Workspace } from '../../contracts/workspace';
import { worktreeOverviewGroups, worktreeOverviewPage, worktreeOverviewPageSize, type WorktreeSnapshot } from '../../contracts/worktree-overview';
import { loadWorktreeOverview } from '../lib/worktree-overview';
import { Button, IconButton } from './controls';
import { TextHint } from './control-tooltip';

export function WorktreeOverview({ state, disabled }: { state: Workspace; disabled: boolean }) {
  const [page, setPage] = useState(0), [refresh, setRefresh] = useState(0), [loading, setLoading] = useState(true);
  const [snapshots, setSnapshots] = useState<WorktreeSnapshot[]>([]);
  const request = useRef(0), totalPages = Math.max(1, Math.ceil(state.projects.length / worktreeOverviewPageSize));
  const currentPage = Math.min(page, totalPages - 1);
  const projectsKey = JSON.stringify(state.projects.map(project => [project.id, project.path]));
  useEffect(() => {
    const revision = ++request.current; let active = true;
    setPage(currentPage);
    setLoading(true); setSnapshots([]);
    void loadWorktreeOverview(worktreeOverviewPage(state.projects, currentPage), id => window.qiyao.gitWorktrees(id), () => active && request.current === revision).then(next => {
      if (active && request.current === revision) { setSnapshots(next); setLoading(false); }
    });
    return () => { active = false; };
  }, [projectsKey, currentPage, refresh]);
  const groups = useMemo(() => worktreeOverviewGroups(state.projects, state.threads, snapshots), [state.projects, state.threads, snapshots]);
  return <section className="worktree-overview" aria-label="已登记项目的工作树" aria-busy={loading}>
    <div className="section-heading"><h3>项目工作树</h3><IconButton icon="retry" label="刷新项目工作树" disabled={disabled || loading} onClick={() => setRefresh(value => value + 1)} /></div>
    <p className="field-hint">列出本页已登记项目所属仓库中的 Git 工作树与关联会话。未登记的仓库可在项目页添加。</p>
    {loading ? <p className="muted" role="status">正在读取项目工作树…</p> : groups.length ? <div className="worktree-overview-groups">{groups.map(group => <section className="worktree-overview-group" key={`${group.failed ? 'error:' : ''}${group.path}:${group.projectIds.join(',')}`}>
      <div className="worktree-row-heading"><h4 className="worktree-title"><TextHint text={group.name}>{group.name}</TextHint></h4><span className="muted">{group.failed ? '读取失败' : `${group.rows.length} 个工作树`}</span></div>
      {group.failed ? <p className="inline-error" role="alert">未能读取此项目的工作树。请检查仓库与 Git，然后刷新重试。</p> : group.rows.map(({ tree, projects, conversations }) => <article className="worktree-row" key={tree.path}>
        <div className="worktree-row-heading"><TextHint as="span" className="worktree-title" text={tree.branch || (tree.bare ? '裸仓库' : '游离 HEAD')}>{tree.branch || (tree.bare ? '裸仓库' : '游离 HEAD')}</TextHint><span className="muted">{tree.locked !== undefined ? '已锁定' : tree.prunable !== undefined ? '文件夹不可用' : projects.length ? '已登记项目' : '未登记项目'}</span></div>
        <TextHint as="p" className="path-text" text={tree.path}>{tree.path}</TextHint>
        <details className="worktree-conversations"><summary>关联会话 · {conversations.length}</summary>{conversations.length ? <ul>{conversations.map(thread => <li key={thread.id}><TextHint as="span" text={thread.title || '未命名会话'}>{thread.title || '未命名会话'}</TextHint>{thread.pinned && <span className="muted">已固定</span>}{thread.archived && <span className="muted">已归档</span>}</li>)}</ul> : <p className="field-hint">此工作树还没有关联会话。</p>}</details>
      </article>)}
    </section>)}</div> : <p className="muted">尚无已登记项目。添加本地 Git 项目后可在这里查看工作树。</p>}
    {totalPages > 1 && <nav className="worktree-overview-pages" aria-label="项目工作树分页"><Button disabled={disabled || loading || currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</Button><span className="muted" role="status">第 {currentPage + 1} / {totalPages} 页 · {state.projects.length} 个项目</span><Button disabled={disabled || loading || currentPage === totalPages - 1} onClick={() => setPage(currentPage + 1)}>下一页</Button></nav>}
  </section>;
}
