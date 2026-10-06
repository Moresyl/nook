import { documentOriginalLimits, documentOriginalSchema, type DocumentOriginal } from '../../contracts/document-originals';
import { attachmentLimits } from '../../contracts/attachments';
import { originalDocumentIdentity, type DocumentOriginalStore } from './document-original-store';

type Pending = { reference: DocumentOriginal; bytes: Buffer; expiresAt: number; claimed: boolean };
type Limits = Pick<typeof documentOriginalLimits, 'memoryBytes' | 'persistentBytes' | 'pendingMilliseconds'>;
function references(values: DocumentOriginal[]): Map<string, DocumentOriginal> {
  const result = new Map<string, DocumentOriginal>();
  for (const raw of values) {
    const parsed = documentOriginalSchema.safeParse(raw);
    if (!parsed.success) throw new Error('Invalid original document reference.');
    const reference = parsed.data, prior = result.get(reference.sha256);
    if (prior && prior.bytes !== reference.bytes) throw new Error('Original document references contain conflicting metadata.');
    result.set(reference.sha256, reference);
  }
  return result;
}

/** Staged imports stay in memory until a persistent workspace transaction prepares their originals. */
export class DocumentOriginalSession {
  private pending = new Map<string, Pending>();
  constructor(private readonly store: Pick<DocumentOriginalStore, 'read' | 'write'>, private readonly now: () => number = Date.now,
    private readonly limits: { [K in keyof Limits]: number } = documentOriginalLimits) {}

  stage(inputs: Uint8Array[]): DocumentOriginal[] {
    if (inputs.length > attachmentLimits.count || inputs.some(input => !(input instanceof Uint8Array)) || inputs.reduce((sum, input) => sum + input.byteLength, 0) > attachmentLimits.batchBytes) throw new Error('The selected original documents exceed the import limit.');
    const now = this.now();
    const next = new Map([...this.pending].filter(([, value]) => value.claimed || value.expiresAt > now));
    const output = inputs.map(originalDocumentIdentity);
    const sizes = new Map([...next].map(([id, value]) => [id, value.bytes.length]));
    for (const reference of output) sizes.set(reference.sha256, reference.bytes);
    if ([...sizes.values()].reduce((sum, size) => sum + size, 0) > this.limits.memoryBytes) throw new Error('Original documents in memory exceed the limit. Remove unused temporary attachments or retry later.');
    output.forEach((reference, index) => {
      const bytes = Buffer.from(inputs[index]);
      if (originalDocumentIdentity(bytes).sha256 !== reference.sha256) throw new Error('An original document changed during import.');
      next.set(reference.sha256, { reference: { ...reference }, bytes, expiresAt: now + this.limits.pendingMilliseconds, claimed: next.get(reference.sha256)?.claimed ?? false });
    });
    this.pending = next;
    return output;
  }

  async prepare(next: DocumentOriginal[], previous: DocumentOriginal[], signal?: AbortSignal): Promise<void> {
    const selected = references(next), prior = references(previous);
    if ([...selected.values()].reduce((sum, value) => sum + value.bytes, 0) > this.limits.persistentBytes) throw new Error('Saved original documents exceed the workspace limit. Remove unused documents before adding more.');
    for (const reference of selected.values()) {
      signal?.throwIfAborted();
      const existing = prior.get(reference.sha256);
      if (existing) { if (existing.bytes !== reference.bytes) throw new Error('Original document metadata cannot change.'); continue; }
      const pending = this.pending.get(reference.sha256);
      if (pending && (pending.claimed || pending.expiresAt > this.now())) {
        if (pending.reference.bytes !== reference.bytes) throw new Error('Original document metadata cannot change.');
        await this.store.write(pending.bytes, signal);
      } else await this.store.read(reference, signal);
    }
  }

  committed(live: DocumentOriginal[], persistent: DocumentOriginal[]): void {
    const owners = references(live), saved = references(persistent);
    for (const [id, value] of this.pending) {
      if (saved.has(id) || value.claimed && !owners.has(id) || !value.claimed && value.expiresAt <= this.now()) this.pending.delete(id);
      else if (owners.has(id)) value.claimed = true;
    }
  }

  async read(raw: DocumentOriginal, owners: DocumentOriginal[], signal?: AbortSignal): Promise<Buffer> {
    const reference = references([raw]).get(raw.sha256)!;
    const owned = references(owners).get(reference.sha256);
    if (!owned || owned.bytes !== reference.bytes) throw new Error('This original document no longer belongs to the workspace.');
    signal?.throwIfAborted();
    const value = this.pending.get(reference.sha256);
    if (value && (value.claimed || value.expiresAt > this.now())) {
      if (value.reference.bytes !== reference.bytes) throw new Error('Original document metadata cannot change.');
      return Buffer.from(value.bytes);
    }
    return this.store.read(reference, signal);
  }
}
