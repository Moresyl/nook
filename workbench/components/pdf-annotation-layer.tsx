import { useEffect, useState } from 'react';
import { Button, Modal } from './controls';
import { ElementHint } from './control-tooltip';
import type { PdfAnnotation } from './pdf-annotations';
import { useContentBridge } from './content-bridge';

export function PdfAnnotationLayer({ items, navigate, report }: { items: PdfAnnotation[]; navigate: (destination: unknown) => Promise<void>; report: (message: string) => void }) {
  const bridge = useContentBridge();
  const [note, setNote] = useState<Extract<PdfAnnotation, { kind: 'note' }>>();
  useEffect(() => setNote(undefined), [items]);
  return <><div className="annotationLayer" aria-label="PDF 链接与注释">{items.map(item => <section key={item.id} className={item.kind === 'link' ? 'linkAnnotation' : 'noteAnnotation'}
    style={{ left: item.left, top: item.top, width: item.width, height: item.height }}>
    {item.kind === 'note' ? <ElementHint text={item.title || '查看注释'}><button type="button" className="pdf-note-button" aria-label={item.title ? `查看注释：${item.title}` : '查看 PDF 注释'} onClick={() => setNote(item)}>▤</button></ElementHint> :
      item.url ? <ElementHint text={item.url}><a href={item.url} aria-label={`打开链接：${item.url}`} onAuxClick={event => event.preventDefault()} onClick={event => { event.preventDefault(); void bridge.openExternal(item.url!).catch(() => report('链接未能打开，请重试。')); }} /></ElementHint> :
      item.destination !== undefined ? <ElementHint text="跳转到文档位置"><a href="#" aria-label="跳转到文档位置" onAuxClick={event => event.preventDefault()} onClick={event => { event.preventDefault(); void navigate(item.destination); }} /></ElementHint> :
      <ElementHint text="此链接不可用"><span tabIndex={0} aria-label="此链接不可用" /></ElementHint>}
  </section>)}</div>{note && <Modal title={note.title || 'PDF 注释'} className="pdf-note-modal" onClose={() => setNote(undefined)} footer={<Button onClick={() => setNote(undefined)}>关闭注释</Button>}><p className="pdf-note-content">{note.content}</p>{note.truncated && <p className="field-hint">注释过长，仅显示前 32,000 个字符。保存 PDF 原件可保留完整内容。</p>}</Modal>}</>;
}
