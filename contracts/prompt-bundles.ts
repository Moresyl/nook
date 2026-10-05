import { z } from 'zod';
import { assistantProfileSchema } from './assistant-profiles';
import { promptParameters, promptTemplateLimits, promptTemplateSchema } from './prompt-templates';

const portableTemplateSchema = z.object({
  title: promptTemplateSchema.shape.title, description: promptTemplateSchema.shape.description,
  content: promptTemplateSchema.shape.content, parameters: promptTemplateSchema.shape.parameters,
  assistantIndex: z.number().int().min(0).max(promptTemplateLimits.count - 1).optional(),
}).strict();
const promptBundleSchema = z.object({
  format: z.literal('qiyao-prompt-templates'), version: z.literal(1),
  templates: z.array(portableTemplateSchema).min(1).max(promptTemplateLimits.count),
  assistants: z.array(assistantProfileSchema).max(promptTemplateLimits.count),
}).strict();
export type PromptBundle = z.infer<typeof promptBundleSchema>;

export function parsePromptBundle(raw: unknown): PromptBundle {
  const result = promptBundleSchema.safeParse(raw);
  if (!result.success) throw new Error('Choose a valid Nook prompt template file containing only template definitions and linked assistant profiles.');
  const bundle = result.data;
  for (const template of bundle.templates) promptParameters(template.content, template.parameters);
  const references = new Set(bundle.templates.flatMap((template) => template.assistantIndex === undefined ? [] : [template.assistantIndex]));
  if ([...references].some((index) => index >= bundle.assistants.length) || references.size !== bundle.assistants.length) {
    throw new Error('The prompt template file has missing or unreferenced assistant profiles. Choose a complete exported file.');
  }
  if (new TextEncoder().encode(JSON.stringify(bundle)).byteLength > promptTemplateLimits.bytes) throw new Error('Prompt templates exceed the 4 MB limit. Export fewer templates.');
  return bundle;
}
