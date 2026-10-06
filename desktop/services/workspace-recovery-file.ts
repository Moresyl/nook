import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { atomicFile } from './atomic-file';

const compress = promisify(gzip);

/** Retain the complete previous JSON revision with durable, atomic gzip replacement. */
export async function writeWorkspaceRecovery(directory: string, bytes: Buffer): Promise<void> {
  const compressed = await compress(bytes, { level: 1 });
  await atomicFile(join(directory, 'workspace.backup.json.gz'), file => file.writeFile(compressed));
}
