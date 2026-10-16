import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { ComposerAction } from '../../contracts/composer-actions';
import { Button } from './controls';
import { Glyph } from './glyphs';

type Props = { id: string; anchor: RefObject<HTMLTextAreaElement | null>; items: ComposerAction[]; active: string; onActive: (key: string) => void; onChoose: (item: ComposerAction) => void };
export function ComposerActions({ id, anchor, items, active, onActive, onChoose }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; width: number; maxHeight: number }>();
  useLayoutEffect(() => {
    const place = () => {
      if (!anchor.current || !panel.current) return;
      const ceiling = Math.max(8, (document.querySelector('.window-chrome')?.getBoundingClientRect().bottom ?? 0) + 8);
      const rect = anchor.current.getBoundingClientRect(); const above = Math.max(0, rect.top - ceiling - 8); const below = Math.max(0, innerHeight - rect.bottom - 16); const up = above >= below;
      const width = Math.min(420, innerWidth - 16); const maxHeight = Math.min(320, up ? above : below);
      const height = Math.min(maxHeight, panel.current.scrollHeight);
      setPosition({ left: Math.max(8, Math.min(rect.left, innerWidth - width - 8)), top: up ? Math.max(ceiling, rect.top - height - 8) : rect.bottom + 8, width, maxHeight });
    };
    place(); const observer = new ResizeObserver(place); if (anchor.current) observer.observe(anchor.current); if (panel.current) observer.observe(panel.current);
    window.addEventListener('resize', place); document.addEventListener('scroll', place, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); document.removeEventListener('scroll', place, true); };
  }, [anchor, items]);
  useLayoutEffect(() => { panel.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active]);
  return createPortal(<div ref={panel} className="composer-actions" style={{ ...position, visibility: position ? 'visible' : 'hidden' }}>
    <p id={`${id}-hint`} className="composer-actions-hint">快捷选择 <span>↑ ↓ 选择 · Enter 应用 · Esc 关闭</span></p>
    <div id={id} role="listbox" aria-label="输入区快捷选择" className="composer-actions-list">{items.map((item, index) => <Button key={item.key} id={`${id}-${index}`} role="option" aria-label={`${item.title}，${item.group}`} aria-selected={active === item.key} tabIndex={-1} onMouseDown={event => event.preventDefault()} onMouseMove={() => onActive(item.key)} onClick={() => onChoose(item)}>
      <Glyph name={item.kind === 'template' ? 'compose' : item.kind === 'assistant' ? 'assistant' : item.kind === 'project' ? 'folder' : item.kind === 'knowledge' ? 'library' : 'code'} size={16} />
      <span className="composer-action-text"><strong>{item.title}</strong><small>{item.description}</small></span><span className="composer-action-group">{item.group}</span>
    </Button>)}</div>
    <p className="composer-actions-status" role="status">{items.length ? `${items.length} 个结果${items.length === 100 ? '，输入更多文字缩小范围' : ''}` : '没有匹配项，继续输入或按 Esc 保留原文。'}</p>
  </div>, document.body);
}
