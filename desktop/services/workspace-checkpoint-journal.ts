import { createHash } from 'node:crypto';
import { readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { composerDraftSchema, threadSchema, type Thread, type Workspace } from '../../contracts/workspace';
import { parsePersistentWorkspace } from '../../contracts/temporary-conversations';
import { atomicFile } from './atomic-file';

const maximumBytes = 8 * 1024 * 1024;
const signatureSchema = z.object({ ino: z.string().regex(/^[1-9]\d*$/), mtimeNs: z.string().regex(/^\d+$/) });
const composerSchema = z.object({
  composerDrafts: z.array(composerDraftSchema).max(100), activeThreadId: z.string().min(1).max(128).optional(),
}).strict();
const journalSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]), baseSha256: z.string().regex(/^[a-f0-9]{64}$/), signature: signatureSchema,
  threads: z.array(z.object({ index: z.number().int().min(0).max(9999), thread: threadSchema })).max(10000),
  composer: composerSchema.optional(),
});
type Signature = z.infer<typeof signatureSchema>;
type Composer = z.infer<typeof composerSchema>;
type Candidate = { bytes: Buffer; threads: Map<number, Thread>; signature: Signature; composer?: Composer };
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

/** Bind a small response journal to one exact, independent primary-file revision. */
export class WorkspaceCheckpointJournal {
  private baseSha256?: string;
  private signature?: Signature;
  private threads = new Map<number, Thread>();
  private composer?: Composer;
  private readonly path: string;
  constructor(private readonly directory: string) { this.path = join(directory, 'workspace.checkpoints.json'); }
  get pending(): boolean { return this.threads.size > 0 || this.composer !== undefined; }

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
      if (saved.schemaVersion === 1 && saved.composer) throw new Error('Legacy response journals cannot contain draft changes');
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
      const next = parsePersistentWorkspace({ ...state, threads: restored,
        ...(saved.composer ? { composerDrafts: saved.composer.composerDrafts, activeThreadId: saved.composer.activeThreadId } : {}) });
      if (saved.composer && (saved.composer.activeThreadId && !restored.some(thread => thread.id === saved.composer!.activeThreadId)
        || saved.composer.composerDrafts.some(draft => draft.threadId && !restored.some(thread => thread.id === draft.threadId)))) throw new Error('Draft owner does not match its primary revision');
      this.signature = signature; this.threads = threads; this.composer = saved.composer; return next;
    } catch { throw new Error('Saved response checkpoints could not be read. Restore a valid backup before continuing.'); }
  }

  async prepare(state: Workspace, threadIds: string[], includeComposer = false): Promise<Candidate | undefined> {
    if (!this.baseSha256) return undefined;
    try {
      const signature = this.signature ?? await this.primarySignature();
      if (!signature) return undefined;
      const threads = new Map(this.threads);
      for (const id of new Set(threadIds)) {
        const index = state.threads.findIndex(thread => thread.id === id);
        if (index >= 0) threads.set(index, state.threads[index]);
      }
      const composer = includeComposer || this.composer ? { composerDrafts: state.composerDrafts, activeThreadId: state.activeThreadId } : undefined;
      if (composer && (composer.activeThreadId && !state.threads.some(thread => thread.id === composer.activeThreadId)
        || composer.composerDrafts.some(draft => draft.threadId && !state.threads.some(thread => thread.id === draft.threadId)))) return undefined;
      const bytes = Buffer.from(JSON.stringify({ schemaVersion: composer ? 2 : 1, baseSha256: this.baseSha256, signature,
        threads: [...threads].map(([index, thread]) => ({ index, thread })), ...(composer ? { composer } : {}) }), 'utf8');
      return bytes.length > maximumBytes ? undefined : { bytes, threads, signature, composer };
    } catch (cause) { throw new Error('Local data could not be saved. Check disk space and directory permissions.', { cause }); }
  }

  async commit(candidate: Candidate): Promise<void> {
    await atomicFile(this.path, file => file.writeFile(candidate.bytes));
    this.threads = candidate.threads; this.signature = candidate.signature; this.composer = candidate.composer;
  }

  async reset(primaryBytes: Buffer): Promise<void> {
    this.baseSha256 = hash(primaryBytes); this.signature = undefined; this.threads.clear(); this.composer = undefined;
    await rm(this.path, { force: true }).catch(() => {});
  }
}
