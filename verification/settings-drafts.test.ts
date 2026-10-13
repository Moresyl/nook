import { describe, expect, it } from 'vitest';
import { updateSettingsActivity, type SettingsDraftSource } from '../workbench/lib/settings-drafts';

describe('settings form activity', () => {
  it('keeps independent forms active until each is cleared', () => {
    const empty = new Set<SettingsDraftSource>();
    const model = updateSettingsActivity(empty, 'models', true);
    const both = updateSettingsActivity(model, 'worktrees', true);
    const remaining = updateSettingsActivity(both, 'models', false);
    expect([...remaining]).toEqual(['worktrees']);
    expect(updateSettingsActivity(remaining, 'worktrees', false).size).toBe(0);
    expect(empty.size).toBe(0); expect([...model]).toEqual(['models']);
    expect([...both]).toEqual(['models', 'worktrees']);
  });
  it('makes repeated registration and cleanup idempotent', () => {
    const empty = new Set<SettingsDraftSource>();
    expect(updateSettingsActivity(empty, 'desktop', false)).toBe(empty);
    const active = updateSettingsActivity(empty, 'desktop', true);
    expect(updateSettingsActivity(active, 'desktop', true)).toBe(active);
    expect([...updateSettingsActivity(active, 'desktop', false)]).toEqual([]);
  });
  it('handles every supported form without storing draft values', () => {
    const sources: SettingsDraftSource[] = ['models', 'desktop', 'worktrees', 'mcp', 'plugins', 'memories'];
    let active: ReadonlySet<SettingsDraftSource> = new Set();
    for (const source of sources) active = updateSettingsActivity(active, source, true);
    expect([...active]).toEqual(sources);
    for (const source of sources.slice().reverse()) active = updateSettingsActivity(active, source, false);
    expect(active.size).toBe(0);
  });
});
