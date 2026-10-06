import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { attachmentImageUrl, type Attachment } from '../../contracts/attachments';
import { Button, IconButton, Modal } from './controls';

const zoomSteps = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];

export function ImagePreview({ file, images, onSelect, onClose, returnFocus }: { file: Attachment; images: Attachment[]; onSelect: (file: Attachment) => void; onClose: () => void; returnFocus?: RefObject<HTMLElement | null> }) {
  const viewport = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const anchor = useRef<{ x: number; y: number; horizontal: number; vertical: number } | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const dimensions = file.image!;
  const fit = Math.min(1, size.width / dimensions.width, size.height / dimensions.height);
  const scale = zoom ?? fit;
  const steps = [...new Set([...zoomSteps, fit])].filter(value => value > 0).sort((a, b) => a - b);
  const index = images.findIndex(item => item.id === file.id);

  useEffect(() => {
    const element = viewport.current!;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(element); measure();
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const point = anchor.current, element = viewport.current, picture = image.current;
    if (!point || !element || !picture) return;
    const bounds = picture.getBoundingClientRect();
    element.scrollLeft += bounds.left + bounds.width * point.horizontal - point.x;
    element.scrollTop += bounds.top + bounds.height * point.vertical - point.y;
    anchor.current = null;
  }, [scale]);

  const changeZoom = (value: number | null, point?: { x: number; y: number }) => {
    const element = viewport.current, picture = image.current;
    if (!element || !picture || !loaded) return;
    if (value === null) { anchor.current = null; element.scrollTo(0, 0); setZoom(null); return; }
    const bounded = Math.max(steps[0], Math.min(steps.at(-1)!, value));
    if (!Number.isFinite(bounded) || bounded === scale) return;
    const bounds = picture.getBoundingClientRect(), area = element.getBoundingClientRect();
    const x = point?.x ?? area.left + area.width / 2, y = point?.y ?? area.top + area.height / 2;
    anchor.current = { x, y, horizontal: Math.max(0, Math.min(1, (x - bounds.left) / bounds.width)), vertical: Math.max(0, Math.min(1, (y - bounds.top) / bounds.height)) };
    setZoom(bounded);
  };
  const step = (direction: number) => changeZoom(direction > 0 ? steps.find(value => value > scale + 0.0001) ?? scale : steps.findLast(value => value < scale - 0.0001) ?? scale);
  const select = (direction: number) => { const next = images[index + direction]; if (next) onSelect(next); };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
    const actions: Record<string, () => void> = { '+': () => step(1), '=': () => step(1), '-': () => step(-1), '0': () => changeZoom(null), '1': () => changeZoom(1), ArrowLeft: () => select(-1), ArrowRight: () => select(1) };
    if (actions[event.key]) { event.preventDefault(); event.stopPropagation(); actions[event.key](); }
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  useEffect(() => { viewport.current?.focus(); }, []);
  useEffect(() => {
    const element = viewport.current!;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey || !loaded) return;
      event.preventDefault(); event.stopPropagation();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      changeZoom(scale * Math.exp(-delta / 300), { x: event.clientX, y: event.clientY });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [scale, fit, loaded]);

  return <Modal title={file.name} className="image-preview-dialog" onClose={onClose} returnFocus={returnFocus}>
    <div className="image-preview-layout" onKeyDown={onKeyDown}>
      <div className="image-preview-stage">
        {images.length > 1 && <IconButton icon="right" className="icon-button image-previous" label="上一张图片" disabled={index <= 0} onClick={() => select(-1)} />}
        <div ref={viewport} className="image-preview-viewport" tabIndex={0} role="region" aria-label="图片查看区域：加减号缩放，0 适应窗口，1 原始尺寸，左右方向键切换图片"
          onDoubleClick={event => {
            const bounds = image.current?.getBoundingClientRect();
            if (bounds && event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom) changeZoom(zoom === null ? Math.max(1, fit * 2) : null, { x: event.clientX, y: event.clientY });
          }}
          onPointerDown={event => {
            if (event.button !== 0 || !loaded || event.target !== image.current) return;
            drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop };
            event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.focus(); event.preventDefault();
          }}
          onPointerMove={event => { const start = drag.current; if (start?.id === event.pointerId) { event.currentTarget.scrollLeft = start.left - (event.clientX - start.x); event.currentTarget.scrollTop = start.top - (event.clientY - start.y); } }}
          onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={() => { drag.current = null; }}>
          {failed ? <div className="image-preview-error" role="status"><p>无法显示这张图片</p><Button onClick={() => { setFailed(false); setLoaded(false); setAttempt(value => value + 1); }}>重新加载</Button></div> : <img key={attempt} ref={image} className="attachment-image-preview" src={attachmentImageUrl(file)} alt={file.name} draggable={false}
            style={{ width: dimensions.width * scale, height: dimensions.height * scale }}
            onLoad={() => setLoaded(true)} onError={() => { setFailed(true); setLoaded(false); }} />}
        </div>
        {images.length > 1 && <IconButton icon="right" className="icon-button image-next" label="下一张图片" disabled={index >= images.length - 1} onClick={() => select(1)} />}
      </div>
      <div className="image-preview-caption" role="status">{images.length > 1 && `${index + 1} / ${images.length} · `}{dimensions.width} × {dimensions.height}{file.source && ` · ${file.source.format.toUpperCase()}`}</div>
      {file.warnings?.length ? <div className="image-preview-warnings">{file.warnings.map(warning => <p key={warning}>{warning}</p>)}</div> : null}
      <div className="image-preview-toolbar" role="group" aria-label="图片缩放">
        <IconButton icon="minimize" label="缩小图片" disabled={!loaded || scale <= steps[0]} onClick={() => step(-1)} />
        <Button aria-label="原始尺寸" title="原始尺寸（1）" disabled={!loaded} onClick={() => changeZoom(1)}>{Math.round(scale * 100)}%</Button>
        <IconButton icon="plus" label="放大图片" disabled={!loaded || scale >= steps.at(-1)!} onClick={() => step(1)} />
        <Button aria-pressed={zoom === null} disabled={!loaded} title="适应窗口（0）" onClick={() => changeZoom(null)}>适应窗口</Button>
        <Button onClick={onClose}>完成</Button>
      </div>
    </div>
  </Modal>;
}
