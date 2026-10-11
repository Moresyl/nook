import { useLayoutEffect, useRef, useState } from 'react';
import { worktreeRegistrationError, worktreeRegistrationSchema, type WorktreeRegistration } from '../../contracts/worktree-registration';
import type { GitWorktree } from '../../contracts/project-worktrees';
import type { WorktreeProjectTarget } from '../../contracts/worktree-navigation';
import { Button, Field, Input } from './controls';

export function WorktreeRegistrationForm({ tree, source, disabled, onRegister }: { tree: GitWorktree; source: WorktreeProjectTarget; disabled: boolean; onRegister(input: WorktreeRegistration): Promise<void> }) {
  const [open, setOpen] = useState(false), [error, setError] = useState('');
  const [name, setName] = useState((tree.branch || tree.path.split(/[\\/]/).filter(Boolean).at(-1) || '工作树').slice(0, 100));
  const [projectId] = useState(() => crypto.randomUUID());
  const working = useRef(false), opener = useRef<HTMLButtonElement>(null), errorRef = useRef<HTMLParagraphElement>(null);
  const input = worktreeRegistrationSchema.safeParse({ source, projectId, name, path: tree.path });
  useLayoutEffect(() => { if (error) errorRef.current?.scrollIntoView({ block: 'nearest' }); }, [error]);
  async function save() {
    if (disabled || working.current || !input.success) return;
    working.current = true; setError('');
    try { await onRegister(input.data); setOpen(false); }
    catch (failure) { setError(worktreeRegistrationError(failure)); }
    finally { working.current = false; }
  }
  return open ? <form className="worktree-registration" aria-label="登记工作树项目" onSubmit={event => { event.preventDefault(); void save(); }}>
    <Field label="工作树项目名称" hint="登记后可独立编辑文件、使用终端和创建项目聊天。本地文件保持原样。"><Input autoFocus value={name} maxLength={100} disabled={disabled} aria-invalid={!input.success} onChange={event => { setName(event.target.value); setError(''); }} /></Field>
    {!input.success && <p className="field-hint">请输入有效的项目名称。</p>}
    {error && <p ref={errorRef} className="inline-error" role="alert">{error}</p>}
    <div className="form-actions"><Button disabled={disabled} onClick={() => { if (working.current) return; setOpen(false); setError(''); requestAnimationFrame(() => opener.current?.focus()); }}>取消登记</Button><Button type="submit" tone="solid" disabled={disabled || !input.success}>登记项目</Button></div>
  </form> : <div className="worktree-conversation-actions"><Button ref={opener} disabled={disabled || tree.bare || tree.prunable !== undefined || !tree.head} onClick={() => { setError(''); setOpen(true); }}>添加为项目</Button></div>;
}
