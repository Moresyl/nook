import { z } from 'zod';

export const providerKindSchema = z.enum(['responses', 'openai', 'anthropic', 'ollama', 'gemini', 'azure']);
export function modelDestination(kind: z.infer<typeof providerKindSchema>, endpoint: string): string {
  const url = new URL(endpoint); url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return JSON.stringify([kind, url.href]);
}
const count = z.number().int().nonnegative().max(1_000_000_000);
const capacity = count.positive();
export const tokenUsageSchema = z.object({
  inputTokens: count.optional(), outputTokens: count.optional(), totalTokens: count.optional(),
  cachedInputTokens: count.optional(), cacheWriteTokens: count.optional(), reasoningTokens: count.optional(),
  toolInputTokens: count.optional(), invalid: z.boolean().optional(),
}).strict();
export const modelInfoSchema = z.object({
  id: z.string().min(1).max(128), source: z.enum(['service', 'manual']),
  destination: z.string().max(8192).optional(),
  inputTokenLimit: capacity.optional(), outputTokenLimit: capacity.optional(), contextWindow: capacity.optional(),
  supportsTools: z.boolean().optional(), supportsReasoning: z.boolean().optional(), supportsImages: z.boolean().optional(),
  maxOutputTokens: capacity.optional(),
  outputParameter: z.enum(['max_tokens', 'max_completion_tokens']).optional(),
}).strict().superRefine((model, context) => {
  if (model.maxOutputTokens && model.outputTokenLimit && model.maxOutputTokens > model.outputTokenLimit) {
    context.addIssue({ code: 'custom', path: ['maxOutputTokens'], message: 'The requested output limit exceeds the configured model limit' });
  }
});
export const invocationSchema = z.object({
  round: z.number().int().min(0).max(15), providerId: z.string().min(1).max(128), providerName: z.string().min(1).max(80),
  providerKind: providerKindSchema, model: z.string().min(1).max(128), destination: z.string().max(8192),
  startedAt: z.number().int().nonnegative(), finishedAt: z.number().int().nonnegative().optional(),
  status: z.enum(['running', 'complete', 'interrupted', 'error']), tokens: tokenUsageSchema.optional(),
  modelInfo: modelInfoSchema.optional(),
}).strict();
export type TokenUsage = z.infer<typeof tokenUsageSchema>;
export type ModelInfo = z.infer<typeof modelInfoSchema>;
export type ModelInvocation = z.infer<typeof invocationSchema>;

export function summarizeUsage(invocations: ModelInvocation[]) {
  const counts: TokenUsage = {};
  const fields = ['inputTokens', 'outputTokens', 'totalTokens', 'cachedInputTokens', 'cacheWriteTokens', 'reasoningTokens', 'toolInputTokens'] as const;
  const coverage: Partial<Record<typeof fields[number], number>> = {};
  for (const field of fields) {
    const values = invocations.map((item) => item.tokens?.[field]).filter((value): value is number => value !== undefined);
    if (values.length) { counts[field] = values.reduce((total, value) => total + value, 0); coverage[field] = values.length; }
  }
  const reported = invocations.filter((item) => item.tokens && fields.some((field) => item.tokens?.[field] !== undefined)).length;
  const partial = reported !== invocations.length || invocations.some((item) => item.status !== 'complete' || item.tokens?.invalid) || (invocations.length > 0 && (coverage.inputTokens !== invocations.length || coverage.outputTokens !== invocations.length)) || fields.some((field) => coverage[field] !== undefined && coverage[field] !== invocations.length);
  return { counts, coverage, reported, requests: invocations.length, partial };
}
