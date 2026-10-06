import { z } from 'zod';
import { documentOriginalLimits, documentOriginalSchema } from './document-originals';

export const attachmentLimits = { count: 12, fileBytes: documentOriginalLimits.fileBytes, batchBytes: 24_000_000, textCharacters: 256_000, imageBytes: 2_000_000, imageDimension: 2000, requestBytes: 16_000_000 } as const;
export const attachmentFormats = ['text', 'pdf', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'png', 'jpeg', 'webp', 'gif'] as const;
function base64Bytes(value: string): number { return value.length / 4 * 3 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0); }
function validBase64(value: string): boolean {
  if (value.length % 4) return false;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const end = value.length - padding;
  for (let index = 0; index < end; index++) {
    const code = value.charCodeAt(index);
    if (!(code >= 65 && code <= 90 || code >= 97 && code <= 122 || code >= 48 && code <= 57 || code === 43 || code === 47)) return false;
  }
  if (padding) {
    const last = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.indexOf(value[end - 1]);
    if (last < 0 || (last & (padding === 2 ? 15 : 3)) !== 0) return false;
  }
  return true;
}
function jpegSize(data: string): { width: number; height: number } | undefined {
  try {
    const header = atob(data.slice(0, 87_384));
    const byte = (index: number) => header.charCodeAt(index);
    if (byte(0) !== 255 || byte(1) !== 216) return;
    let offset = 2;
    while (offset + 4 <= header.length) {
      if (byte(offset++) !== 255) return;
      while (byte(offset) === 255) offset++;
      const marker = byte(offset++);
      const length = byte(offset) * 256 + byte(offset + 1);
      if (length < 2 || offset + length > header.length) return;
      if (marker === 192 || marker === 194) {
        if (length < 8 || byte(offset + 2) !== 8) return;
        return { height: byte(offset + 3) * 256 + byte(offset + 4), width: byte(offset + 5) * 256 + byte(offset + 6) };
      }
      if (marker === 218 || marker === 217) return;
      offset += length;
    }
  } catch { return; }
}
export const attachmentInputSchema = z.object({
  name: z.string().min(1).max(512).refine((value) => !/[\\/\0]/.test(value), 'Use a file name without a directory'),
  data: z.string().max(Math.ceil(attachmentLimits.fileBytes / 3) * 4, 'Choose files smaller than 12 MB').refine(validBase64, 'Use canonical base64 file data'),
}).strict();
export const attachmentInputsSchema = z.array(attachmentInputSchema).min(1).max(attachmentLimits.count).refine((files) => files.reduce((total, file) => total + base64Bytes(file.data), 0) <= attachmentLimits.batchBytes, 'The selected files exceed the 24 MB import limit');
export const attachmentSchema = z.object({
  id: z.string().min(1).max(128).refine((value) => !value.includes('\0'), 'Identifiers cannot contain NUL characters'),
  name: z.string().max(512), content: z.string().max(attachmentLimits.textCharacters),
  source: z.object({ format: z.enum(attachmentFormats), bytes: z.number().int().nonnegative().max(attachmentLimits.fileBytes) }).strict().optional(),
  original: documentOriginalSchema.optional(),
  image: z.object({
    mimeType: z.literal('image/jpeg'), data: z.string().min(4).max(Math.ceil(attachmentLimits.imageBytes / 3) * 4).refine(validBase64, 'Use canonical base64 image data').refine((value) => base64Bytes(value) <= attachmentLimits.imageBytes, 'The image exceeds 2 MB').startsWith('/9j/'),
    width: z.number().int().positive().max(attachmentLimits.imageDimension), height: z.number().int().positive().max(attachmentLimits.imageDimension),
  }).strict().optional(),
  warnings: z.array(z.string().min(1).max(512)).max(8).optional(),
}).superRefine((file, context) => {
  if (file.original && (file.image || file.source?.format !== 'pdf' || file.source?.bytes !== file.original.bytes)) context.addIssue({ code: 'custom', path: ['original'], message: 'A PDF original must match its source metadata and cannot contain an image payload' });
  if (file.image && file.content) context.addIssue({ code: 'custom', path: ['content'], message: 'An image attachment cannot also contain extracted document text' });
  if (file.image) {
    const size = jpegSize(file.image.data);
    if (!size || size.width !== file.image.width || size.height !== file.image.height) context.addIssue({ code: 'custom', path: ['image'], message: 'The JPEG dimensions must match the attachment metadata' });
  }
});
export type AttachmentInput = z.infer<typeof attachmentInputSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;

export function attachmentImageUrl(file: Attachment): string | undefined {
  return file.image ? `data:${file.image.mimeType};base64,${file.image.data}` : undefined;
}
