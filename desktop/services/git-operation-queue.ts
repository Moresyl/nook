export type GitDirectoryIdentity = { path: string; device: string; inode: string };
export type GitRepositoryIdentity = { root: GitDirectoryIdentity; common: GitDirectoryIdentity };

/** Linked worktrees share mutable Git metadata and therefore share one queue. */
export class GitOperationQueue {
  private pending = new Map<string, Promise<unknown>>();
  constructor(private readonly identity: (root: string) => Promise<GitRepositoryIdentity>) {}

  async run<T>(root: string, action: () => Promise<T>): Promise<T> {
    const expected = await this.identity(root);
    const key = JSON.stringify(expected.common);
    const operation = (this.pending.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
      if (JSON.stringify(await this.identity(root)) !== JSON.stringify(expected)) {
        throw new Error('The Git repository changed while this action was waiting. Refresh the project before retrying.');
      }
      return action();
    });
    this.pending.set(key, operation);
    try { return await operation; }
    finally { if (this.pending.get(key) === operation) this.pending.delete(key); }
  }
}
