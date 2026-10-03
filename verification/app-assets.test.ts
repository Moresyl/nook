import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { appAssetPath } from '../desktop/services/app-assets';
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
it('serves only bundled application resources from its own secure origin', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qiyao-assets-')); directories.push(root); await mkdir(join(root, 'assets')); await writeFile(join(root, 'index.html'), 'app'); await writeFile(join(root, 'assets', 'worker.js'), 'worker');
  expect(await appAssetPath(root, 'qiyao://app/index.html')).toBe(join(root, 'index.html')); expect(await appAssetPath(root, 'qiyao://app/assets/worker.js?v=1')).toBe(join(root, 'assets', 'worker.js'));
  for (const url of ['https://app/index.html', 'qiyao://other/index.html', 'qiyao://user@app/index.html', 'qiyao://app:10/index.html', 'qiyao://app/%00', 'qiyao://app/%5coutside', 'qiyao://app/%2e%2e%2foutside', 'qiyao://app/missing']) await expect(appAssetPath(root, url)).rejects.toThrow();
  const outside = await mkdtemp(join(tmpdir(), 'qiyao-assets-outside-')); directories.push(outside); await writeFile(join(outside, 'secret'), 'secret'); await symlink(outside, join(root, 'escape'), 'junction'); await expect(appAssetPath(root, 'qiyao://app/escape/secret')).rejects.toThrow('Invalid');
});
