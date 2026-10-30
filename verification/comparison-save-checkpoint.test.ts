import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { comparisonSaveCheckpointTimeoutMs, waitForComparisonSaveCheckpoint } from '../scripts/comparison-save-checkpoint.mjs';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('durable comparison save checkpoint', () => {
  it('accepts an entered rename without waiting or leaving a timer', async () => {
    const readEntered = vi.fn(async () => true);
    await expect(waitForComparisonSaveCheckpoint(readEntered)).resolves.toEqual({ elapsedMs: 0, deadlineMs: 30_000 });
    expect(readEntered).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

  it('permits a real write to remain pending beyond five seconds before reaching the held rename', async () => {
    let entered = false;
    const pending = waitForComparisonSaveCheckpoint(async () => entered);
    await vi.advanceTimersByTimeAsync(8000); entered = true;
    await vi.advanceTimersByTimeAsync(25);
    await expect(pending).resolves.toEqual({ elapsedMs: 8025, deadlineMs: 30_000 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fails when a save never reaches the checkpoint at the bounded disk deadline', async () => {
    const outcome = waitForComparisonSaveCheckpoint(async () => false).catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(comparisonSaveCheckpointTimeoutMs);
    expect(await outcome).toMatchObject({ message: 'The actual comparison save did not reach the held rename within 30000 ms.' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects a late debugger response that crosses the deadline even when it reports entry', async () => {
    const outcome = waitForComparisonSaveCheckpoint(() => new Promise(resolve => setTimeout(() => resolve(true), comparisonSaveCheckpointTimeoutMs))).catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(comparisonSaveCheckpointTimeoutMs);
    expect(await outcome).toMatchObject({ message: 'The actual comparison save did not reach the held rename within 30000 ms.' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates a failed debugger operation without retrying or leaving a timer', async () => {
    const failure = new Error('Main-process test operation failed');
    const readEntered = vi.fn(async () => { throw failure; });
    await expect(waitForComparisonSaveCheckpoint(readEntered)).rejects.toBe(failure);
    expect(readEntered).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
});
