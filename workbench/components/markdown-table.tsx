import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { IconButton, Modal } from './controls';
import { useTextCopy } from './use-text-copy';

export function MarkdownTable({ source, html, ...props }: ComponentProps<'table'> & { source: string; html?: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const expand = useRef<HTMLButtonElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [preview, setPreview] = useState(false);
  const { copied, copying, error, copy } = useTextCopy(source, html);
  useEffect(() => {
    const element = scroller.current!;
    const measure = () => setOverflow(element.scrollWidth > element.clientWidth + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(element); observer.observe(element.querySelector('table')!); measure();
    return () => observer.disconnect();
  }, [props.children]);
  return <div className="markdown-table">
    <div ref={scroller} className="markdown-table-scroller" role={overflow ? 'region' : undefined} aria-label={overflow ? '可横向滚动的表格' : undefined} tabIndex={overflow ? 0 : undefined}><table {...props} /></div>
    <div className="markdown-table-actions" data-markdown-copy="exclude">
      <IconButton icon={copied ? 'check' : 'copy'} label="复制表格" title={copied ? '已复制表格' : '复制表格'} disabled={!source || copying} onClick={() => { void copy(); }} />
      {overflow && <IconButton icon="maximize" label="展开表格" aria-expanded={preview} aria-haspopup="dialog" onClick={event => { expand.current = event.currentTarget; setPreview(true); }} />}
      {copied && <span className="markdown-table-status" role="status">已复制表格。</span>}
    </div>
    {error && <p className="markdown-table-error inline-error" role="alert" data-markdown-copy="exclude">无法复制，请重试或选取表格原文。</p>}
    {preview && <Modal title="表格预览" className="markdown-table-preview" returnFocus={expand} onClose={() => setPreview(false)}><div className="markdown-table-scroller" role="region" aria-label="可横向滚动的表格" tabIndex={0}><table {...props} /></div></Modal>}
  </div>;
}
