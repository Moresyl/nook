import { z } from 'zod';

const identifier = z.string().min(1).max(128).refine((value) => !value.includes('\0'), 'Identifiers cannot contain NUL characters');
export const messageTargetSchema = z.object({ threadId: identifier, messageId: identifier }).strict();
export const messageDraftSchema = messageTargetSchema.extend({ revision: z.string().regex(/^[a-f0-9]{64}$/), content: z.string().max(4_000_000), updatedAt: z.number().int().nonnegative() }).strict();
export const messageEditSchema = messageDraftSchema.omit({ updatedAt: true }).refine((draft) => Boolean(draft.content.trim()), 'A saved message must contain text');
export const messageDraftsSchema = z.array(messageDraftSchema).max(100).default([]).refine((drafts) => new Set(drafts.map((draft) => JSON.stringify([draft.threadId, draft.messageId]))).size === drafts.length, 'Message drafts must have unique owners').refine((drafts) => new TextEncoder().encode(JSON.stringify(drafts)).byteLength <= 32_000_000, 'Message editing drafts exceed the 32 MB UTF-8 limit');
export type MessageDraft = z.infer<typeof messageDraftSchema>;
export type MessageEdit = z.infer<typeof messageEditSchema>;
