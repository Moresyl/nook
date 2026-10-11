import { z } from 'zod';
import { ownedWorktreePathSchema } from './worktree-ownership';
import { worktreeSnapshotFilesSchema } from './worktree-snapshot-files';

export const worktreeSnapshotStorageLimits = { indexBytes: 8 * 1024 * 1024, packBytes: 64 * 1024 * 1024, textBytes: 192 * 1024 * 1024, compressedBytes: 128 * 1024 * 1024, snapshots: 100 } as const;
const blob = (maximum: number) => z.object({ bytes: z.number().int().min(1).max(maximum), sha256: z.string().regex(/^[a-f0-9]{64}$/), data: z.string().max(4 * Math.ceil(maximum / 3)) }).strict();
const common = z.object({ path: ownedWorktreePathSchema, device: z.string().regex(/^\d+$/), inode: z.string().regex(/^[1-9]\d*$/) }).strict();
export const worktreeSnapshotSchema = z.object({
  version: z.literal(1), id: z.uuid(), receiptId: z.uuid(), createdAt: z.number().int().nonnegative(),
  originalPath: ownedWorktreePathSchema, common, head: z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/),
  index: blob(worktreeSnapshotStorageLimits.indexBytes), pack: blob(worktreeSnapshotStorageLimits.packBytes), files: worktreeSnapshotFilesSchema,
}).strict();
export type WorktreeSnapshot = z.infer<typeof worktreeSnapshotSchema>;
export type WorktreeSnapshotSummary = Omit<WorktreeSnapshot, 'files' | 'index' | 'pack'> & { entries: number; fileBytes: number };
