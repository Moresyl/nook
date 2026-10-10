import { useEffect, type RefObject } from 'react';
import type { PreviewViewport } from '../../contracts/project-preview';

/** Native child views must not cover application overlays or clipped containers. */
export function useNativeViewport(ref: RefObject<HTMLDivElement | null>, enabled: boolean, layout: (bounds: PreviewViewport | null) => Promise<void>, onFailure: () => void): void {
  useEffect(() => {
    const element = ref.current; if (!element || !enabled) return;
    let frame = 0, last = '', disposed = false;
    const update = () => {
      frame = 0; if (disposed) return;
      let bounds: PreviewViewport | null = null;
      const rect = element.getBoundingClientRect();
      const modal = [...document.querySelectorAll('dialog[open], [role="dialog"], select:open')].some(item => item.getClientRects().length > 0);
      const covered = modal || [...document.querySelectorAll('[role="menu"], [role="listbox"], [role="tooltip"], [popover]:popover-open')].some(item => {
        if (!item.getClientRects().length) return false;
        const overlay = item.getBoundingClientRect(); return overlay.left < rect.right && overlay.right > rect.left && overlay.top < rect.bottom && overlay.bottom > rect.top;
      });
      if (!covered && !document.hidden && element.getClientRects().length) {
        let left = Math.max(0, rect.left), top = Math.max(0, rect.top), right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom);
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent), clip = parent.getBoundingClientRect();
          if (style.visibility !== 'visible' || Number(style.opacity) === 0) { right = left; break; }
          if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); }
          if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
        }
        if (right > left && bottom > top) bounds = { x: left, y: top, width: right - left, height: bottom - top };
      }
      const key = JSON.stringify(bounds); if (key === last) return; last = key;
      void layout(bounds).catch(() => { if (!disposed) onFailure(); });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const refresh = () => { last = ''; schedule(); };
    const resize = new ResizeObserver(schedule); resize.observe(element);
    const changes = new MutationObserver(schedule); changes.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'open', 'hidden', 'aria-expanded'] });
    window.addEventListener('resize', refresh); window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh); document.addEventListener('scroll', schedule, true);
    for (const event of ['pointerdown', 'keydown', 'toggle']) document.addEventListener(event, schedule, true);
    schedule();
    return () => {
      disposed = true; cancelAnimationFrame(frame); resize.disconnect(); changes.disconnect();
      window.removeEventListener('resize', refresh); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); document.removeEventListener('scroll', schedule, true);
      for (const event of ['pointerdown', 'keydown', 'toggle']) document.removeEventListener(event, schedule, true);
      void layout(null).catch(() => {});
    };
  }, [ref, enabled, layout, onFailure]);
}
