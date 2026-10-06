import { useEffect, useId, useRef, useState } from 'react';
import { getDocument, PDFWorker, TextLayer, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?worker';
import type { DocumentOriginal } from '../../contracts/document-originals';
import { Button, Input } from './controls';
import { EmbeddedPdfResources } from './pdf-resources';
import { pdfOutlineEntries, resolvePdfDestination, type PdfDestination, type PdfOutlineEntry } from './pdf-navigation';
import { pdfSearchRange, searchPdf, type PdfSearchResult } from './pdf-search';
import { pdfAnnotations, type PdfAnnotation } from './pdf-annotations';
import { PdfAnnotationLayer } from './pdf-annotation-layer';
import '../theme/pdf-preview.css';
import { useContentBridge } from './content-bridge';

export default function PdfPreview({ reference, originalBytes }: { reference: DocumentOriginal; originalBytes?: Uint8Array }) {
  const bridge = useContentBridge();
  const [document, setDocument] = useState<PDFDocumentProxy>();
  const [page, setPage] = useState(1), [zoom, setZoom] = useState(1), [width, setWidth] = useState(600);
  const [error, setError] = useState(''), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  const [outline, setOutline] = useState<PdfOutlineEntry[]>([]), [outlineOpen, setOutlineOpen] = useState(false), [outlineError, setOutlineError] = useState('');
  const [destination, setDestination] = useState<PdfDestination>();
  const navigationVersion = useRef(0), outlineId = useId();
  const [query, setQuery] = useState(''), [searching, setSearching] = useState(false), [searchError, setSearchError] = useState('');
  const [searchResult, setSearchResult] = useState<PdfSearchResult>({ matches: [], limited: false }), [activeMatch, setActiveMatch] = useState(0), [searchedPage, setSearchedPage] = useState(0);
  const textDivs = useRef<HTMLElement[]>([]), [renderRevision, setRenderRevision] = useState(0);
  const [searchJump, setSearchJump] = useState(0);
  const followSearch = useRef(false), searchInput = useRef<HTMLInputElement>(null);
  const [annotations, setAnnotations] = useState<PdfAnnotation[]>([]), [annotationError, setAnnotationError] = useState('');
  const paint = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null), surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const find = (event: KeyboardEvent) => {
      if (event.isComposing || !(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'f') return;
      if (Array.from(window.document.querySelectorAll('dialog[open]')).at(-1) !== scroll.current?.closest('dialog')) return;
      event.preventDefault(); event.stopPropagation(); searchInput.current?.focus(); searchInput.current?.select();
    };
    window.addEventListener('keydown', find); return () => window.removeEventListener('keydown', find);
  }, []);
  useEffect(() => {
    const element = scroll.current!;
    const observer = new ResizeObserver(() => setWidth(Math.max(120, element.clientWidth - 32)));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let stopped = false;
    let task: ReturnType<typeof getDocument> | undefined, worker: Worker | undefined, wrapper: PDFWorker | undefined;
    setDocument(undefined); setPage(1); setError(''); setLoading(true); setOutline([]); setOutlineError(''); setDestination(undefined); navigationVersion.current++;
    void (async () => {
      const bytes = originalBytes ?? await bridge.readDocumentOriginal(reference);
      if (stopped) return;
      worker = new PdfWorker(); wrapper = PDFWorker.create({ port: worker });
      task = getDocument({ data: new Uint8Array(bytes), worker: wrapper, BinaryDataFactory: EmbeddedPdfResources,
        useWorkerFetch: false, cMapPacked: true, useSystemFonts: true, enableXfa: false,
        maxImageSize: 16_000_000, canvasMaxAreaInBytes: 64_000_000, stopAtErrors: true });
      task.onPassword = () => { if (!stopped) { setError('此 PDF 需要密码，请导入未加密的副本。'); setLoading(false); } void task?.destroy().catch(() => {}); };
      const result = await task.promise;
      if (!stopped) {
        setDocument(result);
        void result.getOutline().then(value => { if (!stopped) setOutline(pdfOutlineEntries(value)); })
          .catch(() => { if (!stopped) setOutlineError('目录无法读取，仍可使用页码浏览文档。'); });
      }
    })().catch(() => { if (!stopped) { setError('无法打开 PDF 原件。请重新导入文件，或查看提取的文本。'); setLoading(false); } });
    return () => { stopped = true; navigationVersion.current++; void task?.destroy().catch(() => {}); wrapper?.destroy(); worker?.terminate(); };
  }, [reference.sha256, originalBytes, retry]);
  useEffect(() => {
    const controller = new AbortController();
    followSearch.current = false;
    setSearchResult({ matches: [], limited: false }); setSearchError(''); setActiveMatch(0); setSearchedPage(0); setSearching(Boolean(document && query.trim()));
    if (!document || !query.trim()) return () => controller.abort();
    const timer = setTimeout(() => {
      void searchPdf(document, query, controller.signal, setSearchedPage).then(result => {
        if (controller.signal.aborted) return;
        setSearchResult(result); setSearching(false);
        if (result.matches.length) { followSearch.current = true; navigationVersion.current++; setDestination(undefined); setPage(result.matches[0].page); }
      }).catch(error => { if (!controller.signal.aborted) { setSearching(false); setSearchError(error instanceof Error ? error.message : '搜索失败，请重试。'); } });
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [document, query]);
  useEffect(() => {
    if (!document) return;
    let stopped = false, render: RenderTask | undefined, text: TextLayer | undefined;
    const container = paint.current!, pageRoot = surface.current!; container.replaceChildren(); textDivs.current = []; setAnnotations([]); setAnnotationError(''); setLoading(true); setError('');
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
      pageRoot.style.width = `${viewport.width}px`; pageRoot.style.height = `${viewport.height}px`;
      pageRoot.style.setProperty('--scale-factor', String(viewport.scale));
      pageRoot.style.setProperty('--user-unit', String(viewport.userUnit));
      container.replaceChildren(canvas, layer);
      render = selected.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      text = new TextLayer({ textContentSource: selected.streamTextContent(), container: layer, viewport });
      await Promise.all([render.promise, text.render()]);
      if (!stopped) {
        try {
          const raw = await selected.getAnnotations({ intent: 'display' });
          if (stopped) return;
          setAnnotations(pdfAnnotations(raw, viewport));
        } catch { if (!stopped) setAnnotationError('此页注释无法读取，页面与文字仍可浏览。'); }
        if (stopped) return;
        textDivs.current = text.textDivs; setRenderRevision(value => value + 1);
        setLoading(false);
        if (destination?.page === page) {
          const [left, top] = viewport.convertToViewportPoint(destination.x ?? selected.view[0], destination.y ?? selected.view[3]);
          scroll.current?.scrollTo({ left: Math.max(0, left), top: Math.max(0, top), behavior: 'instant' });
        }
      }
    })().catch(() => { if (!stopped) { setError('此页无法完整显示，请重试或查看提取的文本。'); setLoading(false); } });
    return () => { stopped = true; render?.cancel(); text?.cancel(); container.replaceChildren(); };
  }, [document, page, zoom, width, destination]);
  useEffect(() => {
    CSS.highlights.delete('nook-pdf-search'); CSS.highlights.delete('nook-pdf-search-current');
    const ranges = searchResult.matches.map((match, index) => ({ match, index })).filter(({ match }) => match.page === page)
      .map(({ match, index }) => ({ range: pdfSearchRange(match, textDivs.current), index })).filter(item => item.range);
    if (ranges.length) CSS.highlights.set('nook-pdf-search', new Highlight(...ranges.map(item => item.range!)));
    const active = ranges.find(item => item.index === activeMatch)?.range;
    if (active) {
      CSS.highlights.set('nook-pdf-search-current', new Highlight(active));
      if (followSearch.current) {
        const box = active.getBoundingClientRect(), scroller = scroll.current!;
        scroller.scrollTo({ top: scroller.scrollTop + box.top - scroller.getBoundingClientRect().top - 32, behavior: 'instant' });
      }
    }
    return () => { CSS.highlights.delete('nook-pdf-search'); CSS.highlights.delete('nook-pdf-search-current'); };
  }, [searchResult, activeMatch, page, renderRevision, searchJump]);
  const moveMatch = (direction: number) => {
    if (!searchResult.matches.length) return;
    const index = (activeMatch + direction + searchResult.matches.length) % searchResult.matches.length;
    followSearch.current = true; navigationVersion.current++; setDestination(undefined); setActiveMatch(index); setPage(searchResult.matches[index].page); setSearchJump(value => value + 1);
  };
  const navigateOutline = async (raw: unknown) => {
    if (!document) return;
    const version = ++navigationVersion.current; setOutlineError('');
    try {
      const target = await resolvePdfDestination(document, raw);
      if (version !== navigationVersion.current) return;
      followSearch.current = false; setDestination(target); setPage(target.page); setOutlineOpen(false);
    } catch (error) { if (version === navigationVersion.current) setOutlineError(error instanceof Error ? error.message : '目录跳转失败。'); }
  };
  const turnPage = (value: number) => { followSearch.current = false; navigationVersion.current++; setDestination(undefined); setPage(value); scroll.current?.scrollTo({ top: 0, left: 0 }); };
  return <section className="pdf-preview" aria-label="PDF 原件预览">
    <div className="pdf-toolbar" role="group" aria-label="PDF 页面与缩放">
      <Button aria-expanded={outlineOpen} aria-controls={outlineId} onClick={() => setOutlineOpen(value => !value)}>目录</Button>
      <Button disabled={!document || page <= 1} onClick={() => turnPage(page - 1)}>上一页</Button>
      <Input aria-label="PDF 页码" type="number" min={1} max={document?.numPages ?? 1} value={page} disabled={!document}
        onChange={event => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 1 && value <= (document?.numPages ?? 1)) turnPage(value); }} />
      <span>/ {document?.numPages ?? '—'}</span>
      <Button disabled={!document || page >= document.numPages} onClick={() => turnPage(page + 1)}>下一页</Button>
      <Button disabled={zoom <= .25} onClick={() => setZoom(value => Math.max(.25, value - .25))} aria-label="缩小 PDF">−</Button>
      <span>{Math.round(zoom * 100)}%</span>
      <Button disabled={zoom >= 3} onClick={() => setZoom(value => Math.min(3, value + .25))} aria-label="放大 PDF">+</Button>
      <Button onClick={() => setZoom(1)}>适合宽度</Button>
    </div>
    <div className="pdf-search" role="search" aria-label="PDF 全文搜索">
      <Input ref={searchInput} aria-label="搜索 PDF" type="search" maxLength={512} placeholder="在文档中查找" value={query} onChange={event => setQuery(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); moveMatch(event.shiftKey ? -1 : 1); } }} />
      <Button disabled={!searchResult.matches.length || searching} aria-label="上一个 PDF 匹配" onClick={() => moveMatch(-1)}>上一处</Button>
      <Button disabled={!searchResult.matches.length || searching} aria-label="下一个 PDF 匹配" onClick={() => moveMatch(1)}>下一处</Button>
      <span role="status">{searching ? `正在搜索 ${searchedPage}/${document?.numPages ?? 0} 页` : query.trim() ? `${searchResult.matches.length ? activeMatch + 1 : 0} / ${searchResult.matches.length}${searchResult.limited ? '+' : ''}` : ''}</span>
    </div>
    {searchError && <p role="alert" className="field-hint">{searchError}</p>}
    {annotationError && <p role="alert" className="field-hint">{annotationError}</p>}
    {searchResult.limited && <p className="field-hint">仅显示前 10,000 处匹配，请缩小搜索范围。</p>}
    {outlineOpen && <nav id={outlineId} className="pdf-outline" aria-label="PDF 目录">{outline.length ? outline.map((entry, index) => <Button key={index} style={{ paddingInlineStart: `${8 + Math.min(entry.depth, 12) * 12}px` }} disabled={entry.destination == null} onClick={() => { void navigateOutline(entry.destination); }}>{entry.title}</Button>) : <p className="field-hint">{document ? '此文档没有目录。' : '正在读取目录…'}</p>}</nav>}
    {outlineError && <p role="alert" className="field-hint">{outlineError}</p>}
    {loading && <p role="status" className="field-hint">正在显示 PDF…</p>}
    {error && <div role="alert" className="pdf-error"><p>{error}</p><Button onClick={() => setRetry(value => value + 1)}>重试</Button></div>}
    <div className="pdf-scroll" ref={scroll} tabIndex={0} aria-label="PDF 页面，可滚动" aria-busy={loading}><div ref={surface} className="pdfPreviewPage"><div ref={paint} /><PdfAnnotationLayer items={annotations} navigate={navigateOutline} report={setAnnotationError} /></div></div>
  </section>;
}
