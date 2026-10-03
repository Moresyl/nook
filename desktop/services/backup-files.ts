import { open, type FileHandle } from 'node:fs/promises';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setImmediate as yieldEventLoop } from 'node:timers/promises';
import { createGzip, createGunzip } from 'node:zlib';
import { atomicFile } from './atomic-file';

export const backupLimits = { textBytes: 256_000_000, compressedBytes: 64_000_000 } as const;
type Limits = { textBytes: number; compressedBytes: number };
class BackupLimitError extends Error { constructor() { super('The backup exceeds its size limit. Export some conversations separately or choose a smaller backup.'); } }

function* jsonTokens(value: unknown, ancestors = new Set<object>(), depth = 0): Generator<string> {
  if (depth > 128) throw new Error('The backup contains deeply nested data.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) { yield JSON.stringify(value); return; }
  if (!value || typeof value !== 'object' || ancestors.has(value) || !Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('The backup contains invalid or circular data.');
  ancestors.add(value);
  try {
    const array = Array.isArray(value); yield array ? '[' : '{'; let first = true;
    const keys = array ? undefined : Object.keys(value);
    for (let index = 0; index < (array ? value.length : keys!.length); index++) {
      const key = array ? String(index) : keys![index];
      const item = (value as Record<string, unknown>)[key]; if (!array && item === undefined) continue;
      if (!first) yield ','; first = false;
      if (!array) yield JSON.stringify(key) + ':';
      yield* jsonTokens(array && item === undefined ? null : item, ancestors, depth + 1);
    }
    yield array ? ']' : '}';
  } finally { ancestors.delete(value); }
}
function byteLimit(maximum: number): Transform {
  let bytes = 0;
  return new Transform({ transform(chunk: Buffer, _encoding, callback) { bytes += chunk.length; callback(bytes > maximum ? new BackupLimitError() : null, chunk); } });
}
function fileSink(file: FileHandle): Writable {
  return new Writable({ write(chunk: Buffer, _encoding, callback) {
    void (async () => { let offset = 0; while (offset < chunk.length) { const { bytesWritten } = await file.write(chunk, offset, chunk.length - offset); if (!bytesWritten) throw new Error('The backup could not be written.'); offset += bytesWritten; } })().then(() => callback(), callback);
  } });
}
type Job = { controller: AbortController; promise: Promise<unknown> };
export class WorkspaceBackupFiles {
  private jobs = new Set<Job>(); private closed = false;
  constructor(private readonly limits: Limits = backupLimits) {
    if (![limits.textBytes, limits.compressedBytes].every((limit) => Number.isSafeInteger(limit) && limit > 0)) throw new Error('Backup size limits must be positive integers.');
  }
  private run<T>(operation: (signal: AbortSignal) => Promise<T>, parent?: AbortSignal): Promise<T> {
    if (this.closed) return Promise.reject(new Error('The backup service is closing. Reopen the workspace to create or restore a backup.'));
    if (this.jobs.size) return Promise.reject(new Error('Another backup file operation is running. Wait for it to finish before starting another.'));
    const controller = new AbortController(); const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60_000), ...(parent ? [parent] : [])]);
    const job: Job = { controller, promise: Promise.resolve() }; const promise = Promise.resolve().then(() => { signal.throwIfAborted(); return operation(signal); }).finally(() => this.jobs.delete(job));
    job.promise = promise; this.jobs.add(job); return promise;
  }
  private async *chunks(value: unknown, signal: AbortSignal): AsyncGenerator<string> {
    let bytes = 0; let pendingBytes = 0; let pending: string[] = [];
    for (const token of jsonTokens(value)) {
      signal.throwIfAborted(); const size = Buffer.byteLength(token, 'utf8'); bytes += size; if (bytes > this.limits.textBytes) throw new BackupLimitError();
      pending.push(token); pendingBytes += size;
      if (pendingBytes >= 64_000) { yield pending.join(''); pending = []; pendingBytes = 0; await yieldEventLoop(); }
    }
    if (pending.length) yield pending.join('');
  }
  size(value: unknown, signal?: AbortSignal): Promise<number> {
    return this.run(async (signal) => { let bytes = 0; for await (const chunk of this.chunks(value, signal)) bytes += Buffer.byteLength(chunk, 'utf8'); return bytes; }, signal);
  }
  write(path: string, value: unknown, signal?: AbortSignal): Promise<void> {
    return this.run(async (signal) => {
      for await (const _chunk of this.chunks(value, signal)) { /* Check the complete snapshot before opening a destination. */ }
      try {
        await atomicFile(path, async (file) => {
          const source = Readable.from(this.chunks(value, signal)); const output = fileSink(file);
          if (/\.gz$/i.test(path)) await pipeline(source, createGzip(), byteLimit(this.limits.compressedBytes), output, { signal });
          else await pipeline(source, output, { signal });
          signal.throwIfAborted();
        }, signal);
      } catch (error) { if (error instanceof Error && error.cause instanceof BackupLimitError) throw error.cause; if (signal.aborted) signal.throwIfAborted(); throw error; }
    }, signal);
  }
  read(path: string, signal?: AbortSignal): Promise<unknown> {
    return this.run(async (signal) => {
      let file: FileHandle | undefined;
      try {
        file = await open(path, 'r'); const info = await file.stat(); if (!info.isFile()) throw new Error('Choose a backup file.');
        const header = Buffer.alloc(2); await file.read(header, 0, 2, 0); const compressed = header[0] === 0x1f && header[1] === 0x8b; const maximum = compressed ? this.limits.compressedBytes : this.limits.textBytes;
        if (info.size > maximum) throw new BackupLimitError();
        const parts: string[] = []; const decoder = new TextDecoder('utf-8', { fatal: true }); const sink = new Writable({ write(chunk: Buffer, _encoding, callback) { try { parts.push(decoder.decode(chunk, { stream: true })); callback(); } catch (error) { callback(error as Error); } } });
        const source = file.createReadStream({ start: 0, autoClose: false });
        if (compressed) await pipeline(source, byteLimit(maximum), createGunzip(), byteLimit(this.limits.textBytes), sink, { signal });
        else await pipeline(source, byteLimit(maximum), sink, { signal });
        parts.push(decoder.decode()); signal.throwIfAborted(); return JSON.parse(parts.join(''));
      } catch (error) { if (error instanceof BackupLimitError) throw error; if (signal.aborted) signal.throwIfAborted(); throw new Error('The backup could not be read. Choose a complete JSON or gzip JSON backup.', { cause: error }); }
      finally { try { await file?.close(); } catch (error) { throw new Error('The backup file could not be closed. Retry the operation.', { cause: error }); } }
    }, signal);
  }
  async shutdown(): Promise<void> {
    this.closed = true; const jobs = [...this.jobs]; jobs.forEach((job) => job.controller.abort()); await Promise.all(jobs.map((job) => job.promise.catch(() => {})));
  }
}
export const backupFiles = new WorkspaceBackupFiles();
