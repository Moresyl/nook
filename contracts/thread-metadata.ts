import { z } from 'zod';

export const threadMetadataSchema = z.object({
  id: z.string().min(1).max(128).refine(value => !value.includes('\0'), 'Identifiers cannot contain NUL characters'),
  title: z.string().trim().min(1).max(160).optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
}).strict().refine(value => value.title !== undefined || value.pinned !== undefined || value.archived !== undefined, 'Choose a conversation detail to update');
export type ThreadMetadata = z.infer<typeof threadMetadataSchema>;
