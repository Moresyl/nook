import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitForDesktopPage } from '../scripts/desktop-page.mjs';

const page = (url = 'qiyao://app/index.html', closed = false) => ({ url: () => url, isClosed: () => closed });
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('owned desktop page discovery', () => {
  it('chooses the exact existing application and excludes plugin, blank and external pages', async () => {
    const app = page(); const other = [page('qiyao-plugin://fixture/index.html'), page('about:blank'), page('https://qiyao.example/app/')];
    await expect(waitForDesktopPage({ pages: () => [...other, app] })).resolves.toBe(app); expect(vi.getTimerCount()).toBe(0);
  });
  it('discovers a page whose one-shot creation event was emitted before a subscriber could be attached', async () => {
    const events = new EventEmitter(); const app = page(); const pages: ReturnType<typeof page>[] = []; const observed = vi.fn();
    const pending = waitForDesktopPage({ pages: () => [...pages] }); pages.push(app); events.emit('page', app); events.on('page', observed);
    await vi.advanceTimersByTimeAsync(100); await expect(pending).resolves.toBe(app); expect(observed).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('waits for an existing blank target to navigate without requiring another page creation event', async () => {
    let url = 'about:blank'; const app = { url: () => url, isClosed: () => false }; const pending = waitForDesktopPage({ pages: () => [app] });
    await vi.advanceTimersByTimeAsync(100); url = 'qiyao://app/index.html'; await vi.advanceTimersByTimeAsync(100); await expect(pending).resolves.toBe(app);
  });
  it('ignores a closed application page and follows its live replacement', async () => {
    const pages = [page('qiyao://app/index.html', true)]; const replacement = page(); const pending = waitForDesktopPage({ pages: () => pages });
    pages.push(replacement); await vi.advanceTimersByTimeAsync(100); await expect(pending).resolves.toBe(replacement);
  });
  it('rejects an owned process exit during discovery even if its previous target remains listed', async () => {
    let exited = false; const pages: ReturnType<typeof page>[] = []; const outcome = waitForDesktopPage({ pages: () => pages }, { hasExited: () => exited }).catch((error) => error);
    exited = true; pages.push(page()); await vi.advanceTimersByTimeAsync(100); expect((await outcome).message).toBe('Desktop exited before its application page became ready.'); expect(vi.getTimerCount()).toBe(0);
  });
  it('retains the full original 30-second deadline without leaking URL or workspace data into the timeout', async () => {
    const outcome = waitForDesktopPage({ pages: () => [page('https://private.example/SECRET')] }).catch((error) => error);
    await vi.advanceTimersByTimeAsync(29_900); expect(vi.getTimerCount()).toBe(1); await vi.advanceTimersByTimeAsync(100);
    expect((await outcome).message).toBe('Desktop page discovery timed out after 30000 ms.'); expect(vi.getTimerCount()).toBe(0);
  });
  it('validates deadlines and honors a shorter explicit deadline', async () => {
    for (const timeoutMs of [0, -1, Number.NaN, Infinity]) await expect(waitForDesktopPage({ pages: () => [] }, { timeoutMs })).rejects.toThrow('positive timeout');
    const outcome = waitForDesktopPage({ pages: () => [] }, { timeoutMs: 100 }).catch((error) => error); await vi.advanceTimersByTimeAsync(100); expect((await outcome).message).toBe('Desktop page discovery timed out after 100 ms.');
  });
});
