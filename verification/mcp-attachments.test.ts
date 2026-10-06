import { describe, expect, it } from 'vitest';
import { appendMcpPdfAttachment } from '../contracts/mcp-attachments';
import { composerDraftSchema } from '../contracts/workspace';
import { originalDocumentIdentity } from '../desktop/services/document-original-store';

const bytes = Buffer.from('%PDF-1.4\nMCP original\n%%EOF');
const file = { id: 'mcp-pdf', name: 'mcp-resource.pdf', content: 'Extracted text', source: { format: 'pdf' as const, bytes: bytes.length }, original: originalDocumentIdentity(bytes) };
const draft = () => composerDraftSchema.parse({ threadId: 'thread', text: 'Keep draft 中文', attachments: [{ id: 'existing', name: 'existing.txt', content: 'Keep attachment' }], providerId: 'provider', model: 'model', assistantId: 'assistant', projectId: 'project', mode: 'plan', mcpServerIds: ['server'], skillIds: [], pluginIds: [], knowledgeCollectionIds: ['notes'], updatedAt: 42 });

describe('explicit MCP PDF attachment insertion', () => {
  it('preserves the owner, text, context and existing attachments without mutating the input', () => {
    const current = draft(), snapshot = structuredClone(current);
    expect(appendMcpPdfAttachment(current, file)).toEqual({ ...snapshot, attachments: [...snapshot.attachments, file] });
    expect(current).toEqual(snapshot);
  });
  it('makes a failed-save retry idempotent even when the worker returns a new attachment identifier', () => {
    const once = appendMcpPdfAttachment(draft(), file);
    expect(appendMcpPdfAttachment(once, { ...file, id: 'retry' })).toEqual(once);
    expect(appendMcpPdfAttachment(once, { ...file, id: 'different', original: { ...file.original, sha256: 'f'.repeat(64) } }).attachments).toHaveLength(3);
  });
  it('rejects excess attachments but permits an idempotent retry at the limit', () => {
    const current = { ...draft(), attachments: Array.from({ length: 12 }, (_, index) => ({ id: `existing-${index}`, name: `${index}.txt`, content: '' })) };
    expect(() => appendMcpPdfAttachment(current, file)).toThrow('最多添加 12 个附件');
    const withPdf = { ...current, attachments: [...current.attachments.slice(0, 11), file] };
    expect(appendMcpPdfAttachment(withPdf, { ...file, id: 'retry' }).attachments).toHaveLength(12);
    expect(current.attachments).toHaveLength(12);
  });
  it('rejects a missing original, non-PDF source, mismatched size and invalid current draft before insertion', () => {
    expect(() => appendMcpPdfAttachment(draft(), { ...file, original: undefined })).toThrow('有效的 MCP PDF');
    expect(() => appendMcpPdfAttachment(draft(), { id: 'text', name: 'text.txt', content: '' })).toThrow('有效的 MCP PDF');
    expect(() => appendMcpPdfAttachment(draft(), { ...file, source: { format: 'pdf', bytes: bytes.length + 1 } })).toThrow();
    expect(() => appendMcpPdfAttachment({ ...draft(), text: 'x'.repeat(256_001) }, file)).toThrow();
  });
});
