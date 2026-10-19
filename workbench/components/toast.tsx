import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './controls';
import { Glyph } from './glyphs';
import { ToastLifetime, visibleToastLimit, type ToastMessage } from '../lib/toasts';

export function Toast({ messages, onClose }: { messages: ToastMessage[]; onClose: (id: number) => void }) {
  const [host, setHost] = useState<HTMLElement>(document.body);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);
  const [inactive, setInactive] = useState(!document.hasFocus());
  const viewport = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const pendingFocus = useRef(false);
  const timers = useRef(new Map<number, ToastLifetime>());
  const close = useRef(onClose); close.current = onClose;
  useLayoutEffect(() => {
    const update = () => setHost([...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].at(-1) ?? document.body);
    update(); const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    const blur = () => setInactive(true), focus = () => setInactive(false);
    document.addEventListener('visibilitychange', update);
    window.addEventListener('blur', blur); window.addEventListener('focus', focus);
    return () => { document.removeEventListener('visibilitychange', update); window.removeEventListener('blur', blur); window.removeEventListener('focus', focus); };
  }, []);
  useEffect(() => {
    const visible = messages.slice(0, visibleToastLimit);
    for (const [id, timer] of timers.current) if (!visible.some(item => item.id === id)) { timer.dispose(); timers.current.delete(id); }
    for (const { id } of visible) {
      let timer = timers.current.get(id);
      if (!timer) { timer = new ToastLifetime(() => close.current(id)); timers.current.set(id, timer); }
      if (hovered || focused || hidden || inactive) timer.pause(); else timer.resume();
    }
  }, [messages, hovered, focused, hidden, inactive]);
  useEffect(() => () => { for (const timer of timers.current.values()) timer.dispose(); timers.current.clear(); }, []);
  useLayoutEffect(() => {
    setHovered(false); setFocused(false);
  }, [host]);
  useLayoutEffect(() => {
    if (pendingFocus.current) {
      pendingFocus.current = false;
      const target = viewport.current?.querySelector<HTMLElement>('button') ?? returnFocus.current;
      if (target?.isConnected) target.focus({ preventScroll: true });
    }
    setFocused(Boolean(viewport.current?.contains(document.activeElement)));
    if (!messages.length) setHovered(false);
  }, [messages, host]);
  if (!messages.length) return null;
  return createPortal(<div className="toast-viewport" role="region" aria-label="通知" ref={viewport}
    onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
    onFocusCapture={event => {
      if (event.relatedTarget instanceof HTMLElement && !event.currentTarget.contains(event.relatedTarget)) returnFocus.current = event.relatedTarget;
      setFocused(true);
    }}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}>
    {messages.slice(0, visibleToastLimit).map(item => <div className="toast" role="alert" key={item.message}>
      <span className="toast-leading"><Glyph name="alert" size={20} /></span>
      <span className="toast-message" dir="auto">{item.message}</span>
      <IconButton icon="close" label="关闭提示" onClick={event => { pendingFocus.current = event.currentTarget === document.activeElement; onClose(item.id); }} />
    </div>)}
  </div>, host);
}
