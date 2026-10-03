import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectDistributionInventory, verifyDistributionBinaries, type DistributionManifest } from '../scripts/distribution-inventory.mjs';

const directories: string[] = [];
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'qiyao-distribution-')); directories.push(root);
  const legal = join(root, 'legal'); const tools = join(root, 'tools'); await mkdir(legal); await mkdir(tools);
  const original = Buffer.from('Original author\r\nComplete LGPL terms.  \r\n'); const source = Buffer.from([0x50, 0x4b, 0, 0xff]);
  await writeFile(join(legal, 'LICENSE'), original); await writeFile(join(legal, 'Source.zip'), source); await writeFile(join(tools, 'elevate.exe'), 'fixture executable');
  const manifest: DistributionManifest = { schemaVersion: 1, builderVersion: '26.15.3', toolset: '0.0.0', archiveFilter: 'BCJ', components: [{ name: 'Example helper', license: 'LGPL-2.1-or-later', status: 'verified', source: 'https://example.org/source.zip', documents: [{ path: 'LICENSE', sha256: hash(original) }], sources: [{ path: 'Source.zip', sha256: hash(source) }], binaries: [{ location: 'elevate', path: 'elevate.exe', sha256: hash('fixture executable') }] }] };
  return { root, legal, tools, original, manifest, locations: { compiler: tools, plugins: tools, elevate: tools } };
}
describe('Windows distribution retention', () => {
  it('retains original complete notice text and archive hashes without embedding local paths or decoding source archives', async () => {
    const { legal, manifest, original } = await fixture(); const result = await collectDistributionInventory(manifest, legal);
    expect(result.components).toBe(1); expect(result.unresolved).toEqual([]); expect(result.notices).toContain(original.toString('utf8')); expect(result.notices).toContain('Source.zip (SHA256'); expect(result.notices).not.toContain(legal); expect(result.notices).not.toContain('\ufffd');
  });
  it('keeps unresolved declarations explicit instead of inventing a license', async () => {
    const { legal, manifest } = await fixture(); manifest.components[0].status = 'unresolved'; manifest.components[0].notes = 'Original release has no explicit license.';
    const result = await collectDistributionInventory(manifest, legal); expect(result.unresolved).toEqual(['Example helper']); expect(result.notices).toContain('Redistribution status: unresolved'); expect(result.notices).toContain(manifest.components[0].notes);
  });
  it.each(['LICENSE', 'Source.zip'])('rejects missing, changed and empty retained %s bytes', async (name) => {
    const { legal, manifest } = await fixture(); await writeFile(join(legal, name), 'changed'); await expect(collectDistributionInventory(manifest, legal)).rejects.toThrow('changed'); await writeFile(join(legal, name), ''); await expect(collectDistributionInventory(manifest, legal)).rejects.toThrow('empty'); await rm(join(legal, name)); await expect(collectDistributionInventory(manifest, legal)).rejects.toThrow();
  });
  it('rejects missing identities, declarations, documents, inputs and duplicate component names', async () => {
    const { legal, manifest } = await fixture();
    for (const change of [{ name: '' }, { license: '' }, { status: 'assumed' }, { source: 'http://example.org/license' }, { documents: [] }, { sources: null }, { binaries: [] }]) await expect(collectDistributionInventory({ ...manifest, components: [{ ...manifest.components[0], ...change }] } as DistributionManifest, legal)).rejects.toThrow('Invalid');
    await expect(collectDistributionInventory({ ...manifest, components: [manifest.components[0], manifest.components[0]] }, legal)).rejects.toThrow('Invalid');
    for (const change of [{ schemaVersion: 2 }, { builderVersion: '' }, { toolset: '' }, { archiveFilter: 'ARM64' }, { archiveFilter: undefined }, { components: [] }]) await expect(collectDistributionInventory({ ...manifest, ...change } as DistributionManifest, legal)).rejects.toThrow('Invalid');
  });
  it('rejects absolute declarations, malformed hashes and unsupported binary locations', async () => {
    const { legal, manifest, tools } = await fixture();
    for (const change of [{ path: join(legal, 'LICENSE') }, { sha256: 'invalid' }]) await expect(collectDistributionInventory({ ...manifest, components: [{ ...manifest.components[0], documents: [{ ...manifest.components[0].documents[0], ...change }] }] }, legal)).rejects.toThrow('Invalid');
    for (const change of [{ path: '../elevate.exe' }, { path: join(tools, 'elevate.exe') }, { location: 'unknown' }, { sha256: 'invalid' }, { path: 'other.exe' }]) await expect(collectDistributionInventory({ ...manifest, components: [{ ...manifest.components[0], binaries: [{ ...manifest.components[0].binaries[0], ...change }] }] } as DistributionManifest, legal)).rejects.toThrow('Invalid');
  });
  it('rejects legal files escaping through a path or directory junction', async () => {
    const { root, legal, manifest, original } = await fixture(); await writeFile(join(root, 'outside'), original);
    manifest.components[0].documents[0].path = '../outside'; await expect(collectDistributionInventory(manifest, legal)).rejects.toThrow('escapes');
    const outside = await mkdtemp(join(tmpdir(), 'qiyao-distribution-outside-')); directories.push(outside); await writeFile(join(outside, 'LICENSE'), original); await symlink(outside, join(legal, 'escape'), 'junction'); manifest.components[0].documents[0].path = 'escape/LICENSE'; await expect(collectDistributionInventory(manifest, legal)).rejects.toThrow('escapes');
  });
  it('checks actual binary bytes at each resolved toolset location', async () => {
    const { manifest, locations } = await fixture(); const binary = manifest.components[0].binaries[0];
    manifest.components[0].binaries.push({ ...binary, location: 'compiler' }, { ...binary, location: 'plugins' });
    expect(await verifyDistributionBinaries(manifest, locations)).toEqual(manifest.components[0].binaries.map((item) => ({ component: 'Example helper', ...item })));
  });
  it('rejects changed, missing and escaping toolset inputs, including missing tool directories', async () => {
    const { root, tools, manifest, locations } = await fixture(); await writeFile(join(tools, 'elevate.exe'), 'tampered'); await expect(verifyDistributionBinaries(manifest, locations)).rejects.toThrow('changed'); await rm(join(tools, 'elevate.exe')); await expect(verifyDistributionBinaries(manifest, locations)).rejects.toThrow();
    await writeFile(join(root, 'outside'), 'fixture executable'); manifest.components[0].binaries[0].path = '../outside'; await expect(verifyDistributionBinaries(manifest, locations)).rejects.toThrow('escapes');
    await expect(verifyDistributionBinaries(manifest, { ...locations, elevate: undefined } as unknown as typeof locations)).rejects.toThrow('directory');
  });
});
