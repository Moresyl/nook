import { documentOriginalSchema, type DocumentOriginal } from '../../contracts/document-originals';
import { atomicFile } from './atomic-file';

export class DocumentOriginalFiles {
  constructor(private readonly readOwned: (reference: DocumentOriginal) => Promise<Uint8Array>, private readonly choosePath: () => Promise<string | undefined>) {}

  read(raw: unknown): Promise<Uint8Array> { return this.readOwned(documentOriginalSchema.parse(raw)); }

  async export(raw: unknown): Promise<boolean> {
    const reference = documentOriginalSchema.parse(raw);
    const path = await this.choosePath();
    if (!path) return false;
    // Recheck current ownership after the user finishes the dialog, before touching the destination.
    const bytes = await this.readOwned(reference);
    await atomicFile(path, file => file.writeFile(bytes));
    return true;
  }
}
