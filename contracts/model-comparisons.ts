import { z } from 'zod';
import { attachmentSchema } from './attachments';
import type { Thread } from './workspace';

const identifier = z.string().min(1).max(128).refine((value) => !value.includes('\0'), 'Identifiers cannot contain NUL characters');
export const comparisonSchema = z.object({
  threadId: identifier.optional(), revision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  text: z.string().trim().min(1).max(256_000), attachments: z.array(attachmentSchema).max(12).default([]),
  assistantId: identifier.optional(), projectId: identifier.optional(),
  models: z.array(z.object({ providerId: identifier, model: z.string().min(1).max(128) }).strict()).min(2).max(4),
}).strict().superRefine((input, context) => {
  if (Boolean(input.threadId) !== Boolean(input.revision)) context.addIssue({ code: 'custom', path: ['revision'], message: 'An existing comparison context requires its current revision' });
  if (new Set(input.models.map((item) => JSON.stringify([item.providerId, item.model]))).size !== input.models.length) context.addIssue({ code: 'custom', path: ['models'], message: 'Choose distinct provider/model pairs' });
});
export type ComparisonRequest = z.infer<typeof comparisonSchema>;
export type ComparisonResult = { groupId: string; threadIds: string[]; failedThreadIds: string[] };

export function comparisonThreads(threads: Thread[], groupId: string): Thread[] {
  const members = threads.filter((thread) => thread.comparison?.groupId === groupId);
  if (members.length > 4 || new Set(members.map((thread) => thread.comparison!.index)).size !== members.length || new Set(members.map((thread) => thread.id)).size !== members.length) throw new Error('This comparison has ambiguous conversation records. Restore valid history before continuing.');
  return members.sort((a, b) => a.comparison!.index - b.comparison!.index);
}
