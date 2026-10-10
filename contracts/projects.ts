import { z } from 'zod';

export const revisionSchema = z.string().regex(/^[a-f0-9]{64}$/).nullable();
export const editorDraftSchema = z.object({
  projectId: z.string().min(1).max(128), path: z.string().min(1).max(4096),
  text: z.string().max(256_000), baseText: z.string().max(256_000), baseSha256: revisionSchema,
  updatedAt: z.number().int().nonnegative(),
});
export const saveDocumentSchema = z.object({ path: z.string().min(1).max(4096), text: z.string().max(256_000), expectedSha256: revisionSchema });
export const terminalGeometrySchema = z.object({ cols: z.number().int().min(2).max(500), rows: z.number().int().min(2).max(300) });
export const gitBranchNameSchema = z.string().min(1).max(250).refine(value => !value.startsWith('-') && !/[\x00-\x20\x7f]|@\{/.test(value), { message: 'Enter a valid Git branch name.' });
export const PROJECT_DIRECTORY_PAGE_SIZE = 200;
export const directoryRequestSchema = z.object({
  path: z.string().max(4096).default(''),
  offset: z.number().int().nonnegative().default(0),
  revision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict().refine((request) => request.offset === 0 || request.revision !== undefined, { message: 'Directory pagination requires the preceding listing revision.' });
export type FileEntry = { name: string; relativePath: string; directory: boolean };
export type DirectoryRequest = z.input<typeof directoryRequestSchema>;
export type DirectoryPage = { entries: FileEntry[]; revision: string; total: number; nextOffset: number | null };
export type EditorDraft = z.infer<typeof editorDraftSchema>;
export type FileDocument = { path: string; text: string; sha256: string };
export type SaveDocument = z.infer<typeof saveDocumentSchema>;
export type TerminalGeometry = z.infer<typeof terminalGeometrySchema>;
export type TerminalSession = { id: string; projectId: string; shell: string; cwd: string; status: 'running' | 'exited'; output: string; sequence: number; exitCode?: number };
export type TerminalEvent = { id: string; sequence: number; data?: string; exitCode?: number };
export type GitFile = { path: string; originalPath?: string; index: string; working: string; conflict: boolean };
export type GitStatus = { branch: string; detached: boolean; unborn: boolean; ahead: number; behind: number; files: GitFile[] };
export type GitFileView = { path: string; before: string; after: string; binary: boolean; patch: string };
export type GitBranch = { name: string; current: boolean; worktreePath: string };
export type GitBranches = { status: GitStatus; branches: GitBranch[]; warning?: 'post-switch-error' };
