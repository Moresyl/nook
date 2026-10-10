import { useLayoutEffect, useRef } from 'react';
import type { BrowserTab } from './browser-tabs-state';
import { browserTabLimit } from '../../contracts/browser';
import { Button, IconButton } from './controls';

type Props = { tabs: BrowserTab[]; active: string | null; idPrefix: string; panelId: string; onSelect(token: string): void; onClose(token: string): void; onNew(): void };
export function BrowserTabs({ tabs, active, idPrefix, panelId, onSelect, onClose, onNew }: Props) {
  const viewport = useRef<HTMLDivElement>(null), buttons = useRef(new Map<string, HTMLButtonElement>()), pendingClose = useRef<string | null>(null);
  const order = JSON.stringify(tabs.map(tab => tab.state.token));
  useLayoutEffect(() => {
    const element = viewport.current, selected = active ? buttons.current.get(active) : null; if (!element || !selected) return;
    const reveal = () => { const row = selected.parentElement!.getBoundingClientRect(), bounds = element.getBoundingClientRect(); const delta = row.left < bounds.left ? row.left - bounds.left : Math.max(0, row.right - bounds.right); if (delta) element.scrollBy({ left: delta, behavior: 'instant' }); };
    reveal(); const observer = new ResizeObserver(reveal); observer.observe(element); observer.observe(selected.parentElement!); return () => observer.disconnect();
  }, [active, order]);
  useLayoutEffect(() => { if (pendingClose.current && !buttons.current.has(pendingClose.current)) { if (active) buttons.current.get(active)?.focus(); pendingClose.current = null; } }, [active, order]);
  const close = (token: string) => { pendingClose.current = token; onClose(token); };
  return <div className="browser-tabbar"><IconButton icon="plus" label="新建浏览器标签页" disabled={tabs.length >= browserTabLimit} onClick={onNew} /><div ref={viewport} className="browser-tabs" role="tablist" aria-label="网页标签">{tabs.map(({ state }, index) => {
    const title = state.title || state.url || '新标签页', token = state.token;
    return <div key={token} className={`browser-tab ${token === active ? 'active' : ''}`}><Button ref={element => { if (element) buttons.current.set(token, element); else buttons.current.delete(token); }} role="tab" id={`${idPrefix}-${index}`} aria-controls={panelId} aria-selected={token === active} aria-label={title} tabIndex={token === active ? 0 : -1} title={state.url ? `${title}\n${state.url}` : title} onClick={() => onSelect(token)} onKeyDown={event => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.nativeEvent.isComposing) return;
      if (event.key === 'Delete') { event.preventDefault(); close(token); return; }
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'ArrowRight' ? (index + 1) % tabs.length : -1;
      if (next >= 0) { event.preventDefault(); const target = tabs[next].state.token; onSelect(target); buttons.current.get(target)?.focus(); }
    }}><span className="browser-tab-name">{title}</span>{state.loading && <span className="browser-tab-indicator" aria-label="正在加载">●</span>}{state.error && <span className="browser-tab-indicator" aria-label="加载失败">!</span>}</Button><IconButton icon="close" label={`关闭网页标签 ${title}`} tabIndex={token === active ? 0 : -1} onClick={() => close(token)} /></div>;
  })}</div></div>;
}
