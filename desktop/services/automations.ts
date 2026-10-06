import { randomUUID } from 'node:crypto';
import { Cron } from 'croner';
import { automationInputSchema, automationScheduleSchema, type Automation, type AutomationInput, type AutomationRun, type AutomationSchedule } from '../../contracts/automations';
import type { Workspace } from '../../contracts/workspace';
import type { WorkspaceVault } from './vault';

export function nextAutomationRun(raw: AutomationSchedule, after: number, previous?: number): number | undefined {
  const schedule = automationScheduleSchema.parse(raw);
  if (!Number.isFinite(after) || after < 0) throw new Error('The automation time is invalid.');
  if (schedule.kind === 'once') return schedule.at > after ? schedule.at : undefined;
  if (schedule.kind === 'interval') {
    const period = schedule.minutes * 60_000; const anchor = previous ?? after;
    const next = anchor + (Math.max(0, Math.floor((after - anchor) / period)) + 1) * period;
    if (!Number.isSafeInteger(next) || next > 8_640_000_000_000_000) throw new Error('The automation time is out of range.');
    return next;
  }
  try { const cron = new Cron(schedule.expression, { timezone: schedule.timezone, paused: true }); try { const next = cron.nextRun(new Date(after)); if (!next) throw new Error(); return next.getTime(); } finally { cron.stop(); } }
  catch { throw new Error('The cron expression or time zone is invalid or has no future run.'); }
}
export type AutomationEvent = { state?: Workspace; error?: string; openThreadId?: string };
export type AutomationRunner = (task: AutomationInput, signal: AbortSignal, onThread: (id: string) => Promise<void>) => Promise<'complete' | 'error' | 'stopped'>;
type Job = { controller: AbortController; promise: Promise<void> };
class AutomationConflict extends Error {}
const failedRun = 'The automation failed. Open its conversation for details, or check its model and selections.';

