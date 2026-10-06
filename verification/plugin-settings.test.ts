import { readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PluginSettings } from '../desktop/services/plugin-settings';
import { LocalPlugins } from '../desktop/services/local-plugins';
import { ExtensionSettings } from '../desktop/services/extension-settings';
import { LocalSkills } from '../desktop/services/local-skills';
import { createPluginFixture } from './plugin-fixture.mjs';
import { sampleThread, testVault } from './fixtures';
import { automationInputSchema } from '../contracts/automations';
import { composerDraftSchema } from '../contracts/workspace';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function setup() {
  const { directory, vault } = await testVault(); directories.push(directory);
  const source = join(directory, 'source'); await createPluginFixture(source);
  const packages = new LocalPlugins(join(directory, 'plugins')); const settings = new PluginSettings(vault, packages);
  const extensions = new ExtensionSettings(vault, new LocalSkills(join(directory, 'skills')), packages);
  return { directory, vault, source, packages, settings, extensions };
}
describe('plugin configuration and complete backups', () => {
  it('starts disabled, validates grants and scopes, rolls back duplicate imports and preserves originals on removal', async () => {
    const { directory, vault, source, settings } = await setup(); const state = await settings.importPath(source); const plugin = state.plugins[0];
    expect(plugin).toMatchObject({ enabled: false, grants: [] });
    await expect(settings.importPath(source)).rejects.toThrow('already installed'); expect(await readdir(join(directory, 'plugins'))).toEqual([plugin.id]);
    await expect(settings.save({ id: plugin.id, enabled: true, grants: ['tools'], projectIds: ['missing'] })).rejects.toThrow('existing projects');
    await vault.update((draft) => { draft.projects.push({ id: 'project', name: 'Project', path: directory, instructions: '', createdAt: 1 }); draft.threads.push(sampleThread({ pluginIds: [plugin.id] })); });
    await settings.save({ id: plugin.id, enabled: true, grants: ['tools', 'commands'], projectIds: ['project'] }); expect(vault.snapshot().plugins[0]).toMatchObject({ enabled: true, grants: ['tools', 'commands'], projectIds: ['project'] });
    await expect(settings.save({ id: plugin.id, enabled: false, grants: ['tools', 'tools'], projectIds: [] })).rejects.toThrow('Grant only');
    vi.spyOn(vault, 'update').mockRejectedValueOnce(new Error('Disk full')); await expect(settings.remove(plugin.id)).rejects.toThrow('Disk full'); expect(await readdir(join(directory, 'plugins'))).toEqual([plugin.id]);
    await settings.remove(plugin.id); expect(vault.snapshot().threads[0].pluginIds).toEqual([]); expect(await readFile(join(source, 'LICENSE'), 'utf8')).toContain('Preserve');
    await expect(settings.save({ id: plugin.id, enabled: false, grants: [], projectIds: [] })).rejects.toThrow('no longer'); await expect(settings.remove(plugin.id)).rejects.toThrow('no longer');
    const missing = (await settings.importPath(source)).plugins[0]; await rm(join(directory, 'plugins', missing.id), { recursive: true }); expect((await settings.remove(missing.id)).plugins).toEqual([]);
  });
  it('restores packages with new IDs and no executable grants, retaining plugin data and thread selections', async () => {
    const { vault, source, settings, extensions, packages } = await setup(); await settings.importPath(source); const old = vault.snapshot().plugins[0];
    await vault.update((draft) => { draft.plugins[0].enabled = true; draft.plugins[0].grants = [...old.manifest.permissions]; draft.plugins[0].data = { count: 2 }; draft.threads.push(sampleThread({ pluginIds: [old.id] })); draft.composerDrafts.push({ threadId: 'thread', text: 'Unsent', attachments: [], model: '', mode: 'chat', mcpServerIds: [], skillIds: [], pluginIds: [old.id], updatedAt: 1 }); });
    const task = automationInputSchema.parse({ id: randomUUID(), name: 'Selected plugin', prompt: 'Review evidence', providerId: vault.snapshot().providers[0].id, model: 'test-model', pluginIds: [old.id], enabled: true, schedule: { kind: 'interval', minutes: 60 } });
    await vault.commitQuickChat(state => { state.quickChat = { revision: randomUUID(), composerDrafts: [composerDraftSchema.parse({ text: 'Quick plugin input', pluginIds: [old.id], updatedAt: 1 })] }; });
    await vault.update((draft) => { draft.automations.push({ ...task, createdAt: 1, updatedAt: 1, nextRunAt: Date.now() + 60_000, runs: [] }); });
    const backup = await extensions.backup(); expect(backup.pluginBundles[0].files.some((file) => file.path === 'LICENSE')).toBe(true);
    const restored = await extensions.restore(backup); const plugin = restored.plugins[0];
    expect(plugin.id).not.toBe(old.id); expect(plugin).toMatchObject({ enabled: false, grants: [], data: { count: 2 }, hashes: old.hashes }); expect(restored.threads[0].pluginIds).toEqual([plugin.id]);
    expect(restored.composerDrafts[0].pluginIds).toEqual([plugin.id]);
    expect(restored.quickChat?.composerDrafts[0].pluginIds).toEqual([plugin.id]); expect(backup.quickChat?.composerDrafts[0].pluginIds).toEqual([old.id]);
    expect(restored.automations[0].pluginIds).toEqual([plugin.id]); expect(restored.automations[0].enabled).toBe(false); expect(restored.automations[0].nextRunAt).toBeUndefined(); expect(backup.automations[0].pluginIds).toEqual([old.id]); expect(backup.automations[0].enabled).toBe(true);
    expect(await packages.asset(plugin, 'image.bin')).toEqual(Buffer.from([0, 255, 128])); expect((await packages.asset(old, 'LICENSE')).toString()).toContain('Preserve');
    await expect(new ExtensionSettings(vault, new LocalSkills('unused')).backup()).rejects.toThrow('unavailable');
  });
  it('rejects incomplete or changed packages and cleans up only newly restored copies on failures', async () => {
    const { directory, vault, source, settings, extensions } = await setup();
    vi.spyOn(vault, 'update').mockRejectedValueOnce(new Error('Disk full')); await expect(settings.importPath(source)).rejects.toThrow('Disk full'); expect(await readdir(join(directory, 'plugins'))).toEqual([]);
    await settings.importPath(source); const backup = await extensions.backup(); const originalId = backup.plugins[0].id;
    for (const change of [{ pluginBundles: [] }, { pluginBundles: undefined }, { pluginBundles: [...backup.pluginBundles, ...backup.pluginBundles] }]) await expect(extensions.restore({ ...backup, ...change })).rejects.toThrow('does not match');
    const changed = structuredClone(backup); changed.pluginBundles[0].files.find((file) => file.path === 'main.js')!.base64 = Buffer.from('Changed source').toString('base64'); await expect(extensions.restore(changed)).rejects.toThrow('metadata');
    expect(await readdir(join(directory, 'plugins'))).toEqual([originalId]);
    vi.spyOn(vault, 'update').mockRejectedValueOnce(new Error('Disk full')); await expect(extensions.restore(backup)).rejects.toThrow('Disk full'); expect(await readdir(join(directory, 'plugins'))).toEqual([originalId]);
    await expect(extensions.restore({ ...backup, plugins: [] })).rejects.toThrow('unexpected');
    await expect(new ExtensionSettings(vault, new LocalSkills('unused')).restore(backup)).rejects.toThrow('does not match');
  });
});
