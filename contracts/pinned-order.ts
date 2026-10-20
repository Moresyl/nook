import { z } from 'zod';

const threadId = z.string().min(1).max(128).refine(value => !value.includes('\0'), 'Identifiers cannot contain NUL characters');
export const pinnedReorderSchema = z.object({ threadId, targetId: threadId, position: z.enum(['before', 'after']) }).strict();
export type PinnedReorder = z.infer<typeof pinnedReorderSchema>;
