import { createElement, useEffect, useId, useLayoutEffect, useRef, useState, type HTMLAttributes, type PointerEvent } from 'react';

let dismissActive: (() => void) | undefined;

/** A non-interactive top-layer hint that stays inside its trigger's modal scope. */
export function useControlTooltip<T extends HTMLElement = HTMLButtonElement>(text: string) {
  const id = useId();
  const anchor = useRef<T>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const hide = () => { clearTimeout(timer.current); setOpen(false); };
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    if (!open || !text || !anchor.current?.isConnected || !tip.current) return;
    const element = tip.current;
    dismissActive?.(); dismissActive = hide;
    element.showPopover();
    const bounds = anchor.current.getBoundingClientRect();
    const size = element.getBoundingClientRect();
    const left = Math.max(8, Math.min(bounds.left + (bounds.width - size.width) / 2, innerWidth - size.width - 8));
    const below = bounds.bottom + 6;
    const top = below + size.height <= innerHeight - 8 ? below : Math.max(8, bounds.top - size.height - 6);
    element.style.left = `${left}px`; element.style.top = `${top}px`;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      hide();
    };
    document.addEventListener('keydown', dismiss, true);
    document.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      if (dismissActive === hide) dismissActive = undefined;
      document.removeEventListener('keydown', dismiss, true);
      document.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      if (element.matches(':popover-open')) element.hidePopover();
    };
  }, [open, text]);
  const enter = (event: PointerEvent<T>) => {
    if (!text || event.pointerType === 'touch') return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), 500);
  };
  const leave = () => {
    if (anchor.current === document.activeElement && anchor.current?.matches(':focus-visible')) return;
    hide();
  };
  const focus = () => {
    if (text && anchor.current?.matches(':focus-visible')) { clearTimeout(timer.current); setOpen(true); }
  };
  return { anchor, description: open && text ? id : undefined, enter, leave, focus, hide,
    content: text ? <span ref={tip} id={id} role="tooltip" popover="manual" className="control-tooltip">{text}</span> : null };
}

/** Preserve the text element's semantics while making its full description keyboard-readable. */
export function TextHint({ as = 'span', text, children, tabIndex, ...props }: Omit<HTMLAttributes<HTMLElement>, 'title'> & { as?: 'span' | 'div' | 'p' | 'h3'; text: string }) {
  const tooltip = useControlTooltip<HTMLElement>(text);
  return <>{createElement(as, { ...props, ref: tooltip.anchor, tabIndex: tabIndex ?? (text ? 0 : undefined),
    'aria-describedby': [props['aria-describedby'], tooltip.description].filter(Boolean).join(' ') || undefined,
    onPointerEnter: event => { props.onPointerEnter?.(event); tooltip.enter(event); },
    onPointerLeave: event => { props.onPointerLeave?.(event); tooltip.leave(); },
    onPointerDown: event => { props.onPointerDown?.(event); tooltip.hide(); },
    onFocus: event => { props.onFocus?.(event); tooltip.focus(); },
    onBlur: event => { props.onBlur?.(event); tooltip.hide(); },
    onClick: event => { tooltip.hide(); props.onClick?.(event); },
  }, children)}{tooltip.content}</>;
}
