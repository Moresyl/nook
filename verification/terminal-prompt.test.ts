import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitForTerminalPrompt } from '../scripts/terminal-prompt.mjs';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => { vi.useRealTimers(); });

describe('cold PowerShell prompt readiness', () => {
  it('waits through control output and requires a running shell with its actual prompt', async () => {
    let output = '\x1b[?9001h';
    const read = vi.fn(async () => [{ id: 'owned', status: 'running', output }]);
    const ready = waitForTerminalPrompt(read); await vi.advanceTimersByTimeAsync(100);
    output = 'PS C:\\fixture> '; await vi.advanceTimersByTimeAsync(100);
    await expect(ready).resolves.toEqual({ id: 'owned', elapsedMs: 200, timeoutMs: 30000 }); expect(vi.getTimerCount()).toBe(0);
  });
  it('allows an observed cold start beyond the ordinary command-response budget', async () => {
    const ready = waitForTerminalPrompt(async () => [{ id: 'owned', status: 'running', output: Date.now() >= 14900 ? 'PS C:\\fixture> ' : '' }]);
    await vi.advanceTimersByTimeAsync(14900); await expect(ready).resolves.toMatchObject({ elapsedMs: 14900, timeoutMs: 30000 });
  });
  it('rejects a silent shell at the bounded cold-start deadline', async () => {
    const outcome = waitForTerminalPrompt(async () => [{ id: 'owned', status: 'running', output: 'PRIVATE_FIXTURE' }]).catch(error => error);
    await vi.advanceTimersByTimeAsync(30000); expect((await outcome).message).toBe('Terminal prompt did not become ready within 30000 ms.'); expect(vi.getTimerCount()).toBe(0);
  });
  it('does not accept a retained prompt from an exited session or a missing new session', async () => {
    const read = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([{ id: 'old', status: 'exited', output: 'PS C:\\fixture> ' }]);
    const outcome = waitForTerminalPrompt(read, { timeoutMs: 200 }).catch(error => error);
    await vi.advanceTimersByTimeAsync(200); expect((await outcome).message).toContain('within 200 ms'); expect(read).toHaveBeenCalledTimes(2);
  });
  it('preserves an IPC failure and leaves no pending polling timer', async () => {
    const failure = new Error('Owned bridge failed'); await expect(waitForTerminalPrompt(async () => { throw failure; })).rejects.toBe(failure); expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds an unresponsive IPC read without waiting for it to resolve', async () => {
    const outcome = waitForTerminalPrompt(() => new Promise(() => {}), { timeoutMs: 300 }).catch(error => error);
    await vi.advanceTimersByTimeAsync(300); expect((await outcome).message).toBe('Terminal prompt did not become ready within 300 ms.'); expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects a prompt returned only after a synchronous read consumed the budget', async () => {
    await expect(waitForTerminalPrompt(async () => { vi.setSystemTime(300); return [{ id: 'late', status: 'running', output: 'PS C:\\fixture> ' }]; }, { timeoutMs: 300 })).rejects.toThrow('within 300 ms');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects invalid budgets before reading a session', async () => {
    const read = vi.fn();
    for (const timeoutMs of [0, -1, Number.NaN, Infinity]) await expect(waitForTerminalPrompt(read, { timeoutMs })).rejects.toThrow('positive timeout');
    expect(read).not.toHaveBeenCalled();
  });
});
