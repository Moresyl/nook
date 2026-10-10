import { useEffect, useRef, useState } from 'react';
import { gitBranchNameSchema, type GitBranches, type GitStatus } from '../../contracts/projects';
import { Button, Field, IconButton, Input, Modal } from './controls';
import { Glyph } from './glyphs';

type Props = { projectId: string; status: GitStatus | null; disabled: boolean; beforeChange(): Promise<void>; onChanged(value: GitBranches): void };
export function ProjectBranches({ projectId, status, disabled, beforeChange, onChanged }: Props) {
  const [open, setOpen] = useState(false), [mode, setMode] = useState<'switch' | 'create'>('switch'), [snapshot, setSnapshot] = useState<GitBranches | null>(null);
  const [query, setQuery] = useState(''), [name, setName] = useState(''), [error, setError] = useState(''), [loading, setLoading] = useState(false), [working, setWorking] = useState(false);
  const alive = useRef(true), request = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current++; }; }, []);
  async function refresh() {
    const revision = ++request.current; setLoading(true); setError('');
    try { const next = await window.qiyao.gitBranches(projectId); if (alive.current && request.current === revision) setSnapshot(next); }
    catch { if (alive.current && request.current === revision) setError('无法读取本地分支，请检查仓库与 Git 后重试。'); }
    finally { if (alive.current && request.current === revision) setLoading(false); }
  }
  const close = () => { request.current++; setLoading(false); setOpen(false); };
  const show = () => { setOpen(true); setMode('switch'); setQuery(''); setName(''); setSnapshot(null); void refresh(); };
  const entered = name.trim(), duplicate = snapshot?.branches.some(branch => branch.name === entered), valid = gitBranchNameSchema.safeParse(entered).success;
  async function change(target: string, create: boolean) {
    if (working) return; setWorking(true); setError(''); let prepared = false;
    try {
      await beforeChange();
      prepared = true;
      const next = await (create ? window.qiyao.gitCreateBranch(projectId, target) : window.qiyao.gitSwitchBranch(projectId, target));
      if (alive.current) { onChanged(next); close(); setName(''); }
    } catch (failure) {
      if (alive.current) {
        const message = String(failure);
        setError(!prepared ? '未能保存编辑草稿，本次分支操作尚未执行。请重试。' : message.includes('valid Git branch') ? '分支名称无效，请修改后重试。' : message.includes('already exists') ? '分支已存在，请使用其他名称。' : message.includes('another worktree') ? '此分支正在其他工作树中使用。' : message.includes('Resolve merge conflicts') ? '请先解决合并冲突，再切换分支。' : '无法完成分支操作。请检查可能被覆盖的文件改动、仓库权限与 Git 钩子，再重试。');
      }
    } finally { if (alive.current) setWorking(false); }
  }
  const current = snapshot?.status ?? status, filtered = snapshot?.branches.filter(branch => branch.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())) ?? [];
  return <><Button className="branch-trigger" aria-label="管理项目分支" title={status?.detached ? '游离 HEAD' : status?.branch} disabled={disabled || !status} onClick={show}><Glyph name="branch" size={14} /><span>{status?.detached ? '游离 HEAD' : status?.branch || '…'}</span>{status?.unborn && <span>尚无提交</span>}</Button>
    {open && <Modal title="项目分支" className="branch-dialog" dismissible={!working} onClose={close} footer={<><span className="muted" role="status">{working ? '正在更新分支…' : loading ? '正在读取分支…' : `${snapshot?.branches.length ?? 0} 个本地分支`}</span><span className="spacer" /><Button disabled={working} onClick={close}>取消</Button>{mode === 'create' && <Button tone="solid" disabled={working || loading || !snapshot || !valid || duplicate} onClick={() => { void change(entered, true); }}>创建并切换</Button>}</>}>
      <p className="branch-current">当前 · {current?.detached ? '游离 HEAD' : current?.branch || '…'}{current?.unborn && ' · 尚无提交'}</p>
      <div className="branch-modes"><Button aria-pressed={mode === 'switch'} disabled={working} onClick={() => { setMode('switch'); setError(''); }}>选择分支</Button><Button aria-pressed={mode === 'create'} disabled={working} onClick={() => { setMode('create'); setError(''); }}>新建分支</Button><span className="spacer" /><IconButton icon="retry" label="刷新分支列表" disabled={working || loading} onClick={() => { void refresh(); }} /></div>
      {mode === 'create' ? <form className="branch-create" onSubmit={event => { event.preventDefault(); event.stopPropagation(); if (snapshot && valid && !duplicate && !loading) void change(entered, true); }}><Field label="新分支名称" hint="从当前版本创建并切换，工作区改动与未保存草稿会保留。"><Input key="create" autoFocus value={name} disabled={working} aria-invalid={Boolean(error || entered && (!valid || duplicate))} onChange={event => { setName(event.target.value); setError(''); }} placeholder="feature/新功能" onKeyDown={event => { if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) event.stopPropagation(); }} /></Field>{duplicate && <p className="branch-validation" role="alert">分支已存在</p>}</form> : <><Input key="search" autoFocus aria-label="查找分支" placeholder="查找本地分支" value={query} disabled={working} onChange={event => setQuery(event.target.value)} /><div className="branch-list" aria-label="本地分支">{filtered.map(branch => <Button key={branch.name} className="branch-row" aria-label={branch.name} aria-current={branch.current ? 'true' : undefined} title={branch.worktreePath ? `${branch.name}\n${branch.worktreePath}` : branch.name} disabled={working || branch.current || Boolean(branch.worktreePath)} onClick={() => { void change(branch.name, false); }}><Glyph name="branch" size={14} /><span className="branch-name">{branch.name}</span><span className="muted">{branch.current ? '当前' : branch.worktreePath ? '其他工作树' : ''}</span></Button>)}{snapshot && !filtered.length && <p className="muted">没有匹配的本地分支</p>}</div></>}
      {error && <p className="branch-validation" role="alert">{error}</p>}
    </Modal>}
  </>;
}
