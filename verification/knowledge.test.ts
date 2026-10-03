import { afterEach, describe, expect, it, vi } from 'vitest';
import { rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { embeddingSettingsSchema, knowledgeCollectionSchema, knowledgeIndexSchema, knowledgeQuerySchema, knowledgeSourcesSchema, type KnowledgeCollection } from '../contracts/knowledge';
import { emptyWorkspace, noteSchema, workspaceSchema, type Note } from '../contracts/workspace';
import { restoreComposer } from '../contracts/composer';
import { decodeVector, encodeVector, knowledgeHash, normalizedVector, rankKnowledge, splitKnowledge, type KnowledgeChunk } from '../desktop/services/knowledge-text';
import { embeddingRequest, embeddingResponse, type EmbeddingInput } from '../desktop/services/embedding-protocol';
import { HttpModelGateway } from '../desktop/services/model-gateway';
import { KnowledgeService } from '../desktop/services/knowledge-service';
import { WorkspaceVault } from '../desktop/services/vault';
import { codec, provider, sampleThread, testVault } from './fixtures';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); vi.restoreAllMocks(); });
const note = (id: string, content: string, overrides: Partial<Note> = {}): Note => ({ id, title: id, content, createdAt: 1, ...overrides });
const collection = (overrides: Partial<KnowledgeCollection> = {}): KnowledgeCollection => ({ id: randomUUID(), name: 'Research', mode: 'hybrid', embedding: { providerId: provider.id, model: 'embedding-model', geminiTask: 'none' }, createdAt: 1, ...overrides });
const embedding = (overrides: Partial<EmbeddingInput> = {}): EmbeddingInput => ({ provider, key: 'private-key', settings: { providerId: provider.id, model: 'embedding-model', geminiTask: 'none' }, texts: ['document'], purpose: 'document', signal: new AbortController().signal, ...overrides });
function chunks(notes: Note[], mode: KnowledgeChunk['mode'] = 'keyword'): KnowledgeChunk[] {
  return notes.flatMap((item) => splitKnowledge(item.content).map((range) => ({ ...range, key: `${item.id}:${range.start}`, note: item, text: item.content.slice(range.start, range.end), collectionId: item.collectionId ?? 'notes', collectionName: 'Research', mode })));
}
async function setup() {
  const { vault, directory } = await testVault(); directories.push(directory);
  const embed = vi.fn(async (input: EmbeddingInput) => input.texts.map((text) => text.includes('猫') || text.includes('kitten') ? [1, 0, 0] : [0, 1, 0]));
  const service = new KnowledgeService(vault, { embed }); return { vault, directory, embed, service };
}
describe('knowledge contracts and retrieval', () => {
  it('preserves old notes and workspaces and restores only existing collection selections', () => {
    const state = emptyWorkspace(); delete (state as Partial<typeof state>).knowledgeCollections; state.notes.push(note('old', 'unchanged'));
    const parsed = workspaceSchema.parse(state); expect(parsed.knowledgeCollections).toEqual([]); expect(parsed.notes[0]).toEqual(note('old', 'unchanged'));
    expect(restoreComposer(parsed, sampleThread({ knowledgeCollectionIds: ['notes', randomUUID()] })).knowledgeCollectionIds).toEqual(['notes']);
    expect(knowledgeCollectionSchema.safeParse(collection({ embedding: undefined })).success).toBe(false);
    expect(knowledgeQuerySchema.safeParse({ collections: ['notes', 'notes'], query: 'word' }).success).toBe(false);
    expect(knowledgeSourcesSchema.safeParse([{ citation: 'K1', noteId: 'a', collectionId: 'notes', collectionName: 'Notes', title: 'A', start: 0, end: 4, text: 'wrong' }]).success).toBe(false);
    expect(noteSchema.safeParse({ ...note('a', 'x'), index: { fingerprint: '0'.repeat(64), contentHash: '0'.repeat(64), dimensions: 1, createdAt: 1, chunks: [{ start: 0, end: 2, vector: encodeVector([1]) }] } }).success).toBe(false);
    expect(knowledgeIndexSchema.safeParse({ fingerprint: '0'.repeat(64), contentHash: '0'.repeat(64), dimensions: 2, createdAt: 1, chunks: [{ start: 2, end: 1, vector: encodeVector([1]) }] }).success).toBe(false);
  });
  it('keeps exact original text ranges, heading context, overlap, paragraph boundaries and Unicode pairs', () => {
    const text = '# Overview\r\n' + 'A document paragraph. '.repeat(60) + '\n\n# Details\n' + '中文🧪'.repeat(900);
    const ranges = splitKnowledge(text); expect(ranges.length).toBeGreaterThan(3); expect(ranges[0].heading).toBe('Overview'); expect(ranges.some((item) => item.heading === 'Details')).toBe(true);
    let end = 0;
    for (const range of ranges) { expect(range.end - range.start).toBeLessThanOrEqual(1400); expect(range.start).toBeLessThanOrEqual(end || 1); const value = text.slice(range.start, range.end); expect(value).toBe(value.trim()); expect(value).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/); end = range.end; }
    expect(end).toBe(text.length); expect(splitKnowledge(' \n\t')).toEqual([]); expect(splitKnowledge('Plain')).toEqual([{ start: 0, end: 5 }]); expect(() => splitKnowledge('a'.repeat(1_000_001))).toThrow(/exceeds/);
    expect(splitKnowledge(('line\n'.repeat(500)))[0].end).toBeLessThan(1400);
    expect(splitKnowledge('a'.repeat(720) + '。' + 'b'.repeat(1400))[0].end).toBe(721);
    expect(knowledgeHash(note('a', 'body'))).not.toBe(knowledgeHash(note('a', 'body', { title: 'Changed' })));
  });
  it('ranks local English and Chinese evidence, separates titles, returns no irrelevant matches and deduplicates overlapping ranges', () => {
    const corpus = chunks([note('A', 'apple pear apple'), note('B', 'pear'), note('C', '向量检索用于寻找相关资料。中文资料可以分块。'), note('D', 'unrelated', { title: 'apple' })]);
    expect(rankKnowledge(corpus, 'apple')[0].note.id).toBe('D'); expect(rankKnowledge(corpus, 'apple pear')[0].note.id).toBe('A'); expect(rankKnowledge(corpus, '苹果')).toEqual([]); expect(rankKnowledge(corpus, '中文资料')[0].note.id).toBe('C'); expect(rankKnowledge(corpus, '!?')).toEqual([]);
    expect(rankKnowledge([...corpus, { ...corpus[0], key: 'duplicate', start: 1 }], 'apple').filter((item) => item.note.id === 'A')).toHaveLength(1);
    expect(() => rankKnowledge(corpus, 'a', 13)).toThrow(/limits/); expect(() => rankKnowledge(corpus, 'a'.repeat(2001))).toThrow(/limits/);
  });
  it('normalizes finite vectors and validates persisted Float32 bytes without accepting zero, NaN, wrong dimensions or noncanonical data', () => {
    expect(normalizedVector([3, 4])).toEqual([0.6, 0.8]); expect([...decodeVector(encodeVector([3, 4]), 2)][0]).toBeCloseTo(0.6);
    for (const value of [[], [0, 0], [Infinity], [NaN], ['1'], new Array(4097).fill(1)]) expect(() => normalizedVector(value)).toThrow(/vector/);
    expect(() => normalizedVector([1, 2], 1)).toThrow(/dimensions/); expect(() => decodeVector(encodeVector([1]), 2)).toThrow(/saved/); expect(() => decodeVector('AAAAAA==', 1)).toThrow(/saved/); expect(() => decodeVector('AACAfw==', 1)).toThrow(/saved/); expect(() => decodeVector('AAAAAB==', 1)).toThrow(/saved/);
  });
  it('fuses keyword and semantic ranks, retrieves a synonymous query and rejects missing semantic indexes', () => {
    const corpus = chunks([note('cat', 'A kitten sleeps.'), note('dog', 'A dog runs.')], 'hybrid').map((chunk) => ({ ...chunk, vector: Float32Array.from(chunk.note.id === 'cat' ? [1, 0] : [0, 1]), queryVector: [1, 0] }));
    expect(rankKnowledge(corpus, '猫')[0].note.id).toBe('cat'); expect(rankKnowledge(corpus, 'dog').map((item) => item.note.id)).toContain('dog'); expect(() => rankKnowledge(chunks([note('x', 'body')], 'semantic'), 'query')).toThrow(/index/);
    expect(rankKnowledge(corpus.map((chunk) => ({ ...chunk, queryVector: [-1, -1], mode: 'semantic' as const })), 'cat')).toEqual([]);
  });
});
describe('embedding provider protocols', () => {
  it.each(['responses', 'openai', 'ollama', 'azure', 'gemini'] as const)('sends bounded native %s embedding batches and normalizes results', async (kind) => {
    const input = embedding({ provider: { ...provider, kind }, texts: ['One', 'Two'], settings: { ...embedding().settings, dimensions: 2 } });
    const result = kind === 'gemini' ? { embeddings: [{ values: [3, 4] }, { values: [0, 2] }] } : { data: [{ index: 1, embedding: [0, 2] }, { index: 0, embedding: [3, 4] }] };
    const fetcher = vi.fn(async () => Response.json(result)); expect(await new HttpModelGateway(fetcher).embed(input)).toEqual([[0.6, 0.8], [0, 1]]);
    const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit]; const body = JSON.parse(String(options.body));
    expect(url).toContain(kind === 'gemini' ? '/models/embedding-model:batchEmbedContents' : '/embeddings'); expect(options.redirect).toBe('manual');
    expect(options.headers).toMatchObject(kind === 'gemini' ? { 'x-goog-api-key': 'private-key' } : kind === 'azure' ? { 'api-key': 'private-key' } : { Authorization: 'Bearer private-key' });
    if (kind === 'gemini') expect(body.requests[0].embedContentConfig).toEqual({ outputDimensionality: 2 }); else expect(body).toEqual({ model: 'embedding-model', input: ['One', 'Two'], encoding_format: 'float', dimensions: 2 });
  });
  it('uses explicit Gemini task fields or instruction prefixes without inferring a model generation', () => {
    const base = embedding({ provider: { ...provider, kind: 'gemini' }, title: 'Title', settings: { ...embedding().settings, model: 'models/custom', geminiTask: 'task-type' } });
    const request = embeddingRequest(base); expect(request.route).toBe('models/custom:batchEmbedContents'); expect((request.body.requests as any[])[0].embedContentConfig).toEqual({ taskType: 'RETRIEVAL_DOCUMENT', title: 'Title' });
    expect((embeddingRequest({ ...base, purpose: 'query' }).body.requests as any[])[0].embedContentConfig).toEqual({ taskType: 'RETRIEVAL_QUERY' });
    expect((embeddingRequest({ ...base, settings: { ...base.settings, geminiTask: 'instruction' } }).body.requests as any[])[0].content.parts[0].text).toBe('title: Title | text: document');
    expect((embeddingRequest({ ...base, purpose: 'query', settings: { ...base.settings, geminiTask: 'instruction' } }).body.requests as any[])[0].content.parts[0].text).toBe('task: search result | query: document');
  });
  it('routes dated Azure deployment embeddings using the configured deployment and API version', async () => {
    const fetcher = vi.fn(async (_url: Parameters<typeof fetch>[0]) => Response.json({ data: [{ index: 0, embedding: [1] }] }));
    await new HttpModelGateway(fetcher).embed(embedding({ provider: { ...provider, kind: 'azure', endpoint: 'https://resource.example/openai/v1', azureApi: 'deployment-chat', apiVersion: '2024-10-21' }, settings: { ...embedding().settings, model: 'embed deployment' } }));
    expect(fetcher.mock.calls[0][0]).toBe('https://resource.example/openai/deployments/embed%20deployment/embeddings?api-version=2024-10-21');
  });
  it('rejects unsupported providers, mismatched connection IDs, empty/oversized batches and malformed vectors before use', async () => {
    const fetcher = vi.fn(); const gateway = new HttpModelGateway(fetcher);
    for (const input of [embedding({ provider: { ...provider, kind: 'anthropic' } }), embedding({ settings: { ...embedding().settings, providerId: 'other' } }), embedding({ texts: [] }), embedding({ texts: [' '] }), embedding({ texts: ['x'.repeat(2001)] }), embedding({ texts: new Array(17).fill('x') })]) await expect(gateway.embed(input)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    for (const body of [{}, { data: [] }, { data: [{ index: 9, embedding: [1] }] }, { data: [{ index: 0, embedding: [0] }] }, { data: [{ index: 0, embedding: [1] }, { index: 0, embedding: [2] }] }]) expect(() => embeddingResponse(embedding(), body)).toThrow();
    expect(() => embeddingResponse(embedding({ texts: ['One', 'Two'] }), { data: [{ index: 0, embedding: [1] }, { index: 1, embedding: [1, 0] }] })).toThrow(/batch/);
    expect(() => embeddingResponse(embedding({ provider: { ...provider, kind: 'gemini' } }), { embeddings: [] })).toThrow(/batch/);
    expect(embeddingSettingsSchema.safeParse({ ...embedding().settings, dimensions: 4097 }).success).toBe(false);
    expect(() => embeddingResponse(embedding({ texts: [] }), { data: [] })).toThrow(/between/);
  });
  it('bounds response bytes, redacts server errors, rejects redirects and cancels a blocked response reader', async () => {
    for (const response of [new Response('private-key', { status: 401 }), new Response('private-key', { status: 302 }), new Response('bad json'), new Response('x'.repeat(2_000_001))]) {
      const gateway = new HttpModelGateway(vi.fn(async () => response)); await expect(gateway.embed(embedding())).rejects.not.toThrow(/private-key/);
    }
    const cancelled = vi.fn(); const controller = new AbortController(); const body = new ReadableStream<Uint8Array>({ cancel: cancelled });
    const pending = new HttpModelGateway(vi.fn(async () => new Response(body))).embed(embedding({ signal: controller.signal })); await vi.waitFor(() => expect(body.locked).toBe(true)); controller.abort(); await expect(pending).rejects.toThrow(/Aborted/); expect(cancelled).toHaveBeenCalled(); expect(body.locked).toBe(false);
    const stopped = new AbortController(); stopped.abort(); const fetcher = vi.fn(); await expect(new HttpModelGateway(fetcher).embed(embedding({ signal: stopped.signal }))).rejects.toThrow(/aborted/i); expect(fetcher).not.toHaveBeenCalled();
  });
});
describe('knowledge service persistence and concurrency', () => {
  it('bounds concurrent searches, rejects duplicate request IDs, cancels one request independently and releases all slots', async () => {
    const { service, embed } = await setup(); const base = collection(); await service.saveCollection(base); await service.saveNote(note('cat', 'kitten', { collectionId: base.id })); await service.index(base.id);
    embed.mockImplementation(async (input) => new Promise((_, reject) => input.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })));
    const query = { collections: [base.id], query: '猫', limit: 8 }; const firstId = randomUUID(); const secondId = randomUUID();
    const first = service.search(query, new AbortController().signal, firstId); const firstRejected = expect(first).rejects.toThrow(/Aborted/);
    await expect(service.search(query, new AbortController().signal, firstId)).rejects.toThrow(/already running/);
    const second = service.search(query, new AbortController().signal, secondId); const secondRejected = expect(second).rejects.toThrow(/Aborted/);
    await expect(service.search(query, new AbortController().signal)).rejects.toThrow(/Two knowledge/);
    await vi.waitFor(() => expect(embed.mock.calls.filter(([input]) => input.purpose === 'query')).toHaveLength(2));
    await service.stopSearch(firstId); await firstRejected; await service.stopSearch(firstId); await service.stopSearch(randomUUID());
    await service.stopAll(); await secondRejected; embed.mockResolvedValue([[1, 0, 0]]);
    expect(await service.search(query, new AbortController().signal)).toHaveLength(1); await expect(service.stopSearch('invalid')).rejects.toThrow();
  });
  it('indexes empty collections without HTTP and rejects missing credentials, unsupported embedding connections and requested dimension mismatches', async () => {
    const { vault, service, embed } = await setup(); const base = collection(); await service.saveCollection(base); await service.index(base.id); expect(embed).not.toHaveBeenCalled(); expect(service.views().find((item) => item.collectionId === base.id)).toMatchObject({ status: 'idle', total: 0, indexed: 0 });
    await service.saveNote(note('cat', 'kitten', { collectionId: base.id })); await service.saveCollection({ ...base, embedding: { ...base.embedding!, dimensions: 2 } });
    await expect(service.index(base.id)).rejects.toThrow(/dimensions/); expect(vault.snapshot().notes[0].index).toBeUndefined();
    await vault.update((draft) => { draft.providers[0].kind = 'openai'; }); expect(() => service.validateSelection([base.id])).toThrow(/API key/);
    await vault.update((draft) => { draft.providers[0].kind = 'anthropic'; }); expect(() => service.validateSelection([base.id])).toThrow(/embedding-capable/);
    await service.saveCollection({ ...base, mode: 'keyword' }); const calls = embed.mock.calls.length; await expect(service.index(base.id)).rejects.toThrow(/local keyword/); expect(embed).toHaveBeenCalledTimes(calls);
  });
  it('rejects a provider destination changed while embedding before committing an index', async () => {
    const { vault, service, embed } = await setup(); const base = collection(); await service.saveCollection(base); await service.saveNote(note('cat', 'kitten', { collectionId: base.id }));
    let release!: (vectors: number[][]) => void; embed.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; })); const pending = service.index(base.id); await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await vault.update((draft) => { draft.providers[0].endpoint = 'http://localhost:9999/v1'; }); release([[1, 0, 0]]); await expect(pending).rejects.toThrow(/changed/); expect(vault.snapshot().notes[0].index).toBeUndefined();
  });
  it('imports a batch atomically into a collection, keeps source hashes, searches locally, and recovers through an actual vault restart', async () => {
    const { vault, directory, embed, service } = await setup(); const base = collection({ mode: 'keyword', embedding: undefined }); await service.saveCollection(base);
    await service.importDocuments(base.id, [{ id: 'file', name: 'evidence.pdf', content: '# Report\n中文资料与预算 42', source: { format: 'pdf', bytes: 120 } }]);
    const sources = await service.search({ collections: [base.id], query: '预算', limit: 8 }, new AbortController().signal); expect(sources).toHaveLength(1); expect(sources[0]).toMatchObject({ citation: 'K1', title: 'evidence.pdf', source: { name: 'evidence.pdf', format: 'pdf' }, edited: false }); expect(embed).not.toHaveBeenCalled();
    const original = vault.snapshot(); await expect(service.importDocuments(base.id, [{ id: 'f', name: 'good.txt', content: 'valid' }, { id: 'empty', name: 'empty.txt', content: '' }])).rejects.toThrow(/readable/); expect(vault.snapshot()).toEqual(original);
    const restored = new WorkspaceVault(directory, codec); await restored.initialize(); expect(restored.snapshot().notes).toEqual(original.notes); expect(restored.backup().knowledgeCollections).toEqual([base]);
    expect(await new KnowledgeService(restored, { embed }).search({ collections: [base.id], query: '不存在', limit: 8 }, new AbortController().signal)).toEqual([]);
  });
  it('builds a complete semantic index, reuses unchanged chunks, retrieves synonyms, and invalidates edited text/model/endpoint changes', async () => {
    const { vault, service, embed } = await setup(); const base = collection(); await service.saveCollection(base); await service.saveNote(note('cat', 'A kitten sleeps.', { collectionId: base.id })); await service.saveNote(note('dog', 'A dog runs.', { collectionId: base.id }));
    expect(() => service.validateSelection([base.id])).toThrow(/index/); await service.index(base.id); expect(service.views().find((view) => view.collectionId === base.id)).toMatchObject({ indexed: 2, status: 'idle' });
    const firstCalls = embed.mock.calls.length; await service.index(base.id); expect(embed).toHaveBeenCalledTimes(firstCalls);
    expect((await service.search({ collections: [base.id], query: '猫', limit: 8 }, new AbortController().signal))[0].noteId).toBe('cat');
    const indexed = vault.snapshot().notes[0]; await service.saveNote({ ...indexed, content: 'Changed kitten' }); expect(vault.snapshot().notes[0].index).toBeUndefined(); expect(() => service.validateSelection([base.id])).toThrow(/index/);
    await service.index(base.id); await service.saveCollection({ ...base, embedding: { ...base.embedding!, model: 'new-model' } }); expect(() => service.validateSelection([base.id])).toThrow(/index/);
    await service.index(base.id); await vault.update((draft) => { draft.providers[0].endpoint = 'http://localhost:11435/v1'; }); expect(() => service.validateSelection([base.id])).toThrow(/index/);
  });
  it('preserves an old index after a failed rebuild, rejects inconsistent dimensions and reports a bounded error', async () => {
    const { vault, service, embed } = await setup(); const base = collection(); await service.saveCollection(base); await service.saveNote(note('cat', 'kitten', { collectionId: base.id })); await service.index(base.id); const before = vault.snapshot().notes;
    embed.mockRejectedValueOnce(new Error('Unable to connect')); await expect(service.index(base.id, true)).rejects.toThrow(/connect/); expect(vault.snapshot().notes).toEqual(before); expect(service.views().find((item) => item.collectionId === base.id)).toMatchObject({ status: 'error', error: 'Unable to connect', indexed: 1 });
    await service.saveNote(note('second', 'other', { collectionId: base.id })); embed.mockResolvedValueOnce([[1, 0]]); await expect(service.index(base.id)).rejects.toThrow(/dimensions/); expect(vault.snapshot().notes[1].index).toBeUndefined();
  });
  it('rejects stale document/connection changes in the serialized final commit and ignores client-supplied vector replacements', async () => {
    const { vault, service, embed } = await setup(); const base = collection(); await service.saveCollection(base); await service.saveNote(note('cat', 'kitten', { collectionId: base.id }));
    let release!: (value: number[][]) => void; embed.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; })); const pending = service.index(base.id); await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await service.saveNote(note('cat', 'New body', { collectionId: base.id })); release([[1, 0, 0]]); await expect(pending).rejects.toThrow(/changed/); expect(vault.snapshot().notes[0].index).toBeUndefined();
    await service.index(base.id); const saved = vault.snapshot().notes[0]; await service.saveNote({ ...saved, index: { ...saved.index!, chunks: saved.index!.chunks.map((chunk) => ({ ...chunk, vector: encodeVector([1, 1, 1]) })) } }); expect(vault.snapshot().notes[0].index).toEqual(saved.index);
  });
  it('cancels a running index and provider-bound searches without committing half-built vectors or leaving a locked job', async () => {
    const { vault, service, embed } = await setup(); const base = collection(); await service.saveCollection(base); await service.saveNote(note('cat', 'kitten', { collectionId: base.id }));
    embed.mockImplementationOnce(async (input) => new Promise((_, reject) => input.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })));
    const pending = service.index(base.id); const rejected = expect(pending).rejects.toThrow(/Aborted/); await vi.waitFor(() => expect(embed).toHaveBeenCalled()); await expect(service.index(base.id)).rejects.toThrow(/Another/); await service.stopProvider(provider.id); await rejected; expect(vault.snapshot().notes[0].index).toBeUndefined(); expect(service.views().find((item) => item.collectionId === base.id)?.status).toBe('idle');
    await service.index(base.id); embed.mockImplementationOnce(async (input) => new Promise((_, reject) => input.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })));
    const searching = service.search({ collections: [base.id], query: '猫', limit: 8 }, new AbortController().signal); const failedSearch = expect(searching).rejects.toThrow(/Aborted/); await vi.waitFor(() => expect(embed.mock.calls.at(-1)?.[0].purpose).toBe('query')); await service.stopProvider(provider.id); await failedSearch; await service.stopAll();
  });
  it('keeps documents while removing a collection, clears thread/draft selections, and preserves citation snapshots', async () => {
    const { vault, service } = await setup(); const base = collection({ mode: 'keyword', embedding: undefined }); await service.saveCollection(base); await service.importDocuments(base.id, [{ id: 'f', name: 'source.txt', content: 'evidence' }]);
    const sources = await service.search({ collections: [base.id], query: 'evidence', limit: 8 }, new AbortController().signal);
    await vault.update((draft) => { draft.threads.push(sampleThread({ knowledgeCollectionIds: [base.id], messages: [{ id: 'a', role: 'assistant', content: '[K1]', attachments: [], status: 'complete', createdAt: 1, knowledgeSources: sources }] })); draft.composerDrafts.push({ ...restoreComposer(draft), knowledgeCollectionIds: [base.id] }); });
    await service.removeCollection(base.id); const state = vault.snapshot(); expect(state.knowledgeCollections).toEqual([]); expect(state.notes[0].collectionId).toBeUndefined(); expect(state.threads[0].knowledgeCollectionIds).toEqual([]); expect(state.composerDrafts[0].knowledgeCollectionIds).toEqual([]); expect(state.threads[0].messages[0].knowledgeSources).toEqual(sources);
    expect((await service.search({ collections: ['notes'], query: 'evidence', limit: 8 }, new AbortController().signal))[0].noteId).toBe(state.notes[0].id);
  });
  it('marks manually changed extracted text and enforces document/text/index limits before retaining imports', async () => {
    const { vault, service } = await setup(); await service.importDocuments('notes', [{ id: 'f', name: 'edited.txt', content: 'Original', source: { format: 'text', bytes: 8 } }]); const imported = vault.snapshot().notes[0]; await service.saveNote({ ...imported, content: 'Changed evidence' });
    const sources = await service.search({ collections: ['notes'], query: 'evidence', limit: 8 }, new AbortController().signal); expect(sources[0].edited).toBe(true); expect(sources[0].source?.extractedHash).toBe(createHash('sha256').update('Original').digest('hex'));
    await expect(service.importDocuments('notes', [])).rejects.toThrow(/between/); await expect(service.saveNote(note('missing', 'text', { collectionId: randomUUID() }))).rejects.toThrow(/no longer/);
    await vault.update((draft) => { draft.notes = Array.from({ length: 1000 }, (_, index) => note(String(index), 'small')); }); await expect(service.saveNote(note('over', 'small'))).rejects.toThrow(/1,000/); expect(vault.snapshot().notes).toHaveLength(1000);
  });
});
