import { useEffect, useRef, useState } from 'react';
import { gitBranchNameSchema, type GitBranches, type GitStatus } from '../../contracts/projects';
import { createWorktreeSchema, type GitWorktree, type WorktreeCreated } from '../../contracts/project-worktrees';
import { uiErrorMessage } from '../../contracts/ui-errors';
import type { Project, Workspace } from '../../contracts/workspace';
import { Button, Field, IconButton, Input, Modal, Select } from './controls';
import { TextHint } from './control-tooltip';

type Props = { project: Project; projects: Project[]; worktreeRoot?: string; status: GitStatus | null; disabled: boolean; beforeCreate(): Promise<void>; onState(next: Workspace): void; onOpen(id: string): void };
export function ProjectWorktrees({ project, projects, worktreeRoot, status, disabled, beforeCreate, onState, onOpen }: Props) {
  const [open, setOpen] = useState(false), [mode, setMode] = useState<'new' | 'existing'>('new');
  const [trees, setTrees] = useState<GitWorktree[]>([]), [snapshot, setSnapshot] = useState<GitBranches>();
  const [branch, setBranch] = useState(''), [base, setBase] = useState(''), [path, setPath] = useState('');
  const [result, setResult] = useState<WorktreeCreated>(), [registration, setRegistration] = useState<Project>();
  const [error, setError] = useState(''), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [registeredId, setRegisteredId] = useState('');
  const alive = useRef(true), request = useRef(0), working = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current++; }; }, []);
  async function refresh(defaultPath = false) {
    const revision = ++request.current; setLoading(true); setError('');
    try { const [nextTrees, nextBranches, defaultRoot] = await Promise.all([window.qiyao.gitWorktrees(project.id), window.qiyao.gitBranches(project.id), defaultPath && !worktreeRoot ? window.qiyao.defaultWorktreeRoot() : Promise.resolve(undefined)]); if (alive.current && revision === request.current) { setTrees(nextTrees); setSnapshot(nextBranches); if (defaultRoot) setPath(current => current || `${defaultRoot.replace(/[\\/]+$/, '')}/nook-${crypto.randomUUID().slice(0, 8)}`); } }
    catch { if (alive.current && revision === request.current) setError('无法读取工作树，请检查仓库与 Git 后重试。'); }
    finally { if (alive.current && revision === request.current) setLoading(false); }
  }
  function close() { request.current++; setLoading(false); setOpen(false); }
  function show() { setMode('new'); setBranch(''); setBase(''); setPath(worktreeRoot ? `${worktreeRoot.replace(/[\\/]+$/, '')}/nook-${crypto.randomUUID().slice(0, 8)}` : ''); setResult(undefined); setRegistration(undefined); setRegisteredId(''); setTrees([]); setSnapshot(undefined); setOpen(true); void refresh(true); }
  function selectResult(next: WorktreeCreated) {
    setResult(next); setSnapshot(next.branches); setRegisteredId('');
    setRegistration({ id: crypto.randomUUID(), name: (next.worktree.branch || '工作树').slice(0, 100), path: next.worktree.path, instructions: '', createdAt: Date.now() });
  }
  async function run(action: () => Promise<void>) {
    if (working.current) return; working.current = true; setBusy(true); setError('');
    try { await action(); } finally { working.current = false; if (alive.current) setBusy(false); }
  }
  const input = mode === 'new' ? { mode, path, branch: branch.trim(), ...(base ? { baseBranch: base } : {}) } : { mode, path, branch };
  const valid = createWorktreeSchema.safeParse(input).success;
  const available = snapshot?.branches.filter(item => !item.current && !item.worktreePath) ?? [];
  const duplicate = mode === 'new' && snapshot?.branches.some(item => item.name === branch.trim());
  async function create() {
    let prepared = false;
    try {
      await beforeCreate(); prepared = true;
      const next = await window.qiyao.gitCreateWorktree(project.id, createWorktreeSchema.parse(input));
      if (alive.current) { selectResult(next); setTrees(current => [...current, next.worktree]); }
    } catch (problem) {
      if (alive.current) {
        const message = String(problem);
        setError(!prepared ? '未能保存编辑草稿，工作树尚未创建。请重试。' : message.includes('The default worktree directory could not be prepared.') ? uiErrorMessage(problem) : message.includes('target folder already exists') ? '目标文件夹已存在，请选择新的文件夹。' : message.includes('outside') ? '请选择现有工作树之外的文件夹。' : message.includes('parent folder') ? '目标文件夹的父目录必须已存在。' : message.includes('absolute') ? '请输入目标文件夹的完整绝对路径。' : message.includes('another worktree') ? '此分支已在其他工作树中使用，请刷新列表。' : message.includes('already exists') ? '分支已存在，请修改名称或选择已有分支。' : message.includes('valid Git branch') ? '分支名称无效，请修改后重试。' : message.includes('Create a commit') ? '请先在仓库中创建一次提交。' : '工作树操作未能完成。请刷新列表并检查目标文件夹与 Git 钩子；已有文件会保留。');
      }
    }
  }
  const existingId = result && projects.find(item => item.path.replaceAll('\\', '/') === result.worktree.path.replaceAll('\\', '/'))?.id;
  const projectId = registeredId || existingId;
  async function register() {
    if (!registration) return;
    try { const next = await window.qiyao.saveProject(registration); onState(next); if (alive.current) setRegisteredId(registration.id); }
    catch { if (alive.current) setError('工作树已保留，但项目登记未能保存。请重试“添加为项目”，无需重新创建。'); }
  }
  const canCreate = !busy && !loading && Boolean(snapshot) && !snapshot?.status.unborn && valid && !duplicate && (mode === 'new' || available.some(item => item.name === branch));
  return <><IconButton icon="folder" label="管理项目工作树" disabled={disabled || !status} onClick={show} />{open && <Modal title="项目工作树" className="worktree-dialog" dismissible={!busy} onClose={close} footer={<>
    <span className="muted" role="status">{busy ? '正在处理…' : loading ? '正在读取…' : result ? projectId ? '已添加为项目' : '工作树已就绪' : `${trees.length} 个工作树`}</span><span className="spacer" />
    <Button disabled={busy} onClick={close}>关闭</Button>
    {result ? projectId ? <Button tone="solid" disabled={busy} onClick={() => { onOpen(projectId); close(); }}>打开项目</Button> : <Button tone="solid" disabled={busy || !registration?.name.trim()} onClick={() => { void run(register); }}>添加为项目</Button> : <Button tone="solid" disabled={!canCreate} onClick={() => { void run(create); }}>创建工作树</Button>}
  </>}>
    {result ? <div className="worktree-form"><div className="worktree-row"><TextHint as="span" className="worktree-title" text={result.worktree.branch || '游离 HEAD'}>{result.worktree.branch || '游离 HEAD'}</TextHint><TextHint as="p" className="path-text" text={result.worktree.path}>{result.worktree.path}</TextHint></div>{result.warning && <p className="branch-validation" role="status">工作树已创建，但 Git 钩子报告错误或更新了分支。上方显示实际分支，请检查后再使用。</p>}{!projectId && registration && <Field label="工作树项目名称" hint="添加后可独立编辑文件、打开终端和创建项目聊天。"><Input autoFocus maxLength={100} value={registration.name} disabled={busy} onChange={event => setRegistration({ ...registration, name: event.target.value })} /></Field>}</div> : <>
      <p className="field-hint">在独立文件夹中使用另一个分支。原项目的分支、文件改动与编辑草稿会保留。</p>
      <div className="branch-modes"><Button aria-pressed={mode === 'new'} disabled={busy} onClick={() => { setMode('new'); setBranch(''); setError(''); }}>新建分支</Button><Button aria-pressed={mode === 'existing'} disabled={busy} onClick={() => { setMode('existing'); setBranch(''); setError(''); }}>已有分支</Button><span className="spacer" /><IconButton icon="retry" label="刷新工作树列表" disabled={busy || loading} onClick={() => { void refresh(); }} /></div>
      <form className="worktree-form" onSubmit={event => { event.preventDefault(); event.stopPropagation(); if (canCreate) void run(create); }}>
        <Field label="工作树分支">{mode === 'new' ? <Input key="new" autoFocus value={branch} disabled={busy} aria-invalid={Boolean(branch && (!gitBranchNameSchema.safeParse(branch.trim()).success || duplicate))} placeholder="feature/新功能" onChange={event => { setBranch(event.target.value); setError(''); }} /> : <Select key="existing" autoFocus value={branch} disabled={busy || loading} onChange={event => { setBranch(event.target.value); setError(''); }}><option value="">选择未占用的本地分支…</option>{available.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}</Select>}</Field>
        {duplicate && <p className="branch-validation" role="alert">分支已存在</p>}
        {mode === 'new' && <Field label="起始版本"><Select value={base} disabled={busy || loading} onChange={event => setBase(event.target.value)}><option value="">当前提交{snapshot?.status.branch ? ` · ${snapshot.status.detached ? '游离 HEAD' : snapshot.status.branch}` : ''}</option>{snapshot?.branches.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}</Select></Field>}
        <Field label="工作树文件夹" hint="填写尚不存在的文件夹完整路径。默认目录在创建时准备，其他父目录须已存在。"><Input value={path} disabled={busy} placeholder="C:\Projects\新工作树" onChange={event => { setPath(event.target.value); setError(''); }} /></Field>
      </form>
      {snapshot?.status.unborn && <p className="field-hint">仓库尚无提交。请先创建一次提交，再创建工作树。</p>}
      <details className="worktree-existing"><summary>已有工作树 · {trees.length}</summary><div className="worktree-list">{trees.map(item => <div className="worktree-row" key={item.path}><div className="worktree-row-heading"><TextHint as="span" className="worktree-title" text={item.branch || (item.bare ? '裸仓库' : '游离 HEAD')}>{item.branch || (item.bare ? '裸仓库' : '游离 HEAD')}</TextHint><Button disabled={busy || loading || item.bare || item.prunable !== undefined || !snapshot} onClick={() => { if (snapshot) selectResult({ worktree: item, branches: snapshot }); }}>查看</Button></div><TextHint as="p" className="path-text" text={item.path}>{item.path}</TextHint>{item.locked !== undefined && <span className="muted">已锁定</span>}{item.prunable !== undefined && <span className="muted">文件夹不可用</span>}</div>)}</div></details>
    </>}
    {error && <p className="branch-validation" role="alert">{error}</p>}
  </Modal>}</>;
}
