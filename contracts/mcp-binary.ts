import { z } from 'zod';
import { attachmentInputSchema } from './attachments';

export const mcpBinaryLimits = { itemBytes: 2_000_000, count: 12, totalBytes: 12_000_000 } as const;
const metadata = z.object({
  uri: z.string().min(1).max(4096).refine((value) => !/[\x00-\x1f\x7f]/.test(value), 'Use a valid resource URI'),
  mimeType: z.string().min(1).max(256).refine((value) => !/[\x00-\x1f\x7f]/.test(value), 'Use a valid media type').optional(),
  bytes: z.number().int().nonnegative().max(mcpBinaryLimits.itemBytes),
}).strict();
export const mcpBinaryItemSchema = metadata.extend({ data: attachmentInputSchema.shape.data.max(Math.ceil(mcpBinaryLimits.itemBytes / 3) * 4) }).superRefine((item, context) => {
  const bytes = item.data.length / 4 * 3 - (item.data.endsWith('==') ? 2 : item.data.endsWith('=') ? 1 : 0);
  if (bytes !== item.bytes || bytes > mcpBinaryLimits.itemBytes) context.addIssue({ code: 'custom', path: ['data'], message: 'The binary data must match its size and fit within 2 MB' });
});
export type McpBinaryItem = z.infer<typeof mcpBinaryItemSchema>;

const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'application/pdf': 'pdf', 'text/plain': 'txt', 'application/json': 'json', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' };
export function mcpBinaryFileName(item: Pick<McpBinaryItem, 'mimeType'>): string {
  const mimeType = item.mimeType?.split(';')[0].trim().toLowerCase() ?? '';
  return `mcp-resource.${Object.hasOwn(extensions, mimeType) ? extensions[mimeType] : 'bin'}`;
}
export function mcpBinaryImageSupported(item: Pick<McpBinaryItem, 'mimeType'>): boolean {
  return ['png', 'jpg', 'webp', 'gif'].includes(mcpBinaryFileName(item).split('.').at(-1)!);
}
export function mcpBinaryPdfSupported(item: Pick<McpBinaryItem, 'mimeType'>): boolean {
  return mcpBinaryFileName(item) === 'mcp-resource.pdf';
}
