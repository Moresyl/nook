import type { Automation } from './automations';

export type AutomationPlanStatus = 'active' | 'paused' | 'completed';
export type AutomationFilter = 'all' | AutomationPlanStatus;

export function automationPlanStatus(task: Automation, now = Date.now()): AutomationPlanStatus {
  if (task.enabled || task.runs.some((run) => run.status === 'running')) return 'active';
  return task.schedule.kind === 'once' && task.schedule.at <= now ? 'completed' : 'paused';
}

export function filterAutomations(tasks: Automation[], status: AutomationFilter, search: string, now = Date.now()): Automation[] {
  const query = search.trim().toLocaleLowerCase();
  return tasks.filter((task) => (status === 'all' || automationPlanStatus(task, now) === status)
    && `${task.name}\n${task.prompt}`.toLocaleLowerCase().includes(query));
}
