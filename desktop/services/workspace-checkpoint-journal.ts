import { createHash } from 'node:crypto';
import { readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { composerDraftSchema, quickChatStateSchema, threadSchema, type QuickChatState, type Thread, type Workspace } from '../../contracts/workspace';
import { parsePersistentWorkspace } from '../../contracts/temporary-conversations';
import { atomicFile } from './atomic-file';

const maximumBytes = 8 * 1024 * 1024;
const signatureSchema = z.object({ ino: z.string().regex(/^[1-9]\d*$/), mtimeNs: z.string().regex(/^\d+$/) });
const composerSchema = z.object({
  composerDrafts: z.array(composerDraftSchema).max(100), activeThreadId: z.string().min(1).max(128).optional(),
}).strict();
const journalSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]), baseSha256: z.string().regex(/^[a-f0-9]{64}$/), signature: signatureSchema,
  threads: z.array(z.object({ index: z.number().int().min(0).max(9999), thread: threadSchema })).max(10000),
  composer: composerSchema.optional(),
  quickChat: quickChatStateSchema.nullable().optional(),
});
type Signature = z.infer<typeof signatureSchema>;
type Composer = z.infer<typeof composerSchema>;
type Candidate = { bytes: Buffer; threads: Map<number, Thread>; signature: Signature; composer?: Composer; quickChat?: QuickChatState | null };
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

function validDraftOwners(composer: Composer, threads: Thread[]): boolean {
  const owners = new Set(threads.map(thread => thread.id));
  return (!composer.activeThreadId || owners.has(composer.activeThreadId))
    && composer.composerDrafts.every(draft => !draft.threadId || owners.has(draft.threadId));
}

/** Bind a small response journal to one exact, independent primary-file revision. */
export class WorkspaceCheckpointJournal {
  private baseSha256?: string;
  private signature?: Signature;
  private threads = new Map<number, Thread>();
  private composer?: Composer;
  private quickChat?: QuickChatState | null;
  private readonly path: string;
  constructor(private readonly directory: string) { this.path = join(directory, 'workspace.checkpoints.json'); }
  get pending(): boolean { return this.threads.size > 0 || this.composer !== undefined || this.quickChat !== undefined; }

  private async primarySignature(): Promise<Signature | undefined> {
    const info = await stat(join(this.directory, 'workspace.json'), { bigint: true });
    return !info.isFile() || info.ino === 0n ? undefined : { ino: info.ino.toString(), mtimeNs: info.mtimeNs.toString() };
  }

  async restore(state: Workspace, primaryText?: string): Promise<Workspace> {
    this.baseSha256 = primaryText === undefined ? undefined : hash(primaryText);
    try {
      let bytes: Buffer;
      try {
        if ((await stat(this.path)).size > maximumBytes) throw new Error('Oversized checkpoint journal');
        bytes = await readFile(this.path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        this.signature = primaryText === undefined ? undefined : await this.primarySignature().catch(() => undefined);
        return state;
      }
      if (bytes.length > maximumBytes) throw new Error('Oversized checkpoint journal');
      const saved = journalSchema.parse(JSON.parse(bytes.toString('utf8')));
      if (saved.schemaVersion === 1 && saved.composer) throw new Error('Legacy response journals cannot contain draft changes');
      if (saved.schemaVersion !== 3 && saved.quickChat !== undefined) throw new Error('Legacy response journals cannot contain quick-chat changes');
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
        ...(saved.composer ? { composerDrafts: saved.composer.composerDrafts, activeThreadId: saved.composer.activeThreadId } : {}),
        ...(saved.quickChat !== undefined ? { quickChat: saved.quickChat ?? undefined } : {}) });
      if (saved.composer && !validDraftOwners(saved.composer, restored)) throw new Error('Draft owner does not match its primary revision');
      if (saved.quickChat && !validDraftOwners(saved.quickChat, restored)) throw new Error('Quick-chat draft owner does not match its primary revision');
      this.signature = signature; this.threads = threads; this.composer = saved.composer; this.quickChat = saved.quickChat; return next;
    } catch { throw new Error('Saved response checkpoints could not be read. Restore a valid backup before continuing.'); }
  }

  async prepare(state: Workspace, threadIds: string[], includeComposer = false, includeQuickChat = false): Promise<Candidate | undefined> {
    if (!this.baseSha256) return undefined;
    try {
      const signature = await this.primarySignature();
      if (!signature || !this.signature || signature.ino !== this.signature.ino || signature.mtimeNs !== this.signature.mtimeNs) return undefined;
      const threads = new Map(this.threads);
      for (const id of new Set(threadIds)) {
        const index = state.threads.findIndex(thread => thread.id === id);
        if (index >= 0) threads.set(index, state.threads[index]);
      }
      const composer = includeComposer || this.composer ? { composerDrafts: state.composerDrafts, activeThreadId: state.activeThreadId } : undefined;
      const quickChat = includeQuickChat || this.quickChat !== undefined ? state.quickChat ?? null : undefined;
      if (composer && !validDraftOwners(composer, state.threads) || quickChat && !validDraftOwners(quickChat, state.threads)) return undefined;
      const bytes = Buffer.from(JSON.stringify({ schemaVersion: quickChat !== undefined ? 3 : composer ? 2 : 1, baseSha256: this.baseSha256, signature,
        threads: [...threads].map(([index, thread]) => ({ index, thread })), ...(composer ? { composer } : {}), ...(quickChat !== undefined ? { quickChat } : {}) }), 'utf8');
      return bytes.length > maximumBytes ? undefined : { bytes, threads, signature, composer, quickChat };
    } catch (cause) { throw new Error('Local data could not be saved. Check disk space and directory permissions.', { cause }); }
  }

  async commit(candidate: Candidate): Promise<void> {
    await atomicFile(this.path, file => file.writeFile(candidate.bytes));
    this.threads = candidate.threads; this.signature = candidate.signature; this.composer = candidate.composer; this.quickChat = candidate.quickChat;
  }

  async reset(primaryBytes: Buffer): Promise<void> {
    this.baseSha256 = hash(primaryBytes); this.signature = await this.primarySignature().catch(() => undefined); this.threads.clear(); this.composer = undefined; this.quickChat = undefined;
    await rm(this.path, { force: true }).catch(() => {});
  }
}
