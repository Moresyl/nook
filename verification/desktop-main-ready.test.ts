import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mainProcessReadyExpression } from '../scripts/desktop-main-ready.mjs';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const ready = { app: { commandLine: { hasSwitch: () => true } } };

describe('owned Electron main-process readiness', () => {
  it('accepts initialized native exports immediately without a polling timer', async () => {
    const require = vi.fn(() => ready);
    await expect(runInNewContext(mainProcessReadyExpression, { require, Date, setTimeout })).resolves.toBe(true);
    expect(require).toHaveBeenCalledExactlyOnceWith('electron'); expect(vi.getTimerCount()).toBe(0);
  });
  it('waits through the package path and incomplete exports during bootstrap before checking native switches', async () => {
    let exported: unknown = 'C:/PRIVATE/electron.exe'; const require = vi.fn(() => exported);
    const pending = runInNewContext(mainProcessReadyExpression, { require, Date, setTimeout });
    exported = { app: {} }; await vi.advanceTimersByTimeAsync(100); expect(vi.getTimerCount()).toBe(1);
    exported = ready; await vi.advanceTimersByTimeAsync(100); await expect(pending).resolves.toBe(true);
    expect(require).toHaveBeenCalledTimes(3); expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects unavailable native exports at the original five-second operation deadline without leaking paths', async () => {
    const outcome = runInNewContext(mainProcessReadyExpression, { require: () => 'C:/PRIVATE/electron.exe', Date, setTimeout }).catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(4900); expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(100);
    expect((await outcome).message).toBe('Electron main-process exports did not become ready within 5000 ms.');
    expect(vi.getTimerCount()).toBe(0);
  });
});