export class Automations {
  private jobs = new Map<string, Job>(); private timer: ReturnType<typeof setTimeout> | undefined; private suspended = true; private closed = false;
  constructor(private readonly vault: WorkspaceVault, private readonly runner: AutomationRunner, private readonly emit: (event: AutomationEvent) => void,
    private readonly notify: (task: Automation, run: AutomationRun) => void = () => {}, private readonly now: () => number = Date.now) {}
  private publish(state: Workspace) { try { this.emit({ state }); } catch {} }
  private available() { if (this.closed || this.suspended) throw new Error('Automatic tasks are unavailable. Reopen the workspace after checking local storage.'); }
  private fault() { this.suspended = true; clearTimeout(this.timer); try { this.emit({ error: 'Automatic tasks paused because local data could not be saved. Check storage and reopen the workspace.' }); } catch {} }
  private arm() {
    clearTimeout(this.timer); if (this.closed || this.suspended) return;
    const due = this.vault.automations().filter((task) => task.enabled && task.nextRunAt !== undefined && !this.jobs.has(task.id)).map((task) => task.nextRunAt!);
    if (!due.length) return;
    const delay = this.jobs.size >= 2 ? 1000 : Math.max(1, Math.min(30_000, Math.min(...due) - this.now()));
    this.timer = setTimeout(() => this.wake(), delay); this.timer.unref();
  }
  async resume(): Promise<void> {
    if (this.closed) throw new Error('Automatic tasks are closing. Reopen the workspace.');
    if (this.jobs.size) throw new Error('Wait for running tasks to stop before resuming schedules.');
    const tasks = this.vault.automations(); const now = this.now(); let changed = false;
    for (const task of tasks) {
      for (const run of task.runs) if (run.status === 'running') { run.status = 'stopped'; run.finishedAt = now; run.error = 'The application closed before this run finished. Run it again to retry.'; changed = true; }
      if (task.enabled) {
        try { nextAutomationRun(task.schedule, now, task.nextRunAt); } catch { task.enabled = false; task.nextRunAt = undefined; changed = true; continue; }
      }
      if (task.enabled && (task.nextRunAt === undefined || task.nextRunAt <= now)) {
        if (task.nextRunAt !== undefined) task.runs = [...task.runs, { id: randomUUID(), startedAt: task.nextRunAt, finishedAt: now, trigger: 'recovery' as const, status: 'missed' as const }].slice(-50);
        try { task.nextRunAt = nextAutomationRun(task.schedule, now, task.nextRunAt); if (task.nextRunAt === undefined) task.enabled = false; }
        catch { task.enabled = false; task.nextRunAt = undefined; }
        changed = true;
      }
    }
    if (changed) this.publish(await this.vault.update((draft) => { draft.automations = tasks; }));
    this.suspended = false; this.arm();
  }
  async save(raw: AutomationInput): Promise<Workspace> {
    this.available(); const input = automationInputSchema.parse(raw); const now = this.now();
    const nextRunAt = nextAutomationRun(input.schedule, now); if (input.enabled && nextRunAt === undefined) throw new Error('Choose a future time for a scheduled task.');
    const state = await this.vault.update((draft) => {
      this.available(); if (this.jobs.has(input.id)) throw new Error('Stop this task before editing its configuration.');
      const provider = draft.providers.find((item) => item.id === input.providerId); if (!provider?.models.includes(input.model)) throw new Error('Choose a configured model for this task.');
      if (input.assistantId && !draft.assistants.some((item) => item.id === input.assistantId) || input.projectId && !draft.projects.some((item) => item.id === input.projectId)) throw new Error('The selected assistant or project no longer exists.');
      if (input.mcpServerIds.some((id) => !draft.mcpServers.some((item) => item.id === id && item.enabled)) || input.skillIds.some((id) => !draft.skills.some((item) => item.id === id && item.enabled)) || input.pluginIds.some((id) => !draft.plugins.some((item) => item.id === id && item.enabled)) || input.knowledgeCollectionIds.some((id) => id !== 'notes' && !draft.knowledgeCollections.some((item) => item.id === id))) throw new Error('One of the selected extensions or knowledge collections is unavailable.');
      const existing = draft.automations.find((item) => item.id === input.id);
      if (existing) Object.assign(existing, input, { updatedAt: now, nextRunAt: input.enabled ? nextRunAt : undefined });
      else draft.automations.push({ ...input, createdAt: now, updatedAt: now, nextRunAt: input.enabled ? nextRunAt : undefined, runs: [] });
    }); this.publish(state); this.arm(); return state;
  }
  async setEnabled(id: string, enabled: boolean): Promise<Workspace> {
    this.available(); const state = await this.vault.update((draft) => {
      this.available(); const task = draft.automations.find((item) => item.id === id); if (!task) throw new Error('This automatic task no longer exists.');
      const next = enabled ? nextAutomationRun(task.schedule, this.now()) : undefined; if (enabled && next === undefined) throw new Error('Choose a future time before resuming this task.');
      task.enabled = enabled; task.nextRunAt = next; task.updatedAt = this.now();
    }); this.publish(state); this.arm(); return state;
  }
  runNow(id: string): Promise<void> { this.available(); return this.begin(id, true); }
  wake(): void {
    if (this.closed || this.suspended) return;
    const due = this.vault.automations().filter((task) => task.enabled && task.nextRunAt !== undefined && task.nextRunAt <= this.now() && !this.jobs.has(task.id)).sort((left, right) => left.nextRunAt! - right.nextRunAt!);
    for (const task of due) if (this.jobs.size < 2) void this.begin(task.id, false).catch(() => {});
    this.arm();
  }
  private begin(id: string, manual: boolean): Promise<void> {
    if (!this.vault.automations().some((task) => task.id === id)) return Promise.reject(new AutomationConflict('This automatic task no longer exists.'));
    if (this.jobs.has(id)) return Promise.reject(new Error('This task is already running.'));
    if (this.jobs.size >= 2) return Promise.reject(new Error('Two automatic tasks are running. Wait for one to finish.'));
    const controller = new AbortController(); const job: Job = { controller, promise: Promise.resolve() }; this.jobs.set(id, job);
    const operation = async () => {
      const run: AutomationRun = { id: randomUUID(), startedAt: this.now(), trigger: manual ? 'manual' : 'scheduled', status: 'running' };
      const claimed = await this.vault.update((draft) => {
        if (this.suspended || this.closed) throw new AutomationConflict('This task was stopped before execution.');
        const task = draft.automations.find((item) => item.id === id); if (!task) throw new AutomationConflict('This automatic task no longer exists.');
        if (!manual) { if (!task.enabled || task.nextRunAt === undefined || task.nextRunAt > this.now()) throw new AutomationConflict('The schedule changed before execution.'); task.nextRunAt = nextAutomationRun(task.schedule, this.now(), task.nextRunAt); if (task.nextRunAt === undefined) task.enabled = false; }
        task.runs = [...task.runs, run].slice(-50);
      }); this.publish(claimed); const task = claimed.automations.find((item) => item.id === id)!;
      const timeout = setTimeout(() => controller.abort(new Error('The automatic task reached its time limit.')), task.timeoutMinutes * 60_000); timeout.unref();
      let status: AutomationRun['status'];
      try { controller.signal.throwIfAborted(); status = await this.runner(task, controller.signal, async (threadId) => { this.publish(await this.vault.update((draft) => { const target = draft.automations.find((item) => item.id === id)?.runs.find((item) => item.id === run.id); if (target) target.threadId = threadId; })); }); if (controller.signal.aborted) status = 'stopped'; }
      catch { status = controller.signal.aborted ? 'stopped' : 'error'; }
      finally { clearTimeout(timeout); }
      const completed = await this.vault.update((draft) => {
        const record = draft.automations.find((item) => item.id === id)?.runs.find((item) => item.id === run.id);
        if (record) { record.status = status; record.finishedAt = this.now(); if (status === 'error') record.error = failedRun; else if (controller.signal.reason instanceof Error && status === 'stopped') record.error = controller.signal.reason.message; }
      }); this.publish(completed);
      const record = completed.automations.find((item) => item.id === id)?.runs.find((item) => item.id === run.id);
      if (task.notify && record) try { this.notify(task, record); } catch {}
    };
    job.promise = Promise.resolve().then(operation).catch((error) => { if (!(error instanceof AutomationConflict)) this.fault(); throw error; }).finally(() => { this.jobs.delete(id); this.arm(); }); return job.promise;
  }
  async stop(id: string): Promise<void> { const job = this.jobs.get(id); if (!job) return; job.controller.abort(); await job.promise; }
  async settle(id: string): Promise<void> { await this.jobs.get(id)?.promise; }
  async remove(id: string): Promise<Workspace> {
    this.available(); await this.setEnabled(id, false); await this.stop(id); const state = await this.vault.update((draft) => { this.available(); if (this.jobs.has(id)) throw new Error('Stop this task before deleting it.'); draft.automations = draft.automations.filter((item) => item.id !== id); }); this.publish(state); this.arm(); return state;
  }
  async suspend(): Promise<void> { this.suspended = true; clearTimeout(this.timer); const jobs = [...this.jobs.values()]; jobs.forEach((job) => job.controller.abort()); await Promise.all(jobs.map((job) => job.promise.catch(() => {}))); }
  async shutdown(): Promise<void> { this.closed = true; await this.suspend(); }
}
