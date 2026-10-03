import { z } from 'zod';
import { knowledgeSelectionSchema } from './knowledge';

const identifier = z.string().min(1).max(128).refine((value) => !value.includes('\0'));
const timestamp = z.number().int().min(0).max(8_640_000_000_000_000);
export const automationScheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), at: timestamp }).strict(),
  z.object({ kind: z.literal('interval'), minutes: z.number().int().min(1).max(43_200) }).strict(),
  z.object({ kind: z.literal('cron'), expression: z.string().trim().min(1).max(128).refine((value) => value.split(/\s+/).length === 5, 'Use a five-field cron expression'), timezone: z.string().min(1).max(100) }).strict(),
]);
export const automationInputSchema = z.object({
  id: z.uuid(), name: z.string().trim().min(1).max(120), prompt: z.string().trim().min(1).max(32_000),
  providerId: identifier, model: z.string().min(1).max(128), assistantId: identifier.optional(), projectId: identifier.optional(),
  mode: z.enum(['chat', 'plan', 'agent']).default('chat'),
  mcpServerIds: z.array(identifier).max(8).default([]), skillIds: z.array(z.uuid()).max(20).default([]), pluginIds: z.array(z.uuid()).max(8).default([]),
  knowledgeCollectionIds: knowledgeSelectionSchema.default([]),
  schedule: automationScheduleSchema, enabled: z.boolean().default(false), notify: z.boolean().default(false), timeoutMinutes: z.number().int().min(1).max(60).default(10),
}).strict().refine((task) => task.mode === 'chat' || Boolean(task.projectId), 'Choose a project for plan or agent tasks').refine((task) => !task.knowledgeCollectionIds.length || task.prompt.length <= 2000, 'Knowledge questions cannot exceed 2,000 characters');
export const automationRunSchema = z.object({
  id: z.uuid(), startedAt: timestamp, finishedAt: timestamp.optional(), threadId: identifier.optional(),
  trigger: z.enum(['scheduled', 'manual', 'recovery']), status: z.enum(['running', 'complete', 'error', 'stopped', 'missed']), error: z.string().max(512).optional(),
}).strict().refine((run) => run.status === 'running' ? run.finishedAt === undefined : run.finishedAt !== undefined, 'Finished runs need a completion time');
export const automationSchema = z.object({ ...automationInputSchema.shape, createdAt: timestamp, updatedAt: timestamp, nextRunAt: timestamp.optional(), runs: z.array(automationRunSchema).max(50).default([]).refine((runs) => new Set(runs.map((run) => run.id)).size === runs.length, 'Run IDs must be unique') }).strict().refine((task) => task.mode === 'chat' || Boolean(task.projectId), 'Choose a project for plan or agent tasks');
export const automationsSchema = z.array(automationSchema).max(100).default([]).refine((tasks) => new Set(tasks.map((task) => task.id)).size === tasks.length, 'Automation IDs must be unique');
export type AutomationInput = z.infer<typeof automationInputSchema>;
export type Automation = z.infer<typeof automationSchema>;
export type AutomationSchedule = z.infer<typeof automationScheduleSchema>;
export type AutomationRun = z.infer<typeof automationRunSchema>;
