import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { worktreePreferencesSchema } from '../../contracts/project-worktrees';
import { uiErrorMessage } from '../../contracts/ui-errors';
import type { Workspace } from '../../contracts/workspace';
import { Button, IconButton, Input } from '../components/controls';

type Props = { state: Workspace; busy: boolean; onBusyChange(value: boolean): void; onState(value: Workspace): void };
export function WorktreeSettings({ state, busy, onBusyChange, onState }: Props) {
  const savedRoot = state.preferences.worktrees?.root ?? '';
  const [root, setRoot] = useState(savedRoot), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const [defaultRoot, setDefaultRoot] = useState('');
  const working = useRef(false), errorRef = useRef<HTMLParagraphElement>(null);
  const inputId = useId(), inputRef = useRef<HTMLInputElement>(null), restoreInputFocus = useRef(false);
  const valid = worktreePreferencesSchema.safeParse({ root }).success;
  useEffect(() => { setRoot(savedRoot); }, [savedRoot]);
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
    try { onState(await window.qiyao.savePreferences({ ...state.preferences, worktrees: worktreePreferencesSchema.parse({ root }) })); setSaved(true); }
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
    {error && <p ref={errorRef} className="inline-error" role="alert">{error}</p>}
    {saved && <p role="status" className="field-hint">已保存工作树设置。</p>}
  </section>;
}
