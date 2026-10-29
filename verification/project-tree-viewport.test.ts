import type { Locator, Page } from 'playwright';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectProjectTreeRows, projectTreeItem, scrollProjectTreeItem } from '../scripts/project-tree-viewport.mjs';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function viewport(total = 9, initial = 56) {
  let top = initial;
  const element = {
    clientHeight: 56,
    scrollHeight: total * 28,
    get scrollTop() { return top; },
    set scrollTop(value: number) { top = Math.max(0, Math.min(value, Math.max(0, total * 28 - this.clientHeight))); },
    querySelectorAll: vi.fn(() => Array.from({ length: Math.min(3, total - Math.floor(top / 28)) }, (_, offset) => {
      const index = Math.floor(top / 28) + offset;
      return { getAttribute: (name: string) => name === 'aria-label' ? `file-${index}` : index === 0 ? 'true' : null };
    })),
  };
  const evaluate = vi.fn(async (callback: (node: typeof element, value?: unknown) => unknown, value?: unknown) => callback(element, value));
  const tree = {
    evaluate,
    getByRole: vi.fn((_role: string, options?: { name: string }) => ({
      count: vi.fn(async () => element.querySelectorAll().filter(row => row.getAttribute('aria-label') === options?.name).length),
      waitFor: vi.fn(async () => { throw new Error('TARGET_NOT_REACHABLE'); }),
    })),
  } as unknown as Locator;
  const page = { evaluate: vi.fn(async (callback: () => unknown) => callback()) } as unknown as Page;
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { callback(); return 1; });
  return { element, evaluate, page, tree };
}

describe('native tree viewport verification', () => {
  it('collects every row with overlap, retains expansion metadata and restores the original scroll', async () => {
    const { page, tree, element } = viewport();
    const rows = await collectProjectTreeRows(page, tree);
    expect(rows).toEqual(Array.from({ length: 9 }, (_, index) => [`file-${index}`, index === 0 ? 'true' : null]));
    expect(element.scrollTop).toBe(56);
  });

  it('accepts an empty tree and restores the prior scroll after a DOM read failure', async () => {
    const empty = viewport(0, 0); expect(await collectProjectTreeRows(empty.page, empty.tree)).toEqual([]);
    const fixture = viewport(); fixture.element.querySelectorAll.mockImplementationOnce(() => { throw new Error('READ_FAILURE'); });
    await expect(collectProjectTreeRows(fixture.page, fixture.tree)).rejects.toThrow('READ_FAILURE');
    expect(fixture.element.scrollTop).toBe(56);
  });

  it('rejects excessive mounted rows without losing the original scroll', async () => {
    const { page, tree, element } = viewport(100);
    element.querySelectorAll.mockReturnValue(Array.from({ length: 43 }, (_, index) => ({ getAttribute: () => `unexpected-${index}` })));
    await expect(collectProjectTreeRows(page, tree)).rejects.toThrow('Mounted tree rows must remain bounded: 43');
    expect(element.scrollTop).toBe(56);
  });

  it('rejects processing beyond the frame-adjusted deadline and restores scroll', async () => {
    const { page, tree, element } = viewport(); let time = 0, frames = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => time);
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { if (++frames > 2) time = 6000; callback(); return 1; });
    await expect(collectProjectTreeRows(page, tree)).rejects.toThrow('Scrolling the loaded tree exceeded the operation deadline');
    expect(element.scrollTop).toBe(56);
  });

  it('collects a narrow 207-row tree at 30 Hz beyond five seconds without losing rows or scroll', async () => {
    const { page, tree, element } = viewport(207); let time = 0;
    element.clientHeight = 95;
    element.querySelectorAll.mockImplementation(() => Array.from({ length: Math.min(5, 207 - Math.floor(element.scrollTop / 28)) }, (_, offset) => {
      const index = Math.floor(element.scrollTop / 28) + offset;
      return { getAttribute: (name: string) => name === 'aria-label' ? `file-${index}` : index === 0 ? 'true' : null };
    }));
    vi.spyOn(Date, 'now').mockImplementation(() => time);
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { time += 1000 / 30; callback(); return 1; });
    const rows = await collectProjectTreeRows(page, tree);
    expect(rows).toEqual(Array.from({ length: 207 }, (_, index) => [`file-${index}`, index === 0 ? 'true' : null]).sort(([left], [right]) => left!.localeCompare(right!)));
    expect(time).toBeGreaterThan(5000);
    expect(time).toBeLessThan(11000);
    expect(element.scrollTop).toBe(56);
  });

  it('rejects a viewport that keeps growing beyond its initial extent and restores scroll', async () => {
    const { page, tree, element } = viewport(); let top = 56;
    Object.defineProperty(element, 'scrollTop', { get: () => top, set: (value: number) => { top = value; } });
    element.querySelectorAll.mockReturnValue([{ getAttribute: () => 'moving-row' }]);
    await expect(collectProjectTreeRows(page, tree)).rejects.toThrow('Scrolling the loaded tree exceeded the initial viewport bound');
    expect(element.scrollTop).toBe(56);
  });

  it('scrolls virtual targets into existence and reports targets absent from the loaded tree', async () => {
    const { page, tree, element } = viewport();
    await scrollProjectTreeItem(page, tree, 'file-8'); expect(element.scrollTop).toBe(168);
    await expect(scrollProjectTreeItem(page, tree, 'missing')).rejects.toThrow('TARGET_NOT_REACHABLE');
  });

  it('keeps locator actions and child locators bound while revealing their virtual row', async () => {
    const fixture = viewport(), click = vi.fn(), focus = vi.fn(), text = vi.fn();
    const child = { click, textContent: text }, target = { focus, getByText: vi.fn(() => child) };
    vi.mocked(fixture.tree.getByRole).mockReturnValue({
      ...target,
      count: async () => fixture.element.querySelectorAll().filter(row => row.getAttribute('aria-label') === 'file-8').length,
      waitFor: vi.fn(),
    } as unknown as Locator);
    const item = projectTreeItem(() => fixture.page, () => fixture.tree, 'file-8');
    await item.focus({ timeout: 100 }); expect(focus).toHaveBeenCalledWith({ timeout: 100 });
    await item.getByText('label').click(); expect(click).toHaveBeenCalledOnce();
    await item.getByText('label').textContent(); expect(text).toHaveBeenCalledOnce();
    expect(fixture.element.scrollTop).toBe(168);
  });
});
