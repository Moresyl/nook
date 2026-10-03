import { pluginUpdateSchema, type PluginUpdate } from '../../contracts/plugins';
import type { WorkspaceVault } from './vault';
import type { LocalPlugins } from './local-plugins';

export class PluginSettings {
  constructor(private readonly vault: WorkspaceVault, private readonly packages: LocalPlugins) {}
  async importPath(path: string) {
    const plugin = await this.packages.importPath(path);
    try { return await this.vault.update((draft) => {
      if (draft.plugins.some((item) => item.manifest.id === plugin.manifest.id)) throw new Error('This plugin is already installed. Remove it before importing a replacement.');
      draft.plugins.push(plugin);
    }); } catch (error) { await this.packages.remove(plugin.id); throw error; }
  }
  async save(raw: PluginUpdate) {
    const update = pluginUpdateSchema.parse(raw);
    const plugin = this.vault.snapshot().plugins.find((item) => item.id === update.id);
    if (!plugin) throw new Error('This plugin is no longer installed.');
    if (update.enabled) await this.packages.verify(plugin);
    return this.vault.update((draft) => {
      const current = draft.plugins.find((item) => item.id === update.id);
      if (!current) throw new Error('This plugin is no longer installed.');
      if (update.projectIds.some((id) => !draft.projects.some((project) => project.id === id))) throw new Error('Choose existing projects for the plugin scope.');
      Object.assign(current, update);
    });
  }
  async remove(id: string) {
    if (!this.vault.snapshot().plugins.some((item) => item.id === id)) throw new Error('This plugin is no longer installed.');
    const state = await this.vault.update((draft) => { draft.plugins = draft.plugins.filter((item) => item.id !== id); for (const thread of draft.threads) thread.pluginIds = thread.pluginIds?.filter((value) => value !== id); });
    try { await this.packages.remove(id); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return state;
  }
}
