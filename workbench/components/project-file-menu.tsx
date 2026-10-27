import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FileEntry } from '../../contracts/projects';
import { Button } from './controls';
import { Glyph } from './glyphs';

export type ProjectFileMenuRequest = { id: number; entry: FileEntry; anchor: HTMLElement; x: number; y: number };

export function ProjectFileMenu({ request, expanded, onActivate, onNew, onNewFolder, onClose }: { request: ProjectFileMenuRequest; expanded: boolean; onActivate: () => void; onNew: () => void; onNewFolder: () => void; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null), locked = useRef(false);
  const copyButton = useRef<HTMLButtonElement>(null), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const anchorPosition = useRef({ left: 0, top: 0 });
  function close(restore = true) {
    if (locked.current || !mounted.current) return;
    if (restore && request.anchor.isConnected) request.anchor.focus({ preventScroll: true });
    onClose();
  }
  useLayoutEffect(() => {
    const element = panel.current!, rect = element.getBoundingClientRect(), anchor = request.anchor.getBoundingClientRect();
    anchorPosition.current = { left: anchor.left, top: anchor.top };
    const ceiling = (document.querySelector('.window-chrome')?.getBoundingClientRect().bottom ?? 0) + 8;
    element.style.left = `${Math.floor(Math.max(8, Math.min(request.x, innerWidth - Math.ceil(rect.width) - 8)))}px`;
    element.style.top = `${Math.floor(Math.max(ceiling, Math.min(request.y, innerHeight - Math.ceil(rect.height) - 8)))}px`;
    if (!element.contains(document.activeElement)) (error ? copyButton.current : element.querySelector<HTMLElement>('[role="menuitem"]'))?.focus({ preventScroll: true });
  }, [request, error]);
  useEffect(() => {
    const width = innerWidth, height = innerHeight;
    const outside = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node)) close(false); };
    const scroll = (event: Event) => {
      if (panel.current?.contains(event.target as Node)) return;
      const rect = request.anchor.getBoundingClientRect(), before = anchorPosition.current;
      if (!request.anchor.isConnected || Math.abs(rect.left - before.left) > 1 || Math.abs(rect.top - before.top) > 1) close(false);
    };
    const resize = () => { if (innerWidth !== width || innerHeight !== height) close(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); event.stopPropagation(); close(); } };
    document.addEventListener('pointerdown', outside, true); document.addEventListener('scroll', scroll, true); document.addEventListener('keydown', escape, true); window.addEventListener('resize', resize);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('scroll', scroll, true); document.removeEventListener('keydown', escape, true); window.removeEventListener('resize', resize); };
  }, [request]);
  async function copy() {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try { await navigator.clipboard.writeText(request.entry.relativePath); locked.current = false; close(); }
    catch { if (mounted.current) setError('无法复制路径，请重试。'); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  return createPortal(<div ref={panel} role="menu" aria-label="文件操作" className="project-file-menu" style={{ left: request.x, top: request.y }} onKeyDown={event => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === 'Tab') { close(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const items = [...(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLElement), next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }}>
    <Button role="menuitem" disabled={busy} onClick={() => { close(); onActivate(); }}><Glyph name={request.entry.directory ? expanded ? 'down' : 'right' : 'file'} size={16} />{request.entry.directory ? expanded ? '收起目录' : '展开目录' : '打开文件'}</Button>
    <Button ref={copyButton} role="menuitem" disabled={busy} onClick={() => { void copy(); }}><Glyph name="copy" size={16} />复制相对路径</Button>
    <Button role="menuitem" disabled={busy} onClick={() => { close(); onNew(); }}><Glyph name="plus" size={16} />在此目录新建文件</Button>
    <Button role="menuitem" disabled={busy} onClick={() => { close(); onNewFolder(); }}><Glyph name="folderPlus" size={16} />在此目录新建文件夹</Button>
    {error && <p role="alert">{error}</p>}
  </div>, document.body);
}
