import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { worktreePreferencesSchema } from '../../contracts/project-worktrees';
import { uiErrorMessage } from '../../contracts/ui-errors';
import type { Workspace } from '../../contracts/workspace';
import { Button, Field, Input } from '../components/controls';

type Props = { state: Workspace; busy: boolean; onBusyChange(value: boolean): void; onState(value: Workspace): void };
export function WorktreeSettings({ state, busy, onBusyChange, onState }: Props) {
  const savedRoot = state.preferences.worktrees?.root ?? '';
  const [root, setRoot] = useState(savedRoot), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const working = useRef(false), errorRef = useRef<HTMLParagraphElement>(null);
  const valid = worktreePreferencesSchema.safeParse({ root }).success;
  useEffect(() => { setRoot(savedRoot); }, [savedRoot]);
  useLayoutEffect(() => { if (error) errorRef.current?.scrollIntoView({ block: 'nearest' }); }, [error]);
  async function save() {
    if (busy || working.current || !valid || root === savedRoot) return;
    working.current = true; onBusyChange(true); setError(''); setSaved(false);
    try { onState(await window.qiyao.savePreferences({ ...state.preferences, worktrees: worktreePreferencesSchema.parse({ root }) })); setSaved(true); }
    catch (failure) { setError(uiErrorMessage(failure)); }
    finally { working.current = false; onBusyChange(false); }
  }
  return <section className="worktree-settings" aria-label="工作树设置"><h3>工作树</h3>
    <p className="muted">设置新工作树的创建位置，在独立目录中处理项目分支。</p>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <Field label="工作树根目录" hint="填写已有目录的完整路径。留空时，在创建工作树时自行填写目标路径。"><Input disabled={busy} value={root} maxLength={4096} aria-invalid={!valid} placeholder="C:\Projects\工作树" onChange={event => { setRoot(event.target.value); setError(''); setSaved(false); }} /></Field>
      {!valid && <p className="inline-error" role="alert">请输入完整的绝对目录路径，或留空。</p>}
      <p className="field-hint">设置只影响之后新建工作树的默认路径。已创建的工作树保留当前位置，新建时仍可修改目标路径。</p>
      <div className="form-actions"><Button tone="solid" type="submit" disabled={busy || !valid || root === savedRoot}>保存工作树设置</Button></div>
    </form>
    {error && <p ref={errorRef} className="inline-error" role="alert">{error}</p>}
    {saved && <p role="status" className="field-hint">已保存工作树设置。</p>}
  </section>;
}
