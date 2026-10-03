import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { automationInputSchema, automationRunSchema, automationSchema, type AutomationInput } from '../contracts/automations';
import { emptyWorkspace, workspaceSchema } from '../contracts/workspace';
import { Automations, nextAutomationRun, type AutomationRunner } from '../desktop/services/automations';
import { conversationAutomationRunner } from '../desktop/services/automation-runner';
import { ConversationEngine } from '../desktop/services/conversation-engine';
import { WorkspaceVault } from '../desktop/services/vault';
import type { ModelGateway } from '../desktop/services/model-gateway';
import { codec, provider, testVault } from './fixtures';

const directories: string[] = []; const services: Automations[] = [];
afterEach(async () => { await Promise.all(services.splice(0).map((service) => service.shutdown())); vi.useRealTimers(); vi.restoreAllMocks(); await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
const task = (changes: Partial<AutomationInput> = {}): AutomationInput => automationInputSchema.parse({ id: randomUUID(), name: 'Research', prompt: 'Review evidence', providerId: provider.id, model: 'test-model', schedule: { kind: 'interval', minutes: 1 }, ...changes });
async function setup(runner?: AutomationRunner, emit = vi.fn(), notify = vi.fn()) {
  const { vault, directory } = await testVault(); directories.push(directory); let now = Date.UTC(2026, 9, 2, 0);
  const execute = runner ?? vi.fn<AutomationRunner>(async (_task, _signal, onThread) => { await onThread('generated-thread'); return 'complete'; });
  const service = new Automations(vault, execute, emit, notify, () => now); services.push(service); await service.resume();
  return { vault, service, execute, emit, notify, directory, now: () => now, advance: (milliseconds: number) => { now += milliseconds; } };
}
const held: AutomationRunner = async (_task, signal, onThread) => { await onThread('held-thread'); signal.throwIfAborted(); await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true })); return 'complete'; };

