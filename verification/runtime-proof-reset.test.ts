import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { resetRuntimeProof, runtimeProofFiles } from '../scripts/runtime-proof.mjs';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function directory() { const root = await mkdtemp(join(tmpdir(), 'qiyao-runtime-reset-')); roots.push(root); await mkdir(join(root, 'verification')); return root; }

describe('fresh pipeline runtime records', () => {
  it('removes exactly the ten inherited runtime records, preserves other evidence and is safe to repeat', async () => {
    const root = await directory();
    for (const name of Object.values(runtimeProofFiles)) await writeFile(join(root, 'verification', name), 'STALE_LOCAL_PROOF');
    await writeFile(join(root, 'verification', 'source-review-result.json'), 'KEEP_SOURCE_EVIDENCE');
    await resetRuntimeProof(root); await resetRuntimeProof(root);
    expect(await readdir(join(root, 'verification'))).toEqual(['source-review-result.json']);
    expect(await readFile(join(root, 'verification', 'source-review-result.json'), 'utf8')).toBe('KEEP_SOURCE_EVIDENCE');
  });
  it('reports an actual invalid output path after all other cleanup operations settle and preserves the unexpected directory', async () => {
    const root = await directory();
    await mkdir(join(root, 'verification', runtimeProofFiles.audit));
    await writeFile(join(root, 'verification', runtimeProofFiles.desktop), 'STALE');
    await expect(resetRuntimeProof(root)).rejects.toThrow('Could not reset runtime proof');
    expect(await readdir(join(root, 'verification'))).toEqual([runtimeProofFiles.audit]);
  });
  it('refuses the actual reset command outside GitHub Actions without touching local generated records', async () => {
    const root = await directory(); const record = join(root, 'verification', runtimeProofFiles.audit); await writeFile(record, 'KEEP_LOCAL_PROOF');
    await expect(promisify(execFile)(process.execPath, [resolve('scripts/reset-runtime-proof.mjs')], { cwd: root, env: { ...process.env, GITHUB_ACTIONS: 'false' }, windowsHide: true })).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('isolated GitHub Actions') });
    expect(await readFile(record, 'utf8')).toBe('KEEP_LOCAL_PROOF');
  });
});
