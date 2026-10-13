import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { writeWorkspaceRecovery } from '../desktop/services/workspace-recovery-file';
import { WorkspaceBackupFiles } from '../desktop/services/backup-files';

const directories: string[] = [];
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
async function setup() { const path = await mkdtemp(join(tmpdir(), 'nook-recovery-')); directories.push(path); return path; }
describe('compressed complete recovery revisions', () => {
  it('preserves exact Unicode JSON bytes and remains readable by the existing recovery reader', async () => {
    const directory = await setup(), value = { text: '中文 😀\n'.repeat(100_000), versions: [1, 2, 3] };
    const bytes = Buffer.from(JSON.stringify(value, null, 2));
    await writeWorkspaceRecovery(directory, bytes);
    const path = join(directory, 'workspace.backup.json.gz'), compressed = await readFile(path);
    // Compare every decompressed byte without enumerating a large Buffer's properties.
    expect(compressed.length).toBeLessThan(bytes.length / 10); expect(gunzipSync(compressed).equals(bytes)).toBe(true);
    expect(await new WorkspaceBackupFiles().read(path)).toEqual(value);
  });
  it('atomically replaces the current gzip revision while retaining legacy plain JSON', async () => {
    const directory = await setup(), legacy = join(directory, 'workspace.backup.json');
    await writeFile(legacy, 'LEGACY_RECOVERY');
    await writeWorkspaceRecovery(directory, Buffer.from('{"previous":1}'));
    await writeWorkspaceRecovery(directory, Buffer.from('{"previous":2}'));
    expect(gunzipSync(await readFile(join(directory, 'workspace.backup.json.gz'))).toString()).toBe('{"previous":2}');
    expect(await readFile(legacy, 'utf8')).toBe('LEGACY_RECOVERY');
  });
  it('rejects a blocked destination without changing an older legacy recovery file', async () => {
    const directory = await setup(); await writeFile(join(directory, 'workspace.backup.json'), 'OLD');
    await mkdir(join(directory, 'workspace.backup.json.gz'));
    await expect(writeWorkspaceRecovery(directory, Buffer.from('{}'))).rejects.toThrow('Local data could not be saved');
    expect(await readFile(join(directory, 'workspace.backup.json'), 'utf8')).toBe('OLD');
  });
});
