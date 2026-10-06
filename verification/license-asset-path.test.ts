import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { licenseAssetPath } from '../scripts/license-asset-path.mjs';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), 'nook-license-path-')); directories.push(parent);
  const root = join(parent, 'worktree'), shared = join(parent, 'shared'), outside = join(parent, 'outside');
  await Promise.all([mkdir(root), mkdir(shared), mkdir(outside)]);
  await mkdir(join(shared, 'package')); await writeFile(join(shared, 'package', 'binary'), 'exact asset');
  await writeFile(join(outside, 'secret'), 'outside data');
  await symlink(shared, join(root, 'node_modules'), 'junction');
  return { root, shared, outside };
}

describe('bundled license asset boundaries', () => {
  it('supports an explicitly shared dependency directory and in-store package links', async () => {
    const { root, shared } = await fixture();
    const path = await licenseAssetPath(root, 'node_modules/package/binary', true);
    expect(path).toBe(await realpath(join(shared, 'package', 'binary'))); expect(await readFile(path, 'utf8')).toBe('exact asset');
    await symlink(join(shared, 'package'), join(shared, 'alias'), 'junction');
    expect(await licenseAssetPath(root, 'node_modules/alias/binary', true)).toBe(path);
    await expect(licenseAssetPath(root, 'node_modules/package/binary')).rejects.toThrow('outside');
  });
  it('rejects nested dependency escapes and lexical traversal even when the dependency root is allowed', async () => {
    const { root, shared, outside } = await fixture(); await symlink(outside, join(shared, 'escape'), 'junction');
    await expect(licenseAssetPath(root, 'node_modules/escape/secret', true)).rejects.toThrow('outside');
    for (const name of ['', '.', '..', '../outside/secret', 'node_modules/../secret', 'node_modules\\..\\secret', 'node_modules//package/binary', 'C:secret', join(outside, 'secret'), 'node_modules']) {
      await expect(licenseAssetPath(root, name, true)).rejects.toThrow('outside');
    }
  });
  it('preserves strict project-asset and license-document boundaries', async () => {
    const { root, outside } = await fixture(); await writeFile(join(root, 'LICENSE'), 'retained license');
    expect(await readFile(await licenseAssetPath(root, 'LICENSE'), 'utf8')).toBe('retained license');
    await symlink(outside, join(root, 'fonts'), 'junction');
    await expect(licenseAssetPath(root, 'fonts/secret', true)).rejects.toThrow('outside');
    await symlink(outside, join(root, 'licenses'), 'junction');
    await expect(licenseAssetPath(join(root, 'licenses'), 'secret')).rejects.toThrow('outside');
  });
});
