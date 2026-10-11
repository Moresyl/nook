import { lstat, mkdir, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { worktreePreferencesSchema } from '../../contracts/project-worktrees';

export class ManagedWorktreeRoots {
  readonly defaultRoot: string;
  constructor(defaultRoot: string) {
    const root = worktreePreferencesSchema.parse({ root: defaultRoot }).root;
    if (!root || !isAbsolute(root)) throw new Error('Choose an absolute default worktree directory.');
    this.defaultRoot = resolve(root);
  }

  async prepare(configuredRoot: string, target: string, worktreePaths: readonly string[]): Promise<void> {
    const root = worktreePreferencesSchema.parse({ root: configuredRoot }).root;
    if (root || !isAbsolute(target) || resolve(dirname(target)) !== this.defaultRoot) return;
    try {
      const parent = await realpath(dirname(this.defaultRoot));
      const planned = join(parent, basename(this.defaultRoot), basename(target));
      for (const path of worktreePaths) {
        const displacement = relative(resolve(path), planned);
        if (!displacement || displacement !== '..' && !displacement.startsWith(`..${sep}`) && !isAbsolute(displacement)) throw new Error('The default folder is inside an existing worktree.');
      }
      try { await mkdir(this.defaultRoot); }
      catch (failure) { if ((failure as NodeJS.ErrnoException).code !== 'EEXIST') throw failure; }
      const folder = await lstat(this.defaultRoot);
      if (folder.isSymbolicLink() || !folder.isDirectory()) throw new Error('The default root must be a directory without a directory link.');
    } catch (cause) {
      throw new Error('The default worktree directory could not be prepared. Choose an existing root folder in settings.', { cause });
    }
  }
}
