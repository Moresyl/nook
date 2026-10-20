import { useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Button, Input, Modal } from './controls';

export function RenameThreadDialog({ initialTitle, disabled = false, returnFocus, onSave, onClose }: { initialTitle: string; disabled?: boolean; returnFocus?: RefObject<HTMLElement | null>; onSave: (title: string) => Promise<void>; onClose: () => void }) {
  const [title, setTitle] = useState(initialTitle), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const locked = useRef(false), input = useRef<HTMLInputElement>(null);
  const errorId = useId();
  useLayoutEffect(() => { if (error && !busy) input.current?.focus({ preventScroll: true }); }, [error, busy]);
  async function save() {
    if (locked.current || disabled || !title.trim()) return;
    locked.current = true; setBusy(true); setError('');
    try { await onSave(title.trim()); onClose(); }
    catch { setError('无法保存名称，请重试。'); }
    finally { locked.current = false; setBusy(false); }
  }
  return <Modal title="重命名聊天" returnFocus={returnFocus} dismissible={!busy} onClose={onClose} footer={<><Button disabled={busy} onClick={onClose}>取消</Button><Button tone="solid" disabled={busy || disabled || !title.trim()} onClick={() => { void save(); }}>{busy ? '正在保存…' : '保存'}</Button></>}>
    <Input ref={input} autoFocus aria-label="聊天名称" aria-describedby={error ? errorId : undefined} maxLength={160} disabled={busy} value={title} onChange={event => setTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); void save(); } }} />
    {error && <p id={errorId} role="alert" className="thread-action-error">{error}</p>}
  </Modal>;
}
