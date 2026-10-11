import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { ownedWorktreePathSchema, worktreePinSchema, type ManagedWorktree } from '../../contracts/worktree-ownership';
import { worktreePathKey } from '../../contracts/worktree-overview';
import type { GitWorktree } from '../../contracts/project-worktrees';
import { atomicJson } from './atomic-json';

const runFile = promisify(execFile);
const fileIdentitySchema = z.object({ path: ownedWorktreePathSchema, device: z.string().regex(/^\d+$/), inode: z.string().regex(/^[1-9]\d*$/) }).strict();
const identitySchema = z.object({ directory: fileIdentitySchema, common: fileIdentitySchema, admin: fileIdentitySchema, gitFileSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const conversationIdsSchema = z.array(z.string().min(1).max(128)).max(10_000);
const recordSchema = z.object({ id: z.uuid(), createdAt: z.number().int().nonnegative(), pinned: z.boolean(), identity: identitySchema, conversationIds: conversationIdsSchema.optional().refine(ids => !ids || new Set(ids).size === ids.length, 'Conversation associations must be unique.') }).strict();
const ledgerSchema = z.object({ version: z.literal(1), records: z.array(recordSchema).max(1000) }).strict().refine(value => new Set(value.records.map(row => row.id)).size === value.records.length && new Set(value.records.map(row => worktreePathKey(row.identity.directory.path))).size === value.records.length, 'Managed worktree records must have unique identities.');
type Identity = z.infer<typeof identitySchema>;
type Ledger = z.infer<typeof ledgerSchema>;
type IdentitySnapshot = { trees: GitWorktree[]; common: z.infer<typeof fileIdentitySchema> };
const same = (one: Identity, two: Identity) => JSON.stringify(one) === JSON.stringify(two);

/** Local creation receipts are deliberately separate from shareable workspace backups. */
export class WorktreeOwnership {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string, private readonly readWorktrees: (root: string) => Promise<GitWorktree[]>, private readonly writer: typeof atomicJson = atomicJson) {
    ownedWorktreePathSchema.parse(file);
  }

  private async ordered<T>(operation: () => Promise<T>): Promise<T> {
    const current = this.pending.catch(() => {}).then(operation); this.pending = current;
    return current;
  }

  private async read(): Promise<Ledger> {
    const details = await lstat(this.file).catch(cause => {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new Error('Managed worktree records could not be read. Existing files were retained.', { cause });
    });
    if (!details) return { version: 1, records: [] };
    try {
      if (!details.isFile() || details.isSymbolicLink() || details.size > 2_000_000) throw new Error();
      return ledgerSchema.parse(JSON.parse(await readFile(this.file, 'utf8')));
    } catch (cause) {
      throw new Error('Managed worktree records could not be read. Existing files were retained.', { cause });
    }
  }

  private async save(ledger: Ledger): Promise<void> {
    try { ledgerSchema.parse(ledger); if (Buffer.byteLength(JSON.stringify(ledger), 'utf8') > 2_000_000) throw new Error(); await this.writer(this.file, ledger); }
    catch (cause) { throw new Error('Managed worktree records could not be saved. Existing worktrees were retained.', { cause }); }
  }

  private async directory(path: string): Promise<z.infer<typeof fileIdentitySchema>> {
    ownedWorktreePathSchema.parse(path);
    const actual = await realpath(path), details = await lstat(path, { bigint: true });
    if (worktreePathKey(actual) !== worktreePathKey(path) || !details.isDirectory() || details.isSymbolicLink() || details.ino === 0n) throw new Error();
    return fileIdentitySchema.parse({ path: actual, device: String(details.dev), inode: String(details.ino) });
  }

  private async gitDirectories(root: string) {
    ownedWorktreePathSchema.parse(root);
    const { stdout } = await runFile('git', ['--no-pager', '-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir', '--git-dir'], { encoding: 'buffer', windowsHide: true, timeout: 30_000, maxBuffer: 16_384, env: { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } });
    const paths = new TextDecoder('utf-8', { fatal: true }).decode(stdout).replace(/\r?\n$/, '').split(/\r?\n/);
    if (paths.length !== 2 || paths.some(path => !isAbsolute(path))) throw new Error();
    return { common: await this.directory(paths[0]), admin: await this.directory(paths[1]) };
  }

  private async identity(root: string, path: string, snapshot?: IdentitySnapshot): Promise<Identity> {
    ownedWorktreePathSchema.parse(root); ownedWorktreePathSchema.parse(path);
    const trees = snapshot?.trees ?? await this.readWorktrees(root), tree = trees.find(row => worktreePathKey(row.path) === worktreePathKey(path));
    if (!tree || tree === trees[0] || tree.bare || !tree.head || tree.prunable !== undefined) throw new Error();
    const directory = await this.directory(path), marker = join(directory.path, '.git'), details = await lstat(marker);
    if (!details.isFile() || details.isSymbolicLink() || details.size > 8192) throw new Error();
    const bytes = await readFile(marker), sourceCommon = snapshot?.common ?? (await this.gitDirectories(root)).common, target = await this.gitDirectories(path);
    if (JSON.stringify(sourceCommon) !== JSON.stringify(target.common) || worktreePathKey(target.admin.path) === worktreePathKey(target.common.path)) throw new Error();
    return { directory, common: target.common, admin: target.admin, gitFileSha256: createHash('sha256').update(bytes).digest('hex') };
  }

  /** Called only after this application successfully creates a new Git worktree. */
  async recordCreated(root: string, path: string): Promise<ManagedWorktree> {
    ownedWorktreePathSchema.parse(root); ownedWorktreePathSchema.parse(path);
    return this.ordered(async () => {
      let identity: Identity;
      try { identity = await this.identity(root, path); }
      catch (cause) { throw new Error('The new worktree could not be verified for managed cleanup. Its files were retained.', { cause }); }
      const ledger = await this.read(), existing = ledger.records.find(row => worktreePathKey(row.identity.directory.path) === worktreePathKey(path));
      if (existing) {
        if (!same(existing.identity, identity)) throw new Error('The managed worktree folder changed. Its files were retained.');
        return { id: existing.id, path: identity.directory.path, createdAt: existing.createdAt, pinned: existing.pinned, verified: true, ...(existing.conversationIds ? { conversationIds: [...existing.conversationIds] } : {}) };
      }
      const record = recordSchema.parse({ id: randomUUID(), createdAt: Date.now(), pinned: false, identity });
      ledger.records.push(record); ledgerSchema.parse(ledger);
      await this.save(ledger);
      return { id: record.id, path: identity.directory.path, createdAt: record.createdAt, pinned: false, verified: true };
    });
  }

  async list(root: string): Promise<ManagedWorktree[]> {
    ownedWorktreePathSchema.parse(root);
    return this.ordered(async () => {
      const ledger = await this.read();
      let common: z.infer<typeof fileIdentitySchema>;
      try { common = (await this.gitDirectories(root)).common; }
      catch (cause) { throw new Error('The managed worktree repository could not be checked. Refresh the list.', { cause }); }
      const records = ledger.records.filter(row => worktreePathKey(row.identity.common.path) === worktreePathKey(common.path));
      const snapshot = { common, trees: records.length ? await this.readWorktrees(root).catch(() => []) : [] };
      const result: ManagedWorktree[] = [];
      for (const record of records) {
        let verified = false;
        try { verified = same(record.identity, await this.identity(root, record.identity.directory.path, snapshot)); } catch { /* A stale receipt never grants ownership. */ }
        result.push({ id: record.id, path: record.identity.directory.path, createdAt: record.createdAt, pinned: record.pinned, verified, ...(record.conversationIds ? { conversationIds: [...record.conversationIds] } : {}) });
      }
      return result;
    });
  }

  /** Preserve local chat associations before project metadata is removed; never create a receipt. */
  async rememberConversations(path: string, raw: unknown): Promise<void> {
    ownedWorktreePathSchema.parse(path); const ids = conversationIdsSchema.parse(raw); if (!ids.length) return;
    await this.ordered(async () => {
      const ledger = await this.read(), record = ledger.records.find(row => worktreePathKey(row.identity.directory.path) === worktreePathKey(path)); if (!record) return;
      const next = [...new Set([...(record.conversationIds ?? []), ...ids])]; if (record.conversationIds?.length === next.length && next.every((id, index) => id === record.conversationIds![index])) return;
      record.conversationIds = next; await this.save(ledger);
    });
  }

  async setPinned(root: string, raw: unknown, validateSource: () => void = () => {}): Promise<void> {
    ownedWorktreePathSchema.parse(root); const input = worktreePinSchema.parse(raw);
    await this.ordered(async () => {
      const ledger = await this.read(), record = ledger.records.find(row => worktreePathKey(row.identity.directory.path) === worktreePathKey(input.path));
      if (!record) throw new Error('This worktree was not created by this application. Its files were retained.');
      let identity: Identity;
      try { identity = await this.identity(root, input.path); }
      catch (cause) { throw new Error('The managed worktree folder changed. Its files were retained.', { cause }); }
      if (!same(record.identity, identity)) throw new Error('The managed worktree folder changed. Its files were retained.');
      validateSource();
      if (record.pinned === input.pinned) return;
      record.pinned = input.pinned; await this.save(ledger);
    });
  }

  /** Keep pin changes ordered with the final identity check, removal and receipt update. */
  async removeVerified(root: string, path: string, receiptId: string, remove: (verify: () => Promise<void>) => Promise<void>, validateSource: () => void): Promise<'saved' | 'failed'> {
    ownedWorktreePathSchema.parse(root); ownedWorktreePathSchema.parse(path); z.uuid().parse(receiptId);
    return this.ordered(async () => {
      const ledger = await this.read(), record = ledger.records.find(row => row.id === receiptId && worktreePathKey(row.identity.directory.path) === worktreePathKey(path));
      if (!record || record.pinned) throw new Error('This worktree is pinned or has no matching local creation receipt. Its files were retained.');
      const verify = async () => {
        let identity: Identity;
        try { identity = await this.identity(root, path); }
        catch (cause) { throw new Error('The managed worktree folder changed. Its files were retained.', { cause }); }
        if (!same(record.identity, identity)) throw new Error('The managed worktree folder changed. Its files were retained.');
        validateSource();
      };
      await verify(); await remove(verify);
      ledger.records = ledger.records.filter(row => row.id !== receiptId);
      try { await this.save(ledger); return 'saved'; } catch { return 'failed'; }
    });
  }
}
