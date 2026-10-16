import { cloneElement, createElement, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type FocusEvent, type HTMLAttributes, type PointerEvent, type ReactElement, type Ref, type RefObject } from 'react';

let dismissActive: (() => void) | undefined;
let hoverReadyUntil = 0;
const dismissals = new Set<() => void>();
const dismissAll = () => { for (const dismiss of dismissals) dismiss(); hoverReadyUntil = 0; };
const dismissOnEscape = (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return;
  // Consume an active hint before queued cleanup can remove its document listener.
  if (dismissActive) { event.preventDefault(); event.stopPropagation(); }
  queueMicrotask(dismissAll);
};
const dismissOnDialog = (event: Event) => {
  if (event.target instanceof HTMLDialogElement && (event as ToggleEvent).newState === 'open') dismissAll();
};

/** A non-interactive top-layer hint that stays inside its trigger's modal scope. */
export function useControlTooltip<T extends HTMLElement = HTMLButtonElement>(text: string, positionAnchor?: RefObject<HTMLElement | null>) {
  const id = useId();
  const anchor = useRef<T>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const opened = useRef(false);
  const blocked = useRef(false);
  const currentText = useRef(text); currentText.current = text;
  const [open, setOpen] = useState(false);
  const hide = useCallback(() => {
    clearTimeout(timer.current); timer.current = undefined;
    if (opened.current) hoverReadyUntil = performance.now() + 300;
    opened.current = false; setOpen(false);
  }, []);
  useEffect(() => {
    if (!dismissals.size) {
      window.addEventListener('blur', dismissAll);
      window.addEventListener('keydown', dismissOnEscape, true);
      document.addEventListener('beforetoggle', dismissOnDialog, true);
    }
    dismissals.add(hide);
    return () => {
      hide(); dismissals.delete(hide);
      if (!dismissals.size) {
        window.removeEventListener('blur', dismissAll);
        window.removeEventListener('keydown', dismissOnEscape, true);
        document.removeEventListener('beforetoggle', dismissOnDialog, true);
        hoverReadyUntil = 0;
      }
    };
  }, [hide]);
  useEffect(() => { if (!text) hide(); }, [text, hide]);
  useLayoutEffect(() => {
    if (!open || !text || !anchor.current?.isConnected || !tip.current) return;
    const element = tip.current;
    dismissActive?.(); dismissActive = hide;
    element.showPopover();
    const place = () => {
      const bounds = (positionAnchor?.current ?? anchor.current)?.getBoundingClientRect();
      if (!bounds) { hide(); return; }
      const size = element.getBoundingClientRect();
      const left = Math.max(8, Math.min(bounds.left + (bounds.width - size.width) / 2, innerWidth - size.width - 8));
      const above = bounds.top - size.height - 2;
      const top = Math.max(8, above >= 8 ? above : Math.min(bounds.bottom + 2, innerHeight - size.height - 8));
      element.style.left = `${left}px`; element.style.top = `${top}px`;
    };
    place();
    const scroll = () => {
      if (anchor.current === document.activeElement && anchor.current?.matches(':focus-visible')) place();
      else hide();
    };
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      hide();
    };
    document.addEventListener('keydown', dismiss, true);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', hide);
    return () => {
      if (dismissActive === hide) dismissActive = undefined;
      document.removeEventListener('keydown', dismiss, true);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', hide);
      if (element.matches(':popover-open')) element.hidePopover();
    };
  }, [open, text, positionAnchor, hide]);
  const show = () => {
    const element = anchor.current;
    if (!currentText.current || !element?.isConnected || element.closest('[inert]')) return;
    if (document.querySelector('dialog:modal') && !element.closest('dialog:modal')) return;
    opened.current = true; setOpen(true);
  };
  const move = (event: PointerEvent<T>) => {
    if (!text || event.pointerType === 'touch' || blocked.current || opened.current || timer.current !== undefined) return;
    if (dismissActive || performance.now() < hoverReadyUntil) show();
    else timer.current = setTimeout(() => { timer.current = undefined; show(); }, 200);
  };
  const enter = (event: PointerEvent<T>) => { blocked.current = false; move(event); };
  const press = () => { blocked.current = true; hide(); };
  const focus = (event?: FocusEvent<T>) => {
    if (event?.defaultPrevented) { press(); return; }
    if (text && anchor.current?.matches(':focus-visible')) { blocked.current = false; clearTimeout(timer.current); timer.current = undefined; show(); }
  };
  return { anchor, description: open && text ? id : undefined, enter, move, leave: hide, focus, hide, press,
    content: text ? <span ref={tip} id={id} role="tooltip" popover="manual" className="control-tooltip">{text}</span> : null };
}

/** Add a hint without inserting a layout wrapper or changing the control's native behavior. */
export function ElementHint<T extends HTMLElement>({ text, children }: { text: string; children: ReactElement<HTMLAttributes<T> & { ref?: Ref<T> }> }) {
  const tooltip = useControlTooltip<T>(text);
  const props = children.props;
  useImperativeHandle(props.ref, () => tooltip.anchor.current!, [tooltip.anchor]);
  return <>{cloneElement(children, { ref: tooltip.anchor,
    'aria-describedby': [props['aria-describedby'], tooltip.description].filter(Boolean).join(' ') || undefined,
    onPointerEnter: event => { props.onPointerEnter?.(event); tooltip.enter(event); },
    onPointerMove: event => { props.onPointerMove?.(event); tooltip.move(event); },
    onPointerLeave: event => { props.onPointerLeave?.(event); tooltip.leave(); },
    onPointerDown: event => { props.onPointerDown?.(event); tooltip.press(); },
    onContextMenu: event => { props.onContextMenu?.(event); tooltip.hide(); },
    onFocus: event => { props.onFocus?.(event); tooltip.focus(event); },
    onBlur: event => { props.onBlur?.(event); tooltip.hide(); },
    onClick: event => { tooltip.press(); props.onClick?.(event); },
  })}{tooltip.content}</>;
}

/** Preserve the text element's semantics while making its full description keyboard-readable. */
export function TextHint({ as = 'span', text, children, tabIndex, ...props }: Omit<HTMLAttributes<HTMLElement>, 'title'> & { as?: 'span' | 'div' | 'p' | 'h3'; text: string }) {
  const tooltip = useControlTooltip<HTMLElement>(text);
  return <>{createElement(as, { ...props, ref: tooltip.anchor, tabIndex: tabIndex ?? (text ? 0 : undefined),
    'aria-describedby': [props['aria-describedby'], tooltip.description].filter(Boolean).join(' ') || undefined,
    onPointerEnter: event => { props.onPointerEnter?.(event); tooltip.enter(event); },
    onPointerMove: event => { props.onPointerMove?.(event); tooltip.move(event); },
    onPointerLeave: event => { props.onPointerLeave?.(event); tooltip.leave(); },
    onPointerDown: event => { props.onPointerDown?.(event); tooltip.press(); },
    onContextMenu: event => { props.onContextMenu?.(event); tooltip.hide(); },
    onFocus: event => { props.onFocus?.(event); tooltip.focus(event); },
    onBlur: event => { props.onBlur?.(event); tooltip.hide(); },
    onClick: event => { tooltip.press(); props.onClick?.(event); },
  }, children)}{tooltip.content}</>;
}
