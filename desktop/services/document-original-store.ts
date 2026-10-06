import { createHash } from 'node:crypto';
import { lstat, mkdir, open } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { documentOriginalLimits, documentOriginalSchema, type DocumentOriginal } from '../../contracts/document-originals';
import { atomicFile } from './atomic-file';

const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export function originalDocumentIdentity(bytes: Uint8Array): DocumentOriginal {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 5 || bytes.byteLength > documentOriginalLimits.fileBytes) throw new Error('Choose a PDF no larger than 12 MB.');
  if (Buffer.from(bytes.buffer, bytes.byteOffset, 5).toString('ascii') !== '%PDF-') throw new Error('Choose a PDF document.');
  return { sha256: digest(bytes), bytes: bytes.length, mimeType: 'application/pdf' };
}

/** Internal immutable storage. Callers must resolve document ownership before reading a reference. */
export class DocumentOriginalStore {
  constructor(private readonly directory: string) {
    if (!isAbsolute(directory)) throw new Error('The original document directory must be absolute.');
  }

  private async checkDirectory(create: boolean): Promise<void> {
    if (create) await mkdir(this.directory, { recursive: true });
    const info = await lstat(this.directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid original document directory.');
  }

  private async readBytes(reference: DocumentOriginal, signal?: AbortSignal): Promise<Buffer> {
    signal?.throwIfAborted();
    await this.checkDirectory(false);
    const path = join(this.directory, reference.sha256);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== reference.bytes) throw new Error('Invalid original document file.');
    const file = await open(path, 'r');
    try {
      const opened = await file.stat();
      // Windows path-based lstat may report device 0 while handle stat reports the volume ID.
      const changedDevice = process.platform !== 'win32' && opened.dev !== info.dev;
      if (!opened.isFile() || opened.size !== reference.bytes || changedDevice || opened.ino !== info.ino) throw new Error('The original document changed.');
      // One extra byte detects growth without an unbounded readFile allocation.
      const bytes = Buffer.alloc(reference.bytes + 1); let offset = 0;
      while (offset < bytes.length) {
        signal?.throwIfAborted();
        const { bytesRead } = await file.read(bytes, offset, Math.min(65_536, bytes.length - offset), offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      signal?.throwIfAborted();
      const result = bytes.subarray(0, offset);
      if (offset !== reference.bytes || result.subarray(0, 5).toString('ascii') !== '%PDF-' || digest(result) !== reference.sha256) throw new Error('The original document failed its integrity check.');
      return result;
    } finally { await file.close(); }
  }

  async read(raw: unknown, signal?: AbortSignal): Promise<Buffer> {
    const reference = documentOriginalSchema.safeParse(raw);
    if (!reference.success) throw new Error('Choose a valid original document reference.');
    try { return await this.readBytes(reference.data, signal); }
    catch {
      signal?.throwIfAborted();
      throw new Error('The original document is missing or damaged. Import the original file again.');
    }
  }

  async write(input: Uint8Array, signal?: AbortSignal): Promise<DocumentOriginal> {
    signal?.throwIfAborted();
    originalDocumentIdentity(input);
    // Capture before any await so a caller cannot mutate bytes while a durable write is pending.
    const bytes = Buffer.from(input);
    const reference = originalDocumentIdentity(bytes);
    try {
      await this.checkDirectory(true);
      const path = join(this.directory, reference.sha256);
      try {
        await lstat(path);
        await this.readBytes(reference, signal);
        return reference;
      } catch (error) { if (!missing(error)) throw error; }
      await atomicFile(path, file => file.writeFile(bytes), signal);
      return reference;
    } catch {
      signal?.throwIfAborted();
      throw new Error('The original document could not be saved. Check disk space and directory permissions.');
    }
  }
}
