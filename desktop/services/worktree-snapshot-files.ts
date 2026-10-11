import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, open, readdir, realpath } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { BigIntStats } from 'node:fs';
import { worktreeSnapshotFilesSchema, worktreeSnapshotLimits, type WorktreeSnapshotFiles } from '../../contracts/worktree-snapshot-files';
import { sameOpenedSnapshotFile, snapshotFileIdentity as identity } from './snapshot-file-identity';

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const key = (path: string) => path.toLowerCase();
const canonicalKey = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path;
const retained = 'The worktree snapshot could not be verified. Existing files were retained.';

/** Check the complete manifest before restoration writes any file. */
export function validateWorktreeSnapshotFiles(raw: unknown): WorktreeSnapshotFiles {
  const manifest = worktreeSnapshotFilesSchema.parse(raw), paths = new Map<string, string>(); let total = 0;
  for (const entry of manifest.entries) {
    const name = key(entry.path);
    if (paths.has(name)) throw new Error(retained);
    paths.set(name, entry.kind);
    if (entry.kind === 'file') {
      const bytes = Buffer.from(entry.data, 'base64'); total += bytes.length;
      if (bytes.length !== entry.bytes || bytes.toString('base64') !== entry.data || digest(bytes) !== entry.sha256 || total > worktreeSnapshotLimits.totalBytes) throw new Error(retained);
    }
  }
  for (const entry of manifest.entries) {
    const parts = entry.path.split('/'); parts.pop();
    while (parts.length) { if (paths.get(key(parts.join('/'))) !== 'directory') throw new Error(retained); parts.pop(); }
  }
  return manifest;
}

async function directory(path: string): Promise<BigIntStats> {
  const info = await lstat(path, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink() || info.ino === 0n || canonicalKey(await realpath(path)) !== canonicalKey(resolve(path))) throw new Error(retained);
  return info;
}

/** Preserve raw tracked, ignored and untracked bytes; reject links and unsupported trees. Git metadata is stored separately. */
export async function captureWorktreeSnapshotFiles(root: string): Promise<WorktreeSnapshotFiles> {
  const actual = resolve(root), entries: WorktreeSnapshotFiles['entries'] = [], observed = new Map<string, string>(); let total = 0;
  const walk = async (folder: string, prefix: string): Promise<void> => {
    const before = await directory(folder);
    observed.set(folder, identity(before));
    for (const name of (await readdir(folder)).sort()) {
      if (!prefix && name === '.git') continue;
      const path = join(folder, name), relative = prefix ? `${prefix}/${name}` : name;
      const info = await lstat(path, { bigint: true });
      observed.set(path, identity(info));
      if (info.isSymbolicLink() || info.ino === 0n || !info.isDirectory() && (!info.isFile() || info.nlink !== 1n)) throw new Error(retained);
      if (entries.length >= worktreeSnapshotLimits.entries) throw new Error(retained);
      const mode = Number(info.mode & 0o777n);
      if (info.isDirectory()) { entries.push({ kind: 'directory', path: relative, mode }); await walk(path, relative); }
      else {
        total += Number(info.size);
        if (info.size > BigInt(worktreeSnapshotLimits.fileBytes) || total > worktreeSnapshotLimits.totalBytes) throw new Error(retained);
        const file = await open(path, 'r');
        try {
          const opened = await file.stat({ bigint: true });
          if (!sameOpenedSnapshotFile(info, opened)) throw new Error(retained);
          const buffer = Buffer.alloc(Number(info.size) + 1); let length = 0;
          while (length < buffer.length) {
            const read = await file.read(buffer, length, buffer.length - length, length);
            if (!read.bytesRead) break;
            length += read.bytesRead;
          }
          const bytes = buffer.subarray(0, length);
          if (bytes.length !== Number(info.size) || identity(await file.stat({ bigint: true })) !== identity(opened) || identity(await lstat(path, { bigint: true })) !== identity(info)) throw new Error(retained);
          entries.push({ kind: 'file', path: relative, mode, bytes: bytes.length, sha256: digest(bytes), data: bytes.toString('base64') });
        } finally { await file.close(); }
      }
    }
    if (identity(await directory(folder)) !== identity(before)) throw new Error(retained);
  };
  try {
    await walk(actual, '');
    for (const [path, expected] of observed) if (identity(await lstat(path, { bigint: true })) !== expected) throw new Error(retained);
    return validateWorktreeSnapshotFiles({ version: 1, entries });
  }
  catch (cause) { throw new Error(retained, { cause }); }
}

/** Restore into a new empty checkout only. Never overwrite existing worktree files or its .git marker. */
export async function restoreWorktreeSnapshotFiles(root: string, raw: unknown): Promise<void> {
  const manifest = validateWorktreeSnapshotFiles(raw), actual = resolve(root), original = await directory(actual);
  const present = await readdir(actual);
  if (present.some(name => name !== '.git')) throw new Error('Choose an empty worktree folder for restoration. Existing files were retained.');
  if (present.includes('.git')) { const marker = await lstat(join(actual, '.git')); if (!marker.isFile() || marker.isSymbolicLink()) throw new Error(retained); }
  const rootIdentity = [original.dev, original.ino].map(String).join(':');
  const ordered = [...manifest.entries].sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path));
  try {
    for (const entry of ordered) {
      const current = await directory(actual);
      if ([current.dev, current.ino].map(String).join(':') !== rootIdentity) throw new Error(retained);
      const parts = entry.path.split('/'); parts.pop(); let parent = actual;
      for (const part of parts) { parent = join(parent, part); await directory(parent); }
      const path = resolve(actual, entry.path);
      if (!path.startsWith(`${actual}${sep}`)) throw new Error(retained);
      if (entry.kind === 'directory') await mkdir(path, { mode: 0o700 });
      else {
        const file = await open(path, 'wx', 0o600);
        try { await file.writeFile(Buffer.from(entry.data, 'base64')); await file.sync(); }
        finally { await file.close(); }
        await chmod(path, entry.mode);
      }
    }
    for (const entry of ordered.reverse()) if (entry.kind === 'directory') await chmod(join(actual, entry.path), entry.mode);
    const restored = await captureWorktreeSnapshotFiles(actual);
    const normalized = (value: WorktreeSnapshotFiles) => JSON.stringify([...value.entries].sort((a, b) => a.path.localeCompare(b.path)));
    if (normalized(restored) !== normalized(manifest)) throw new Error(retained);
  } catch (cause) { throw new Error('The snapshot restoration did not complete. Existing files and the snapshot were retained; use a new folder to retry.', { cause }); }
}
