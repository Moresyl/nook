import { createHash } from 'node:crypto';
import { knowledgeLimits } from '../../contracts/knowledge';
import type { Note } from '../../contracts/workspace';

export type KnowledgeChunk = { key: string; note: Note; start: number; end: number; text: string; heading?: string; collectionId: string; collectionName: string; mode: 'keyword' | 'semantic' | 'hybrid'; vector?: Float32Array; queryVector?: number[] };
export function knowledgeHash(note: Pick<Note, 'title' | 'content' | 'collectionId' | 'source'>): string {
  return createHash('sha256').update(JSON.stringify([1, note.title, note.content, note.collectionId, note.source])).digest('hex');
}
export function splitKnowledge(text: string): { start: number; end: number; heading?: string }[] {
  if (text.length > 1_000_000) throw new Error('The knowledge document exceeds 1,000,000 characters. Split it before indexing.');
  const headings = [...text.matchAll(/^#{1,6}[ \t]+([^\r\n]+)$/gm)].map((match) => ({ offset: match.index, title: match[1].trim().slice(0, 160) }));
  const chunks: { start: number; end: number; heading?: string }[] = [];
  let start = 0; let headingIndex = -1;
  while (start < text.length) {
    while (start < text.length && /\s/.test(text[start])) start++;
    if (start === text.length) break;
    let end = Math.min(text.length, start + 1400);
    if (end < text.length) {
      const minimum = start + 700;
      const paragraph = text.lastIndexOf('\n\n', end);
      const line = text.lastIndexOf('\n', end);
      const sentence = Math.max(...['。', '！', '？', '. ', '! ', '? '].map((separator) => text.lastIndexOf(separator, end - 1) + 1));
      if (paragraph >= minimum) end = paragraph; else if (line >= minimum) end = line; else if (sentence >= minimum) end = sentence;
      if (/[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--;
    }
    let trimmedEnd = end;
    while (trimmedEnd > start && /\s/.test(text[trimmedEnd - 1])) trimmedEnd--;
    while (headingIndex + 1 < headings.length && headings[headingIndex + 1].offset <= start) headingIndex++;
    chunks.push({ start, end: trimmedEnd, ...(headingIndex >= 0 ? { heading: headings[headingIndex].title } : {}) });
    if (chunks.length > knowledgeLimits.documentChunks) throw new Error('The document contains too many text chunks. Split it before indexing.');
    if (end === text.length) break;
    const next = Math.max(start + 1, end - 160);
    start = /[\uDC00-\uDFFF]/.test(text[next]) && /[\uD800-\uDBFF]/.test(text[next - 1]) ? next - 1 : next;
  }
  return chunks;
}
function terms(text: string): string[] {
  return [...text.normalize('NFKC').toLowerCase().matchAll(/\p{Script=Han}+|[a-z0-9_]+|[\p{L}\p{N}]+/gu)].flatMap(([word]) => {
    if (!/^\p{Script=Han}+$/u.test(word)) return [word];
    const characters = [...word]; return [...characters, ...characters.slice(1).map((character, index) => characters[index] + character)];
  });
}
export function normalizedVector(values: unknown, dimensions?: number): number[] {
  if (!Array.isArray(values) || !values.length || values.length > knowledgeLimits.dimensions || dimensions !== undefined && values.length !== dimensions || values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) throw new Error('The embedding service returned invalid vector dimensions or values. Check the model configuration.');
  const magnitude = Math.hypot(...values);
  if (!Number.isFinite(magnitude) || !magnitude) throw new Error('The embedding service returned an unusable vector. Check the model configuration.');
  return values.map((value) => value / magnitude);
}
export function encodeVector(values: number[]): string {
  const normalized = normalizedVector(values); const bytes = Buffer.alloc(normalized.length * 4);
  normalized.forEach((value, index) => bytes.writeFloatLE(value, index * 4)); return bytes.toString('base64');
}
export function decodeVector(encoded: string, dimensions: number): Float32Array {
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length !== dimensions * 4 || bytes.toString('base64') !== encoded) throw new Error('The saved knowledge vector is invalid. Rebuild the semantic index.');
  const vector = Array.from({ length: dimensions }, (_, index) => bytes.readFloatLE(index * 4));
  try { return Float32Array.from(normalizedVector(vector, dimensions)); }
  catch { throw new Error('The saved knowledge vector is invalid. Rebuild the semantic index.'); }
}
export function rankKnowledge(chunks: KnowledgeChunk[], query: string, limit = 8): KnowledgeChunk[] {
  if (chunks.length > knowledgeLimits.chunks || !Number.isInteger(limit) || limit < 1 || limit > knowledgeLimits.results || query.length > knowledgeLimits.queryCharacters) throw new Error('The knowledge search exceeds its limits. Select fewer collections or a shorter query.');
  const vocabulary = new Set(terms(query)); const lexical = chunks.filter((chunk) => chunk.mode !== 'semantic');
  const frequencies = new Map<string, number>(); let totalLength = 0;
  for (const chunk of lexical) {
    const words = terms(chunk.text); totalLength += words.length;
    for (const word of new Set([...words, ...terms(chunk.note.title)].filter((word) => vocabulary.has(word)))) frequencies.set(word, (frequencies.get(word) ?? 0) + 1);
  }
  const average = totalLength / Math.max(1, lexical.length) || 1;
  const keyword = lexical.map((chunk) => {
    const words = terms(chunk.text); const counts = new Map<string, number>();
    for (const word of [...words, ...terms(chunk.note.title), ...terms(chunk.note.title)]) if (vocabulary.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
    let score = 0;
    for (const [word, count] of counts) score += Math.log(1 + (lexical.length - (frequencies.get(word) ?? 0) + 0.5) / ((frequencies.get(word) ?? 0) + 0.5)) * count * 2.5 / (count + 1.5 * (0.25 + 0.75 * words.length / average));
    return { chunk, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.chunk.key.localeCompare(b.chunk.key));
  const semantic = new Map<string, { chunk: KnowledgeChunk; score: number }[]>();
  for (const chunk of chunks) {
    if (chunk.mode === 'keyword') continue;
    if (!chunk.vector || !chunk.queryVector || chunk.vector.length !== chunk.queryVector.length) throw new Error('The semantic index is missing or uses different dimensions. Rebuild the index.');
    const score = chunk.vector.reduce((sum, value, index) => sum + value * chunk.queryVector![index], 0);
    if (score <= 0) continue;
    const matches = semantic.get(chunk.collectionId) ?? []; matches.push({ chunk, score }); semantic.set(chunk.collectionId, matches);
  }
  const scores = new Map<string, { chunk: KnowledgeChunk; score: number }>();
  const add = (lane: { chunk: KnowledgeChunk; score: number }[]) => lane.slice(0, limit * 5).forEach(({ chunk }, index) => {
    const previous = scores.get(chunk.key); scores.set(chunk.key, { chunk, score: (previous?.score ?? 0) + 1 / (60 + index + 1) });
  });
  add(keyword); for (const lane of semantic.values()) add(lane.sort((a, b) => b.score - a.score || a.chunk.key.localeCompare(b.chunk.key)));
  const ranked = [...scores.values()].sort((a, b) => b.score - a.score || a.chunk.key.localeCompare(b.chunk.key)); const selected: KnowledgeChunk[] = [];
  for (const { chunk } of ranked) {
    if (selected.some((item) => item.note.id === chunk.note.id && Math.min(item.end, chunk.end) - Math.max(item.start, chunk.start) > Math.min(item.end - item.start, chunk.end - chunk.start) / 2)) continue;
    selected.push(chunk); if (selected.length === limit) break;
  }
  return selected;
}
