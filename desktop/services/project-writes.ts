import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { createProjectFolderSchema, type CreateProjectFolder, type FileDocument } from '../../contracts/projects';
import { projectDocument, scopedPath } from './project-files';

export async function writableProjectPath(root: string, path: string): Promise<string> {
  if (isAbsolute(path) || /[:\0]/.test(path)) throw new Error('Use a relative project file path.');
  const actualRoot = await scopedPath(root, '.');
  const candidate = resolve(actualRoot, path);
  const displacement = relative(actualRoot, candidate);
  if (!displacement || displacement === '..' || displacement.startsWith(`..${sep}`) || isAbsolute(displacement)) throw new Error('This path is outside the selected project.');
  const parent = await scopedPath(actualRoot, dirname(displacement));
  const target = resolve(parent, basename(candidate));
  if (relative(actualRoot, target).split(sep).some((part) => part.toLowerCase() === '.git')) throw new Error('Git internal files cannot be modified from the editor.');
  try { if ((await lstat(target)).isSymbolicLink()) throw new Error('File modification through a symbolic link is not allowed.'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return target;
}

export async function optionalProjectDocument(root: string, path: string): Promise<{ text: string; sha256: string } | null> {
  try { return await projectDocument(root, path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

export async function createProjectFolder(root: string, input: CreateProjectFolder): Promise<string> {
  const { directory, name } = createProjectFolderSchema.parse(input);
  const path = directory ? `${directory}/${name}` : name;
  try {
    const target = await writableProjectPath(root, path);
    await mkdir(target);
    return path.replaceAll('\\', '/');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('A file or folder with that name already exists.', { cause });
    if (/^E[A-Z]+$/.test((cause as NodeJS.ErrnoException).code ?? '')) throw new Error('The project folder could not be created. Check the parent folder and permissions.', { cause });
    throw cause;
  }
}

const writes = new Map<string, Promise<unknown>>();
export async function saveProjectDocument(root: string, path: string, text: string, expectedSha256: string | null, expectedTarget?: string): Promise<FileDocument> {
  try {
    const target = await writableProjectPath(root, path);
    const key = process.platform === 'win32' ? target.toLowerCase() : target;
    const operation = (writes.get(key) ?? Promise.resolve()).catch(() => {}).then(() => persistProjectDocument(root, path, text, expectedSha256, expectedTarget));
    writes.set(key, operation);
    try { return await operation; }
    finally { if (writes.get(key) === operation) writes.delete(key); }
  } catch (cause) {
    if (cause instanceof Error && /^E[A-Z]+$/.test((cause as NodeJS.ErrnoException).code ?? '')) throw new Error('The project file could not be saved. Check disk space and directory permissions.', { cause });
    throw cause;
  }
}

async function persistProjectDocument(root: string, path: string, text: string, expectedSha256: string | null, expectedTarget?: string): Promise<FileDocument> {
  if (text.includes('\0') || Buffer.byteLength(text, 'utf8') > 256_000) throw new Error('Save a UTF-8 text file smaller than 256 KB.');
  const target = await writableProjectPath(root, path);
  const current = await optionalProjectDocument(root, path);
  if ((current?.sha256 ?? null) !== expectedSha256 || (expectedTarget && expectedTarget !== target)) throw new Error('The file changed while approval was pending. Reopen it or compare your draft before saving.');
  const staging = resolve(dirname(target), `.qiyao-${randomUUID()}.tmp`);
  let mode = 0o600;
  try { mode = (await stat(target)).mode & 0o777; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  try {
    await writeFile(staging, text, { encoding: 'utf8', flag: 'wx', mode });
    if (await writableProjectPath(root, path) !== target || ((await optionalProjectDocument(root, path))?.sha256 ?? null) !== expectedSha256) throw new Error('The file changed before saving. Compare your draft before saving.');
    await rename(staging, target);
  }
  finally { await rm(staging, { force: true }); }
  return { path, text, sha256: createHash('sha256').update(text).digest('hex') };
}
