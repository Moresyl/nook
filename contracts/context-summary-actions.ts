import { z } from 'zod';
import type { ContextSummary } from './context-summary-schema';

const identifier = z.string().min(1).max(128).refine(value => !value.includes('\0'), 'Identifiers cannot contain NUL characters');
const content = z.string().max(256_000).refine(value => Boolean(value.trim()), 'The summary cannot be empty.');
export const generateContextSummarySchema = z.object({ threadId: identifier, requestId: z.uuid(), providerId: identifier, model: identifier, keepRecentTurns: z.number().int().min(0).max(20) }).strict();
export const changeContextSummarySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('apply'), threadId: identifier, previewId: z.uuid(), content }).strict(),
  z.object({ action: z.literal('select'), threadId: identifier, summaryId: z.uuid().optional() }).strict(),
  z.object({ action: z.literal('edit'), threadId: identifier, summaryId: z.uuid(), revision: z.string().regex(/^[a-f0-9]{64}$/), content }).strict(),
  z.object({ action: z.literal('delete'), threadId: identifier, summaryId: z.uuid() }).strict(),
]);
export type GenerateContextSummary = z.infer<typeof generateContextSummarySchema>;
export type ChangeContextSummary = z.infer<typeof changeContextSummarySchema>;
export type ContextSummaryPreview = ContextSummary & { threadId: string };
