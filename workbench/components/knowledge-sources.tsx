import { useState } from 'react';
import type { KnowledgeSource } from '../../contracts/knowledge';
import { Button, Modal } from './controls';
import { Glyph } from './glyphs';

export function KnowledgeSources({ sources, content }: { sources: KnowledgeSource[]; content?: string }) {
  const [preview, setPreview] = useState<KnowledgeSource | null>(null);
  const references = [...new Set(content?.match(/\[K\d+\]/g) ?? [])];
  const unsupported = references.filter((reference) => !sources.some((source) => reference === `[${source.citation}]`));
  return <><div className="knowledge-sources" aria-label="本次检索片段"><p className="field-hint">{sources.length ? `本次检索片段 · ${sources.length}${content !== undefined ? ' · 标记对应下方原文' : ''}` : '本次没有找到匹配的资料片段，请核对回答依据。'}</p>
    <div className="knowledge-source-buttons">{sources.map((source) => <Button key={source.citation} aria-label={`查看 ${source.citation} ${source.title}`} onClick={() => setPreview(source)}><Glyph name="library" size={14} /><span>[{source.citation}] {source.title}{source.heading ? ` · ${source.heading}` : ''}</span></Button>)}</div>
    {unsupported.length > 0 && <p className="inline-error">回复中的 {unsupported.join('、')} 没有对应的检索片段，请核对回答。</p>}
  </div>{preview && <Modal title={`[${preview.citation}] ${preview.title}`} onClose={() => setPreview(null)} footer={<Button onClick={() => setPreview(null)}>完成</Button>}>
    <p className="field-hint">{preview.collectionName} · 字符 {preview.start + 1}–{preview.end}{preview.heading ? ` · ${preview.heading}` : ''}</p>
    {preview.source && <p className="field-hint">{preview.source.name} · {preview.source.format.toUpperCase()}{preview.edited ? ' · 导入后已编辑的文本' : ' · 提取的文本'}</p>}
    <pre className="attachment-text-preview">{preview.text}</pre>
  </Modal>}</>;
}
