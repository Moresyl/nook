import { z } from 'zod';

export const promptTemplateLimits = { count: 200, content: 32_000, variables: 20, value: 32_000, draft: 256_000, bytes: 4_000_000 } as const;
const contentSchema = z.string().max(promptTemplateLimits.content).refine((text) => Boolean(text.trim()), 'Write a nonempty prompt template');
const tokenPattern = /(?:\\)?\{\{([\p{L}_][\p{L}\p{N}_-]{0,39})\}\}/gu;

export function promptVariables(content: string): string[] {
  const text = contentSchema.parse(content); const variables = new Set<string>();
  for (const match of text.matchAll(tokenPattern)) if (!match[0].startsWith('\\')) variables.add(match[1]);
  if (variables.size > promptTemplateLimits.variables) throw new Error('Prompt templates support at most 20 different variables.');
  return [...variables];
}
export const promptTemplateSchema = z.object({
  id: z.uuid(), title: z.string().trim().min(1).max(80), description: z.string().max(512), content: contentSchema,
}).strict().superRefine((template, context) => {
  try { promptVariables(template.content); } catch { context.addIssue({ code: 'custom', path: ['content'], message: 'Prompt templates support at most 20 different variables' }); }
});
export const promptTemplatesSchema = z.array(promptTemplateSchema).max(promptTemplateLimits.count)
  .refine((items) => new Set(items.map((item) => item.id)).size === items.length, 'Prompt template IDs must be unique')
  .refine((items) => new TextEncoder().encode(JSON.stringify(items)).byteLength <= promptTemplateLimits.bytes, 'Prompt templates exceed the 4 MB limit').default([]);
export type PromptTemplate = z.infer<typeof promptTemplateSchema>;

export function renderPrompt(content: string, rawValues: Record<string, string>): string {
  const variables = promptVariables(content);
  if (!rawValues || typeof rawValues !== 'object' || Array.isArray(rawValues)) throw new Error('Prompt variable values must be an object.');
  const entries = z.array(z.tuple([z.string(), z.string().max(promptTemplateLimits.value)])).parse(Object.entries(rawValues));
  const values: Record<string, string> = Object.fromEntries(entries);
  if (Object.keys(values).some((key) => !variables.includes(key)) || variables.some((key) => !Object.hasOwn(values, key) || !values[key].trim())) throw new Error('Fill each prompt variable and remove unknown values.');
  let cursor = 0; let length = 0; const parts: string[] = [];
  const append = (part: string) => { length += part.length; if (length > promptTemplateLimits.draft) throw new Error('The expanded prompt exceeds the 256 KB draft limit. Use shorter variable values.'); parts.push(part); };
  for (const match of content.matchAll(tokenPattern)) {
    append(content.slice(cursor, match.index)); append(match[0].startsWith('\\') ? match[0].slice(1) : values[match[1]]); cursor = match.index + match[0].length;
  }
  append(content.slice(cursor)); return parts.join('');
}
export function appendPrompt(draft: string, prompt: string): string {
  z.string().max(promptTemplateLimits.draft).parse(draft); z.string().max(promptTemplateLimits.draft).refine((text) => Boolean(text.trim()), 'The prompt is empty').parse(prompt);
  const joined = draft ? `${draft}\n\n${prompt}` : prompt;
  if (joined.length > promptTemplateLimits.draft) throw new Error('The combined draft exceeds 256 KB. Shorten the draft before adding this prompt.');
  return joined;
}
