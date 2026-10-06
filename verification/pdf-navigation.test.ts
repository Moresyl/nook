import { describe, expect, it, vi } from 'vitest';
import { pdfOutlineEntries, resolvePdfDestination } from '../workbench/components/pdf-navigation';

describe('PDF outline navigation', () => {
  it('preserves nested order, plain titles and internal destinations without activating external actions', () => {
    const raw = [{ title: '<script>plain title</script>', dest: [0, { name: 'Fit' }], items: [{ title: 'Child', dest: 'chapter' }] }, { title: '', url: 'https://example.com' }];
    expect(pdfOutlineEntries(raw)).toEqual([
      { title: '<script>plain title</script>', depth: 0, destination: raw[0].dest }, { title: 'Child', depth: 1, destination: 'chapter' }, { title: '未命名章节', depth: 0, destination: undefined },
    ]);
    expect(pdfOutlineEntries(null)).toEqual([]);
    expect(pdfOutlineEntries([{ title: 'x'.repeat(600) }])[0].title).toHaveLength(512);
  });
  it('rejects malformed, cyclic and oversized outlines before unbounded traversal', () => {
    const cyclic = { title: 'Cycle', items: [] as unknown[] }; cyclic.items.push(cyclic);
    for (const raw of [{}, [null], [cyclic], [{ items: {} }], Array.from({ length: 10001 }, () => ({})), [{ items: Array.from({ length: 10000 }, () => ({})) }]]) expect(() => pdfOutlineEntries(raw)).toThrow();
  });
  it('resolves named and explicit destinations with exact page identity and coordinates', async () => {
    const document = { numPages: 3, getDestination: vi.fn(async () => [{ num: 10, gen: 0 }, { name: 'XYZ' }, 12, 345, null]), getPageIndex: vi.fn(async () => 1) };
    expect(await resolvePdfDestination(document, 'chapter')).toEqual({ page: 2, x: 12, y: 345 });
    expect(document.getPageIndex).toHaveBeenCalledWith({ num: 10, gen: 0 }); expect(document.getDestination).toHaveBeenCalledWith('chapter');
    expect(await resolvePdfDestination(document, [0, { name: 'FitH' }, 500])).toEqual({ page: 1, y: 500 });
    expect(await resolvePdfDestination(document, [2, { name: 'FitV' }, 25])).toEqual({ page: 3, x: 25 });
    expect(await resolvePdfDestination(document, [0, { name: 'Fit' }])).toEqual({ page: 1 });
    expect(await resolvePdfDestination(document, [0, { name: 'XYZ' }, Infinity, 'bad'])).toEqual({ page: 1, x: undefined, y: undefined });
  });
  it('rejects invalid targets, missing named destinations and out-of-range resolved pages', async () => {
    const document = { numPages: 2, getDestination: vi.fn(async () => null), getPageIndex: vi.fn(async () => 2) };
    for (const raw of ['absent', null, [], [-1, { name: 'Fit' }], [2, { name: 'Fit' }], [{ num: -1, gen: 0 }, {}], [{ num: 1, gen: 0 }, {}]]) await expect(resolvePdfDestination(document, raw)).rejects.toThrow();
  });
});
