import type { BigIntStats } from 'node:fs';

export function snapshotFileIdentity(info: BigIntStats): string {
  return [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs, info.mode, info.nlink].map(String).join(':');
}

/** Windows lstat reports dev=0 while fstat reports the volume serial. Keep inode and every content-change field. */
export function sameOpenedSnapshotFile(path: BigIntStats, opened: BigIntStats): boolean {
  if (process.platform !== 'win32') return snapshotFileIdentity(path) === snapshotFileIdentity(opened);
  return [path.ino, path.size, path.mtimeNs, path.ctimeNs, path.mode, path.nlink].map(String).join(':') ===
    [opened.ino, opened.size, opened.mtimeNs, opened.ctimeNs, opened.mode, opened.nlink].map(String).join(':');
}