describe('automation contracts and calendar', () => {
  it('migrates old workspaces and rejects forged execution fields, duplicated owners and malformed runs', () => {
    const { automations: _tasks, ...legacy } = emptyWorkspace(); expect(workspaceSchema.parse(legacy).automations).toEqual([]);
    const input = task(); expect(automationInputSchema.safeParse({ ...input, runs: [] }).success).toBe(false);
    const stored = { ...input, createdAt: 1, updatedAt: 1, runs: [] }; expect(workspaceSchema.safeParse({ ...emptyWorkspace(), automations: [stored, stored] }).success).toBe(false);
    expect(automationInputSchema.safeParse(task({ mode: 'plan', projectId: 'project' })).success).toBe(true);
    for (const change of [{ mode: 'agent' }, { prompt: '' }, { timeoutMinutes: 0 }, { timeoutMinutes: 61 }, { knowledgeCollectionIds: ['notes'], prompt: 'x'.repeat(2001) }, { schedule: { kind: 'cron', expression: '* * * * * *', timezone: 'UTC' } }]) expect(automationInputSchema.safeParse({ ...input, ...change }).success).toBe(false);
    expect(automationInputSchema.safeParse({ ...input, knowledgeCollectionIds: ['notes', 'notes'] }).success).toBe(false);
    expect(automationRunSchema.safeParse({ id: randomUUID(), startedAt: 1, status: 'complete', trigger: 'manual' }).success).toBe(false);
    expect(automationRunSchema.safeParse({ id: randomUUID(), startedAt: 1, finishedAt: 2, status: 'running', trigger: 'manual' }).success).toBe(false);
    expect(automationSchema.safeParse({ ...stored, mode: 'plan' }).success).toBe(false);
  });
  it.each([
    ['Asia/Shanghai', '2026-10-01T00:00:00Z', '2026-10-01T01:00:00Z'],
    ['America/New_York', '2026-03-07T15:00:00Z', '2026-03-08T13:00:00Z'],
    ['America/New_York', '2026-10-31T14:00:00Z', '2026-11-01T14:00:00Z'],
    ['UTC', '2026-10-01T09:00:00Z', '2026-10-02T09:00:00Z'],
  ])('calculates the next daily occurrence in %s across calendar and DST boundaries', (timezone, start, expected) => {
    expect(nextAutomationRun({ kind: 'cron', expression: '0 9 * * *', timezone }, Date.parse(start))).toBe(Date.parse(expected));
  });
  it('advances interval calendars without a backlog, expires once schedules and handles long timers safely', () => {
    expect(nextAutomationRun({ kind: 'interval', minutes: 1 }, 190_000, 60_000)).toBe(240_000);
    expect(nextAutomationRun({ kind: 'interval', minutes: 43_200 }, 1)).toBe(2_592_000_001);
    expect(nextAutomationRun({ kind: 'once', at: 100 }, 99)).toBe(100); expect(nextAutomationRun({ kind: 'once', at: 100 }, 100)).toBeUndefined();
    for (const expression of ['bad * * * *', '0 9 30 2 *']) expect(() => nextAutomationRun({ kind: 'cron', expression, timezone: 'UTC' }, Date.UTC(2026, 0, 1))).toThrow('invalid');
    expect(() => nextAutomationRun({ kind: 'cron', expression: '0 9 * * *', timezone: 'Invalid/Zone' }, 1)).toThrow('invalid');
    for (const value of [-1, Infinity]) expect(() => nextAutomationRun({ kind: 'interval', minutes: 1 }, value)).toThrow('invalid');
    expect(() => nextAutomationRun({ kind: 'interval', minutes: 1 }, 8_640_000_000_000_000)).toThrow('out of range');
  });
});
describe('persistent automatic tasks', () => {
  it('fires a real one-shot timer automatically without manual dispatch and leaves future monthly timers dormant', async () => {
    const { vault, directory } = await testVault(); directories.push(directory); const execute = vi.fn<AutomationRunner>().mockResolvedValue('complete'); const service = new Automations(vault, execute, vi.fn()); services.push(service); await service.resume();
    const future = task({ enabled: true, schedule: { kind: 'interval', minutes: 43_200 } }); await service.save(future);
    const soon = task({ enabled: true, schedule: { kind: 'once', at: Date.now() + 150 } }); await service.save(soon);
    await vi.waitFor(() => expect(vault.snapshot().automations.find((item) => item.id === soon.id)?.runs[0]?.status).toBe('complete')); expect(execute).toHaveBeenCalledTimes(1); expect(vault.snapshot().automations.find((item) => item.id === future.id)?.runs).toEqual([]);
  });
  it('does not run early when the system clock moves backwards', async () => {
    const { service, vault, advance, execute } = await setup(); const input = task({ enabled: true }); await service.save(input); advance(-20_000); service.wake(); advance(60_000); service.wake(); expect(execute).not.toHaveBeenCalled();
    advance(20_000); service.wake(); await service.settle(input.id); expect(vault.snapshot().automations[0].runs).toHaveLength(1);
  });
  it('keeps the natural calendar unchanged by manual runs and preserves history when editing, pausing and resuming', async () => {
    const { service, vault, advance } = await setup(); const input = task({ enabled: true }); const saved = await service.save(input); const next = saved.automations[0].nextRunAt;
    await service.runNow(input.id); expect(vault.snapshot().automations[0]).toMatchObject({ nextRunAt: next, runs: [{ status: 'complete', trigger: 'manual', threadId: 'generated-thread' }] });
    await service.save({ ...input, name: 'Changed' }); expect(vault.snapshot().automations[0].runs).toHaveLength(1);
    await service.setEnabled(input.id, false); advance(5000); const resumed = await service.setEnabled(input.id, true); expect(resumed.automations[0].nextRunAt).toBe(next! + 5000);
    expect((await service.remove(input.id)).automations).toEqual([]); await service.stop('missing'); await service.settle('missing');
  });
  it('claims a due one-shot before model execution and persists it once without overlapping duplicate wakes', async () => {
    const { service, vault, advance, now, execute } = await setup(held); const input = task({ enabled: true, schedule: { kind: 'once', at: now() + 1000 } }); await service.save(input); advance(1000);
    service.wake(); service.wake(); await vi.waitFor(() => expect(vault.snapshot().automations[0].runs[0]?.threadId).toBe('held-thread'));
    expect(execute).toBe(held); expect(vault.snapshot().automations[0]).toMatchObject({ enabled: false, runs: [{ status: 'running', trigger: 'scheduled' }] });
    await expect(service.runNow(input.id)).rejects.toThrow('already running'); await expect(service.save({ ...input, enabled: false })).rejects.toThrow('Stop this task');
    await expect(service.resume()).rejects.toThrow('Wait for'); await service.stop(input.id); service.wake(); expect(vault.snapshot().automations[0].runs).toHaveLength(1); expect(vault.snapshot().automations[0].runs[0].status).toBe('stopped');
  });
  it('skips accumulated interval occurrences after a slow run while keeping the original interval alignment', async () => {
    const { service, vault, advance, now } = await setup(); const input = task({ enabled: true }); await service.save(input); const first = vault.snapshot().automations[0].nextRunAt!;
    advance(190_000); service.wake(); await service.settle(input.id); const next = vault.snapshot().automations[0].nextRunAt!;
    expect(next).toBeGreaterThan(now()); expect((next - first) % 60_000).toBe(0); expect(vault.snapshot().automations[0].runs).toHaveLength(1);
  });
  it('limits active jobs to two and dispatches older due plans first when a slot becomes free', async () => {
    const seen: string[] = []; let secondStarted!: () => void; let thirdStarted!: () => void;
    const second = new Promise<void>((resolve) => { secondStarted = resolve; }); const third = new Promise<void>((resolve) => { thirdStarted = resolve; });
    const { service, vault, advance, now } = await setup(async (task, signal, onThread) => { seen.push(task.name); if (seen.length === 2) secondStarted(); if (seen.length === 3) thirdStarted(); return held(task, signal, onThread); });
    const late = task({ name: 'Late', enabled: true, schedule: { kind: 'once', at: now() + 3000 } }); const early = task({ name: 'Early', enabled: true, schedule: { kind: 'once', at: now() + 1000 } }); const middle = task({ name: 'Middle', enabled: true, schedule: { kind: 'once', at: now() + 2000 } });
    for (const input of [late, early, middle]) await service.save(input); advance(3000); service.wake(); await second; expect(seen).toEqual(['Early', 'Middle']);
    await expect(service.runNow(late.id)).rejects.toThrow('Two automatic'); await service.stop(early.id); service.wake(); await third; expect(seen).toEqual(['Early', 'Middle', 'Late']);
    await service.stop(middle.id); await service.stop(late.id); expect(vault.snapshot().automations.every((item) => item.runs.length === 1)).toBe(true);
  });
  it('records redacted errors, permits a fresh retry, and isolates notification and renderer errors', async () => {
    const runner = vi.fn<AutomationRunner>().mockRejectedValueOnce(new Error('SECRET_PROVIDER_TOKEN /private/path')).mockResolvedValue('complete'); const notify = vi.fn(() => { throw new Error('Notification unavailable'); });
    const { service, vault } = await setup(runner, vi.fn(() => { throw new Error('Renderer closed'); }), notify); const input = task({ notify: true }); await service.save(input); await service.runNow(input.id); await service.runNow(input.id);
    expect(vault.snapshot().automations[0].runs.map((run) => run.status)).toEqual(['error', 'complete']); expect(JSON.stringify(vault.snapshot())).not.toContain('SECRET_PROVIDER'); expect(notify).toHaveBeenCalledTimes(2);
  });
  it('enforces deadlines and keeps an explicit stop distinct from pausing future occurrences', async () => {
    const { service, vault } = await setup(held); const input = task({ timeoutMinutes: 1, enabled: true }); await service.save(input); vi.useFakeTimers();
    const running = service.runNow(input.id); await vi.waitFor(() => expect(vault.snapshot().automations[0].runs[0]?.threadId).toBe('held-thread')); await service.setEnabled(input.id, false);
    await vi.advanceTimersByTimeAsync(60_001); await running; vi.useRealTimers(); expect(vault.snapshot().automations[0].runs[0]).toMatchObject({ status: 'stopped', error: 'The automatic task reached its time limit.' });
    expect(vault.snapshot().automations[0].enabled).toBe(false);
  });
  it('suspends ongoing jobs before restore, rejects new launches, and resumes only after jobs have stopped', async () => {
    const { service, vault } = await setup(held); const input = task(); await service.save(input); const run = service.runNow(input.id); await vi.waitFor(() => expect(vault.snapshot().automations[0].runs[0]?.threadId).toBe('held-thread'));
    await service.suspend(); await run; expect(() => service.runNow(input.id)).toThrow('unavailable'); await expect(service.save(input)).rejects.toThrow('unavailable'); service.wake();
    await service.resume(); await service.shutdown(); await expect(service.resume()).rejects.toThrow('closing'); expect(() => service.runNow(input.id)).toThrow('unavailable');
  });
  it('cancels reservations before execution without detached model work or false storage errors', async () => {
    const runner = vi.fn<AutomationRunner>().mockResolvedValue('complete'); const { service, emit } = await setup(runner); const input = task(); await service.save(input);
    const running = service.runNow(input.id); await service.suspend(); await expect(running).rejects.toThrow('stopped before'); expect(runner).not.toHaveBeenCalled(); expect(emit.mock.calls.some(([event]) => event.error)).toBe(false);
  });
  it('keeps only the latest fifty records and preserves conversations when deleting a running task', async () => {
    const { service, vault } = await setup(); const input = task(); await service.save(input); const first = randomUUID(); await vault.update((draft) => { draft.automations[0].runs = Array.from({ length: 50 }, (_, index) => ({ id: index ? randomUUID() : first, startedAt: 1, finishedAt: 2, status: 'complete', trigger: 'manual' })); });
    await service.runNow(input.id); expect(vault.snapshot().automations[0].runs).toHaveLength(50); expect(vault.snapshot().automations[0].runs.some((run) => run.id === first)).toBe(false); await service.remove(input.id);
    const heldSetup = await setup(held); const second = task(); await heldSetup.service.save(second); const running = heldSetup.service.runNow(second.id); await vi.waitFor(() => expect(heldSetup.vault.snapshot().automations[0].runs[0]?.threadId).toBe('held-thread')); await heldSetup.service.remove(second.id); await running; expect(heldSetup.vault.snapshot().automations).toEqual([]);
  });
  it('recovers interrupted histories, marks a closed-period occurrence missed and never backfills model requests', async () => {
    const { service, vault, now, execute } = await setup(); await service.suspend(); const input = task({ enabled: true, schedule: { kind: 'once', at: now() - 1000 } });
    await vault.update((draft) => { draft.automations.push({ ...input, createdAt: 1, updatedAt: 1, nextRunAt: now() - 1000, runs: [{ id: randomUUID(), startedAt: now() - 2000, status: 'running', trigger: 'manual' }] }); });
    await service.resume(); expect(vault.snapshot().automations[0]).toMatchObject({ enabled: false, runs: [{ status: 'stopped' }, { status: 'missed', trigger: 'recovery' }] }); expect(execute).not.toHaveBeenCalled();
    const reopened = new WorkspaceVault((directories.at(-1))!, codec); await reopened.initialize(); expect(reopened.snapshot().automations[0].runs).toHaveLength(2);
  });
  it('repairs absent calendars, disables invalid persisted Cron configurations and leaves paused plans paused', async () => {
    const { service, vault, now } = await setup(); await service.suspend(); const interval = task({ enabled: true }); const invalid = task({ enabled: true, schedule: { kind: 'cron', expression: 'bad * * * *', timezone: 'UTC' } }); const paused = task();
    await vault.update((draft) => { draft.automations = [interval, invalid, paused].map((input) => ({ ...input, createdAt: 1, updatedAt: 1, runs: [] })); }); await service.resume();
    expect(vault.snapshot().automations.map((item) => item.enabled)).toEqual([true, false, false]); expect(vault.snapshot().automations[0].nextRunAt).toBe(now() + 60_000);
  });
  it('rejects missing configuration references and expired one-shots without replacing a valid task', async () => {
    const { service, vault, now } = await setup(); const input = task(); await service.save(input);
    for (const changes of [{ providerId: 'missing' }, { model: 'missing' }, { assistantId: 'missing' }, { projectId: 'missing' }, { mcpServerIds: ['missing'] }, { skillIds: [randomUUID()] }, { pluginIds: [randomUUID()] }, { knowledgeCollectionIds: [randomUUID()] }]) await expect(service.save({ ...input, ...changes })).rejects.toThrow();
    await expect(service.save({ ...input, enabled: true, schedule: { kind: 'once', at: now() } })).rejects.toThrow('future'); await expect(service.setEnabled(randomUUID(), true)).rejects.toThrow('no longer'); await expect(service.runNow(randomUUID())).rejects.toThrow('no longer');
    await service.save({ ...input, schedule: { kind: 'once', at: now() } }); await expect(service.setEnabled(input.id, true)).rejects.toThrow('future'); expect(vault.snapshot().automations[0].runs).toEqual([]);
  });
  it('fails safely before a claim when persistence fails and requires recovery before new work', async () => {
    const { service, vault, execute, emit } = await setup(); const input = task(); await service.save(input); vi.spyOn(vault, 'update').mockRejectedValueOnce(new Error('PRIVATE_DISK_PATH'));
    await expect(service.runNow(input.id)).rejects.toThrow('PRIVATE_DISK_PATH'); expect(execute).not.toHaveBeenCalled(); expect(vault.snapshot().automations[0].runs).toEqual([]); expect(emit.mock.calls.at(-1)?.[0].error).not.toContain('PRIVATE_DISK_PATH');
    await expect(service.setEnabled(input.id, true)).rejects.toThrow('unavailable'); await service.resume(); await service.runNow(input.id); expect(vault.snapshot().automations[0].runs[0].status).toBe('complete');
  });
  it('retains a recoverable running record when final persistence fails and cancels stale queued claims', async () => {
    const { vault, service } = await setup(async () => { vi.spyOn(vault, 'update').mockRejectedValueOnce(new Error('Disk full')); return 'complete'; }); const input = task(); await service.save(input); await expect(service.runNow(input.id)).rejects.toThrow('Disk full'); expect(vault.snapshot().automations[0].runs[0].status).toBe('running'); await service.resume(); expect(vault.snapshot().automations[0].runs[0].status).toBe('stopped');
    const other = await setup(); const queued = task({ enabled: true }); await other.service.save(queued); other.advance(60_000); const original = other.vault.update.bind(other.vault); let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(other.vault, 'update').mockImplementationOnce(async (change) => { await gate; return original(change); }); other.service.wake(); await Promise.resolve(); await other.service.setEnabled(queued.id, false); release(); await expect(other.service.settle(queued.id)).rejects.toThrow('schedule changed'); expect(other.vault.snapshot().automations[0].runs).toEqual([]);
  });
});
describe('automatic conversation integration', () => {
  it('keeps selected project analysis read-only in the real engine', async () => {
    const { vault, directory } = await testVault(); directories.push(directory); await vault.update((draft) => { draft.projects.push({ id: 'project', name: 'Project', path: directory, instructions: 'READ_ONLY_PROJECT_EVIDENCE', createdAt: 1 }); });
    const gateway = { stream: vi.fn<ModelGateway['stream']>(async () => {}) }; const engine = new ConversationEngine(vault, gateway, vi.fn()); const runner = conversationAutomationRunner(engine, vault); expect(await runner(task({ projectId: 'project', mode: 'plan' }), new AbortController().signal, vi.fn())).toBe('complete');
    const input = gateway.stream.mock.calls[0][0]; expect(input.instructions).toContain('READ_ONLY_PROJECT_EVIDENCE'); expect(input.tools?.some((tool) => /write|execute/.test(tool.name))).toBe(false);
  });
  it('uses the real engine and preserves instructions, complete output, model errors and fresh retry threads', async () => {
    const { vault, directory } = await testVault(); directories.push(directory); const gateway = { stream: vi.fn().mockImplementationOnce(async (_input, onText) => { onText('AUTOMATED_EVIDENCE'); }).mockRejectedValueOnce(new Error('model failure')) };
    const engine = new ConversationEngine(vault, gateway, vi.fn()); const run = conversationAutomationRunner(engine, vault); const service = new Automations(vault, run, vi.fn()); services.push(service); await service.resume(); const input = task({ assistantId: 'developer' }); await service.save(input); await service.runNow(input.id); await service.runNow(input.id);
    expect(vault.snapshot().threads).toHaveLength(2); expect(vault.snapshot().threads[0].messages.at(-1)).toMatchObject({ status: 'complete', content: 'AUTOMATED_EVIDENCE' }); expect(vault.snapshot().automations[0].runs.map((run) => run.status)).toEqual(['complete', 'error']); expect(gateway.stream.mock.calls[0][0].instructions).toContain('careful software engineer');
  });
  it('stops active engine work on cancellation and on failure to save its conversation link', async () => {
    const { vault, directory } = await testVault(); directories.push(directory); const engine = new ConversationEngine(vault, { stream: async (input, onText) => { onText('partial'); input.signal.throwIfAborted(); await new Promise<void>((_resolve, reject) => input.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })); } }, vi.fn()); const runner = conversationAutomationRunner(engine, vault);
    const aborted = new AbortController(); aborted.abort(); await expect(runner(task(), aborted.signal, vi.fn())).rejects.toThrow(); expect(engine.active()).toBe(false);
    await expect(runner(task(), new AbortController().signal, async () => { throw new Error('link failed'); })).rejects.toThrow('link failed'); expect(engine.active()).toBe(false);
    const controller = new AbortController(); let threadId = ''; const promise = runner(task(), controller.signal, async (id) => { threadId = id; controller.abort(); }); expect(await promise).toBe('stopped'); expect(vault.snapshot().threads.find((thread) => thread.id === threadId)?.messages.at(-1)?.status).toBe('stopped');
  });
});
