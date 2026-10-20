import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { Thread } from '../../contracts/workspace';
import { Button } from './controls';
import { Glyph } from './glyphs';

type Props = { threads: Thread[]; activeId?: string; onSelect: (thread: Thread) => void };
const pageSize = 10;

function ThreadSection({ label, threads, activeId, onSelect, paginate = false }: Props & { label: string; paginate?: boolean }) {
  const id = useId(); const [collapsed, setCollapsed] = useState(false); const [limit, setLimit] = useState(pageSize);
  const rows = useRef(new Map<string, HTMLButtonElement>()); const reveal = useRef<string | undefined>(undefined);
  const active = threads.find(thread => thread.id === activeId);
  const visible = paginate ? threads.slice(0, limit) : [...threads];
  if (active && !visible.includes(active)) visible.push(active);
  const remaining = threads.length - visible.length;
  useLayoutEffect(() => { if (active) setCollapsed(false); }, [active?.id]);
  useLayoutEffect(() => {
    const element = reveal.current ? rows.current.get(reveal.current) : undefined;
    reveal.current = undefined;
    if (element) { element.focus({ preventScroll: true }); element.scrollIntoView({ block: 'nearest' }); }
  }, [limit]);
  function showMore() {
    const shown = new Set(visible.map(thread => thread.id));
    reveal.current = threads.slice(0, limit + pageSize).find(thread => !shown.has(thread.id))?.id;
    setLimit(value => value + pageSize);
  }
  return <section className="thread-section" aria-label={label}>
    <Button className="sidebar-section-label thread-section-toggle" aria-label={label} aria-expanded={!collapsed} aria-controls={id} title={`${collapsed ? '展开' : '折叠'}${label}`} onClick={() => setCollapsed(value => !value)}><span>{label}</span><Glyph name={collapsed ? 'right' : 'down'} size={14} /><span className="thread-section-count" aria-hidden="true">{threads.length || ''}</span></Button>
    <div id={id} hidden={collapsed}>{!collapsed && <>{visible.map(item => <Button key={item.id} ref={element => { if (element) rows.current.set(item.id, element); else rows.current.delete(item.id); }} title={item.temporary ? `临时 · ${item.title}` : item.title} aria-current={activeId === item.id ? 'page' : undefined} className={`thread-row ${activeId === item.id ? 'selected' : ''}`} onClick={() => onSelect(item)}>{item.pinned && <Glyph name="pin" size={12} />}<span>{item.temporary ? `临时 · ${item.title}` : item.title}</span>{item.messages.some(message => message.status === 'running') && <span className="stream-dot" />}</Button>)}{remaining > 0 && <Button className="thread-more" onClick={showMore} title={`显示更多${label}，还有 ${remaining} 个`} aria-label={`显示更多${label}`}><Glyph name="down" size={14} /><span>显示更多</span><span aria-hidden="true">{remaining}</span></Button>}{threads.length === 0 && <p className="sidebar-empty">暂无聊天</p>}</>}</div>
  </section>;
}

export function RecentThreads({ threads, activeId, onSelect }: Props) {
  const pinned = threads.filter(thread => thread.pinned); const recent = threads.filter(thread => !thread.pinned);
  return <div className="thread-list">{pinned.length > 0 && <ThreadSection label="已置顶" threads={pinned} activeId={activeId} onSelect={onSelect} />}<ThreadSection label="最近聊天" threads={recent} activeId={activeId} onSelect={onSelect} paginate /></div>;
}
