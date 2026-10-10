import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { Button, IconButton } from './controls';

type Tab = { path: string; dirty: boolean };
type Props = { tabs: Tab[]; active: string; idPrefix: string; panelId: string; closing: string | null; onSelect(path: string): void; onClose(path: string): void };

export function EditorTabs({ tabs, active, idPrefix, panelId, closing, onSelect, onClose }: Props) {
  const viewport = useRef<HTMLDivElement>(null), buttons = useRef(new Map<string, HTMLButtonElement>()), pendingClose = useRef<string | null>(null);
  const order = JSON.stringify(tabs.map(tab => tab.path));
  useLayoutEffect(() => {
    const element = viewport.current, selected = buttons.current.get(active);
    if (!element || !selected) return;
    const reveal = () => {
      const row = selected.parentElement!.getBoundingClientRect(), bounds = element.getBoundingClientRect();
      const delta = row.left < bounds.left ? row.left - bounds.left : row.right > bounds.right ? row.right - bounds.right : 0;
      if (delta) element.scrollBy({ left: delta, behavior: 'instant' });
    };
    reveal();
    const observer = new ResizeObserver(reveal); observer.observe(element); observer.observe(selected.parentElement!);
    return () => observer.disconnect();
  }, [active, order]);
  useLayoutEffect(() => {
    const path = pendingClose.current;
    if (!path) return;
    if (!buttons.current.has(path)) { buttons.current.get(active)?.focus(); pendingClose.current = null; }
    else if (closing === null) pendingClose.current = null;
  }, [active, order, closing]);
  function requestClose(path: string) { pendingClose.current = path; onClose(path); }
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.nativeEvent.isComposing) return;
    if (event.key === 'Delete') { event.preventDefault(); requestClose(tabs[index].path); return; }
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'ArrowRight' ? (index + 1) % tabs.length : -1;
    if (next < 0) return;
    event.preventDefault(); const path = tabs[next].path; onSelect(path); buttons.current.get(path)?.focus();
  }
  return <div ref={viewport} className="editor-tabs" role="tablist" aria-label="打开的文件">{tabs.map((tab, index) => <div className={`editor-tab ${tab.path === active ? 'active' : ''}`} key={tab.path}>
    <Button ref={element => { if (element) buttons.current.set(tab.path, element); else buttons.current.delete(tab.path); }} role="tab" id={`${idPrefix}-${index}`} aria-controls={panelId} aria-selected={tab.path === active} aria-label={`${tab.path}${tab.dirty ? ' 未保存' : ''}`} tabIndex={tab.path === active ? 0 : -1} title={tab.path} onClick={() => onSelect(tab.path)} onKeyDown={event => navigate(event, index)}><span className="editor-tab-name">{tab.path.split('/').at(-1)}</span>{tab.dirty && <span aria-hidden="true">●</span>}</Button>
    <IconButton icon="close" label={`关闭 ${tab.path}`} tabIndex={tab.path === active ? 0 : -1} onClick={() => requestClose(tab.path)} />
  </div>)}</div>;
}
