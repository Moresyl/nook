import { randomUUID } from 'node:crypto';
import { open, rename, rm, type FileHandle } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const renameDelays = [50, 100, 150, 200, 250, 300];
export async function atomicFile(path: string, write: (file: FileHandle) => Promise<void>, signal?: AbortSignal): Promise<void> {
  const staging = `${path}.${randomUUID()}.tmp`;
  try {
    signal?.throwIfAborted();
    const file = await open(staging, 'wx', 0o600);
    try { await write(file); await file.sync(); }
    finally { await file.close(); }
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      try { await rename(staging, path); return; }
      catch (error) {
        if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '') || attempt >= renameDelays.length) throw error;
        await delay(renameDelays[attempt]);
      }
    }
  } catch (error) { throw new Error('Local data could not be saved. Check disk space and directory permissions.', { cause: error }); }
  finally { await rm(staging, { force: true }).catch(() => {}); }
}
