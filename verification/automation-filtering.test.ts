import { describe, expect, it, vi } from 'vitest';
import { automationPlanStatus, filterAutomations } from '../contracts/automation-filtering';
import { automationSchema, type Automation } from '../contracts/automations';

const now = Date.UTC(2026, 9, 30, 8);
const task = (overrides: Partial<Automation> = {}) => automationSchema.parse({
  id: '7f74405b-3ef2-48ed-bf26-df91674e423e', name: '每日 Research', prompt: 'Review the release notes',
  providerId: 'provider', model: 'model', schedule: { kind: 'interval', minutes: 60 },
  createdAt: 1, updatedAt: 2, ...overrides,
});
const run = (status: Automation['runs'][number]['status'], trigger: Automation['runs'][number]['trigger'] = 'scheduled') => ({
  id: '6d12ae86-de1c-487b-843f-1ba457876489', startedAt: now - 2000, trigger, status,
  ...(status === 'running' ? {} : { finishedAt: now - 1000 }),
});

describe('automation list filters', () => {
  it('classifies enabled interval, cron and one-shot plans as active regardless of previous results', () => {
    for (const schedule of [{ kind: 'interval', minutes: 60 }, { kind: 'cron', expression: '0 9 * * *', timezone: 'UTC' }, { kind: 'once', at: now + 1000 }] as const) {
      expect(automationPlanStatus(task({ schedule, enabled: true, runs: [run('error')] }), now)).toBe('active');
    }
  });

  it('keeps disabled recurring plans paused after successful, failed, stopped or missed runs', () => {
    for (const status of ['complete', 'error', 'stopped', 'missed'] as const) {
      for (const schedule of [{ kind: 'interval', minutes: 60 }, { kind: 'cron', expression: '0 9 * * *', timezone: 'UTC' }] as const) {
        expect(automationPlanStatus(task({ schedule, runs: [run(status)] }), now)).toBe('paused');
      }
    }
    expect(automationPlanStatus(task(), now)).toBe('paused');
  });

  it('ends a disabled one-shot at its deadline independently of execution success or missing history', () => {
    const once = task({ schedule: { kind: 'once', at: now } });
    expect(automationPlanStatus(once, now - 1)).toBe('paused');
    expect(automationPlanStatus(once, now)).toBe('completed');
    for (const status of ['complete', 'error', 'stopped', 'missed'] as const) {
      expect(automationPlanStatus({ ...once, runs: [run(status)] }, now + 1)).toBe('completed');
    }
  });

  it('keeps a running one-shot and a manually running paused plan reachable in active until they stop', () => {
    for (const schedule of [{ kind: 'once', at: now - 1000 }, { kind: 'interval', minutes: 60 }] as const) {
      const running = task({ schedule, runs: [run('running', 'manual')] });
      expect(automationPlanStatus(running, now)).toBe('active');
      expect(filterAutomations([running], 'active', '', now)).toEqual([running]);
      expect(filterAutomations([running], 'completed', '', now)).toEqual([]);
    }
  });

  it('combines status with trimmed case-insensitive name and prompt search while preserving identity, order and data', () => {
    const active = task({ enabled: true }), paused = task({ id: 'd1e15b47-f546-4146-a775-cf75bb9bdca3' });
    const ended = task({ id: '3012726e-109a-4760-8a7a-de4a0d8dd6df', schedule: { kind: 'once', at: now } });
    const tasks = [paused, ended, active], before = structuredClone(tasks);
    expect(filterAutomations(tasks, 'all', '', now)).toEqual(tasks);
    expect(filterAutomations(tasks, 'all', '  RESEARCH  ', now)).toEqual(tasks);
    expect(filterAutomations(tasks, 'all', '每日', now)).toEqual(tasks);
    expect(filterAutomations(tasks, 'active', '  RELEASE NOTES  ', now)).toEqual([active]);
    expect(filterAutomations(tasks, 'paused', '', now)).toEqual([paused]);
    expect(filterAutomations(tasks, 'completed', '', now)).toEqual([ended]);
    expect(filterAutomations(tasks, 'all', 'missing', now)).toEqual([]);
    expect(filterAutomations([], 'all', '', now)).toEqual([]);
    expect(filterAutomations(tasks, 'active', '', now)[0]).toBe(active);
    expect(tasks).toEqual(before);
  });

  it('rechecks the current clock when the filter changes instead of storing a stale completed flag', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(now - 1);
      const once = task({ schedule: { kind: 'once', at: now } });
      expect(automationPlanStatus(once)).toBe('paused');
      expect(filterAutomations([once], 'completed', '')).toEqual([]);
      vi.setSystemTime(now);
      expect(automationPlanStatus(once)).toBe('completed');
      expect(filterAutomations([once], 'completed', '')).toEqual([once]);
    } finally { vi.useRealTimers(); }
  });
});
