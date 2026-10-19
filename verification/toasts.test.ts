import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendToast, ToastLifetime, visibleToastLimit } from '../workbench/lib/toasts';

describe('notification queue', () => {
  it('retains distinct messages in arrival order beyond the visible limit', () => {
    const messages = Array.from({ length: 5 }, (_, id) => ({ id, message: `Message ${id}` }));
    const queue = messages.reduce(appendToast, []);
    expect(queue).toEqual(messages);
    expect(queue.slice(0, visibleToastLimit).map(item => item.id)).toEqual([0, 1, 2]);
    expect(queue.filter(item => item.id !== 0).slice(0, visibleToastLimit).map(item => item.id)).toEqual([1, 2, 3]);
  });
  it('refreshes an exact duplicate without moving it or mutating the previous queue', () => {
    const before = [{ id: 1, message: 'First\n中文' }, { id: 2, message: 'Second' }];
    expect(appendToast(before, { id: 3, message: 'First\n中文' })).toEqual([{ id: 3, message: 'First\n中文' }, before[1]]);
    expect(before[0].id).toBe(1);
    expect(appendToast(before, { id: 4, message: 'First' })).toHaveLength(3);
  });
});

describe('notification lifetime', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
  afterEach(() => vi.useRealTimers());
  it('starts only when visible and expires once after five seconds', () => {
    const close = vi.fn(), timer = new ToastLifetime(close);
    vi.advanceTimersByTime(10_000); expect(close).not.toHaveBeenCalled();
    timer.resume(); vi.advanceTimersByTime(4_999); expect(close).not.toHaveBeenCalled();
    timer.resume(); vi.advanceTimersByTime(1); expect(close).toHaveBeenCalledTimes(1);
    timer.resume(); timer.pause(); vi.advanceTimersByTime(10_000); expect(close).toHaveBeenCalledTimes(1);
  });
  it('preserves the remaining time through repeated pause and resume cycles', () => {
    const close = vi.fn(), timer = new ToastLifetime(close);
    timer.pause(); timer.resume(); vi.advanceTimersByTime(2_000); timer.pause(); timer.pause();
    vi.advanceTimersByTime(20_000); expect(close).not.toHaveBeenCalled();
    timer.resume(); vi.advanceTimersByTime(1_000); timer.pause(); vi.advanceTimersByTime(20_000);
    timer.resume(); vi.advanceTimersByTime(1_999); expect(close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(close).toHaveBeenCalledTimes(1);
  });
  it('cancels disposed timers permanently, including timers that never started', () => {
    const close = vi.fn();
    for (const started of [false, true]) {
      const timer = new ToastLifetime(close); if (started) timer.resume();
      timer.dispose(); timer.dispose(); timer.resume();
    }
    vi.advanceTimersByTime(20_000); expect(close).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
