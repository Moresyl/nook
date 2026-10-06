import { z } from 'zod';

export const previewTextPattern = /\.(?:html?|css|m?js|json|svg)$/i;
const previewDraftSchema = z.object({ path: z.string().min(1).max(4096).regex(previewTextPattern), text: z.string().max(256_000) }).strict();
export const projectPreviewSchema = z.object({
  path: z.string().min(1).max(4096).refine(path => /\.html?$/i.test(path), 'Choose an HTML file to preview.'),
  text: z.string().max(256_000),
  drafts: z.array(previewDraftSchema).max(32, 'Preview supports up to 32 related drafts.').optional(),
}).strict().refine(input => input.text.length + (input.drafts ?? []).reduce((total, draft) => total + draft.text.length, 0) <= 2_000_000, { message: 'The combined preview drafts are too large.' });
export type ProjectPreviewInput = z.infer<typeof projectPreviewSchema>;

export const previewViewportSchema = z.object({
  x: z.number().min(0).max(32_768), y: z.number().min(0).max(32_768),
  width: z.number().min(0).max(32_768), height: z.number().min(0).max(32_768),
}).strict();
export type PreviewViewport = z.infer<typeof previewViewportSchema>;
