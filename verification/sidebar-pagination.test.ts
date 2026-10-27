import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeSidebarPage } from '../workbench/lib/sidebar-pagination';

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  let notify: IntersectionObserverCallback = () => {};
  const disconnect = vi.fn(), observe = vi.fn(), load = vi.fn();
  const document = Object.assign(new EventTarget(), { hidden: false, activeElement: null as unknown });
  const target = { isConnected: true, ownerDocument: document, closest: vi.fn(() => null as unknown), contains: vi.fn(() => false) } as unknown as HTMLElement;
  vi.stubGlobal('IntersectionObserver', class {
    disconnect = disconnect;
    observe = observe;
    constructor(callback: IntersectionObserverCallback) { notify = callback; }
  });
  const dispose = observeSidebarPage(target, load);
  const intersect = (isIntersecting = true, element = target) => notify([{ target: element, isIntersecting } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
  return { target, document, dispose, intersect, load, observe, disconnect };
}

describe('sidebar automatic pagination', () => {
  it('observes the boundary and loads a single page without moving focus', () => {
    const test = fixture();
    expect(test.observe).toHaveBeenCalledWith(test.target);
    test.intersect(false);
    expect(test.load).not.toHaveBeenCalled();
    test.intersect(); test.intersect();
    expect(test.load).toHaveBeenCalledTimes(1);
    expect(test.disconnect).toHaveBeenCalledTimes(1);
    expect(test.document.activeElement).toBeNull();
  });
  it('ignores queued notifications after cleanup', () => {
    const test = fixture(); test.dispose(); test.intersect();
    expect(test.load).not.toHaveBeenCalled();
    expect(test.disconnect).toHaveBeenCalledTimes(1);
  });
  it('ignores entries from a different boundary', () => {
    const test = fixture(); test.intersect(true, {} as HTMLElement);
    expect(test.load).not.toHaveBeenCalled();
    test.intersect(); expect(test.load).toHaveBeenCalledTimes(1);
  });
  it('ignores a boundary removed before the callback', () => {
    const test = fixture(); Object.assign(test.target, { isConnected: false }); test.intersect();
    expect(test.load).not.toHaveBeenCalled();
  });
  it('does not expand a hidden window', () => {
    const test = fixture(); test.document.hidden = true; test.intersect();
    expect(test.load).not.toHaveBeenCalled();
    test.document.hidden = false; test.intersect(); expect(test.load).toHaveBeenCalledTimes(1);
  });
  it('reobserves a restored window and removes its visibility listener after loading or cleanup', () => {
    const test = fixture(); test.document.hidden = true;
    test.document.dispatchEvent(new Event('visibilitychange'));
    expect(test.observe).toHaveBeenCalledTimes(1);
    test.document.hidden = false; test.document.dispatchEvent(new Event('visibilitychange'));
    expect(test.observe).toHaveBeenCalledTimes(2);
    test.intersect(); test.document.dispatchEvent(new Event('visibilitychange'));
    expect(test.observe).toHaveBeenCalledTimes(2);
    expect(test.load).toHaveBeenCalledTimes(1);
    const disposed = fixture(); disposed.dispose(); disposed.document.dispatchEvent(new Event('visibilitychange')); disposed.intersect();
    expect(disposed.observe).toHaveBeenCalledTimes(1); expect(disposed.load).not.toHaveBeenCalled();
  });
  it('does not expand a collapsed or hidden section', () => {
    const test = fixture(); vi.mocked(test.target.closest).mockReturnValue({} as HTMLElement); test.intersect();
    expect(test.load).not.toHaveBeenCalled();
    vi.mocked(test.target.closest).mockReturnValue(null); test.intersect(); expect(test.load).toHaveBeenCalledTimes(1);
  });
  it('leaves a focused manual pagination button available for keyboard activation', () => {
    const test = fixture(); vi.mocked(test.target.contains).mockReturnValue(true); test.intersect();
    expect(test.load).not.toHaveBeenCalled();
    vi.mocked(test.target.contains).mockReturnValue(false); test.intersect(); expect(test.load).toHaveBeenCalledTimes(1);
  });
  it('preserves manual pagination when the observer API is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const load = vi.fn(); const dispose = observeSidebarPage({} as HTMLElement, load);
    expect(() => dispose()).not.toThrow(); expect(load).not.toHaveBeenCalled();
  });
});
