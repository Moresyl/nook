import { z } from 'zod';

export const worktreeSnapshotLimits = { entries: 4096, fileBytes: 16 * 1024 * 1024, totalBytes: 64 * 1024 * 1024 } as const;
const relativePath = z.string().min(1).max(1024).refine(path => path.split('/').every(part =>
  part.length > 0 && part !== '.' && part !== '..' && part.toLowerCase() !== '.git' &&
  !/[\\\u0000-\u001f<>:"|?*]/.test(part) && !/[. ]$/.test(part) &&
  !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)), 'Choose a supported relative snapshot path.');
const mode = z.number().int().min(0).max(0o777);
export const worktreeSnapshotEntrySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('directory'), path: relativePath, mode }).strict(),
  z.object({ kind: z.literal('file'), path: relativePath, mode, bytes: z.number().int().min(0).max(worktreeSnapshotLimits.fileBytes), sha256: z.string().regex(/^[a-f0-9]{64}$/), data: z.string().max(4 * Math.ceil(worktreeSnapshotLimits.fileBytes / 3)) }).strict(),
]);
export const worktreeSnapshotFilesSchema = z.object({ version: z.literal(1), entries: z.array(worktreeSnapshotEntrySchema).max(worktreeSnapshotLimits.entries) }).strict();
export type WorktreeSnapshotFiles = z.infer<typeof worktreeSnapshotFilesSchema>;
