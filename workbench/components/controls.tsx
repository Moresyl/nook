import { cloneElement, createElement, isValidElement, useEffect, useId, useRef, type ButtonHTMLAttributes, type ComponentProps, type ReactElement, type ReactNode, type RefObject, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Glyph, type GlyphName } from './glyphs';
import { useControlTooltip } from './control-tooltip';

export function Button({ tone = 'ghost', className = '', ...props }: ComponentProps<'button'> & { tone?: 'ghost' | 'solid' | 'danger' }) {
  return <button type="button" className={`button button-${tone} ${className}`} {...props} />;
}
export function IconButton({ icon, label, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: GlyphName; label: string }) {
  const tooltip = useControlTooltip(props.title ?? label);
  return <><Button className="icon-button" aria-label={label} {...props} title={undefined} ref={tooltip.anchor}
    aria-describedby={[props['aria-describedby'], tooltip.description].filter(Boolean).join(' ') || undefined}
    onPointerEnter={event => { props.onPointerEnter?.(event); tooltip.enter(event); }}
    onPointerLeave={event => { props.onPointerLeave?.(event); tooltip.leave(); }}
    onPointerDown={event => { props.onPointerDown?.(event); tooltip.hide(); }}
    onFocus={event => { props.onFocus?.(event); tooltip.focus(); }}
    onBlur={event => { props.onBlur?.(event); tooltip.hide(); }}><Glyph name={icon} /></Button>{tooltip.content}</>;
}
export function Input(props: ComponentProps<'input'>) { return <input {...props} className={`input ${props.className ?? ''}`} />; }
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea {...props} className={`input textarea ${props.className ?? ''}`} />; }
export function Select({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) { return <select {...props} className={`input select ${props.className ?? ''}`}><button type="button">{createElement('selectedcontent')}</button>{children}</select>; }
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const id = useId();
  const control = isValidElement(children) ? cloneElement(children as ReactElement<{ 'aria-labelledby'?: string; 'aria-describedby'?: string }>, { 'aria-labelledby': id, 'aria-describedby': hint ? `${id}-hint` : undefined }) : children;
  return <label className="field"><span className="field-label" id={id}>{label}</span>{control}{hint && <span className="field-hint" id={`${id}-hint`}>{hint}</span>}</label>;
}
export function Toggle({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return <label className={`toggle-label ${disabled ? 'disabled' : ''}`}><span>{label}</span><input type="checkbox" role="switch" disabled={disabled} checked={checked} onChange={(event) => onChange(event.target.checked)} /><span className="toggle-track" aria-hidden="true"><span /></span></label>;
}
export function Empty({ icon, title, detail, action }: { icon: GlyphName; title: string; detail: string; action?: ReactNode }) {
  return <div className="empty"><div className="empty-glyph"><Glyph name={icon} size={28} /></div><h3>{title}</h3><p>{detail}</p>{action}</div>;
}
export function Modal({ title, children, onClose, footer, className = '', returnFocus }: { title: string; children: ReactNode; onClose: () => void; footer?: ReactNode; className?: string; returnFocus?: RefObject<HTMLElement | null> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    element.showModal();
    return () => { element.close(); (returnFocus?.current ?? previous)?.focus(); };
  }, []);
  return <dialog ref={dialog} aria-labelledby={titleId} className={`modal ${className}`} onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }} onClick={(event) => { if (event.target === dialog.current) { const rect = dialog.current.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}>
    <header className="modal-header"><h2 id={titleId}>{title}</h2><IconButton icon="close" label="关闭" onClick={onClose} /></header>
    <div className="modal-content">{children}</div>{footer && <footer className="modal-footer">{footer}</footer>}
  </dialog>;
}
