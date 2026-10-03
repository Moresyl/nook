import { createHash, randomUUID } from 'node:crypto';
import { setImmediate as yieldEventLoop } from 'node:timers/promises';
import { attachmentSchema, type Attachment } from '../../contracts/attachments';
import { knowledgeCollectionSchema, knowledgeLimits, knowledgeQuerySchema, knowledgeSelectionSchema, knowledgeSourcesSchema, type KnowledgeCollection, type KnowledgeQuery, type KnowledgeSource, type KnowledgeView } from '../../contracts/knowledge';
import { noteSchema, type Note, type Provider, type Workspace } from '../../contracts/workspace';
import type { EmbeddingGateway } from './embedding-protocol';
import { decodeVector, encodeVector, knowledgeHash, normalizedVector, rankKnowledge, splitKnowledge, type KnowledgeChunk } from './knowledge-text';
import { providerDestination, providerKey } from './provider-settings';
import type { WorkspaceVault } from './vault';

type IndexJob = { collectionId: string; providerId: string; controller: AbortController; promise: Promise<Workspace>; completed: number; total: number };
type SearchJob = { providerIds: string[]; controller: AbortController; promise: Promise<KnowledgeSource[]> };
export class KnowledgeService {
  private job?: IndexJob;
  private searches = new Map<string, SearchJob>();
  private errors = new Map<string, string>();
  constructor(private readonly vault: WorkspaceVault, private readonly gateway: EmbeddingGateway) {}

