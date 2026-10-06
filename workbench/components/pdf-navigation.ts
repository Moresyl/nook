export type PdfOutlineEntry = { title: string; depth: number; destination: unknown };
export type PdfDestination = { page: number; x?: number; y?: number };
type DocumentNavigation = { numPages: number; getDestination(name: string): Promise<unknown>; getPageIndex(reference: { num: number; gen: number }): Promise<number> };

export function pdfOutlineEntries(raw: unknown): PdfOutlineEntry[] {
  if (raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 10_000) throw new Error('PDF outline is invalid or too large.');
  const pending = raw.map(value => ({ value, depth: 0 })).reverse(), result: PdfOutlineEntry[] = [];
  const seen = new Set<object>();
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (!value || typeof value !== 'object' || seen.has(value)) throw new Error('PDF outline contains an invalid entry.');
    seen.add(value);
    if (seen.size > 10_000) throw new Error('PDF outline is too large.');
    result.push({ title: typeof value.title === 'string' && value.title.trim() ? value.title.slice(0, 512) : '未命名章节', depth, destination: value.dest });
    if (value.items !== undefined) {
      if (!Array.isArray(value.items) || pending.length + result.length + value.items.length > 10_000) throw new Error('PDF outline is invalid or too large.');
      for (let index = value.items.length - 1; index >= 0; index--) pending.push({ value: value.items[index], depth: depth + 1 });
    }
  }
  return result;
}

export async function resolvePdfDestination(document: DocumentNavigation, raw: unknown): Promise<PdfDestination> {
  const destination = typeof raw === 'string' ? await document.getDestination(raw) : raw;
  if (!Array.isArray(destination) || destination.length < 2) throw new Error('此目录项没有可用的页内目标。');
  const reference = destination[0]; let index: number;
  if (Number.isInteger(reference)) index = reference;
  else if (reference && typeof reference === 'object' && Number.isInteger(reference.num) && reference.num > 0 && Number.isInteger(reference.gen) && reference.gen >= 0) index = await document.getPageIndex({ num: reference.num, gen: reference.gen });
  else throw new Error('此目录项的目标无效。');
  if (!Number.isInteger(index) || index < 0 || index >= document.numPages) throw new Error('此目录项指向不存在的页面。');
  const coordinate = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  const kind = destination[1]?.name;
  return { page: index + 1, ...(kind === 'XYZ' ? { x: coordinate(destination[2]), y: coordinate(destination[3]) } :
    kind === 'FitH' || kind === 'FitBH' ? { y: coordinate(destination[2]) } :
    kind === 'FitV' || kind === 'FitBV' ? { x: coordinate(destination[2]) } : {}) };
}
