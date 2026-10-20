import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import type { Thread } from '../../contracts/workspace';
import type { PinnedReorder } from '../../contracts/pinned-order';
import { readSidebarCollapsed, saveSidebarCollapsed, type SidebarSection } from '../lib/sidebar-sections';
import { Button } from './controls';
import { Glyph } from './glyphs';

type Props = { threads: Thread[]; activeId?: string; revealRequest: number; onSelect: (thread: Thread) => void; onReorder: (input: PinnedReorder) => Promise<void> };
type Drag = { threadId: string; pointerId: number; x: number; y: number; startX: number; startY: number; started: boolean };
const pageSize = 10;

function ThreadSection({ section, label, threads, activeId, revealRequest, onSelect, onReorder, paginate = false }: Props & { section: SidebarSection; label: string; paginate?: boolean }) {
  const id = useId(); const [collapsed, setCollapsed] = useState(() => readSidebarCollapsed(section)); const [limit, setLimit] = useState(pageSize);
  const [present, setPresent] = useState(!collapsed);
  const rows = useRef(new Map<string, HTMLButtonElement>()); const reveal = useRef<string | undefined>(undefined);
  const drag = useRef<Drag | undefined>(undefined); const suppressClick = useRef(false); const moving = useRef(false); const focusAfter = useRef<string | undefined>(undefined);
  const [dragging, setDragging] = useState<string>(); const [drop, setDrop] = useState<PinnedReorder>(); const [busy, setBusy] = useState(false); const [error, setError] = useState(false); const [announcement, setAnnouncement] = useState('');
  const active = threads.find(thread => thread.id === activeId);
  const visible = paginate ? threads.slice(0, limit) : [...threads];
  if (active && !visible.includes(active)) visible.push(active);
  const remaining = threads.length - visible.length;
  const previousActive = useRef(active?.id);
  const previousReveal = useRef(revealRequest);
  function changeCollapsed(value: boolean) { setCollapsed(value); saveSidebarCollapsed(section, value); }
  useLayoutEffect(() => {
    if (active && (active.id !== previousActive.current || revealRequest !== previousReveal.current)) changeCollapsed(false);
    previousActive.current = active?.id;
    previousReveal.current = revealRequest;
  }, [active?.id, revealRequest]);
  useLayoutEffect(() => {
    if (!collapsed) { setPresent(true); return; }
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    if (motion.matches) { setPresent(false); return; }
    const timer = window.setTimeout(() => setPresent(false), 300);
    const finish = () => { if (motion.matches) { window.clearTimeout(timer); setPresent(false); } };
    motion.addEventListener('change', finish);
    return () => { window.clearTimeout(timer); motion.removeEventListener('change', finish); };
  }, [collapsed]);
  useLayoutEffect(() => {
    const element = reveal.current ? rows.current.get(reveal.current) : undefined;
    reveal.current = undefined;
    if (element) { element.focus({ preventScroll: true }); element.scrollIntoView({ block: 'nearest' }); }
  }, [limit]);
  useLayoutEffect(() => {
    if (busy || !focusAfter.current) return;
    const element = rows.current.get(focusAfter.current); focusAfter.current = undefined;
    if (element && (document.activeElement === element || document.activeElement === document.body)) { element.focus({ preventScroll: true }); element.scrollIntoView({ block: 'nearest' }); }
  }, [busy, threads]);
  function cancelDrag() {
    const current = drag.current; drag.current = undefined;
    if (current?.started) suppressClick.current = true;
    const element = current && rows.current.get(current.threadId);
    if (element?.hasPointerCapture(current!.pointerId)) element.releasePointerCapture(current!.pointerId);
    setDragging(undefined); setDrop(undefined);
  }
  useEffect(() => { window.addEventListener('blur', cancelDrag); return () => window.removeEventListener('blur', cancelDrag); }, []);
  function destination(current: Drag): PinnedReorder | undefined {
    const element = document.elementFromPoint(current.x, current.y)?.closest<HTMLElement>('[data-pinned-id]');
    const targetId = element?.dataset.pinnedId;
    if (!element || !targetId || targetId === current.threadId || !threads.some(thread => thread.id === targetId && thread.pinned)) return undefined;
    const bounds = element.getBoundingClientRect();
    return { threadId: current.threadId, targetId, position: current.y < bounds.top + bounds.height / 2 ? 'before' : 'after' };
  }
  useEffect(() => {
    if (!dragging) return;
    let frame = 0;
    const tick = () => {
      const current = drag.current; if (!current?.started) return;
      const viewport = rows.current.get(current.threadId)?.closest('.thread-list');
      if (viewport) { const bounds = viewport.getBoundingClientRect(); if (current.x >= bounds.left && current.x <= bounds.right && current.y >= bounds.top - 24 && current.y <= bounds.bottom + 24) { const distance = current.y < bounds.top + 24 ? current.y - bounds.top - 24 : current.y > bounds.bottom - 24 ? current.y - bounds.bottom + 24 : 0; viewport.scrollTop += Math.max(-12, Math.min(12, distance / 2)); } }
      const next = destination(current);
      setDrop(previous => previous?.targetId === next?.targetId && previous?.position === next?.position ? previous : next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [dragging, threads]);
  async function move(input: PinnedReorder) {
    if (moving.current) return;
    moving.current = true; focusAfter.current = input.threadId; setBusy(true); setError(false); setAnnouncement('');
    try { await onReorder(input); setAnnouncement('置顶顺序已保存'); }
    catch { setError(true); }
    finally { moving.current = false; setBusy(false); }
  }
  function startDrag(event: PointerEvent<HTMLButtonElement>, thread: Thread) {
    suppressClick.current = false;
    if (!thread.pinned || event.button !== 0 || moving.current || drag.current) return;
    drag.current = { threadId: thread.id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, started: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current; if (!current || current.pointerId !== event.pointerId) return;
    if (!(event.buttons & 1)) { cancelDrag(); return; }
    current.x = event.clientX; current.y = event.clientY;
    if (!current.started && (current.x - current.startX) ** 2 + (current.y - current.startY) ** 2 < 16) return;
    if (!current.started) { current.started = true; suppressClick.current = true; event.currentTarget.setPointerCapture(event.pointerId); setDragging(current.threadId); }
    event.preventDefault(); setDrop(destination(current));
  }
  function finishDrag(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current; if (!current || current.pointerId !== event.pointerId) return;
    current.x = event.clientX; current.y = event.clientY;
    const next = current.started ? destination(current) : undefined;
    if (current.started) event.preventDefault();
    cancelDrag(); if (next) void move(next);
  }
  function showMore() {
    const shown = new Set(visible.map(thread => thread.id));
    reveal.current = threads.slice(0, limit + pageSize).find(thread => !shown.has(thread.id))?.id;
    setLimit(value => value + pageSize);
  }
  return <section className="thread-section" aria-label={label} hidden={section === 'pinned' && threads.length === 0}>
    <Button className="sidebar-section-label thread-section-toggle" aria-label={label} aria-expanded={!collapsed} aria-controls={id} title={`${collapsed ? '展开' : '折叠'}${label}`} onClick={() => changeCollapsed(!collapsed)}><span>{label}</span><Glyph name={collapsed ? 'right' : 'down'} size={14} /><span className="thread-section-count" aria-hidden="true">{threads.length || ''}</span></Button>
    <div id={id} className="thread-section-content" data-collapsed={collapsed} inert={collapsed} aria-hidden={collapsed}><div>{present && <>{visible.map((item, index) => <Button key={item.id} ref={element => { if (element) rows.current.set(item.id, element); else rows.current.delete(item.id); }} title={`${item.temporary ? `临时 · ${item.title}` : item.title}${item.pinned ? '\n拖动调整顺序，或使用 Alt＋上下方向键' : ''}`} aria-current={activeId === item.id ? 'page' : undefined} aria-keyshortcuts={item.pinned ? 'Alt+ArrowUp Alt+ArrowDown' : undefined} disabled={item.pinned && busy} data-pinned-id={item.pinned ? item.id : undefined} data-dragging={dragging === item.id || undefined} data-drop-side={drop?.targetId === item.id ? drop.position : undefined} className={`thread-row ${activeId === item.id ? 'selected' : ''}`} onPointerDown={event => startDrag(event, item)} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag} onKeyDown={event => {
      if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopPropagation(); cancelDrag(); return; }
      if (!item.pinned || busy || event.nativeEvent.isComposing || event.key === 'Process' || event.nativeEvent.keyCode === 229 || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); const target = visible[index + (event.key === 'ArrowUp' ? -1 : 1)];
      if (target) void move({ threadId: item.id, targetId: target.id, position: event.key === 'ArrowUp' ? 'before' : 'after' });
    }} onClick={event => { if (event.detail > 0 && suppressClick.current) { event.preventDefault(); suppressClick.current = false; return; } onSelect(item); }}>{item.pinned && <Glyph name="pin" size={12} />}<span>{item.temporary ? `临时 · ${item.title}` : item.title}</span>{item.messages.some(message => message.status === 'running') && <span className="stream-dot" />}</Button>)}{remaining > 0 && <Button className="thread-more" onClick={showMore} title={`显示更多${label}，还有 ${remaining} 个`} aria-label={`显示更多${label}`}><Glyph name="down" size={14} /><span>显示更多</span><span aria-hidden="true">{remaining}</span></Button>}{threads.length === 0 && <p className="sidebar-empty">暂无聊天</p>}</>}</div></div>
    {error && <p role="alert" className="thread-reorder-error">无法保存置顶顺序，请重试。</p>}<span role="status" className="thread-reorder-announcement">{announcement}</span>
  </section>;
}

export function RecentThreads({ threads, activeId, revealRequest, onSelect, onReorder }: Omit<Props, 'threads'> & { threads?: Thread[] }) {
  if (!threads) return null;
  const pinned = threads.filter(thread => thread.pinned); const recent = threads.filter(thread => !thread.pinned);
  return <div className="thread-list"><ThreadSection section="pinned" label="已置顶" threads={pinned} activeId={activeId} revealRequest={revealRequest} onSelect={onSelect} onReorder={onReorder} /><ThreadSection section="recent" label="最近聊天" threads={recent} activeId={activeId} revealRequest={revealRequest} onSelect={onSelect} onReorder={onReorder} paginate /></div>;
}
