import { lstat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { scopedPath } from './project-files';

export class ProjectEntryActions {
  constructor(private readonly projectRoot: (id: string) => string, private readonly showItem: (path: string) => void) {}

  async path(id: string, path: string): Promise<string> {
    const root = this.projectRoot(id);
    let target: string;
    try {
      if (typeof path !== 'string' || !path || path.length > 4096 || isAbsolute(path) || /[:\0]/.test(path)) throw new Error('Invalid project path.');
      const actualRoot = await scopedPath(root, '.');
      const candidate = resolve(actualRoot, path), displacement = relative(actualRoot, candidate);
      if (!displacement || displacement === '..' || displacement.startsWith(`..${sep}`) || isAbsolute(displacement)
        || displacement.split(sep).some(part => ['.git', 'node_modules'].includes(part.toLowerCase()))) throw new Error('Invalid project entry.');
      target = await scopedPath(actualRoot, displacement);
      const metadata = await lstat(candidate);
      if (metadata.isSymbolicLink() || !metadata.isFile() && !metadata.isDirectory()) throw new Error('Unsupported project entry.');
    } catch (cause) {
      throw new Error('The project entry could not be found. Refresh the file tree and retry.', { cause });
    }
    if (this.projectRoot(id) !== root) throw new Error('The selected project changed. Retry from its file tree.');
    return target;
  }

  async reveal(id: string, path: string): Promise<void> {
    const target = await this.path(id, path);
    try { this.showItem(target); }
    catch (cause) { throw new Error('The project entry could not be revealed in the file manager. Retry from its file tree.', { cause }); }
  }
}
