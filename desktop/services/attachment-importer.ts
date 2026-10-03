import { basename } from 'node:path';
import { open } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { attachmentInputsSchema, attachmentLimits, attachmentSchema, type Attachment, type AttachmentInput } from '../../contracts/attachments';

type Parser = (input: AttachmentInput) => Promise<Attachment>;

export function parseInWorker(path: string, input: AttachmentInput, timeoutMs = 30_000): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path, { workerData: input, resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 32 } });
    let finished = false;
    const finish = (error?: Error, value?: Attachment) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      void worker.terminate().catch(() => {});
      if (error) reject(error); else resolve(value!);
    };
    const timer = setTimeout(() => finish(new Error('File import timed out. Split the document or use a smaller image.')), timeoutMs);
    worker.once('message', (value: unknown) => {
      const result = value as { attachment?: unknown; error?: unknown } | null;
      if (result && typeof result.error === 'string' && result.error.length <= 512) { finish(new Error(result.error)); return; }
      const parsed = attachmentSchema.safeParse(result?.attachment);
      if (!parsed.success) finish(new Error('The file parser returned an invalid attachment.')); else finish(undefined, parsed.data);
    });
    worker.once('error', () => finish(new Error('The file parser stopped unexpectedly. Use a smaller file or reopen the workspace.')));
    worker.once('exit', () => finish(new Error('The file parser stopped before finishing. Try a smaller file.')));
  });
}

export class AttachmentImporter {
  private busy = false;
  constructor(private readonly parser: Parser) {}

  private async importFiles(load: () => Promise<AttachmentInput[]>): Promise<Attachment[]> {
    if (this.busy) throw new Error('Another file import is running. Wait for it to finish.');
    this.busy = true;
    try {
      const inputs = attachmentInputsSchema.parse(await load());
      const files: Attachment[] = [];
      for (const input of inputs) files.push(attachmentSchema.parse(await this.parser(input)));
      return files;
    } finally { this.busy = false; }
  }

  importInputs(raw: AttachmentInput[]): Promise<Attachment[]> {
    return this.importFiles(async () => raw);
  }

  importPaths(paths: string[]): Promise<Attachment[]> {
    return this.importFiles(async () => {
      if (!paths.length || paths.length > attachmentLimits.count) throw new Error('Attach between 1 and 12 files per message.');
      const files: AttachmentInput[] = [];
      let total = 0;
      for (const path of paths) {
        let handle;
        try {
          handle = await open(path, 'r');
          const stats = await handle.stat();
          if (!stats.isFile() || stats.size > attachmentLimits.fileBytes) throw new Error('Choose regular files smaller than 12 MB.');
          total += stats.size;
          if (total > attachmentLimits.batchBytes) throw new Error('The selected files exceed the 24 MB import limit.');
          const bytes = Buffer.alloc(stats.size + 1);
          let count = 0;
          while (count < bytes.length) {
            const result = await handle.read(bytes, count, bytes.length - count, count);
            if (!result.bytesRead) break;
            count += result.bytesRead;
          }
          if (count !== stats.size) throw new Error('A selected file changed while it was being read. Import it again.');
          files.push({ name: basename(path), data: bytes.subarray(0, count).toString('base64') });
        } catch (error) {
          if (error instanceof Error && !('code' in error)) throw error;
          throw new Error('A selected file could not be opened. Check that it still exists and is readable.');
        } finally { await handle?.close(); }
      }
      return files;
    });
  }
}
