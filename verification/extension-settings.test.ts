import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mcpServerSchema } from '../contracts/extensions';
import { composerDraftSchema, emptyWorkspace, workspaceSchema } from '../contracts/workspace';
import { ExtensionSettings } from '../desktop/services/extension-settings';
import { LocalSkills } from '../desktop/services/local-skills';
import { sampleThread, testVault } from './fixtures';
import { randomUUID } from 'node:crypto';
import { automationInputSchema } from '../contracts/automations';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function setup() {
  const { vault, directory } = await testVault(); directories.push(directory);
  const skills = new LocalSkills(join(directory, 'skills')); const settings = new ExtensionSettings(vault, skills);
  const source = join(directory, 'source'); await mkdir(source); await writeFile(join(source, 'SKILL.md'), '---\nname: Test\n---\nInstructions'); await writeFile(join(source, 'LICENSE'), 'License');
  return { vault, directory, skills, settings, source };
}
const config = () => mcpServerSchema.parse({ id: 'server', name: 'Server', transport: 'http', endpoint: 'http://localhost:8080/mcp' });
describe('extension configuration and backups', () => {
  it('restores automation history and complete selected skill assets with fresh IDs while pausing every imported schedule', async () => {
    const { settings, vault, source } = await setup(); await settings.importSkill(source); const skill = vault.snapshot().skills[0];
    await vault.update((draft) => { draft.preferences.desktop = { trayEnabled: true, closeToTray: true, shortcutEnabled: true, accelerator: 'Ctrl+Alt+Shift+F12' }; });
    const input = automationInputSchema.parse({ id: randomUUID(), name: 'Imported schedule', prompt: 'Review evidence', providerId: vault.snapshot().providers[0].id, model: 'test-model', schedule: { kind: 'interval', minutes: 60 }, skillIds: [skill.id], enabled: true });
    await vault.update((draft) => { draft.automations.push({ ...input, createdAt: 1, updatedAt: 1, nextRunAt: Date.now() + 60_000, runs: [{ id: randomUUID(), startedAt: 1, status: 'running', trigger: 'scheduled' }] }); });
    const backup = await settings.backup(); const restored = await settings.restore(backup); expect(restored.automations[0]).toMatchObject({ enabled: false, runs: [{ status: 'stopped' }] }); expect(restored.automations[0].nextRunAt).toBeUndefined(); expect(restored.automations[0].skillIds).toEqual([restored.skills[0].id]); expect(restored.skills[0].id).not.toBe(skill.id); expect(backup.automations[0].enabled).toBe(true);
    expect(restored.preferences.desktop).toEqual({ trayEnabled: false, closeToTray: false, shortcutEnabled: false, accelerator: 'Ctrl+Alt+Shift+F12' }); expect(backup.preferences.desktop?.trayEnabled).toBe(true);
  });
  it('clears a previous active conversation when a restored backup has no matching active owner', async () => {
    const { settings, vault } = await setup();
    await vault.update((draft) => { draft.threads.push(sampleThread()); draft.activeThreadId = 'thread'; });
    expect((await settings.restore(emptyWorkspace())).activeThreadId).toBeUndefined();
    expect((await settings.restore({ ...emptyWorkspace(), activeThreadId: 'missing' })).activeThreadId).toBeUndefined();
  });
  it('validates destinations and migrates old workspaces without enabling extensions', () => {
    expect(() => mcpServerSchema.parse({ ...config(), endpoint: 'https://user:password@example.com/mcp' })).toThrow();
    expect(() => mcpServerSchema.parse({ ...config(), endpoint: 'file:///tmp' })).toThrow();
    expect(() => mcpServerSchema.parse({ ...config(), transport: 'stdio', command: '' })).toThrow();
    const old = workspaceSchema.parse({ schemaVersion: 1, providers: [], threads: [], projects: [], assistants: [], notes: [], preferences: {} });
    expect(old.skills).toEqual([]); expect(old.mcpServers).toEqual([]);
  });
  it('encrypts MCP credentials, preserves them on edits, clears them on destination changes and never exports secrets', async () => {
    const { settings, vault, directory } = await setup();
    await settings.saveServer({ ...config(), autoConnect: true }, { token: 'private-token', env: { API_KEY: 'private-env' } });
    expect(settings.credentials('server')).toEqual({ token: 'private-token', env: { API_KEY: 'private-env' } });
    expect(await readFile(join(directory, 'credentials.json'), 'utf8')).not.toContain('private-token');
    expect(await readFile(join(directory, 'workspace.json'), 'utf8')).not.toContain('private-env');
    const backup = await settings.backup(); expect(JSON.stringify(backup)).not.toContain('private-'); expect(backup.mcpServers[0]).toMatchObject({ autoConnect: false, hasCredentials: false });
    await settings.saveServer({ ...config(), name: 'Renamed' }); expect(settings.credentials('server').token).toBe('private-token');
    await settings.saveServer({ ...config(), endpoint: 'http://localhost:9090/mcp' }); expect(settings.credentials('server')).toEqual({});
    await settings.saveServer(config(), { token: 'new' }); await settings.saveServer(config(), {}); expect(settings.credentials('server')).toEqual({});
    await settings.removeServer('server'); expect(vault.snapshot().mcpServers).toEqual([]); expect(settings.credentials('missing')).toEqual({});
  });
  it('imports skills, changes only enabled state, and retains original files after removal', async () => {
    const { settings, source, vault } = await setup(); const state = await settings.importSkill(source); const skill = state.skills[0];
    await settings.saveSkill({ ...skill, name: 'Forged metadata', enabled: false }); expect(vault.snapshot().skills[0]).toMatchObject({ name: 'Test', enabled: false });
    await settings.removeSkill(skill.id); expect(vault.snapshot().skills).toEqual([]); expect(await readFile(join(source, 'LICENSE'), 'utf8')).toBe('License');
    await expect(settings.saveSkill(skill)).rejects.toThrow('no longer'); await expect(settings.removeSkill(skill.id)).rejects.toThrow('no longer');
  });
  it('preserves saved credentials when a server edit or removal cannot be persisted', async () => {
    const { settings, vault } = await setup(); await settings.saveServer(config(), { token: 'original-token' });
    vi.spyOn(vault, 'update').mockRejectedValueOnce(new Error('Disk full')); await expect(settings.saveServer({ ...config(), endpoint: 'https://different.example/mcp' })).rejects.toThrow('Disk full'); expect(settings.credentials('server').token).toBe('original-token');
    vi.spyOn(vault, 'update').mockRejectedValueOnce(new Error('Disk full')); await expect(settings.removeServer('server')).rejects.toThrow('Disk full'); expect(settings.credentials('server').token).toBe('original-token');
    await vault.setKey('mcp:server', 'provider-key'); expect(settings.credentials('server').token).toBe('original-token');
  });
  it('restores skill assets and remaps conversation selection without overwriting original managed folders', async () => {
    const { settings, source, vault, skills } = await setup(); await settings.importSkill(source); const old = vault.snapshot().skills[0];
    await vault.update((draft) => { draft.threads.push({ id: 'thread', title: 'Thread', model: '', pinned: false, archived: false, createdAt: 1, updatedAt: 1, messages: [], skillIds: [old.id] }); draft.composerDrafts.push({ threadId: 'thread', text: 'Unsent', attachments: [], model: '', mode: 'chat', mcpServerIds: [], skillIds: [old.id], pluginIds: [], updatedAt: 1 }); });
    await vault.commitQuickChat(state => { state.quickChat = { revision: randomUUID(), composerDrafts: [composerDraftSchema.parse({ text: 'Quick skill input', skillIds: [old.id], updatedAt: 1 })] }; });
    const backup = await settings.backup(); const restored = await settings.restore(backup);
    expect(restored.skills[0].id).not.toBe(old.id); expect(restored.threads[0].skillIds).toEqual([restored.skills[0].id]);
    expect(restored.composerDrafts[0].skillIds).toEqual([restored.skills[0].id]);
    expect(restored.quickChat?.composerDrafts[0].skillIds).toEqual([restored.skills[0].id]);
    expect(restored.quickChat?.revision).not.toBe(backup.quickChat?.revision); expect(backup.quickChat?.composerDrafts[0].skillIds).toEqual([old.id]);
    expect(await skills.read(restored.skills[0].id, 'LICENSE')).toBe('License'); expect(await skills.read(old.id, 'LICENSE')).toBe('License');
    await expect(settings.restore({ ...backup, skillBundles: [] })).rejects.toThrow('does not match');
  });
  it('invalidates old quick-chat windows on backup replacement and clears quick state for a legacy backup', async () => {
    const { vault, settings } = await setup(); const revision = randomUUID();
    await vault.commitQuickChat(state => { state.quickChat = { revision, composerDrafts: [composerDraftSchema.parse({ text: 'Backed-up quick input', updatedAt: 1 })] }; });
    const backup = await settings.backup(); const restored = await settings.restore(backup);
    expect(restored.quickChat?.revision).not.toBe(revision); expect(restored.quickChat?.composerDrafts[0].text).toBe('Backed-up quick input');
    await settings.restore(emptyWorkspace()); expect(vault.quickChat()).toBeUndefined();
  });
  it('rolls back newly copied assets on persistence failure and disables missing assets in legacy backups', async () => {
    const { settings, source, vault, directory, skills } = await setup();
    vi.spyOn(vault, 'update').mockRejectedValueOnce(new Error('Disk full')); await expect(settings.importSkill(source)).rejects.toThrow('Disk full'); expect(await readdir(join(directory, 'skills'))).toEqual([]);
    await settings.importSkill(source); const backup = await settings.backup(); const originalId = backup.skills[0].id;
    vi.spyOn(vault, 'update').mockRejectedValueOnce(new Error('Disk full')); await expect(settings.restore(backup)).rejects.toThrow('Disk full'); expect(await readdir(join(directory, 'skills'))).toEqual([originalId]);
    await skills.remove(originalId); const { skillBundles: _bundles, ...legacy } = backup;
    expect((await settings.restore(legacy)).skills[0].enabled).toBe(false);
    await vault.setKey('\0mcp:broken', '{bad'); await settings.saveServer({ ...config(), id: 'broken' }); expect(() => settings.credentials('broken')).toThrow('invalid');
  });
});
