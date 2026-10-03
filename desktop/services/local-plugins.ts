import { createHash } from 'node:crypto';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';
import { pluginManifestSchema, pluginSchema, type Plugin, type PluginManifest } from '../../contracts/plugins';
import type { SkillBundle } from '../../contracts/extensions';
import { ManagedAssets } from './managed-assets';

export function pluginManifest(text: string): PluginManifest {
  let raw: unknown; try { raw = JSON.parse(text); } catch { throw new Error('qiyao-plugin.json must contain valid JSON.'); }
  const manifest = pluginManifestSchema.parse(raw);
  for (const tool of manifest.tools) {
    if (tool.parameters.type !== 'object' || JSON.stringify(tool.parameters).length > 32_000) throw new Error('Plugin tool schemas must be JSON objects smaller than 32 KB.');
    new AjvJsonSchemaValidator().getValidator(tool.parameters);
  }
  return manifest;
}

export class LocalPlugins {
  private readonly assets: ManagedAssets;
  constructor(directory: string) { this.assets = new ManagedAssets(directory, 'qiyao-plugin.json', 'plugin'); }

  private async record(id: string, manifest: PluginManifest): Promise<Plugin> {
    const hashes = await this.assets.hashes(id);
    for (const entry of [manifest.main, ...manifest.panels.map((panel) => panel.entry)].filter((name): name is string => Boolean(name))) {
      if (!Object.hasOwn(hashes, entry.replaceAll('\\', '/'))) throw new Error('A declared plugin entry is missing from the package.');
    }
    return pluginSchema.parse({ id, manifest, installedAt: Date.now(), hashes });
  }

  async importPath(path: string): Promise<Plugin> {
    const installed = await this.assets.importPath(path, pluginManifest, 256_000);
    try { return await this.record(installed.id, installed.metadata); } catch (error) { await this.assets.remove(installed.id); throw error; }
  }

  async verify(plugin: Plugin): Promise<void> {
    const hashes = await this.assets.hashes(plugin.id);
    if (JSON.stringify(hashes) !== JSON.stringify(plugin.hashes) || JSON.stringify(pluginManifest(await this.assets.read(plugin.id, 'qiyao-plugin.json', 256_000))) !== JSON.stringify(plugin.manifest)) throw new Error('The plugin package changed. Reimport it before enabling.');
  }

  async asset(plugin: Plugin, path: string): Promise<Buffer> {
    const normalized = path.replaceAll('\\', '/');
    if (!Object.hasOwn(plugin.hashes, normalized)) throw new Error('This asset is not part of the installed plugin.');
    const bytes = await this.assets.bytes(plugin.id, normalized);
    if (createHash('sha256').update(bytes).digest('hex') !== plugin.hashes[normalized]) throw new Error('The plugin asset changed. Reimport the plugin.');
    return bytes;
  }
  async bundle(id: string): Promise<SkillBundle> { return this.assets.bundle(id); }
  async restore(bundle: SkillBundle): Promise<Plugin> {
    const restored = await this.assets.restore(bundle, pluginManifest, 256_000);
    try { return await this.record(restored.id, restored.metadata); } catch (error) { await this.assets.remove(restored.id); throw error; }
  }
  async remove(id: string): Promise<void> { await this.assets.remove(id); }
}
