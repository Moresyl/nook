import { z } from 'zod';
import { attachmentFormats } from './attachments';
import { documentOriginalSchema } from './document-originals';

export const knowledgeLimits = { collections: 64, selection: 8, documents: 1000, textBytes: 24_000_000, vectorBytes: 24_000_000, chunks: 20_000, documentChunks: 1000, dimensions: 4096, queryCharacters: 2000, results: 12 } as const;
export const knowledgeSelectionSchema = z.array(z.union([z.literal('notes'), z.uuid()])).max(knowledgeLimits.selection).refine((ids) => new Set(ids).size === ids.length, 'Select each knowledge collection once');
export const embeddingSettingsSchema = z.object({
  providerId: z.string().min(1).max(128), model: z.string().trim().min(1).max(128),
  dimensions: z.number().int().positive().max(knowledgeLimits.dimensions).optional(),
  geminiTask: z.enum(['none', 'task-type', 'instruction']).default('none'),
}).strict();
export const knowledgeCollectionSchema = z.object({
  id: z.uuid(), name: z.string().trim().min(1).max(160),
  mode: z.enum(['keyword', 'semantic', 'hybrid']).default('keyword'),
  embedding: embeddingSettingsSchema.optional(), createdAt: z.number().int().nonnegative(),
}).strict().superRefine((collection, context) => {
  if (collection.mode !== 'keyword' && !collection.embedding) context.addIssue({ code: 'custom', path: ['embedding'], message: 'Configure an embedding model for semantic retrieval' });
});
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const encodedVector = z.string().min(8).max(Math.ceil(knowledgeLimits.dimensions * 4 / 3) * 4).regex(/^[A-Za-z0-9+/]+={0,2}$/).refine((value) => value.length % 4 === 0, 'Use base64 vector data');
export const knowledgeIndexSchema = z.object({
  fingerprint: hash, contentHash: hash, dimensions: z.number().int().positive().max(knowledgeLimits.dimensions), createdAt: z.number().int().nonnegative(),
  chunks: z.array(z.object({ start: z.number().int().nonnegative(), end: z.number().int().positive(), vector: encodedVector }).strict()).min(1).max(knowledgeLimits.documentChunks),
}).strict().superRefine((index, context) => {
  for (const [number, chunk] of index.chunks.entries()) {
    const bytes = chunk.vector.length / 4 * 3 - (chunk.vector.endsWith('==') ? 2 : chunk.vector.endsWith('=') ? 1 : 0);
    if (chunk.end <= chunk.start || bytes !== index.dimensions * 4) context.addIssue({ code: 'custom', path: ['chunks', number], message: 'Vector dimensions and text ranges must match the index' });
  }
});
export const knowledgeDocumentSourceSchema = z.object({ name: z.string().min(1).max(512), format: z.enum(attachmentFormats), bytes: z.number().int().nonnegative().max(12_000_000), extractedHash: hash, original: documentOriginalSchema.optional() }).strict().refine(source => !source.original || source.format === 'pdf' && source.bytes === source.original.bytes, 'A PDF original must match its source metadata');
export const knowledgeSourceSchema = z.object({
  citation: z.string().regex(/^K(?:[1-9]|1[0-2])$/), noteId: z.string().min(1).max(128), collectionId: z.union([z.literal('notes'), z.uuid()]),
  collectionName: z.string().min(1).max(160), title: z.string().min(1).max(160),
  start: z.number().int().nonnegative(), end: z.number().int().positive(), text: z.string().min(1).max(2000),
  heading: z.string().max(160).optional(), source: knowledgeDocumentSourceSchema.optional(), edited: z.boolean().optional(),
}).strict().refine((source) => source.end - source.start === source.text.length, 'Source text must match its character range');
export const knowledgeSourcesSchema = z.array(knowledgeSourceSchema).max(knowledgeLimits.results).refine((sources) => new Set(sources.map((source) => source.citation)).size === sources.length, 'Source citation IDs must be unique');
export const knowledgeQuerySchema = z.object({ collections: knowledgeSelectionSchema.min(1), query: z.string().trim().min(1).max(knowledgeLimits.queryCharacters), limit: z.number().int().positive().max(knowledgeLimits.results).default(8) }).strict();
export type EmbeddingSettings = z.infer<typeof embeddingSettingsSchema>;
export type KnowledgeCollection = z.infer<typeof knowledgeCollectionSchema>;
export type KnowledgeIndex = z.infer<typeof knowledgeIndexSchema>;
export type KnowledgeSource = z.infer<typeof knowledgeSourceSchema>;
export type KnowledgeQuery = z.infer<typeof knowledgeQuerySchema>;
export type KnowledgeView = { collectionId: string; status: 'idle' | 'indexing' | 'error'; completed: number; total: number; indexed: number; error?: string };
