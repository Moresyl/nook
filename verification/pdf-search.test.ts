import { describe, expect, it, vi } from 'vitest';
import { chatTextMatches } from '../contracts/chat-navigation';
import { searchPdf } from '../workbench/components/pdf-search';

const document = (pages: unknown[][]) => ({ numPages: pages.length, getPage: vi.fn(async (page: number) => ({ getTextContent: async () => ({ items: pages[page - 1] }) })) });
describe('PDF document search', () => {
  it('maps case-insensitive literal matches across text items and pages to exact UTF-16 offsets', async () => {
    const source = document([[{ type: 'beginMarkedContent' }, { str: '😀Bud' }, { str: 'get [42]' }], [{ str: 'BUDGET' }]]);
    const result = await searchPdf(source, 'budget', new AbortController().signal);
    expect(result).toEqual({ limited: false, matches: [
      { page: 1, from: { index: 0, offset: 2 }, to: { index: 1, offset: 3 } },
      { page: 2, from: { index: 0, offset: 0 }, to: { index: 0, offset: 6 } },
    ] });
    expect((await searchPdf(source, '[42]', new AbortController().signal)).matches[0]).toEqual({ page: 1, from: { index: 1, offset: 4 }, to: { index: 1, offset: 8 } });
  });
  it('keeps empty text-item indices and line breaks stable and ignores non-text marks', async () => {
    const source = document([[null, { str: '' }, { str: '中文', hasEOL: true }, { str: '资料' }]]);
    expect((await searchPdf(source, '中文\n资料', new AbortController().signal)).matches).toEqual([{ page: 1, from: { index: 1, offset: 0 }, to: { index: 2, offset: 2 } }]);
    expect((await searchPdf(source, '中文资料', new AbortController().signal)).matches).toEqual([]);
  });
  it('cancels an in-flight page read before text extraction, progress reporting or later pages', async () => {
    const controller = new AbortController(), progress = vi.fn(), getTextContent = vi.fn(async () => ({ items: [{ str: 'match' }] }));
    const source = { numPages: 3, getPage: vi.fn(async () => { controller.abort(); return { getTextContent }; }) };
    await expect(searchPdf(source, 'match', controller.signal, progress)).rejects.toThrow();
    expect(source.getPage).toHaveBeenCalledOnce(); expect(getTextContent).not.toHaveBeenCalled(); expect(progress).not.toHaveBeenCalled();
  });
  it('reports result truncation explicitly and enforces text and query limits', async () => {
    const signal = new AbortController().signal;
    const result = await searchPdf(document([[{ str: 'x'.repeat(10001) }]]), 'x', signal);
    expect(result.matches).toHaveLength(10000); expect(result.limited).toBe(true);
    await expect(searchPdf(document([[{ str: 'a'.repeat(1_000_001) }]]), 'a', signal)).rejects.toThrow('容量');
    await expect(searchPdf(document([]), 'a'.repeat(513), signal)).rejects.toThrow('512');
    await expect(searchPdf(document([Array.from({ length: 100001 }, () => ({ str: '' }))]), 'x', signal)).rejects.toThrow('过多');
    expect((await searchPdf(document([[{ str: 'x'.repeat(10000) }]]), 'x', signal)).limited).toBe(false);
    await expect(searchPdf(document(Array.from({ length: 17 }, () => [{ str: 'a'.repeat(950_000) }])), 'z', signal)).rejects.toThrow('容量');
  });
  it('discards a text extraction completed after cancellation without reporting matches or progress', async () => {
    const controller = new AbortController(), progress = vi.fn();
    const source = { numPages: 2, getPage: vi.fn(async () => ({ getTextContent: async () => { controller.abort(); return { items: [{ str: 'late match' }] }; } })) };
    await expect(searchPdf(source, 'match', controller.signal, progress)).rejects.toThrow();
    expect(source.getPage).toHaveBeenCalledOnce(); expect(progress).not.toHaveBeenCalled();
    await expect(searchPdf(source, '', controller.signal)).rejects.toThrow();
  });
  it('does not scan empty queries, reports progress and preserves existing unlimited literal matching', async () => {
    const source = document([[{ str: 'Test' }], [{ str: 'Test' }]]), progress = vi.fn(), signal = new AbortController().signal;
    expect(await searchPdf(source, ' ', signal)).toEqual({ matches: [], limited: false }); expect(source.getPage).not.toHaveBeenCalled();
    await searchPdf(source, 'test', signal, progress); expect(progress.mock.calls).toEqual([[1], [2]]);
    expect(chatTextMatches('xxx', 'x')).toHaveLength(3); expect(chatTextMatches('xxx', 'x', 1)).toEqual([{ start: 0, end: 1 }]); expect(chatTextMatches('xxx', 'x', 0)).toEqual([]);
    expect(() => chatTextMatches('x', 'x', -1)).toThrow(); expect(() => chatTextMatches('x', 'x', .5)).toThrow();
  });
});
