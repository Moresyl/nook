import { describe, expect, it, vi } from 'vitest';
import { StartupDiagnostics } from '../desktop/services/startup-diagnostics';

const memory = { rss: 100, heapTotal: 90, heapUsed: 80, external: 70, arrayBuffers: 60 };
const cpu = { user: 20, system: 10 };

describe('isolated startup diagnostics', () => {
  it('does not sample resources or expose a snapshot when disabled', () => {
    const now = vi.fn(); const memorySample = vi.fn(); const cpuSample = vi.fn();
    const diagnostics = new StartupDiagnostics(false, now, memorySample, cpuSample);
    diagnostics.phase('workspace.read'); expect(diagnostics.snapshot()).toBeUndefined();
    expect(now).not.toHaveBeenCalled(); expect(memorySample).not.toHaveBeenCalled(); expect(cpuSample).not.toHaveBeenCalled();
  });
  it('retains ordered actual phase samples without sharing mutable snapshots', () => {
    let time = 1; const diagnostics = new StartupDiagnostics(true, () => time++, () => ({ ...memory }), () => ({ ...cpu }));
    diagnostics.phase('workspace.read'); diagnostics.phase('workspace.parsed');
    expect(diagnostics.snapshot()).toEqual({ events: [{ phase: 'workspace.read', at: 1, memory, cpu }, { phase: 'workspace.parsed', at: 2, memory, cpu }] });
    const snapshot = diagnostics.snapshot()!; snapshot.events[0].memory.rss = 999; snapshot.events.pop();
    expect(diagnostics.snapshot()!.events).toHaveLength(2); expect(diagnostics.snapshot()!.events[0].memory.rss).toBe(100);
  });
  it('bounds retained phase history and supports the actual process samplers', () => {
    const diagnostics = new StartupDiagnostics(true);
    for (let index = 0; index < 35; index++) diagnostics.phase(`phase-${index}`);
    const events = diagnostics.snapshot()!.events; expect(events).toHaveLength(32); expect(events[0].phase).toBe('phase-3'); expect(events.at(-1)!.phase).toBe('phase-34');
    expect(events[0].at).toBeGreaterThan(0); expect(events[0].memory.rss).toBeGreaterThan(0); expect(events[0].cpu.user).toBeGreaterThanOrEqual(0);
  });
});
