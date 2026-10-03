import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { pluginManifestSchema, pluginSchema } from '../contracts/plugins';
import { LocalPlugins, pluginManifest } from '../desktop/services/local-plugins';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
export const exampleManifest = () => ({ schemaVersion: 1, id: 'example.evidence', name: '验证插件', version: '1.0.0', main: 'main.js', permissions: ['tools', 'commands', 'panels', 'storage', 'project.read', 'project.write'], tools: [{ name: 'echo', description: 'Plugin evidence', parameters: { type: 'object', properties: { text: { type: 'string' } }, additionalProperties: false } }], commands: [{ id: 'greet', title: 'Say hello' }], panels: [{ id: 'dashboard', title: 'Dashboard', entry: 'ui/index.html' }] });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'qiyao-plugin-')); directories.push(directory); const source = join(directory, 'source'); await mkdir(join(source, 'ui'), { recursive: true });
  await writeFile(join(source, 'qiyao-plugin.json'), JSON.stringify(exampleManifest())); await writeFile(join(source, 'main.js'), 'export default function () {}'); await writeFile(join(source, 'ui/index.html'), '<html lang="zh-CN"><body>Plugin evidence</body></html>');
  await writeFile(join(source, 'LICENSE'), 'Retain this original plugin license'); await writeFile(join(source, 'image.bin'), Buffer.from([0, 255]));
  return { directory, source, plugins: new LocalPlugins(join(directory, 'managed')) };
}
describe('managed local plugins', () => {
  it('imports complete packages disabled, preserves licenses/binary assets and verifies declared entries and hashes', async () => {
    const { plugins, source, directory } = await fixture(); const plugin = await plugins.importPath(source);
    expect(plugin.enabled).toBe(false); expect(plugin.grants).toEqual([]); expect(plugin.manifest.tools[0].timeout).toBe(60_000); await plugins.verify(plugin);
    expect((await plugins.asset(plugin, 'LICENSE')).toString()).toContain('original plugin license'); expect(await plugins.asset(plugin, 'image.bin')).toEqual(Buffer.from([0, 255]));
    await expect(plugins.asset(plugin, '../outside')).rejects.toThrow('not part');
    await writeFile(join(directory, 'managed', plugin.id, 'main.js'), 'Modified'); await expect(plugins.verify(plugin)).rejects.toThrow('changed'); await expect(plugins.asset(plugin, 'main.js')).rejects.toThrow('changed');
    await plugins.remove(plugin.id); expect(await readFile(join(source, 'LICENSE'), 'utf8')).toContain('original');
  });
  it('restores a complete package under a new ID and refuses manifest/entry/schema errors', async () => {
    const { plugins, source } = await fixture(); const plugin = await plugins.importPath(source); const bundle = await plugins.bundle(plugin.id); const restored = await plugins.restore(bundle);
    expect(restored.id).not.toBe(plugin.id); expect(restored.hashes).toEqual(plugin.hashes); await plugins.verify(restored);
    await writeFile(join(source, 'qiyao-plugin.json'), JSON.stringify({ ...exampleManifest(), main: 'missing.js' })); await expect(plugins.importPath(source)).rejects.toThrow('entry is missing');
    await expect(plugins.restore({ ...bundle, files: bundle.files.filter((file) => file.path !== 'main.js') })).rejects.toThrow('entry is missing');
    expect(() => pluginManifest('{bad')).toThrow('valid JSON');
    expect(() => pluginManifest(JSON.stringify({ ...exampleManifest(), tools: [{ name: 'bad', description: '', parameters: { type: 'string' } }] }))).toThrow('JSON objects');
    expect(() => pluginManifest(JSON.stringify({ ...exampleManifest(), tools: [{ name: 'bad', description: '', parameters: { type: 'object', properties: { value: { type: 'unknown-type' } } } }] }))).toThrow();
  });
  it('enforces permission dependencies, unique contributions, module paths, network host scopes and grants', () => {
    const manifest = exampleManifest();
    for (const change of [{ permissions: [] }, { tools: [...manifest.tools, ...manifest.tools] }, { main: '../outside.js' }, { main: 'entry.html' }, { main: undefined }, { permissions: ['tools', 'commands', 'panels', 'network'] }, { domains: ['api.example.com'] }, { permissions: ['tools', 'commands', 'panels', 'network'], domains: ['user:secret@api.example.com'] }]) expect(() => pluginManifestSchema.parse({ ...manifest, ...change })).toThrow();
    const parsed = pluginManifestSchema.parse({ ...manifest, permissions: [...manifest.permissions, 'network'], domains: ['api.example.com', '127.0.0.1:8000'] }); expect(parsed.domains).toHaveLength(2);
    expect(() => pluginSchema.parse({ id: 'b641bc9a-f97a-4300-9c7e-41740cdc9510', manifest, installedAt: 1, hashes: {}, grants: ['network'] })).toThrow('Grant only');
  });
});
