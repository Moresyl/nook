import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { collectLicenseInventory, type LicenseGroups, type LicenseSupplement } from '../scripts/license-inventory.mjs';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'qiyao-licenses-')); directories.push(root); const directory = join(root, 'node_modules', 'example'); await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'example', version: '1.0.0' }));
  const groups: LicenseGroups = { MIT: [{ name: 'example', versions: ['1.0.0'], paths: [directory], license: 'MIT' }] };
  return { root, directory, groups };
}
async function supplementalFixture() {
  const base = await fixture(); const original = Buffer.from('Copyright original source author\r\nComplete MIT terms.  \r\n');
  await mkdir(join(base.root, 'licenses', 'supplements'), { recursive: true }); await writeFile(join(base.root, 'licenses', 'supplements', 'LICENSE'), original);
  const supplement: LicenseSupplement = { name: 'example', version: '1.0.0', license: 'MIT', document: 'supplements/LICENSE', sha256: createHash('sha256').update(original).digest('hex'), source: `https://raw.githubusercontent.com/example/repository/${'a'.repeat(40)}/LICENSE`, packageIntegrity: 'sha512-verified-package' };
  return { ...base, original, supplement };
}
describe('installed dependency license retention', () => {
  it('retains complete license bytes, nested notices and hashes without local absolute paths', async () => {
    const { root, directory, groups } = await fixture(); const original = Buffer.from('Copyright original author\r\nAll license terms retained.\r\n'); await writeFile(join(directory, 'LICENSE'), original); await mkdir(join(directory, 'vendor')); await writeFile(join(directory, 'vendor', 'ThirdPartyNotices.txt'), 'Nested author and license');
    await mkdir(join(directory, 'node_modules')); await writeFile(join(directory, 'node_modules', 'LICENSE'), 'Excluded duplicate dependency'); await writeFile(join(directory, 'README.md'), 'Excluded documentation');
    const result = await collectLicenseInventory(groups, root); expect(result.files).toHaveLength(2); expect(result.files[0].content).toEqual(original); expect(result.components[0].documents[0].sha256).toBe(createHash('sha256').update(original).digest('hex')); expect(result.notices).toContain(original.toString()); expect(result.notices).toContain('Nested author'); expect(result.notices).not.toContain('Excluded'); expect(JSON.stringify(result.components)).not.toContain(root);
  });
  it('deduplicates identical installations and produces stable component ordering', async () => {
    const { root, directory, groups } = await fixture(); await writeFile(join(directory, 'LICENSE'), 'Original license'); groups.MIT[0].paths.push(directory);
    const other = join(root, 'node_modules', 'another'); await mkdir(other); await writeFile(join(other, 'package.json'), JSON.stringify({ name: 'another', version: '2.0.0' })); await writeFile(join(other, 'COPYING'), 'Other license'); groups.MIT.push({ name: 'another', versions: ['2.0.0'], paths: [other], license: 'MIT' });
    const result = await collectLicenseInventory(groups, root); expect(result.components.map((item) => item.name)).toEqual(['another', 'example']); expect(result.files).toHaveLength(2); expect((await collectLicenseInventory({ MIT: [...groups.MIT].reverse() }, root)).components).toEqual(result.components);
  });
  it('fails missing, blank or mismatched license metadata instead of inventing license text', async () => {
    const { root, directory, groups } = await fixture(); await expect(collectLicenseInventory(groups, root)).rejects.toThrow('Missing license document'); await writeFile(join(directory, 'LICENSE'), 'License');
    groups.MIT[0].license = ''; await expect(collectLicenseInventory(groups, root)).rejects.toThrow('Missing declared license'); groups.MIT[0].license = 'MIT'; groups.MIT[0].versions = ['2.0.0']; await expect(collectLicenseInventory(groups, root)).rejects.toThrow('identity'); groups.MIT[0].versions = ['1.0.0']; groups.MIT[0].name = 'wrong'; await expect(collectLicenseInventory(groups, root)).rejects.toThrow('identity'); await expect(collectLicenseInventory({}, root)).rejects.toThrow('empty');
    groups.MIT[0].name = 'example'; await writeFile(join(directory, 'LICENSE'), ''); await expect(collectLicenseInventory(groups, root)).rejects.toThrow('Empty license');
  });
  it('rejects a license link and dependency roots escaping through a junction', async () => {
    const { root, directory, groups } = await fixture(); const outside = await mkdtemp(join(tmpdir(), 'qiyao-licenses-outside-')); directories.push(outside); await writeFile(join(outside, 'secret'), 'Private content');
    await symlink(join(outside, 'secret'), join(directory, 'LICENSE'), 'file'); await expect(collectLicenseInventory(groups, root)).rejects.toThrow('link'); await rm(join(directory, 'LICENSE')); await symlink(outside, join(root, 'node_modules', 'escape'), 'junction'); groups.MIT[0].paths = [join(root, 'node_modules', 'escape')]; await expect(collectLicenseInventory(groups, root)).rejects.toThrow('outside');
  });
  it('rejects two copies of a version with different legal documents', async () => {
    const { root, directory, groups } = await fixture(); await writeFile(join(directory, 'LICENSE'), 'Original license'); const other = join(root, 'node_modules', 'duplicate'); await mkdir(other); await writeFile(join(other, 'package.json'), JSON.stringify({ name: 'example', version: '1.0.0' })); await writeFile(join(other, 'LICENSE'), 'Changed license'); groups.MIT[0].paths.push(other); await expect(collectLicenseInventory(groups, root)).rejects.toThrow('Conflicting');
  });
  it('retains a missing package license from its exact verified source revision, including original bytes and provenance', async () => {
    const { root, groups, original, supplement } = await supplementalFixture(); const result = await collectLicenseInventory(groups, root, [supplement]);
    expect(result.files[0].content).toEqual(original); expect(result.components[0].provenance).toEqual({ source: supplement.source, originalSha256: supplement.sha256 }); expect(result.notices).toContain(supplement.source); expect(result.notices).toContain(original.toString()); expect(JSON.stringify(result.components)).not.toContain(root);
  });
  it('rejects changed bytes, mismatched declarations and unpinned supplemental sources', async () => {
    const { root, groups, supplement } = await supplementalFixture();
    for (const change of [{ sha256: '0'.repeat(64) }, { license: 'Apache-2.0' }, { source: 'https://raw.githubusercontent.com/example/repository/main/LICENSE' }, { source: supplement.source.replace('https:', 'http:') }]) await expect(collectLicenseInventory(groups, root, [{ ...supplement, ...change }])).rejects.toThrow('Unverified');
    for (const change of [{ name: 'other' }, { version: '2.0.0' }]) await expect(collectLicenseInventory(groups, root, [{ ...supplement, ...change }])).rejects.toThrow('Missing license');
    await writeFile(join(root, 'licenses', supplement.document), ''); await expect(collectLicenseInventory(groups, root, [{ ...supplement, sha256: createHash('sha256').update('').digest('hex') }])).rejects.toThrow('Empty license');
  });
  it('rejects a supplemental document escaping through a path or junction', async () => {
    const { root, groups, original, supplement } = await supplementalFixture(); const outside = await mkdtemp(join(tmpdir(), 'qiyao-license-supplement-')); directories.push(outside); await writeFile(join(outside, 'LICENSE'), original);
    await writeFile(join(root, 'outside-license'), original); await expect(collectLicenseInventory(groups, root, [{ ...supplement, document: '../outside-license' }])).rejects.toThrow('escapes');
    await symlink(outside, join(root, 'licenses', 'escape'), 'junction'); await expect(collectLicenseInventory(groups, root, [{ ...supplement, document: 'escape/LICENSE' }])).rejects.toThrow('escapes');
  });
  it('prefers the installed original and deduplicates identical original/supplemental documents in either order', async () => {
    const { root, directory, groups, original, supplement } = await supplementalFixture(); await writeFile(join(directory, 'LICENSE'), original);
    expect((await collectLicenseInventory(groups, root, [{ ...supplement, sha256: 'invalid' }])).components[0].provenance).toBeUndefined();
    const other = join(root, 'node_modules', 'duplicate'); await mkdir(other); await writeFile(join(other, 'package.json'), JSON.stringify({ name: 'example', version: '1.0.0' })); groups.MIT[0].paths.push(other);
    const result = await collectLicenseInventory(groups, root, [supplement]); groups.MIT[0].paths.reverse(); const reversed = await collectLicenseInventory(groups, root, [supplement]); expect(result.components).toEqual(reversed.components); expect(result.files).toHaveLength(1); expect(result.components[0].provenance?.source).toBe(supplement.source);
  });
  it.each(['true', 'input'])('retains original legal bytes in Git with core.autocrlf=%s', async (autocrlf) => {
    const { root } = await fixture(); const run = promisify(execFile); const original = Buffer.from('Copyright original author\r\nComplete terms\r\nOriginal heading\r\n=======\r\n');
    await writeFile(join(root, '.gitattributes'), await readFile(new URL('../.gitattributes', import.meta.url))); await mkdir(join(root, 'licenses', 'runtime'), { recursive: true });
    const files = ['LICENSE', 'COPYING', 'THIRD_PARTY_NOTICES.txt', 'licenses/runtime/LICENSE.md']; for (const file of files) await writeFile(join(root, file), original);
    await run('git', ['init', '-q', root], { windowsHide: true }); await run('git', ['-C', root, '-c', `core.autocrlf=${autocrlf}`, 'add', '.gitattributes', ...files], { windowsHide: true });
    await run('git', ['-C', root, 'diff', '--cached', '--check'], { windowsHide: true });
    for (const file of files) { const { stdout } = await run('git', ['-C', root, 'show', `:${file}`], { windowsHide: true, encoding: 'buffer' }); expect(stdout).toEqual(original); }
  });
});
