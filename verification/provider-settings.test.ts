import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderSettings, providerDestination, providerKey, bindProviderKeys } from '../desktop/services/provider-settings';
import { WorkspaceVault } from '../desktop/services/vault';
import { emptyWorkspace } from '../contracts/workspace';
import { ExtensionSettings } from '../desktop/services/extension-settings';
import { LocalSkills } from '../desktop/services/local-skills';
import { codec, provider, testVault } from './fixtures';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
async function setup() { const { vault, directory } = await testVault(); directories.push(directory); const stop = vi.fn().mockResolvedValue(undefined); return { vault, directory, stop, settings: new ProviderSettings(vault, stop) }; }

describe('provider configuration and destination-bound credentials', () => {
  it('normalizes trailing slashes, encrypts keys, preserves ordinary edits, and excludes secrets from backups', async () => {
    const { vault, directory, stop, settings } = await setup();
    expect(providerDestination(provider)).toBe(providerDestination({ ...provider, endpoint: `${provider.endpoint}/` }));
    const state = await settings.save(provider, '  private-provider-key  '); expect(state.preferences).toMatchObject({ defaultProviderId: provider.id, defaultModel: 'test-model' });
    expect(settings.key(provider)).toBe('private-provider-key'); expect(settings.key(provider, ' override ')).toBe('override'); expect(vault.key(provider.id)).toBe('');
    expect(await readFile(join(directory, 'credentials.json'), 'utf8')).not.toContain('private-provider-key'); expect(JSON.stringify(vault.backup())).not.toContain('private-provider-key');
    stop.mockClear(); await settings.save({ ...provider, name: 'Renamed', hasKey: false }); expect(stop).not.toHaveBeenCalled(); expect(vault.snapshot().providers[0].hasKey).toBe(true);
    const restarted = new WorkspaceVault(directory, codec); await restarted.initialize(); expect(providerKey(restarted, provider)).toBe('private-provider-key'); expect(restarted.snapshot().providers[0].hasKey).toBe(true);
    await settings.save(provider, ''); expect(settings.key(provider)).toBe(''); expect(vault.snapshot().providers[0].hasKey).toBe(false);
  });

  it('refuses saved keys for a changed endpoint/type, clears them on save and stops affected turns', async () => {
    const { vault, stop, settings } = await setup(); await settings.save(provider, 'private-key');
    const changed = { ...provider, kind: 'gemini' as const, endpoint: 'https://generativelanguage.googleapis.com/v1beta' };
    expect(settings.key(changed)).toBe(''); expect(settings.key({ ...provider, id: 'missing' })).toBe('');
    await settings.save(changed); expect(settings.key(changed)).toBe(''); expect(vault.snapshot().providers[0].hasKey).toBe(false); expect(stop).toHaveBeenCalledWith(provider.id);
    await settings.save(changed, 'gemini-key'); await settings.save({ ...changed, models: ['different-model'] }); expect(settings.key(changed)).toBe('gemini-key');
    const azure = { ...provider, kind: 'azure' as const }; await settings.save(azure, 'azure-key'); await settings.save({ ...azure, azureApi: 'chat' }); await settings.save({ ...azure, azureApi: 'deployment-chat', apiVersion: '2024-10-21' });
    expect(settings.key(azure)).toBe('azure-key'); expect(stop.mock.calls.length).toBe(7);
  });

  it('migrates legacy keys and refuses to rebind them during backup restoration under a reused ID', async () => {
    const { vault, directory, settings } = await setup(); await vault.setKey(provider.id, 'legacy-key'); expect(settings.key(provider)).toBe('legacy-key');
    expect(settings.key({ ...provider, endpoint: 'https://different.invalid/v1' })).toBe('');
    const extensions = new ExtensionSettings(vault, new LocalSkills(directory));
    const backup = { ...emptyWorkspace(), providers: [{ ...provider, endpoint: 'https://different.invalid/v1', hasKey: true }] };
    const restored = await extensions.restore(backup); expect(restored.providers[0].hasKey).toBe(false); expect(settings.key(restored.providers[0])).toBe('');
    expect(providerKey(vault, provider)).toBe('legacy-key'); await bindProviderKeys(vault); expect(providerKey(vault, provider)).toBe('legacy-key');
    const restarted = new WorkspaceVault(directory, codec); await restarted.initialize(); expect(restarted.snapshot().providers[0].hasKey).toBe(false);
    await settings.save(restored.providers[0]); expect(settings.key(restored.providers[0])).toBe(''); expect(vault.key(provider.id)).toBe('');
  });

  it('restores both bound and legacy credentials when saving/removing cannot persist', async () => {
    const { vault, settings } = await setup(); await vault.setKey(provider.id, 'legacy-key');
    vi.spyOn(vault, 'updateSettings').mockRejectedValueOnce(new Error('Disk full')); await expect(settings.save(provider, 'replacement')).rejects.toThrow('Disk full'); expect(settings.key(provider)).toBe('legacy-key');
    await settings.save(provider, 'bound-key'); await vault.setKey(provider.id, 'legacy-fallback');
    vi.spyOn(vault, 'updateSettings').mockRejectedValueOnce(new Error('Disk full')); await expect(settings.save({ ...provider, endpoint: 'https://different.invalid' })).rejects.toThrow('Disk full'); expect(settings.key(provider)).toBe('bound-key'); expect(vault.key(provider.id)).toBe('legacy-fallback');
    vi.spyOn(vault, 'updateSettings').mockRejectedValueOnce(new Error('Disk full')); await expect(settings.remove(provider.id)).rejects.toThrow('Disk full'); expect(settings.key(provider)).toBe('bound-key'); expect(vault.snapshot().providers).toHaveLength(1);
    vi.spyOn(vault, 'setKey').mockRejectedValueOnce(new Error('Credential store failed')); await expect(settings.save(provider, 'new')).rejects.toThrow('Credential store failed'); expect(settings.key(provider)).toBe('bound-key');
  });

  it('serializes config changes, recovers from failures, and selects the next remaining default on removal', async () => {
    const { vault, settings } = await setup();
    await Promise.all([settings.save(provider, 'first'), settings.save({ ...provider, name: 'Latest' }, 'second')]); expect(settings.key(provider)).toBe('second'); expect(vault.snapshot().providers[0].name).toBe('Latest');
    await settings.save({ ...provider, id: 'next', models: [] }); await settings.remove(provider.id); expect(vault.snapshot().preferences).toMatchObject({ defaultProviderId: 'next', defaultModel: '' });
    await settings.remove('next'); expect(vault.snapshot().preferences.defaultProviderId).toBeUndefined(); await settings.remove('missing');
    expect(() => settings.remove('\0mcp:server')).toThrow(); expect(() => settings.save(provider, 'x'.repeat(4097))).toThrow(); expect(() => settings.key(provider, 'x'.repeat(4097))).toThrow();
  });

  it('redacts malformed bound credentials, permits replacement, and leaves configuration untouched if stopping fails', async () => {
    const { vault, settings, stop } = await setup(); await vault.setKey('\0provider:local', 'private-malformed-secret');
    try { settings.key(provider); throw new Error('Expected rejection'); } catch (error) { expect(String(error)).toContain('invalid'); expect(String(error)).not.toContain('private-malformed'); }
    await settings.save(provider, 'new-key'); expect(settings.key(provider)).toBe('new-key'); stop.mockRejectedValueOnce(new Error('Stop failed'));
    await expect(settings.save({ ...provider, models: ['changed'] })).rejects.toThrow('Stop failed'); expect(vault.snapshot().providers[0].models).toEqual(provider.models); expect(settings.key(provider)).toBe('new-key');
  });
  it('retains unreadable sealed keys on failed replacement and allows key repair/removal after restart', async () => {
    const { vault, directory } = await setup(); await vault.setKey('\0provider:local', 'unreadable'); await vault.setKey(provider.id, 'unreadable');
    const stored = await readFile(join(directory, 'credentials.json'), 'utf8');
    const broken = new WorkspaceVault(directory, { seal: codec.seal, open: (value) => { if (value === codec.seal('unreadable')) throw new Error('private cipher detail'); return codec.open(value); } });
    await broken.initialize(); expect(broken.snapshot().providers[0].hasKey).toBe(false); const settings = new ProviderSettings(broken, async () => {});
    vi.spyOn(broken, 'updateSettings').mockRejectedValueOnce(new Error('Disk full')); await expect(settings.save(provider, 'replacement')).rejects.toThrow('Disk full'); expect(await readFile(join(directory, 'credentials.json'), 'utf8')).toBe(stored);
    await settings.save(provider, 'replacement'); expect(settings.key(provider)).toBe('replacement');
    await broken.setKey('\0provider:local', 'unreadable'); await settings.remove(provider.id); expect(broken.snapshot().providers).toEqual([]);
  });
  it('keeps malformed bound credentials editable after restart and omits unusable keys when restoring a backup', async () => {
    const { vault, directory } = await setup(); await vault.setKey('\0provider:local', 'not-json');
    const restarted = new WorkspaceVault(directory, codec); await restarted.initialize(); expect(restarted.snapshot().providers[0].hasKey).toBe(false);
    const restored = await new ExtensionSettings(restarted, new LocalSkills(directory)).restore({ ...emptyWorkspace(), providers: [provider] }); expect(restored.providers[0].hasKey).toBe(false);
    const settings = new ProviderSettings(restarted, async () => {}); await settings.save(provider, 'repaired'); expect(settings.key(provider)).toBe('repaired');
  });
});
