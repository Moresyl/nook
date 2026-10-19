import { z } from 'zod';
import type { ProjectFileSearchResult } from '../../contracts/projects';
import { projectEntries } from './project-files';

const querySchema = z.string().trim().min(1).max(256);

export async function searchProjectFiles(root: string, query: string, list = projectEntries): Promise<ProjectFileSearchResult> {
  const needle = querySchema.parse(query).replaceAll('\\', '/').toLocaleLowerCase();
  const pending = [''];
  const entries: ProjectFileSearchResult['entries'] = [];
  let visited = 0, skippedDirectories = 0, truncated = false;
  for (let index = 0; index < pending.length && !truncated; index++) {
    let children;
    try { children = await list(root, pending[index]); }
    catch (error) { if (index === 0) throw error; skippedDirectories++; continue; }
    for (const entry of children) {
      if (++visited > 10_000) { truncated = true; break; }
      if (entry.directory) { pending.push(entry.relativePath); continue; }
      if (!entry.relativePath.toLocaleLowerCase().includes(needle)) continue;
      entries.push(entry);
      if (entries.length === 100) { truncated = true; break; }
    }
  }
  return { entries, truncated, skippedDirectories };
}
