import { useState } from 'react';
import { attachmentImageUrl, attachmentLimits, type Attachment, type AttachmentInput } from '../../contracts/attachments';
import { Button, IconButton, Modal } from './controls';
import { Glyph } from './glyphs';
import { ImagePreview } from './image-preview';

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

export function AttachmentPreview({ file, images = [file], onSelect = () => {}, onClose }: { file: Attachment; images?: Attachment[]; onSelect?: (file: Attachment) => void; onClose: () => void }) {
  if (file.image) return <ImagePreview key={file.id} file={file} images={images} onSelect={onSelect} onClose={onClose} />;
  return <Modal title={file.name} onClose={onClose} footer={<Button onClick={onClose}>完成</Button>}>
    {file.source && <p className="field-hint">{file.source.format.toUpperCase()} · {(file.source.bytes / 1000).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} KB · 提取的文本</p>}
    {file.warnings?.map((warning) => <p className="field-hint" key={warning}>{warning}</p>)}
    <pre className="attachment-text-preview">{file.content || '（空文本文件）'}</pre>
  </Modal>;
}
