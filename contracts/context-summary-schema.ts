import { z } from 'zod';
import { invocationSchema } from './models';

export const contextSummarySchema = z.object({
  id: z.uuid(), throughMessageId: z.string().min(1).max(128).refine(value => !value.includes('\0'), 'Identifiers cannot contain NUL characters'),
  sourceRevision: z.string().regex(/^[a-f0-9]{64}$/),
  messageCount: z.number().int().min(1).max(5000),
  content: z.string().max(256_000).refine(value => Boolean(value.trim()), 'The summary cannot be empty.'),
  createdAt: z.number().int().nonnegative(),
  invocations: z.array(invocationSchema).max(16).optional().refine(items => !items || new Set(items.map(item => item.round)).size === items.length, 'Model invocation rounds must be unique'),
}).strict();
export type ContextSummary = z.infer<typeof contextSummarySchema>;
