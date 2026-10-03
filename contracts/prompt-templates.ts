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
export const promptParameterSchema = z.object({
  key: z.string().min(1).max(40), label: z.string().max(80).optional(), description: z.string().max(512).optional(),
  required: z.boolean().optional(), defaultValue: z.string().max(promptTemplateLimits.value).optional(),
  choices: z.array(z.string().min(1).max(512).refine((value) => Boolean(value.trim()))).min(1).max(50)
    .refine((items) => new Set(items).size === items.length, 'Each parameter choice must be unique').optional(),
}).strict().superRefine((parameter, context) => {
  if (parameter.choices && parameter.defaultValue && !parameter.choices.includes(parameter.defaultValue)) {
    context.addIssue({ code: 'custom', path: ['defaultValue'], message: 'The default value must match a parameter choice' });
  }
});
export type PromptParameter = z.infer<typeof promptParameterSchema>;
const parametersSchema = z.array(promptParameterSchema).max(promptTemplateLimits.variables);
export function promptParameters(content: string, rawParameters: PromptParameter[] = []): PromptParameter[] {
  const variables = promptVariables(content); const parameters = parametersSchema.parse(rawParameters);
  if (new Set(parameters.map((item) => item.key)).size !== parameters.length || parameters.some((item) => !variables.includes(item.key))) {
    throw new Error('Define each existing prompt variable only once.');
  }
  return variables.map((key) => {
    const parameter = parameters.find((item) => item.key === key);
    return { ...parameter, key, required: parameter?.required ?? true };
  });
}
export const promptTemplateSchema = z.object({
  id: z.uuid(), title: z.string().trim().min(1).max(80), description: z.string().max(512), content: contentSchema,
  assistantId: z.string().min(1).max(128).refine((value) => !value.includes('\0')).optional(),
  parameters: parametersSchema.optional(),
}).strict().superRefine((template, context) => {
  try { promptParameters(template.content, template.parameters); } catch (error) {
    context.addIssue({ code: 'custom', path: ['content'], message: error instanceof Error ? error.message : 'Invalid prompt parameter definitions' });
  }
});
export const promptTemplatesSchema = z.array(promptTemplateSchema).max(promptTemplateLimits.count)
  .refine((items) => new Set(items.map((item) => item.id)).size === items.length, 'Prompt template IDs must be unique')
  .refine((items) => new TextEncoder().encode(JSON.stringify(items)).byteLength <= promptTemplateLimits.bytes, 'Prompt templates exceed the 4 MB limit').default([]);
export type PromptTemplate = z.infer<typeof promptTemplateSchema>;

export function renderPrompt(content: string, rawValues: Record<string, string>, definitions?: PromptParameter[]): string {
  const parameters = promptParameters(content, definitions); const variables = parameters.map((item) => item.key);
  if (!rawValues || typeof rawValues !== 'object' || Array.isArray(rawValues)) throw new Error('Prompt variable values must be an object.');
  const entries = z.array(z.tuple([z.string(), z.string().max(promptTemplateLimits.value)])).parse(Object.entries(rawValues));
  const supplied: Record<string, string> = Object.fromEntries(entries);
  if (Object.keys(supplied).some((key) => !variables.includes(key))) throw new Error('Fill each prompt variable and remove unknown values.');
  const values: Record<string, string> = Object.fromEntries(parameters.map((parameter) => {
    const value = Object.hasOwn(supplied, parameter.key) ? supplied[parameter.key] : parameter.defaultValue ?? '';
    if ((parameter.required && !value.trim()) || (parameter.choices && value !== '' && !parameter.choices.includes(value))) {
      throw new Error('Fill each required prompt variable and choose a declared option.');
    }
    return [parameter.key, value];
  }));
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
