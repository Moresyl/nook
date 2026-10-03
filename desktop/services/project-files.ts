import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { directoryRequestSchema, PROJECT_DIRECTORY_PAGE_SIZE, type DirectoryPage, type DirectoryRequest, type FileEntry } from '../../contracts/projects';

const runFile = promisify(execFile);

export async function scopedPath(root: string, path: string): Promise<string> {
  const actualRoot = await realpath(root);
  const candidate = await realpath(resolve(actualRoot, path));
  const displacement = relative(actualRoot, candidate);
  if (displacement === '..' || displacement.startsWith(`..${sep}`) || isAbsolute(displacement)) {
    throw new Error('This path is outside the selected project.');
  }
  return candidate;
}

export async function projectEntries(root: string, path: string): Promise<FileEntry[]> {
  const actualRoot = await realpath(root);
  const directory = await scopedPath(actualRoot, path);
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.filter((entry) => !entry.isSymbolicLink() && !['.git', 'node_modules'].includes(entry.name))
    .map((entry) => ({ name: entry.name, relativePath: relative(actualRoot, resolve(directory, entry.name)).split(sep).join('/'), directory: entry.isDirectory() }))
    .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
}

export async function projectDirectory(root: string, input: DirectoryRequest): Promise<DirectoryPage> {
  const request = directoryRequestSchema.parse(input);
  const entries = await projectEntries(root, request.path);
  const revision = createHash('sha256').update(JSON.stringify(entries)).digest('hex');
  if (request.revision && request.revision !== revision) throw new Error('The project directory changed. Refresh it before loading more entries.');
  const end = request.offset + PROJECT_DIRECTORY_PAGE_SIZE;
  return { entries: entries.slice(request.offset, end), revision, total: entries.length, nextOffset: end < entries.length ? end : null };
}

export async function projectDocument(root: string, path: string): Promise<{ text: string; sha256: string }> {
  const file = await scopedPath(root, path);
  const metadata = await stat(file);
  if (!metadata.isFile() || metadata.size > 256_000) throw new Error('Choose a text file smaller than 256 KB.');
  const bytes = await readFile(file);
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error('This file is not UTF-8 text. Convert it before opening it.'); }
  if (text.includes('\0')) throw new Error('This file is binary and cannot be opened as text.');
  return { text, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export async function projectText(root: string, path: string): Promise<string> { return (await projectDocument(root, path)).text; }

export async function projectDiff(root: string, runner: typeof runFile = runFile): Promise<string> {
  const directory = await realpath(root);
  try {
    const result = await runner('git', ['-C', directory, 'diff', 'HEAD', '--no-ext-diff', '--no-textconv', '--'], { windowsHide: true, timeout: 15_000, maxBuffer: 2_000_000 });
    return String(result.stdout) || 'No tracked changes.';
  } catch { throw new Error('Could not read the Git diff. Check that Git is installed and the project has a commit.'); }
}
