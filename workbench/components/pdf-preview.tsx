import { useEffect, useRef, useState } from 'react';
import { getDocument, PDFWorker, TextLayer, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?worker';
import type { DocumentOriginal } from '../../contracts/document-originals';
import { Button, Input } from './controls';
import { EmbeddedPdfResources } from './pdf-resources';
import '../theme/pdf-preview.css';

export default function PdfPreview({ reference }: { reference: DocumentOriginal }) {
  const [document, setDocument] = useState<PDFDocumentProxy>();
  const [page, setPage] = useState(1), [zoom, setZoom] = useState(1), [width, setWidth] = useState(600);
  const [error, setError] = useState(''), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  const scroll = useRef<HTMLDivElement>(null), surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = scroll.current!;
    const observer = new ResizeObserver(() => setWidth(Math.max(120, element.clientWidth - 32)));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let stopped = false;
    let task: ReturnType<typeof getDocument> | undefined, worker: Worker | undefined, wrapper: PDFWorker | undefined;
    setDocument(undefined); setPage(1); setError(''); setLoading(true);
    void (async () => {
      const bytes = await window.qiyao.readDocumentOriginal(reference);
      if (stopped) return;
      worker = new PdfWorker(); wrapper = PDFWorker.create({ port: worker });
      task = getDocument({ data: new Uint8Array(bytes), worker: wrapper, BinaryDataFactory: EmbeddedPdfResources,
        useWorkerFetch: false, cMapPacked: true, useSystemFonts: true, enableXfa: false,
        maxImageSize: 16_000_000, canvasMaxAreaInBytes: 64_000_000, stopAtErrors: true });
      task.onPassword = () => { if (!stopped) { setError('此 PDF 需要密码，请导入未加密的副本。'); setLoading(false); } void task?.destroy().catch(() => {}); };
      const result = await task.promise;
      if (!stopped) setDocument(result);
    })().catch(() => { if (!stopped) { setError('无法打开 PDF 原件。请重新导入文件，或查看提取的文本。'); setLoading(false); } });
    return () => { stopped = true; void task?.destroy().catch(() => {}); wrapper?.destroy(); worker?.terminate(); };
  }, [reference.sha256, retry]);
  useEffect(() => {
    if (!document) return;
    let stopped = false, render: RenderTask | undefined, text: TextLayer | undefined;
    const container = surface.current!; container.replaceChildren(); setLoading(true); setError('');
    void (async () => {
      const selected = await document.getPage(page); if (stopped) return;
      const unscaled = selected.getViewport({ scale: 1 });
      const viewport = selected.getViewport({ scale: width / unscaled.width * zoom });
      const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(16_000_000 / (viewport.width * viewport.height)));
      const canvas = window.document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width * ratio)); canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
      canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
      canvas.setAttribute('aria-label', `PDF 第 ${page} 页`); canvas.setAttribute('role', 'img');
      const layer = window.document.createElement('div'); layer.className = 'textLayer';
      container.style.width = `${viewport.width}px`; container.style.height = `${viewport.height}px`;
      container.style.setProperty('--scale-factor', String(viewport.scale));
      container.style.setProperty('--user-unit', String(viewport.userUnit));
      container.replaceChildren(canvas, layer);
      render = selected.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      text = new TextLayer({ textContentSource: selected.streamTextContent(), container: layer, viewport });
      await Promise.all([render.promise, text.render()]);
      if (!stopped) setLoading(false);
    })().catch(() => { if (!stopped) { setError('此页无法完整显示，请重试或查看提取的文本。'); setLoading(false); } });
    return () => { stopped = true; render?.cancel(); text?.cancel(); container.replaceChildren(); };
  }, [document, page, zoom, width]);
  return <section className="pdf-preview" aria-label="PDF 原件预览">
    <div className="pdf-toolbar" role="group" aria-label="PDF 页面与缩放">
      <Button disabled={!document || page <= 1} onClick={() => setPage(value => value - 1)}>上一页</Button>
      <Input aria-label="PDF 页码" type="number" min={1} max={document?.numPages ?? 1} value={page} disabled={!document}
        onChange={event => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 1 && value <= (document?.numPages ?? 1)) setPage(value); }} />
      <span>/ {document?.numPages ?? '—'}</span>
      <Button disabled={!document || page >= document.numPages} onClick={() => setPage(value => value + 1)}>下一页</Button>
      <Button disabled={zoom <= .25} onClick={() => setZoom(value => Math.max(.25, value - .25))} aria-label="缩小 PDF">−</Button>
      <span>{Math.round(zoom * 100)}%</span>
      <Button disabled={zoom >= 3} onClick={() => setZoom(value => Math.min(3, value + .25))} aria-label="放大 PDF">+</Button>
      <Button onClick={() => setZoom(1)}>适合宽度</Button>
    </div>
    {loading && <p role="status" className="field-hint">正在显示 PDF…</p>}
    {error && <div role="alert" className="pdf-error"><p>{error}</p><Button onClick={() => setRetry(value => value + 1)}>重试</Button></div>}
    <div className="pdf-scroll" ref={scroll} tabIndex={0} aria-label="PDF 页面，可滚动" aria-busy={loading}><div ref={surface} className="pdfPreviewPage" /></div>
  </section>;
}
