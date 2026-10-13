import { z } from 'zod';
import type { ToolActivity } from './tools';

export const taskPlanSchema = z.object({
  explanation: z.string().max(2000).refine(value => !value.includes('\0')),
  steps: z.array(z.object({
    step: z.string().min(1).max(300).refine(value => Boolean(value.trim()) && !value.includes('\0')),
    status: z.enum(['pending', 'in_progress', 'completed']),
  }).strict()).min(1).max(20),
}).strict().refine(value => value.steps.filter(step => step.status === 'in_progress').length <= 1, 'Only one step may be in progress.');

export type TaskPlan = z.infer<typeof taskPlanSchema>;

export function latestTaskPlan(activities: readonly ToolActivity[]): TaskPlan | null {
  for (let index = activities.length - 1; index >= 0; index--) {
    const activity = activities[index];
    if (activity.name !== 'update_plan' || activity.status !== 'complete') continue;
    try {
      const result = taskPlanSchema.safeParse(JSON.parse(activity.output));
      if (result.success) return result.data;
    } catch { /* Malformed historical output retains its raw tool record. */ }
  }
  return null;
}
