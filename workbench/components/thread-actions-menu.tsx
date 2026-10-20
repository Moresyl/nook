import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Thread } from '../../contracts/workspace';
import { Button, Input, Modal } from './controls';
import { Glyph } from './glyphs';

export type ThreadAction = 'rename' | 'pin' | 'unpin' | 'archive' | 'export' | 'delete';
export type ThreadActionRequest = { id: string; anchor: HTMLElement; x: number; y: number };
export type ThreadActionHandler = (action: ThreadAction, id: string, title?: string) => Promise<void>;

export function ThreadActionsMenu({ thread, request, onAction, onClose }: { thread: Thread; request: ThreadActionRequest; onAction: ThreadActionHandler; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null); const returning = useRef<HTMLElement | null>(request.anchor);
  const anchorPosition = useRef<{ left: number; top: number } | undefined>(undefined);
  const [dialog, setDialog] = useState<'rename' | 'delete'>(); const [title, setTitle] = useState(thread.title);
  const [busy, setBusy] = useState(false); const locked = useRef(false); const [error, setError] = useState('');
  const running = thread.messages.some(message => message.status === 'running');
  function close(restore = true) {
    if (locked.current) return;
    if (restore && request.anchor.isConnected) request.anchor.focus({ preventScroll: true });
    onClose();
  }
  useLayoutEffect(() => {
    if (dialog || !panel.current) return;
    const element = panel.current, rect = element.getBoundingClientRect();
    const anchorRect = request.anchor.getBoundingClientRect(); anchorPosition.current = { left: anchorRect.left, top: anchorRect.top };
    const ceiling = (document.querySelector('.window-chrome')?.getBoundingClientRect().bottom ?? 0) + 8;
    element.style.left = `${Math.floor(Math.max(8, Math.min(request.x, innerWidth - Math.ceil(rect.width) - 8)))}px`;
    element.style.top = `${Math.floor(Math.max(ceiling, Math.min(request.y, innerHeight - Math.ceil(rect.height) - 8)))}px`;
    element.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
  }, [request, dialog]);
  useEffect(() => {
    if (dialog) return;
    const outside = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node)) close(false); };
    const scroll = (event: Event) => {
      if (panel.current?.contains(event.target as Node)) return;
      const rect = request.anchor.getBoundingClientRect(), previous = anchorPosition.current;
      if (!request.anchor.isConnected || !previous || Math.abs(rect.left - previous.left) > 1 || Math.abs(rect.top - previous.top) > 1) close();
    };
    const resize = () => close();
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } };
    document.addEventListener('keydown', escape, true); document.addEventListener('pointerdown', outside, true); document.addEventListener('scroll', scroll, true); window.addEventListener('resize', resize);
    return () => { document.removeEventListener('keydown', escape, true); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', resize); };
  }, [request, dialog]);
  async function perform(action: ThreadAction) {
    if (locked.current || (running && action !== 'export')) return;
    locked.current = true; setBusy(true); setError('');
    const fallback = request.anchor.closest('.thread-section')?.querySelector<HTMLElement>('.thread-section-toggle');
    const focused = document.activeElement as HTMLElement | null;
    try {
      await onAction(action, thread.id, action === 'rename' ? title.trim() : undefined);
      const ownsFocus = document.activeElement === document.body || panel.current?.contains(document.activeElement) || Boolean(dialog);
      returning.current = ['pin', 'unpin', 'archive', 'delete'].includes(action) ? fallback ?? null : request.anchor;
      onClose();
      requestAnimationFrame(() => {
        if (!ownsFocus || document.activeElement !== document.body) return;
        const candidate = returning.current?.isConnected && returning.current.getClientRects().length ? returning.current : document.querySelector<HTMLElement>('.thread-section:not([hidden]) .thread-section-toggle');
        candidate?.focus({ preventScroll: true });
      });
    } catch { setError('操作未完成，请重试。'); requestAnimationFrame(() => { if (document.activeElement === document.body && focused?.isConnected) focused.focus(); }); }
    finally { locked.current = false; setBusy(false); }
  }
  if (dialog) return <Modal title={dialog === 'rename' ? '重命名聊天' : '删除聊天？'} returnFocus={returning} dismissible={!busy} onClose={() => close()} footer={<><Button disabled={busy} onClick={() => close()}>取消</Button><Button tone={dialog === 'delete' ? 'danger' : 'solid'} disabled={busy || running || (dialog === 'rename' && !title.trim())} onClick={() => { void perform(dialog); }}>{busy ? '正在保存…' : dialog === 'rename' ? '保存' : '删除'}</Button></>}>
    {dialog === 'rename' ? <Input autoFocus aria-label="聊天名称" maxLength={160} disabled={busy} value={title} onChange={event => setTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && title.trim()) { event.preventDefault(); void perform('rename'); } }} /> : <p>将删除“{thread.title}”及其未发送草稿。需要保留时，可以先导出聊天。</p>}
    {error && <p role="alert">{error}</p>}
  </Modal>;
  return createPortal(<div ref={panel} role="menu" aria-label="聊天操作" className="thread-actions-menu" style={{ left: request.x, top: request.y }} onKeyDown={event => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.key === 'Process' || event.nativeEvent.keyCode === 229) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key === 'Tab') { close(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const items = [...(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement); const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }}>
    <Button role="menuitem" disabled={busy || running} onClick={() => { setError(''); setDialog('rename'); }}><Glyph name="compose" size={16} />重命名</Button>
    <Button role="menuitem" disabled={busy || running} onClick={() => { void perform(thread.pinned ? 'unpin' : 'pin'); }}><Glyph name="pin" size={16} />{thread.pinned ? '取消置顶' : '置顶'}</Button>
    <Button role="menuitem" disabled={busy || running} onClick={() => { void perform('archive'); }}><Glyph name="archive" size={16} />归档</Button>
    <Button role="menuitem" disabled={busy} onClick={() => { void perform('export'); }}><Glyph name="download" size={16} />导出</Button>
    <Button role="menuitem" tone="danger" disabled={busy || running} onClick={() => { setError(''); setDialog('delete'); }}><Glyph name="trash" size={16} />删除</Button>
    {error && <p role="alert">{error}</p>}
  </div>, document.body);
}
