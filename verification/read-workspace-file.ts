import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { gunzipSync } from 'node:zlib';

export function readWorkspaceFile(path: string): Promise<Buffer>;
export function readWorkspaceFile(path: string, encoding: 'utf8'): Promise<string>;
/** Compare full decoded recovery bytes, never just compressed size or metadata. */
export async function readWorkspaceFile(path: string, encoding?: 'utf8'): Promise<Buffer | string> {
  const raw = await readFile(path);
  const bytes = basename(path) === 'workspace.backup.json.gz' ? gunzipSync(raw) : raw;
  return encoding ? bytes.toString(encoding) : bytes;
}
