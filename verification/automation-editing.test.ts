import { describe, expect, it, vi } from 'vitest';
import { automationEditDraft, automationPlanAction } from '../contracts/automation-editing';
import { automationInputSchema, automationSchema } from '../contracts/automations';

const now = Date.UTC(2026, 9, 30, 8);
const task = () => automationSchema.parse({
  id: '7f74405b-3ef2-48ed-bf26-df91674e423e', name: 'Research', prompt: 'Keep the complete instructions',
  providerId: 'provider', model: 'model', mode: 'chat', enabled: false, notify: true, timeoutMinutes: 12,
  schedule: { kind: 'once', at: now - 1000 }, createdAt: 1, updatedAt: 2,
  runs: [{ id: '6d12ae86-de1c-487b-843f-1ba457876489', startedAt: now - 1000, finishedAt: now - 500, trigger: 'scheduled', status: 'complete', threadId: 'previous-result' }],
});

describe('automation plan editing', () => {
  it('offers a new time at the exact expiration boundary and preserves active and recurring plan actions', () => {
    const once = task();
    expect(automationPlanAction(once, once.schedule.kind === 'once' ? once.schedule.at - 1 : 0)).toBe('resume');
    expect(automationPlanAction(once, now - 1000)).toBe('reschedule');
    expect(automationPlanAction(once, now)).toBe('reschedule');
    expect(automationPlanAction({ ...once, enabled: true }, now)).toBe('pause');
    expect(automationPlanAction({ ...once, schedule: { kind: 'interval', minutes: 60 } }, now)).toBe('resume');
    expect(automationPlanAction({ ...once, schedule: { kind: 'cron', expression: '0 9 * * *', timezone: 'UTC' } }, now)).toBe('resume');
  });

  it('creates a valid future draft with the same identity and options without changing saved history', () => {
    const original = task(), before = structuredClone(original);
    const draft = automationEditDraft(original, 'reschedule', now);
    expect(automationInputSchema.parse(draft)).toEqual(draft);
    expect(draft).toMatchObject({ id: original.id, name: original.name, prompt: original.prompt, providerId: original.providerId, model: original.model, notify: true, timeoutMinutes: 12, enabled: true, schedule: { kind: 'once', at: now + 300_000 } });
    expect(draft).not.toHaveProperty('runs');
    expect(draft).not.toHaveProperty('createdAt');
    expect(draft).not.toHaveProperty('updatedAt');
    expect(draft).not.toHaveProperty('nextRunAt');
    expect(original).toEqual(before);
  });

  it('normal editing preserves a paused plan and strips persisted execution metadata', () => {
    const original = { ...task(), nextRunAt: now + 1000 };
    const draft = automationEditDraft(original);
    expect(draft.enabled).toBe(false);
    expect(draft.schedule).toEqual(original.schedule);
    expect(automationInputSchema.parse(draft)).toEqual(draft);
  });

  it('never converts an interval or cron plan into a one-shot schedule', () => {
    for (const schedule of [{ kind: 'interval', minutes: 60 }, { kind: 'cron', expression: '0 9 * * *', timezone: 'UTC' }] as const) {
      const original = { ...task(), schedule };
      expect(automationEditDraft(original, 'reschedule', now)).toMatchObject({ schedule, enabled: false });
    }
  });

  it('uses the current clock when preparing an expired plan from an old rendered row', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(now);
      const original = { ...task(), schedule: { kind: 'once' as const, at: now + 1000 } };
      expect(automationPlanAction(original)).toBe('resume');
      vi.setSystemTime(now + 1000);
      expect(automationPlanAction(original)).toBe('reschedule');
      expect(automationEditDraft(original, 'reschedule').schedule).toEqual({ kind: 'once', at: now + 301_000 });
    } finally { vi.useRealTimers(); }
  });
});
