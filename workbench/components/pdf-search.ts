import { chatTextMatches } from '../../contracts/chat-navigation';

type SearchDocument = { numPages: number; getPage(page: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }> };
export type PdfSearchMatch = { page: number; from: { index: number; offset: number }; to: { index: number; offset: number } };
export type PdfSearchResult = { matches: PdfSearchMatch[]; limited: boolean };

export async function searchPdf(document: SearchDocument, query: string, signal: AbortSignal, progress: (page: number) => void = () => {}): Promise<PdfSearchResult> {
  if (query.length > 512) throw new Error('搜索内容不能超过 512 个字符。');
  signal.throwIfAborted();
  const matches: PdfSearchMatch[] = []; let characters = 0;
  if (!query.trim()) return { matches, limited: false };
  for (let page = 1; page <= document.numPages; page++) {
    signal.throwIfAborted(); const selected = await document.getPage(page); signal.throwIfAborted();
    const content = await selected.getTextContent(); signal.throwIfAborted();
    if (content.items.length > 100_000) throw new Error('此页文字段落过多，无法完整搜索。');
    const parts: { index: number; start: number; end: number }[] = []; const strings: string[] = []; let length = 0;
    for (const item of content.items) {
      if (!item || typeof item !== 'object' || !('str' in item) || typeof item.str !== 'string') continue;
      const lineEnd = 'hasEOL' in item && item.hasEOL === true;
      characters += item.str.length + Number(lineEnd); if (characters > 16_000_000 || length + item.str.length > 1_000_000) throw new Error('文档文字超出搜索容量，请使用提取文本分段查找。');
      parts.push({ index: parts.length, start: length, end: length + item.str.length }); strings.push(item.str); length += item.str.length;
      if (lineEnd) { strings.push('\n'); length++; }
    }
    let first = 0, last = 0;
    for (const match of chatTextMatches(strings.join(''), query, 10_001 - matches.length)) {
      while (first < parts.length && parts[first].end <= match.start) first++;
      while (last < parts.length && parts[last].end < match.end) last++;
      const from = parts[first], to = parts[last];
      if (!from || !to || from.start > match.start || to.start > match.end) continue;
      if (matches.length === 10_000) return { matches, limited: true };
      matches.push({ page, from: { index: from.index, offset: match.start - from.start }, to: { index: to.index, offset: match.end - to.start } });
    }
    progress(page);
    // Yield to input and cancellation while scanning a large already-cached document.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  signal.throwIfAborted(); return { matches, limited: false };
}

export function pdfSearchRange(match: PdfSearchMatch, textDivs: HTMLElement[]): Range | undefined {
  const from = textDivs[match.from.index]?.firstChild, to = textDivs[match.to.index]?.firstChild;
  if (from?.nodeType !== Node.TEXT_NODE || to?.nodeType !== Node.TEXT_NODE || match.from.offset > (from.textContent?.length ?? 0) || match.to.offset > (to.textContent?.length ?? 0)) return;
  const range = document.createRange(); range.setStart(from, match.from.offset); range.setEnd(to, match.to.offset); return range;
}
