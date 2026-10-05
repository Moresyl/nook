import { z } from 'zod';

export const projectPreviewSchema = z.object({
  path: z.string().min(1).max(4096).refine(path => /\.html?$/i.test(path), 'Choose an HTML file to preview.'),
  text: z.string().max(256_000),
}).strict();
export type ProjectPreviewInput = z.infer<typeof projectPreviewSchema>;
