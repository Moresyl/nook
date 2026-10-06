import { describe, expect, it, vi } from 'vitest';
import { observeDesktopProcesses } from '../scripts/desktop-process-observation.mjs';

describe('scoped desktop process observation', () => {
  it.each([[], [0], [-1], [1.5], [0x100000000], [1, 1], Array.from({ length: 17 }, (_, index) => index + 1), '12'])('rejects invalid PID scope before invoking the OS (%j)', async pids => {
    const execute = vi.fn();
    await expect(observeDesktopProcesses(pids, execute)).rejects.toThrow('bounded, unique');
    expect(execute).not.toHaveBeenCalled();
  });

  it('observes exact owned PIDs with a bounded hidden subprocess and strips private extra fields', async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: JSON.stringify([{ pid: 12, cpuMilliseconds: 45, workingSetBytes: 1000, commandLine: 'PRIVATE', threads: [{ id: 8, state: 'Wait', reason: 'Executive', private: 'PRIVATE' }] }, { pid: 13, exited: true }, { pid: 14, unavailable: true }]) });
    expect(await observeDesktopProcesses([12, 13, 14], execute)).toEqual([{ pid: 12, cpuMilliseconds: 45, workingSetBytes: 1000, threads: [{ id: 8, state: 'Wait', reason: 'Executive' }] }, { pid: 13, exited: true }, { pid: 14, unavailable: true }]);
    const [program, args, options] = execute.mock.calls[0];
    expect(program).toBe('powershell.exe');
    expect(args[3]).toContain('@(12,13,14)');
    expect(args[3]).not.toMatch(/CimInstance|CommandLine|ExecutablePath/);
    expect(options).toEqual({ windowsHide: true, timeout: 2000, maxBuffer: 65_536 });
  });

  it.each(['PRIVATE malformed output', '{}', '[{"pid":99,"exited":true}]', '[{"pid":12,"cpuMilliseconds":-1,"workingSetBytes":1,"threads":[]}]', '[{"pid":12,"cpuMilliseconds":1,"workingSetBytes":1,"threads":[{"id":0,"state":"Wait","reason":"Executive"}]}]'])('rejects malformed or unrelated output without exposing it', async stdout => {
    await expect(observeDesktopProcesses([12], vi.fn().mockResolvedValue({ stdout }))).rejects.toThrow(/^Desktop process observation unavailable\.$/);
  });

  it('sanitizes OS errors', async () => {
    await expect(observeDesktopProcesses([12], vi.fn().mockRejectedValue(new Error('PRIVATE native failure')))).rejects.toThrow(/^Desktop process observation unavailable\.$/);
  });
});
