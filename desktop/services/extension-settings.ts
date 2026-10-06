import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { mcpCredentialsSchema, mcpServerSchema, skillBundleSchema, skillSchema, type McpCredentials, type McpServer, type Skill } from '../../contracts/extensions';
import { parsePersistentWorkspace } from '../../contracts/temporary-conversations';
import { mcpDestination } from './mcp-identity';
import { bindProviderKeys, providerKey } from './provider-settings';
import { interruptRuns } from './interrupted-runs';
import type { WorkspaceVault } from './vault';
import type { LocalSkills } from './local-skills';
import type { LocalPlugins } from './local-plugins';
import type { Plugin } from '../../contracts/plugins';
import { backupFiles } from './backup-files';

export class ExtensionSettings {
  constructor(private readonly vault: WorkspaceVault, private readonly skills: LocalSkills, private readonly plugins?: LocalPlugins) {}

  credentials(id: string): McpCredentials {
    const config = this.vault.mcpServer(id);
    const secret = this.vault.key(`\0mcp:${id}`);
    if (!secret || !config) return {};
    try {
      const stored = JSON.parse(secret);
      return stored.destination === mcpDestination(config) ? mcpCredentialsSchema.parse(stored.credentials) : {};
    } catch { throw new Error('The saved MCP credentials are invalid. Enter them again in settings.'); }
  }

  async saveServer(raw: McpServer, rawCredentials?: McpCredentials) {
    const server = mcpServerSchema.parse(raw);
    const previous = this.vault.mcpServer(server.id);
    const credentialId = `\0mcp:${server.id}`;
    const previousSecret = this.vault.key(credentialId);
    const oauthId = `\0mcp-oauth:${server.id}`; const previousOAuth = this.vault.key(oauthId);
    try {
      if (rawCredentials !== undefined) {
        const credentials = mcpCredentialsSchema.parse(rawCredentials);
        const hasSecret = Boolean(credentials.token || credentials.clientSecret || Object.keys(credentials.env ?? {}).length);
        await this.vault.setKey(credentialId, hasSecret ? JSON.stringify({ destination: mcpDestination(server), credentials }) : '');
      } else if (previous && mcpDestination(previous) !== mcpDestination(server)) await this.vault.setKey(credentialId, '');
      if ((previous && mcpDestination(previous) !== mcpDestination(server)) || rawCredentials !== undefined) await this.vault.setKey(oauthId, '');
      server.hasCredentials = Boolean(this.vault.key(credentialId));
      return await this.vault.update((draft) => {
        const index = draft.mcpServers.findIndex((item) => item.id === server.id);
        if (index < 0) draft.mcpServers.push(server); else draft.mcpServers[index] = server;
      });
    } catch (error) { await this.vault.setKey(credentialId, previousSecret); await this.vault.setKey(oauthId, previousOAuth); throw error; }
  }

  async removeServer(id: string) {
    const credentialId = `\0mcp:${id}`; const previousSecret = this.vault.key(credentialId);
    const oauthId = `\0mcp-oauth:${id}`; const previousOAuth = this.vault.key(oauthId);
    try {
      await this.vault.setKey(credentialId, '');
      await this.vault.setKey(oauthId, '');
      return await this.vault.update((draft) => {
        draft.mcpServers = draft.mcpServers.filter((item) => item.id !== id);
        draft.threads.forEach((thread) => { thread.mcpServerIds = thread.mcpServerIds?.filter((item) => item !== id); });
      });
    } catch (error) { await this.vault.setKey(credentialId, previousSecret); await this.vault.setKey(oauthId, previousOAuth); throw error; }
  }

  async importSkill(path: string) {
    const skill = await this.skills.importPath(path);
    try { return await this.vault.update((draft) => { draft.skills.push(skill); }); }
    catch (error) { await this.skills.remove(skill.id); throw error; }
  }

  saveSkill(raw: Skill) {
    const skill = skillSchema.parse(raw);
    return this.vault.update((draft) => {
      const existing = draft.skills.find((item) => item.id === skill.id);
      if (!existing) throw new Error('This skill no longer exists. Import it again.');
      existing.enabled = skill.enabled;
    });
  }

