import { attachmentSchema, attachmentLimits, type Attachment } from './attachments';
import { composerDraftSchema, type ComposerDraft } from './workspace';

/** Keep the current draft intact and make a failed-save retry idempotent. */
export function appendMcpPdfAttachment(draft: ComposerDraft, raw: Attachment): ComposerDraft {
  const file = attachmentSchema.parse(raw);
  if (file.source?.format !== 'pdf' || !file.original) throw new Error('请先读取有效的 MCP PDF 文档，再添加到聊天。');
  const current = composerDraftSchema.parse(draft);
  if (current.attachments.some(item => item.name === file.name && item.original?.sha256 === file.original!.sha256 && item.original.bytes === file.original!.bytes)) return current;
  if (current.attachments.length >= attachmentLimits.count) throw new Error('每条消息最多添加 12 个附件，请先移除部分附件。');
  return composerDraftSchema.parse({ ...current, attachments: [...current.attachments, file] });
}
