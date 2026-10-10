import { lazy, Suspense, useState, type RefObject } from 'react';
import { attachmentImageUrl, attachmentLimits, type Attachment, type AttachmentInput } from '../../contracts/attachments';
import { uiErrorMessage } from '../../contracts/ui-errors';
import { Button, IconButton, Modal } from './controls';
import { Glyph } from './glyphs';
import { ImagePreview } from './image-preview';
import { useContentBridge } from './content-bridge';
const PdfPreview = lazy(() => import('./pdf-preview'));

export async function attachmentInputs(files: File[]): Promise<AttachmentInput[]> {
  if (!files.length || files.length > attachmentLimits.count) throw new Error('每条消息最多添加 12 个附件。');
  if (files.some((file) => file.size > attachmentLimits.fileBytes) || files.reduce((sum, file) => sum + file.size, 0) > attachmentLimits.batchBytes) throw new Error('单个文件需小于 12 MB，每次导入合计需小于 24 MB。');
  const inputs: AttachmentInput[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length !== file.size) throw new Error('文件在读取时发生变化，请重新导入。');
    let binary = '';
    for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
    inputs.push({ name: file.name, data: btoa(binary) });
  }
  return inputs;
}

export function AttachmentList({ files, disabled = false, onRemove }: { files: Attachment[]; disabled?: boolean; onRemove?: (id: string) => void }) {
  const [preview, setPreview] = useState<Attachment | null>(null);
  return <><div className="attachments">{files.map((file) => <div className="attachment" key={file.id}>
    <Button className="attachment-preview-button" aria-label={`预览 ${file.name}`} onClick={() => setPreview(file)}>{file.image ? <img src={attachmentImageUrl(file)} alt="" className="attachment-thumbnail" /> : <Glyph name="file" size={14} />}<span>{file.name}</span></Button>
    {onRemove && <IconButton icon="close" label={`移除 ${file.name}`} disabled={disabled} onClick={() => onRemove(file.id)} />}
  </div>)}</div>{preview && <AttachmentPreview key={preview.id} file={preview} images={files.filter(file => file.image)} onSelect={setPreview} onClose={() => setPreview(null)} />}</>;
}

export function AttachmentPreview({ file, images = [file], onSelect = () => {}, onClose, originalBytes, onExportOriginal, returnFocus }: { file: Attachment; images?: Attachment[]; onSelect?: (file: Attachment) => void; onClose: () => void; originalBytes?: Uint8Array; onExportOriginal?: () => Promise<boolean>; returnFocus?: RefObject<HTMLElement | null> }) {
  const bridge = useContentBridge();
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [showOriginal, setShowOriginal] = useState(Boolean(file.original));
  const exportOriginal = async () => {
    if (!file.original || exporting) return;
    setExporting(true); setError('');
    try { if (onExportOriginal) await onExportOriginal(); else await bridge.exportDocumentOriginal(file.original); }
    catch (error) { setError(uiErrorMessage(error, '原件保存失败，请重试。')); }
    finally { setExporting(false); }
  };
  if (file.image) return <ImagePreview key={file.id} file={file} images={images} onSelect={onSelect} onClose={onClose} returnFocus={returnFocus} />;
  return <Modal title={file.name} className={file.original ? 'pdf-attachment-modal' : ''} onClose={onClose} returnFocus={returnFocus} footer={<>{file.original && <Button disabled={exporting} onClick={() => { void exportOriginal(); }}>{exporting ? '正在保存…' : '保存 PDF 原件'}</Button>}<Button onClick={onClose}>完成</Button></>}>
    {error && <p role="alert">{error}</p>}
    {file.source && <p className="field-hint">{file.source.format.toUpperCase()} · {(file.source.bytes / 1000).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} KB · {showOriginal ? '原始文档' : '提取的文本'}</p>}
    {file.warnings?.map((warning) => <p className="field-hint" key={warning}>{warning}</p>)}
    {file.original && <Button aria-pressed={showOriginal} onClick={() => setShowOriginal(value => !value)}>{showOriginal ? '查看提取文本' : '查看 PDF 原件'}</Button>}
    {showOriginal && file.original ? <Suspense fallback={<p role="status">正在加载 PDF 查看器…</p>}><PdfPreview reference={file.original} originalBytes={originalBytes} /></Suspense> : <pre className="attachment-text-preview">{file.content || '（空文本文件）'}</pre>}
  </Modal>;
}
