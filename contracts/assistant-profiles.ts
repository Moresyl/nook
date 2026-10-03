import { z } from 'zod';
import { assistantSchema } from './workspace';

export const assistantProfileLimits = { bytes: 4_000_000, count: 1000 } as const;
export const assistantProfileSchema = assistantSchema.omit({ id: true }).extend({ name: z.string().trim().min(1).max(80) }).strict();
export const assistantBundleSchema = z.object({
  format: z.literal('qiyao-assistants'), version: z.literal(1),
  assistants: z.array(assistantProfileSchema).min(1).max(assistantProfileLimits.count),
}).strict();
export type AssistantBundle = z.infer<typeof assistantBundleSchema>;

export function parseAssistantBundle(raw: unknown): AssistantBundle {
  const parsed = assistantBundleSchema.safeParse(raw);
  if (!parsed.success) throw new Error('Choose a valid Qiyao assistant file containing only names, descriptions and instructions.');
  if (new TextEncoder().encode(JSON.stringify(parsed.data)).byteLength > assistantProfileLimits.bytes) throw new Error('Assistant profiles exceed the 4 MB limit. Export fewer assistants.');
  return parsed.data;
}
