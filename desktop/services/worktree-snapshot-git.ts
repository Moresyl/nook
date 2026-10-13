import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { worktreeSnapshotStorageLimits, type WorktreeSnapshot } from '../../contracts/worktree-snapshots';
import { sameOpenedSnapshotFile, snapshotFileIdentity as fingerprint } from './snapshot-file-identity';

export type WorktreeSnapshotGit = Pick<WorktreeSnapshot, 'common' | 'head' | 'index' | 'pack'>;
const failure = 'Git could not verify a complete worktree snapshot. Existing files were retained.';
const canonical = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path;
const blob = (bytes: Buffer) => ({ bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), data: bytes.toString('base64') });

/** Bounded binary transport for pack-objects and index-pack; never expose Git stderr or credentials. */
export function runGitSnapshotCommand(root: string, args: string[], input = Buffer.alloc(0), maximum = 2_000_000): Promise<Buffer> {
  if (!isAbsolute(root) || input.length > worktreeSnapshotStorageLimits.packBytes || !Number.isSafeInteger(maximum) || maximum <= 0 || maximum > worktreeSnapshotStorageLimits.packBytes) return Promise.reject(new Error(failure));
  return new Promise((resolveResult, reject) => {
    const child = execFile('git', ['--no-pager', '--literal-pathspecs', '-C', root, ...args], {
      encoding: 'buffer', windowsHide: true, timeout: 30_000, maxBuffer: maximum,
      env: { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
    }, (error, stdout) => { if (error) reject(new Error(failure, { cause: error })); else resolveResult(stdout); });
    child.stdin?.on('error', () => { /* Git's completion callback reports a closed input pipe. */ });
    child.stdin?.end(input);
  });
}
function text(bytes: Buffer): string { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r?\n$/, ''); }
async function regularBytes(path: string): Promise<Buffer> {
  const before = await lstat(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.ino === 0n || before.nlink !== 1n || before.size < 12n || before.size > BigInt(worktreeSnapshotStorageLimits.indexBytes) || canonical(await realpath(path)) !== canonical(resolve(path))) throw new Error(failure);
  const file = await open(path, 'r');
  try {
    const opened = await file.stat({ bigint: true });
    if (!sameOpenedSnapshotFile(before, opened)) throw new Error(failure);
    const bytes = Buffer.alloc(Number(before.size) + 1); let offset = 0;
    while (offset < bytes.length) { const result = await file.read(bytes, offset, bytes.length - offset, offset); if (!result.bytesRead) break; offset += result.bytesRead; }
    if (offset !== Number(before.size) || fingerprint(await file.stat({ bigint: true })) !== fingerprint(opened) || fingerprint(await lstat(path, { bigint: true })) !== fingerprint(before)) throw new Error(failure);
    const index = bytes.subarray(0, offset);
    if (index.subarray(0, 4).toString('ascii') !== 'DIRC' || ![2, 3, 4].includes(index.readUInt32BE(4))) throw new Error(failure);
    return index;
  } finally { await file.close(); }
}

/** Read-only capture: packs HEAD ancestry and every staged/conflict blob, retaining exact ordinary index bytes. */
export async function captureWorktreeSnapshotGit(root: string, command: typeof runGitSnapshotCommand = runGitSnapshotCommand): Promise<WorktreeSnapshotGit> {
  try {
    const actual = await realpath(root), initial = await lstat(root, { bigint: true });
    if (!initial.isDirectory() || initial.isSymbolicLink() || initial.ino === 0n || canonical(actual) !== canonical(resolve(root))) throw new Error(failure);
    const paths = text(await command(actual, ['rev-parse', '--path-format=absolute', '--git-common-dir', '--git-path', 'index'])).split(/\r?\n/);
    if (paths.length !== 2 || paths.some(path => !isAbsolute(path))) throw new Error(failure);
    const commonPath = await realpath(paths[0]), commonInfo = await lstat(paths[0], { bigint: true });
    if (!commonInfo.isDirectory() || commonInfo.isSymbolicLink() || commonInfo.ino === 0n || canonical(commonPath) !== canonical(resolve(paths[0]))) throw new Error(failure);
    const metadata = await Promise.allSettled([
      command(actual, ['rev-parse', '--shared-index-path']),
      command(actual, ['config', '--null', '--list']),
      command(actual, ['rev-parse', '--verify', 'HEAD']),
    ]);
    const [sharedIndex, configuration, revision] = metadata.map(result => { if (result.status === 'rejected') throw result.reason; return result.value; });
    if (text(sharedIndex)) throw new Error('Convert the split index to an ordinary index before making a worktree snapshot.');
    const config = text(configuration);
    if (config.split('\0').some(entry => /^(?:core\.(?:sparsecheckout|fsmonitor)|extensions\.worktreeconfig)\n(?!false$|0$).+/i.test(entry))) throw new Error('Disable sparse or monitored indexes before making a worktree snapshot.');
    const head = text(revision);
    if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(head)) throw new Error(failure);
    const index = await regularBytes(paths[1]), objects = new Set([head]);
    const staged = text(await command(actual, ['ls-files', '--stage', '-z']));
    for (const entry of staged.split('\0').filter(Boolean)) {
      const record = entry.match(/^(\d{6}) ([a-f0-9]{40}(?:[a-f0-9]{24})?) [0-3]\t[\s\S]+$/);
      if (!record || !['100644', '100755'].includes(record[1])) throw new Error('Submodules and linked index entries cannot be included in a complete worktree snapshot.');
      objects.add(record[2]);
    }
    const pack = await command(actual, ['pack-objects', '--stdout', '--revs'], Buffer.from([...objects].join('\n') + '\n'), worktreeSnapshotStorageLimits.packBytes);
    if (pack.length < 12 || pack.subarray(0, 4).toString('ascii') !== 'PACK') throw new Error(failure);
    const final = await lstat(root, { bigint: true }), finalCommon = await lstat(paths[0], { bigint: true });
    if (initial.dev !== final.dev || initial.ino !== final.ino || commonInfo.dev !== finalCommon.dev || commonInfo.ino !== finalCommon.ino || text(await command(actual, ['rev-parse', '--verify', 'HEAD'])) !== head || !(await regularBytes(paths[1])).equals(index)) throw new Error(failure);
    return { common: { path: commonPath, device: String(commonInfo.dev), inode: String(commonInfo.ino) }, head, index: blob(index), pack: blob(pack) };
  } catch (cause) { throw new Error(failure, { cause }); }
}
