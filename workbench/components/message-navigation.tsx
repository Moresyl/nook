import { useId, useRef, useState, type PointerEvent } from 'react';
import { messageMarkerIndex, type MessageMarker } from '../../contracts/chat-navigation';
import { Button } from './controls';

type Props = { markers: MessageMarker[]; current: string; controls: (id: string) => string; onJump: (id: string, scrubbing: boolean) => void };
export function MessageNavigation({ markers, current, controls, onJump }: Props) {
  const [focused, setFocused] = useState(0); const [hover, setHover] = useState<number | null>(null); const [previewTop, setPreviewTop] = useState(0); const [scrubbing, setScrubbing] = useState(false);
  const nav = useRef<HTMLElement>(null); const buttons = useRef(new Map<string, HTMLButtonElement>()); const dragging = useRef(false); const previewId = useId();
  function preview(index: number) {
    setHover(index); const button = buttons.current.get(markers[index]?.id); const region = nav.current?.parentElement;
    if (button && region) setPreviewTop(Math.max(0, Math.min(region.clientHeight - 80, button.getBoundingClientRect().top - region.getBoundingClientRect().top)));
  }
  function scrub(event: PointerEvent<HTMLElement>) {
    const element = nav.current; if (!element || !markers.length) return;
    const box = element.getBoundingClientRect();
    if (event.clientY < box.top) element.scrollTop -= 24; else if (event.clientY > box.bottom) element.scrollTop += 24;
    const index = Math.max(0, Math.min(markers.length - 1, Math.floor((event.clientY - box.top + element.scrollTop) / 24)));
    preview(index); setFocused(index); onJump(markers[index].id, true);
  }
  if (!markers.length) return null;
  return <><nav ref={nav} className="message-navigation" aria-label="用户消息导航" data-floating-navigation-rail-list data-scrubbing={scrubbing || undefined} onPointerDown={(event) => { if (event.button !== 0) return; dragging.current = true; setScrubbing(true); event.currentTarget.setPointerCapture(event.pointerId); scrub(event); }} onPointerMove={(event) => { if (dragging.current) scrub(event); }} onPointerUp={(event) => { dragging.current = false; setScrubbing(false); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onLostPointerCapture={() => { dragging.current = false; setScrubbing(false); }} onPointerLeave={() => { if (!dragging.current) setHover(null); }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHover(null); }}>
    {markers.map((marker, index) => <Button key={marker.id} ref={(element) => { if (element) buttons.current.set(marker.id, element); else buttons.current.delete(marker.id); }} className="message-navigation-button" aria-label={`跳转到第 ${marker.number} 条用户消息`} aria-controls={controls(marker.id)} aria-current={current === marker.id || undefined} aria-describedby={hover === index ? previewId : undefined} data-scrub-target={scrubbing && hover === index || undefined} tabIndex={index === Math.min(focused, markers.length - 1) ? 0 : -1} onPointerEnter={() => preview(index)} onFocus={() => { setFocused(index); preview(index); }} onClick={() => onJump(marker.id, false)} onKeyDown={(event) => { if (!['Home', 'End', 'ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault(); const next = messageMarkerIndex(markers.length, index, event.key); setFocused(next); const button = buttons.current.get(markers[next].id); button?.focus({ preventScroll: true }); button?.scrollIntoView({ block: 'nearest' }); }}><span className="message-navigation-marker" aria-hidden="true"><span /></span></Button>)}
  </nav>{hover !== null && markers[hover] && <div id={previewId} role="tooltip" className="message-navigation-preview" style={{ top: previewTop }}><span className="text-small muted">第 {markers[hover].number} 条消息</span><p>{markers[hover].preview}</p></div>}</>;
}
