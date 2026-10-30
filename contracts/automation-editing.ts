import type { Automation, AutomationInput } from './automations';

export function automationPlanAction(task: Automation, now = Date.now()): 'pause' | 'resume' | 'reschedule' {
  if (task.enabled) return 'pause';
  return task.schedule.kind === 'once' && task.schedule.at <= now ? 'reschedule' : 'resume';
}

export function automationEditDraft(task: Automation, action: 'edit' | 'reschedule' = 'edit', now = Date.now()): AutomationInput {
  const { runs: _runs, createdAt: _created, updatedAt: _updated, nextRunAt: _next, ...input } = task;
  return action === 'reschedule' && input.schedule.kind === 'once'
    ? { ...input, schedule: { kind: 'once', at: Math.floor((now + 300_000) / 1000) * 1000 }, enabled: true }
    : input;
}