  async removeSkill(id: string) {
    if (!this.vault.snapshot().skills.some((skill) => skill.id === id)) throw new Error('This skill no longer exists.');
    // If metadata cannot be saved, keep the original managed assets available for recovery.
    const next = await this.vault.update((draft) => {
      draft.skills = draft.skills.filter((skill) => skill.id !== id);
      draft.threads.forEach((thread) => { thread.skillIds = thread.skillIds?.filter((item) => item !== id); });
    });
    try { await this.skills.remove(id); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return next;
  }

  async backup() {
    const workspace = await this.vault.backupWithOriginals();
    const skillBundles = await Promise.all(workspace.skills.map((skill) => this.skills.bundle(skill.id)));
    if (workspace.plugins.length && !this.plugins) throw new Error('Plugin assets are unavailable for backup.');
    const pluginBundles = await Promise.all(workspace.plugins.map((plugin) => this.plugins!.bundle(plugin.id)));
    const backup = { ...workspace, skillBundles, pluginBundles };
    await backupFiles.size(backup);
    return backup;
  }

  async restore(raw: unknown) {
    const backup = parsePersistentWorkspace(raw);
    const composerDrafts = [...backup.composerDrafts, ...(backup.quickChat?.composerDrafts ?? [])];
    if (backup.quickChat) backup.quickChat.revision = randomUUID();
    await this.vault.prepareOriginalRestore(raw, backup);
    if (backup.preferences.desktop) Object.assign(backup.preferences.desktop, { trayEnabled: false, closeToTray: false, shortcutEnabled: false });
    interruptRuns(backup.threads);
    for (const task of backup.automations) {
      task.enabled = false; task.nextRunAt = undefined;
      for (const run of task.runs) if (run.status === 'running') { run.status = 'stopped'; run.finishedAt = Date.now(); run.error = 'This run was interrupted in the restored backup.'; }
    }
    const bundles = z.object({ skillBundles: z.array(skillBundleSchema).max(1000).optional() }).parse(raw).skillBundles;
    const pluginBundles = z.object({ pluginBundles: z.array(skillBundleSchema).max(100).optional() }).parse(raw).pluginBundles;
    const created: Skill[] = [];
    const createdPlugins: Plugin[] = [];
    try {
      if (bundles) {
        if (bundles.length !== backup.skills.length || new Set(bundles.map((item) => item.id)).size !== bundles.length) throw new Error('The backup does not match its skill assets.');
        const remap = new Map<string, string>();
        for (const skill of backup.skills) {
          const bundle = bundles.find((item) => item.id === skill.id);
          if (!bundle) throw new Error('The backup is missing a skill bundle.');
          const restored = await this.skills.restore(bundle); created.push(restored); remap.set(skill.id, restored.id);
          skill.id = restored.id;
        }
        backup.threads.forEach((thread) => { thread.skillIds = thread.skillIds?.map((id) => remap.get(id)).filter((id): id is string => Boolean(id)); });
        composerDrafts.forEach((draft) => { draft.skillIds = draft.skillIds.map((id) => remap.get(id)).filter((id): id is string => Boolean(id)); });
        backup.automations.forEach((task) => { task.skillIds = task.skillIds.map((id) => remap.get(id)).filter((id): id is string => Boolean(id)); });
      } else {
        for (const skill of backup.skills) { try { await this.skills.document(skill.id); } catch { skill.enabled = false; } }
      }
      if (backup.plugins.length) {
        if (!this.plugins || !pluginBundles || pluginBundles.length !== backup.plugins.length || new Set(pluginBundles.map((item) => item.id)).size !== pluginBundles.length) throw new Error('The backup does not match its plugin packages.');
        const remap = new Map<string, string>();
        for (const plugin of backup.plugins) {
          const bundle = pluginBundles.find((item) => item.id === plugin.id); if (!bundle) throw new Error('The backup is missing a plugin package.');
          const restored = await this.plugins.restore(bundle); createdPlugins.push(restored);
          if (JSON.stringify(restored.manifest) !== JSON.stringify(plugin.manifest) || JSON.stringify(restored.hashes) !== JSON.stringify(plugin.hashes)) throw new Error('The plugin package does not match its backup metadata.');
          remap.set(plugin.id, restored.id); plugin.id = restored.id; plugin.enabled = false; plugin.grants = [];
        }
        for (const thread of backup.threads) thread.pluginIds = thread.pluginIds?.map((id) => remap.get(id)).filter((id): id is string => Boolean(id));
        for (const draft of composerDrafts) draft.pluginIds = draft.pluginIds.map((id) => remap.get(id)).filter((id): id is string => Boolean(id));
        for (const task of backup.automations) task.pluginIds = task.pluginIds.map((id) => remap.get(id)).filter((id): id is string => Boolean(id));
      } else if (pluginBundles?.length) throw new Error('The backup contains unexpected plugin packages.');
      await bindProviderKeys(this.vault);
      backup.providers.forEach((provider) => {
        try { provider.hasKey = Boolean(providerKey(this.vault, provider)); }
        catch { provider.hasKey = false; }
      });
      backup.mcpServers.forEach((server) => {
        server.autoConnect = false;
        const stored = this.vault.key(`\0mcp:${server.id}`);
        try { server.hasCredentials = Boolean(stored && JSON.parse(stored).destination === mcpDestination(server)); }
        catch { server.hasCredentials = false; }
      });
      return await this.vault.update((draft) => { Object.assign(draft, backup); if (!backup.quickChat) delete draft.quickChat; draft.activeThreadId = backup.threads.some((thread) => thread.id === backup.activeThreadId) ? backup.activeThreadId : undefined; });
    } catch (error) { await Promise.all([...created.map((skill) => this.skills.remove(skill.id)), ...createdPlugins.map((plugin) => this.plugins!.remove(plugin.id))]); throw error; }
  }
}
