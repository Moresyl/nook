type Viewport = { width: number; height: number; convertToViewportPoint(x: number, y: number): number[] };
export type PdfAnnotation = { id: string; left: number; top: number; width: number; height: number; title: string } &
  ({ kind: 'link'; url?: string; destination?: unknown } | { kind: 'note'; content: string; truncated: boolean });

export function pdfAnnotations(raw: unknown, viewport: Viewport): PdfAnnotation[] {
  if (!Array.isArray(raw) || raw.length > 10_000) throw new Error('此页注释过多或数据无效。');
  const result: PdfAnnotation[] = [];
  for (const [index, item] of raw.entries()) {
    if (!item || typeof item !== 'object' || item.noView || item.hidden || !Array.isArray(item.rect) || item.rect.length !== 4 || !item.rect.every(Number.isFinite)) continue;
    const rect = [...viewport.convertToViewportPoint(item.rect[0], item.rect[1]), ...viewport.convertToViewportPoint(item.rect[2], item.rect[3])];
    if (rect.length !== 4 || !rect.every(Number.isFinite)) continue;
    const left = Math.max(0, Math.min(rect[0], rect[2])), top = Math.max(0, Math.min(rect[1], rect[3]));
    const right = Math.min(viewport.width, Math.max(rect[0], rect[2])), bottom = Math.min(viewport.height, Math.max(rect[1], rect[3]));
    if (right <= left || bottom <= top) continue;
    const content = typeof item.contentsObj?.str === 'string' ? item.contentsObj.str.slice(0, 32_000) : '';
    const title = typeof item.titleObj?.str === 'string' ? item.titleObj.str.slice(0, 512) : '';
    const box = { id: String(index), left, top, width: right - left, height: bottom - top, title };
    if (item.subtype === 'Link') {
      let url: string | undefined;
      if (typeof item.url === 'string') {
        try { const parsed = new URL(item.url); if (['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password) url = parsed.href; } catch { /* Unsupported links remain inactive. */ }
      }
      result.push({ ...box, kind: 'link', url, destination: typeof item.dest === 'string' || Array.isArray(item.dest) ? item.dest : undefined });
    } else if (content.trim()) result.push({ ...box, kind: 'note', content, truncated: item.contentsObj.str.length > 32_000 });
  }
  return result;
}
