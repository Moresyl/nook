import { createHash } from 'node:crypto';
import { readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { threadSchema, type Thread, type Workspace } from '../../contracts/workspace';
import { parsePersistentWorkspace } from '../../contracts/temporary-conversations';
import { atomicFile } from './atomic-file';

const maximumBytes = 8 * 1024 * 1024;
const signatureSchema = z.object({ ino: z.string().regex(/^[1-9]\d*$/), mtimeNs: z.string().regex(/^\d+$/) });
const journalSchema = z.object({
  schemaVersion: z.literal(1), baseSha256: z.string().regex(/^[a-f0-9]{64}$/), signature: signatureSchema,
  threads: z.array(z.object({ index: z.number().int().min(0).max(9999), thread: threadSchema })).max(10000),
});
type Signature = z.infer<typeof signatureSchema>;
type Candidate = { bytes: Buffer; threads: Map<number, Thread>; signature: Signature };
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

/** Bind a small response journal to one exact, independent primary-file revision. */
export class WorkspaceCheckpointJournal {
  private baseSha256?: string;
  private signature?: Signature;
  private threads = new Map<number, Thread>();
  private readonly path: string;
  constructor(private readonly directory: string) { this.path = join(directory, 'workspace.checkpoints.json'); }
  get pending(): boolean { return this.threads.size > 0; }

  private async primarySignature(): Promise<Signature | undefined> {
    const info = await stat(join(this.directory, 'workspace.json'), { bigint: true });
    return info.ino === 0n ? undefined : { ino: info.ino.toString(), mtimeNs: info.mtimeNs.toString() };
  }

  async restore(state: Workspace, primaryText?: string): Promise<Workspace> {
    this.baseSha256 = primaryText === undefined ? undefined : hash(primaryText);
    try {
      let bytes: Buffer;
      try {
        if ((await stat(this.path)).size > maximumBytes) throw new Error('Oversized checkpoint journal');
        bytes = await readFile(this.path);
      } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return state; throw error; }
      if (bytes.length > maximumBytes) throw new Error('Oversized checkpoint journal');
      const saved = journalSchema.parse(JSON.parse(bytes.toString('utf8')));
      const signature = await this.primarySignature();
      if (saved.baseSha256 !== this.baseSha256 || !signature || saved.signature.ino !== signature.ino || saved.signature.mtimeNs !== signature.mtimeNs) {
        await rm(this.path, { force: true }).catch(() => {}); return state;
      }
      const threads = new Map(saved.threads.map(item => [item.index, item.thread]));
      if (threads.size !== saved.threads.length) throw new Error('Duplicate checkpoint index');
      const restored = [...state.threads];
      for (const [index, thread] of threads) {
        if (thread.temporary || !restored[index] || restored[index].id !== thread.id) throw new Error('Checkpoint owner does not match its primary revision');
        restored[index] = thread;
      }
      const next = parsePersistentWorkspace({ ...state, threads: restored });
      this.signature = signature; this.threads = threads; return next;
    } catch { throw new Error('Saved response checkpoints could not be read. Restore a valid backup before continuing.'); }
  }

  async prepare(state: Workspace, threadIds: string[]): Promise<Candidate | undefined> {
    if (!this.baseSha256) return undefined;
    try {
      const signature = this.signature ?? await this.primarySignature();
      if (!signature) return undefined;
      const threads = new Map(this.threads);
      for (const id of new Set(threadIds)) {
        const index = state.threads.findIndex(thread => thread.id === id);
        if (index >= 0) threads.set(index, state.threads[index]);
      }
      const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, baseSha256: this.baseSha256, signature,
        threads: [...threads].map(([index, thread]) => ({ index, thread })) }), 'utf8');
      return bytes.length > maximumBytes ? undefined : { bytes, threads, signature };
    } catch (cause) { throw new Error('Local data could not be saved. Check disk space and directory permissions.', { cause }); }
  }

  async commit(candidate: Candidate): Promise<void> {
    await atomicFile(this.path, file => file.writeFile(candidate.bytes));
    this.threads = candidate.threads; this.signature = candidate.signature;
  }

  async reset(primaryBytes: Buffer): Promise<void> {
    this.baseSha256 = hash(primaryBytes); this.signature = undefined; this.threads.clear();
    await rm(this.path, { force: true }).catch(() => {});
  }
}