  private collection(state: Workspace, id: string): KnowledgeCollection {
    const collection = state.knowledgeCollections.find((item) => item.id === id);
    if (!collection) throw new Error('This knowledge collection no longer exists. Select an available collection.');
    return collection;
  }
  private documents(state: Workspace, id: string): Note[] {
    if (id !== 'notes') this.collection(state, id);
    return state.notes.filter((note) => id === 'notes' ? !note.collectionId || !state.knowledgeCollections.some((item) => item.id === note.collectionId) : note.collectionId === id);
  }
  private checkQuota(notes: Note[]): void {
    if (notes.length > knowledgeLimits.documents || notes.reduce((total, note) => total + Buffer.byteLength(note.content, 'utf8'), 0) > knowledgeLimits.textBytes) throw new Error('Knowledge documents exceed 1,000 files or 24 MB of text. Select fewer collections or remove unused documents.');
    if (notes.reduce((total, note) => total + (note.index?.chunks.reduce((size, chunk) => size + chunk.vector.length, 0) ?? 0), 0) > knowledgeLimits.vectorBytes) throw new Error('Knowledge vectors exceed 24 MB. Use fewer documents or smaller embedding dimensions.');
  }
  private connection(state: Workspace, collection: KnowledgeCollection): { provider: Provider; key: string; fingerprint: string } {
    const settings = collection.embedding; const provider = state.providers.find((item) => item.id === settings?.providerId);
    if (!settings || !provider || provider.kind === 'anthropic') throw new Error('Configure an embedding-capable connection and model for this collection.');
    const key = providerKey(this.vault, provider);
    if (provider.kind !== 'ollama' && !key) throw new Error('Add the embedding connection API key in settings first.');
    const fingerprint = createHash('sha256').update(JSON.stringify([1, provider.id, providerDestination(provider), provider.azureApi, provider.apiVersion, settings.model, settings.dimensions, provider.kind === 'gemini' ? settings.geminiTask : 'none'])).digest('hex');
    return { provider, key, fingerprint };
  }
  private ready(note: Note, fingerprint: string): boolean {
    if (!note.index || note.index.fingerprint !== fingerprint || note.index.contentHash !== knowledgeHash(note)) return false;
    const chunks = splitKnowledge(note.content);
    return chunks.length === note.index.chunks.length && chunks.every((chunk, index) => chunk.start === note.index!.chunks[index].start && chunk.end === note.index!.chunks[index].end);
  }
  validateSelection(ids: string[]): void {
    knowledgeSelectionSchema.parse(ids); const state = this.vault.snapshot(); const notes = ids.flatMap((id) => this.documents(state, id)); this.checkQuota(notes);
    for (const id of ids) {
      if (id === 'notes') continue;
      const collection = this.collection(state, id);
      if (collection.mode === 'keyword') continue;
      const { fingerprint } = this.connection(state, collection);
      if (this.documents(state, id).some((note) => note.content.trim() && !this.ready(note, fingerprint))) throw new Error('This collection needs a semantic index. Build or rebuild it in the knowledge library first.');
    }
  }
  views(): KnowledgeView[] {
    const state = this.vault.snapshot();
    return ['notes', ...state.knowledgeCollections.map((item) => item.id)].map((id) => {
      const notes = this.documents(state, id).filter((note) => note.content.trim()); let indexed = 0;
      const collection = state.knowledgeCollections.find((item) => item.id === id);
      if (collection?.embedding) { try { const { fingerprint } = this.connection(state, collection); indexed = notes.filter((note) => this.ready(note, fingerprint)).length; } catch {} }
      const job = this.job?.collectionId === id ? this.job : undefined; const error = this.errors.get(id);
      return { collectionId: id, status: job ? 'indexing' : error ? 'error' : 'idle', completed: job?.completed ?? 0, total: job?.total ?? notes.length, indexed, ...(error ? { error } : {}) };
    });
  }
  async saveCollection(raw: KnowledgeCollection): Promise<Workspace> {
    const collection = knowledgeCollectionSchema.parse(raw);
    if (this.job?.collectionId === collection.id) await this.stop(collection.id);
    const result = await this.vault.update((draft) => {
      const index = draft.knowledgeCollections.findIndex((item) => item.id === collection.id);
      if (index < 0) draft.knowledgeCollections.push(collection); else draft.knowledgeCollections[index] = collection;
    }); this.errors.delete(collection.id); return result;
  }
  async removeCollection(id: string): Promise<Workspace> {
    this.collection(this.vault.snapshot(), id); await this.stop(id);
    const result = await this.vault.update((draft) => {
      this.collection(draft, id); draft.knowledgeCollections = draft.knowledgeCollections.filter((item) => item.id !== id);
      for (const note of draft.notes) if (note.collectionId === id) { delete note.collectionId; delete note.index; }
      for (const thread of draft.threads) thread.knowledgeCollectionIds = thread.knowledgeCollectionIds?.filter((item) => item !== id);
      for (const composer of draft.composerDrafts) composer.knowledgeCollectionIds = composer.knowledgeCollectionIds?.filter((item) => item !== id);
    }); this.errors.delete(id); return result;
  }
  saveNote(raw: Note): Promise<Workspace> {
    const note = noteSchema.parse({ ...raw, index: undefined });
    return this.vault.update((draft) => {
      if (note.collectionId) this.collection(draft, note.collectionId);
      const index = draft.notes.findIndex((item) => item.id === note.id); const previous = draft.notes[index];
      note.index = previous && knowledgeHash(previous) === knowledgeHash(note) ? previous.index : undefined;
      if (index < 0) draft.notes.push(note); else draft.notes[index] = note;
      this.checkQuota(draft.notes);
    });
  }
  importDocuments(collectionId: string, raw: Attachment[]): Promise<Workspace> {
    knowledgeSelectionSchema.min(1).parse([collectionId]);
    if (!raw.length || raw.length > 12) return Promise.reject(new Error('Import between 1 and 12 documents at a time.'));
    const files = raw.map((item) => attachmentSchema.parse(item));
    if (files.some((file) => file.image || !file.content.trim())) return Promise.reject(new Error('Choose documents containing readable text. Import images in the conversation instead.'));
    const notes: Note[] = files.map((file) => ({ id: randomUUID(), title: file.name.slice(0, 160), content: file.content, createdAt: Date.now(), ...(collectionId !== 'notes' ? { collectionId } : {}), ...(file.source ? { source: { name: file.name, ...file.source, extractedHash: createHash('sha256').update(file.content).digest('hex') } } : {}) }));
    return this.vault.update((draft) => {
      if (collectionId !== 'notes') this.collection(draft, collectionId);
      draft.notes.push(...notes); this.checkQuota(draft.notes);
    });
  }
  index(collectionId: string, force = false): Promise<Workspace> {
    if (this.job) return Promise.reject(new Error('Another semantic index is being built. Wait for it to finish or stop it first.'));
    const state = this.vault.snapshot(); const collection = this.collection(state, collectionId);
    if (collection.mode === 'keyword') return Promise.reject(new Error('This collection uses local keyword search. Choose semantic or hybrid retrieval before building an index.'));
    const connection = this.connection(state, collection);
    const notes = this.documents(state, collectionId).filter((note) => note.content.trim()); this.checkQuota(notes);
    const controller = new AbortController(); this.errors.delete(collectionId);
    const job: IndexJob = { collectionId, providerId: connection.provider.id, controller, completed: 0, total: notes.length, promise: Promise.resolve(state) };
    this.job = job;
    job.promise = this.buildIndex(state, collection, notes, connection, controller.signal, force).catch((error: unknown) => {
      if (!controller.signal.aborted) this.errors.set(collectionId, error instanceof Error ? error.message.slice(0, 512) : 'Could not build the semantic index. Check the embedding connection and retry.');
      throw error;
    }).finally(() => { if (this.job === job) this.job = undefined; });
    return job.promise;
  }
  private async buildIndex(state: Workspace, collection: KnowledgeCollection, notes: Note[], connection: ReturnType<KnowledgeService['connection']>, signal: AbortSignal, force: boolean): Promise<Workspace> {
    await yieldEventLoop(); signal.throwIfAborted(); const replacements = new Map<string, Note>(); let dimensions: number | undefined;
    for (const note of notes) {
      signal.throwIfAborted();
      if (!force && this.ready(note, connection.fingerprint)) { if (dimensions !== undefined && note.index!.dimensions !== dimensions) throw new Error('Existing vectors use inconsistent dimensions. Rebuild the entire index.'); dimensions = note.index!.dimensions; replacements.set(note.id, note); }
      else {
        const chunks = splitKnowledge(note.content); const vectors: string[] = [];
        for (let start = 0; start < chunks.length; start += 16) {
          const batch = chunks.slice(start, start + 16);
          const result = await this.gateway.embed({ provider: connection.provider, key: connection.key, settings: collection.embedding!, texts: batch.map((chunk) => note.content.slice(chunk.start, chunk.end)), purpose: 'document', title: note.title, signal });
          signal.throwIfAborted();
          if (result.length !== batch.length || result.some((vector) => vector.length !== (dimensions ?? collection.embedding!.dimensions ?? result[0]?.length))) throw new Error('The embedding service changed vector counts or dimensions. Rebuild the entire index.');
          dimensions ??= result[0]?.length;
          vectors.push(...result.map(encodeVector));
        }
        replacements.set(note.id, { ...note, index: { fingerprint: connection.fingerprint, contentHash: knowledgeHash(note), dimensions: dimensions!, createdAt: Date.now(), chunks: chunks.map(({ start, end }, index) => ({ start, end, vector: vectors[index] })) } });
      }
      this.checkQuota([...state.notes.filter((item) => item.collectionId !== collection.id), ...replacements.values()]);
      if (this.job?.collectionId === collection.id) this.job.completed++;
    }
    signal.throwIfAborted();
    return this.vault.update((draft) => {
      signal.throwIfAborted(); const current = this.collection(draft, collection.id);
      if (this.connection(draft, current).fingerprint !== connection.fingerprint || JSON.stringify(this.documents(draft, collection.id).filter((note) => note.content.trim()).map((note) => [note.id, knowledgeHash(note)])) !== JSON.stringify(notes.map((note) => [note.id, knowledgeHash(note)]))) throw new Error('Knowledge documents or the embedding connection changed during indexing. Retry using the current collection.');
      draft.notes = draft.notes.map((note) => replacements.get(note.id) ?? note); this.checkQuota(draft.notes);
    });
  }
  search(raw: KnowledgeQuery, parentSignal: AbortSignal, id: string = randomUUID()): Promise<KnowledgeSource[]> {
    const query = knowledgeQuerySchema.parse(raw); this.validateSelection(query.collections);
    knowledgeCollectionSchema.shape.id.parse(id);
    if (this.searches.has(id)) return Promise.reject(new Error('This knowledge search is already running. Use a new request ID.'));
    if (this.searches.size >= 2) return Promise.reject(new Error('Two knowledge searches are already running. Wait for one to finish.'));
    const state = this.vault.snapshot(); const controller = new AbortController();
    const signal = AbortSignal.any([parentSignal, controller.signal]);
    const promise = this.searchNotes(state, query, signal).finally(() => this.searches.delete(id));
    this.searches.set(id, { controller, providerIds: query.collections.flatMap((id) => state.knowledgeCollections.find((item) => item.id === id)?.embedding?.providerId ?? []), promise }); return promise;
  }
  private async searchNotes(state: Workspace, query: KnowledgeQuery, signal: AbortSignal): Promise<KnowledgeSource[]> {
    await yieldEventLoop(); signal.throwIfAborted(); const chunks: KnowledgeChunk[] = []; const queries = new Map<string, number[]>();
    for (const id of query.collections) {
      const documents = this.documents(state, id);
      if (!documents.some((note) => note.content.trim())) continue;
      const collection = state.knowledgeCollections.find((item) => item.id === id); const mode = collection?.mode ?? 'keyword'; let fingerprint = ''; let queryVector: number[] | undefined;
      if (mode !== 'keyword') {
        const connection = this.connection(state, collection!); fingerprint = connection.fingerprint; queryVector = queries.get(fingerprint);
        if (!queryVector) { const result = await this.gateway.embed({ provider: connection.provider, key: connection.key, settings: collection!.embedding!, texts: [query.query], purpose: 'query', signal }); if (result.length !== 1) throw new Error('The embedding service returned an invalid query vector.'); queryVector = normalizedVector(result[0], collection!.embedding!.dimensions); queries.set(fingerprint, queryVector); }
      }
      for (const [number, note] of documents.entries()) {
        if (number % 16 === 0) await yieldEventLoop(); signal.throwIfAborted();
        const ranges = splitKnowledge(note.content);
        if (mode !== 'keyword' && ranges.length && !this.ready(note, fingerprint)) throw new Error('The collection index is out of date. Rebuild it before searching.');
        ranges.forEach(({ start, end, heading }, index) => chunks.push({ key: `${note.id}:${start}:${end}`, note, start, end, heading, text: note.content.slice(start, end), collectionId: id, collectionName: collection?.name ?? '未分类资料', mode, ...(mode !== 'keyword' ? { vector: decodeVector(note.index!.chunks[index].vector, note.index!.dimensions), queryVector } : {}) }));
        if (chunks.length > knowledgeLimits.chunks) throw new Error('Too many knowledge chunks. Select fewer collections.');
      }
    }
    signal.throwIfAborted(); const ranked = rankKnowledge(chunks, query.query, query.limit); signal.throwIfAborted();
    return knowledgeSourcesSchema.parse(ranked.map((chunk, index) => ({ citation: `K${index + 1}`, noteId: chunk.note.id, collectionId: chunk.collectionId, collectionName: chunk.collectionName, title: chunk.note.title, start: chunk.start, end: chunk.end, text: chunk.text, ...(chunk.heading ? { heading: chunk.heading } : {}), ...(chunk.note.source ? { source: chunk.note.source, edited: createHash('sha256').update(chunk.note.content).digest('hex') !== chunk.note.source.extractedHash } : {}) })));
  }
  async stop(collectionId: string): Promise<void> {
    const job = this.job;
    if (job?.collectionId === collectionId) { job.controller.abort(); await job.promise.catch(() => {}); }
  }
  async stopProvider(id: string): Promise<void> {
    if (this.job?.providerId === id) await this.stop(this.job.collectionId);
    const searches = [...this.searches.values()].filter((search) => search.providerIds.includes(id)); searches.forEach((search) => search.controller.abort()); await Promise.all(searches.map((search) => search.promise.catch(() => {})));
  }
  async stopSearch(id: string): Promise<void> {
    knowledgeCollectionSchema.shape.id.parse(id); const search = this.searches.get(id);
    if (search) { search.controller.abort(); await search.promise.catch(() => {}); }
  }
  async stopAll(): Promise<void> {
    if (this.job) await this.stop(this.job.collectionId);
    const searches = [...this.searches.values()]; searches.forEach((search) => search.controller.abort()); await Promise.all(searches.map((search) => search.promise.catch(() => {})));
  }
}
